from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, col
from typing import List, Optional
from pydantic import BaseModel

from services.business_api import BusinessRuClient
from database import get_session
from models import Transaction, User, Product
from auth import get_current_user, get_current_admin
from schemas import TransactionCreateRequest, TransactionRead, TransactionBulkReassignRequest
from utils import create_audit_log

router = APIRouter(prefix="/api/transactions", tags=["Transactions"])

class BalanceCorrectionRequest(BaseModel):
    seller_id: int
    amount: float
    comment: str


@router.post("/correction")
def apply_balance_correction(
        req: BalanceCorrectionRequest,
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    # Доступ только для администратора
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Доступ запрещен")

    # 1. ЗАЩИТА ГОНКИ: Блокируем строку пользователя в БД
    # Пока эта транзакция не завершится (commit), никто другой не сможет изменить этого юзера
    user = session.exec(
        select(User).where(User.id == req.seller_id).with_for_update()
    ).first()

    if not user:
        raise HTTPException(status_code=404, detail="Продавец не найден")

    old_balance = user.balance
    new_balance = old_balance + req.amount

    # 2. Применяем изменения
    user.balance = new_balance
    session.add(user)

    # 3. Создаем запись о финансовой операции
    transaction = Transaction(
        type="correction",
        amount=req.amount,
        comment=req.comment,
        seller_id=user.id
    )
    session.add(transaction)

    # Делаем flush, чтобы БД присвоила ID транзакции (он нам нужен для лога)
    # При этом commit еще не происходит, данные в БД еще не зафиксированы окончательно
    session.flush()

    # 4. Записываем понятный лог (одна строка с JSON)
    create_audit_log(
        session=session,
        actor=current_user.get("username"),
        entity_name="User",
        entity_id=user.id,
        action="manual_balance_correction",
        changes={
            "balance": {"old": old_balance, "new": new_balance},
            "transaction_id": transaction.id,
            "comment": req.comment
        }
    )

    # 5. Сохраняем всё вместе. Транзакция закрывается, блокировка строки снимается!
    session.commit()
    session.refresh(user)

    return {"status": "success", "new_balance": user.balance}

@router.get("/", response_model=List[TransactionRead])
def get_transactions(
        seller_filter: Optional[str] = Query("all", description="all, unassigned, или ID продавца"),
        type_filter: Optional[str] = Query("all", description="Тип операции: sale, payout, rent, correction"),
        min_amount: Optional[float] = Query(None, description="Минимальная сумма"),
        max_amount: Optional[float] = Query(None, description="Максимальная сумма"),
        start_date: Optional[datetime] = Query(None, description="Начальная дата (YYYY-MM-DDTHH:MM:SS)"),
        end_date: Optional[datetime] = Query(None, description="Конечная дата (YYYY-MM-DDTHH:MM:SS)"),
        sort_by: Optional[str] = Query("date_desc", description="Сортировка: date_desc, date_asc, amount_desc, amount_asc"),
        limit: int = Query(50, ge=1, le=100),
        offset: int = Query(0, ge=0),
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    statement = select(Transaction)

    # 1. Фильтр по роли и продавцу (Задача 3)
    if current_user.get("role") == "seller":
        user_in_db = session.exec(select(User).where(User.username == current_user.get("username"))).first()
        statement = statement.where(Transaction.seller_id == user_in_db.id)
    elif current_user.get("role") == "admin":
        if seller_filter == "unassigned":
            statement = statement.where(Transaction.seller_id == None)
        elif seller_filter != "all" and seller_filter.isdigit():
            statement = statement.where(Transaction.seller_id == int(seller_filter))

    # 2. Фильтр по типу операции
    if type_filter and type_filter != "all":
        statement = statement.where(Transaction.type == type_filter)

    # 3. Фильтр по сумме
    if min_amount is not None:
        statement = statement.where(Transaction.amount >= min_amount)
    if max_amount is not None:
        statement = statement.where(Transaction.amount <= max_amount)

    # 4. Фильтр по датам
    if start_date:
        statement = statement.where(Transaction.date >= start_date)
    if end_date:
        statement = statement.where(Transaction.date <= end_date)

    # 5. Сортировка
    if sort_by == "date_desc":
        statement = statement.order_by(col(Transaction.date).desc())
    elif sort_by == "date_asc":
        statement = statement.order_by(Transaction.date)
    elif sort_by == "amount_desc":
        statement = statement.order_by(col(Transaction.amount).desc())
    elif sort_by == "amount_asc":
        statement = statement.order_by(Transaction.amount)

    return session.exec(statement.offset(offset).limit(limit)).all()


@router.post("/", response_model=TransactionRead)
def create_manual_transaction(
        req: TransactionCreateRequest,
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    # ЗАЩИТА: Блокируем продавца от параллельных изменений
    seller = session.exec(
        select(User).where(User.id == req.seller_id).with_for_update()
    ).first()

    if not seller:
        raise HTTPException(status_code=404, detail="Продавец не найден")

    new_transaction = Transaction(
        type=req.type,
        amount=req.amount,
        comment=req.comment,
        seller_id=seller.id
    )

    old_balance = seller.balance
    seller.balance += req.amount

    session.add(new_transaction)
    session.add(seller)
    session.flush()  # Получаем ID транзакции до коммита

    # Пишем в лог
    create_audit_log(
        session=session,
        actor=admin_data.get("username", "admin"),
        entity_name="User",
        entity_id=seller.id,
        action="manual_transaction_created",
        changes={
            "balance": {"old": old_balance, "new": seller.balance},
            "transaction_id": new_transaction.id,
            "type": req.type,
            "amount": req.amount
        }
    )

    session.commit()
    session.refresh(new_transaction)

    return new_transaction


def run_b2b_sync(session: Session, force_full: bool = False):
    client = BusinessRuClient()

    existing_check = session.exec(
        select(Transaction).where(Transaction.external_check_id != None).limit(1)
    ).first()

    # ФЛАГ ПЕРВОЙ СИНХРОНИЗАЦИИ или ПРИНУДИТЕЛЬНОЙ ПОЛНОЙ
    is_first_sync = force_full or (existing_check is None)

    all_checks = []
    if is_first_sync:
        # Первая загрузка — тянем всё (по 250 за раз)
        page = 1
        while True:
            checks = client.get_checks(limit=250, page=page)
            if not checks: break
            all_checks.extend(checks)
            page += 1
    else:
        # Последующие загрузки — последние 100
        all_checks = client.get_checks(limit=100, page=1)

    sync_conflicts = []
    processed_count = 0
    skipped_count = 0
    total_revenue = 0.0

    for sale in all_checks:
        check_id = str(sale.get("id"))

        # --- ПАРСИНГ РЕАЛЬНОЙ ДАТЫ ЧЕКА ---
        # Пример: "23.04.2026 14:35:04 MSK"
        raw_date = sale.get("date", "")
        check_date = datetime.now(timezone.utc)
        if raw_date:
            try:
                # Убираем " MSK" и парсим строку
                clean_date = raw_date.replace(" MSK", "").strip()
                dt = datetime.strptime(clean_date, "%d.%m.%Y %H:%M:%S")
                # Приводим к UTC (МСК = UTC+3)
                check_date = dt.replace(tzinfo=timezone(timedelta(hours=3)))
            except ValueError:
                pass

        # Жесткая защита от дублирования
        existing_txs = session.exec(select(Transaction).where(Transaction.external_check_id == check_id)).all()
        if existing_txs:
            skipped_count += 1
            for tx in existing_txs:
                if tx.is_manual_assigned:
                    sync_conflicts.append({
                        "check_id": check_id,
                        "products": tx.product_identifier
                    })
            continue

        grouped_data = {}

        for item in sale.get("goods", []):
            b2b_good_id = str(item.get("good_id", "")).strip()
            price = float(item.get("price", 0))
            count = int(float(item.get("amount", 1)))

            # Сначала ищем товар в нашей БД
            product = session.exec(select(Product).where(Product.sku == b2b_good_id)).first()
            seller_id = product.seller_id if product else None
            # Имя берем из нашей БД, иначе из чека, иначе заглушка
            name = product.name if product else item.get("name", "Неизвестный товар")

            # ВАЖНО: Списываем остатки ТОЛЬКО если это НЕ первая/полная синхронизация
            if product and not is_first_sync:
                product.stock = max(0, product.stock - count)
                session.add(product)

            # Инициализируем группу автора
            if seller_id not in grouped_data:
                grouped_data[seller_id] = {
                    "full_amount": 0.0, "profit": 0.0, "commission": 0.0, "items": []
                }

            total_item_price = price * count
            grouped_data[seller_id]["full_amount"] += total_item_price
            grouped_data[seller_id]["items"].append(f"{name} ({count} шт.)")

            if seller_id:
                seller = session.get(User, seller_id)
                commission_rate = seller.commission_percent if (seller and seller.is_active) else 15.0
                profit = total_item_price * (1 - commission_rate / 100.0)
                commission = total_item_price - profit
            else:
                profit = total_item_price
                commission = 0.0

            grouped_data[seller_id]["profit"] += profit
            grouped_data[seller_id]["commission"] += commission

        # Создаем объединенные транзакции
        for s_id, data in grouped_data.items():
            items_str = ", ".join(data["items"])
            new_tx = Transaction(
                type="sale",
                full_amount=data["full_amount"],
                amount=data["profit"],
                commission_amount=data["commission"],
                seller_id=s_id,
                product_identifier=items_str,
                comment=f"Чек #{check_id} (Бизнес.Ру)",
                external_check_id=check_id,
                date=check_date  # <-- ТЕПЕРЬ СОХРАНЯЕТСЯ РЕАЛЬНАЯ ДАТА ИЗ ЧЕКА
            )
            session.add(new_tx)

            if s_id:
                seller = session.exec(select(User).where(User.id == s_id).with_for_update()).first()
                if seller and seller.is_active:
                    seller.balance += data["profit"]
                    session.add(seller)

            processed_count += 1
            total_revenue += data["full_amount"]

    session.commit()

    if processed_count == 0 and skipped_count == 0:
        return {
            "status": "error",
            "message": "Новых чеков не найдено, повторений тоже нет.",
            "processed_items": 0, "skipped_checks": 0, "total_revenue": 0,
            "conflicts": []
        }

    return {
        "status": "success",
        "message": f"Синхронизация завершена. Обработано новых транзакций: {processed_count}.",
        "processed_items": processed_count,
        "skipped_checks": skipped_count,
        "total_revenue": total_revenue,
        "conflicts": sync_conflicts
    }


@router.post("/sync/sales")
def trigger_manual_sync(
        force_full: bool = Query(False),  # <-- Принимаем параметр с фронтенда
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    result = run_b2b_sync(session=session, force_full=force_full)
    return result


@router.post("/bulk-reassign")
def bulk_reassign_transactions(
        req: TransactionBulkReassignRequest,
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    admin_username = admin_data.get("username", "admin")
    updated_count = 0

    new_seller = None
    if req.new_seller_id is not None:
        new_seller = session.get(User, req.new_seller_id)
        if not new_seller:
            raise HTTPException(status_code=404, detail="Новый продавец не найден")

    for tx_id in req.transaction_ids:
        # Блокируем транзакцию на время изменения
        tx = session.exec(select(Transaction).where(Transaction.id == tx_id).with_for_update()).first()
        if not tx or tx.type != "sale":
            continue

        if tx.seller_id == req.new_seller_id:
            continue

        old_seller_id = tx.seller_id
        old_amount = tx.amount

        # 1. Откатываем баланс старого владельца
        if old_seller_id is not None:
            old_seller = session.exec(select(User).where(User.id == old_seller_id).with_for_update()).first()
            if old_seller:
                old_seller.balance -= tx.amount
                session.add(old_seller)

        # 2. Считаем новую комиссию и начисляем новому владельцу
        if new_seller:
            commission_rate = new_seller.commission_percent if new_seller.is_active else 15.0
            new_profit = tx.full_amount * (1 - commission_rate / 100.0)
            new_comm = tx.full_amount - new_profit

            new_seller.balance += new_profit
            session.add(new_seller)

            tx.amount = new_profit
            tx.commission_amount = new_comm
        else:
            # Транзакция стала "ничейной"
            tx.amount = tx.full_amount
            tx.commission_amount = 0.0

        tx.seller_id = req.new_seller_id
        tx.is_manual_assigned = True
        session.add(tx)

        # 3. Пишем лог аудита
        create_audit_log(
            session=session,
            actor=admin_username,
            entity_name="Transaction",
            entity_id=tx.id,
            action="manual_reassign",
            changes={
                "seller_id": {"old": old_seller_id, "new": req.new_seller_id},
                "amount": {"old": old_amount, "new": tx.amount}
            }
        )
        updated_count += 1

    session.commit()
    return {"status": "success", "updated_count": updated_count}