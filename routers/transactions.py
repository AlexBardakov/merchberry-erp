from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, col
from typing import List, Optional
from pydantic import BaseModel

from services.business_api import BusinessRuClient
from database import get_session
from models import Transaction, User, Product
from auth import get_current_user, get_current_admin
from schemas import TransactionCreateRequest, TransactionRead, \
    TransactionBulkReassignRequest, TransactionUpdateRequest, RentChargeRequest
from utils import create_audit_log
from routers.vk_bot import send_vk_message_sync

router = APIRouter(prefix="/api/transactions", tags=["Transactions"])

SYNC_IN_PROGRESS = False

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


@router.post("/rent", response_model=TransactionRead)
def charge_rent(
        req: RentChargeRequest,
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    if req.payment_method not in ["balance", "own_funds"]:
        raise HTTPException(status_code=400,
                            detail="Неверный метод оплаты аренды")

    # Блокируем строку пользователя для защиты от параллельных изменений
    seller = session.exec(
        select(User).where(User.id == req.seller_id).with_for_update()
    ).first()

    if not seller:
        raise HTTPException(status_code=404, detail="Продавец не найден")

    old_balance = seller.balance

    if req.payment_method == "balance":
        tx_type = "rent_balance"
        tx_comment = "Оплата аренды полки (Списание с баланса)"
        # Уменьшаем баланс
        seller.balance -= req.amount
    else:
        tx_type = "rent_own"
        tx_comment = "Оплата аренды полки (Аренда со своих средств)"
        # Баланс НЕ меняем, транзакция просто для учета

    # Создаем транзакцию. Записываем сумму с минусом для наглядности (списание)
    new_transaction = Transaction(
        type=tx_type,
        amount=-req.amount,
        comment=tx_comment,
        seller_id=seller.id
    )

    session.add(new_transaction)
    session.add(seller)
    session.flush()  # Получаем ID новой транзакции до фиксации в БД

    # Пишем в лог аудита
    create_audit_log(
        session=session,
        actor=admin_data.get("username", "admin"),
        entity_name="User",
        entity_id=seller.id,
        action=f"rent_charge_{req.payment_method}",
        changes={
            "balance": {"old": old_balance, "new": seller.balance},
            "transaction_id": new_transaction.id,
            "type": tx_type,
            "amount": req.amount
        }
    )

    session.commit()
    session.refresh(new_transaction)

    return new_transaction


@router.get("/", response_model=List[TransactionRead])
def get_transactions(
        seller_filter: Optional[str] = Query("all",
                                             description="all, unassigned, или ID продавца"),
        type_filter: Optional[str] = Query("all",
                                           description="Тип операции: sale, payout, rent_balance, rent_own, correction"),
        min_amount: Optional[float] = Query(None,
                                            description="Минимальная сумма"),
        max_amount: Optional[float] = Query(None,
                                            description="Максимальная сумма"),
        start_date: Optional[datetime] = Query(None,
                                               description="Начальная дата (YYYY-MM-DDTHH:MM:SS)"),
        end_date: Optional[datetime] = Query(None,
                                             description="Конечная дата (YYYY-MM-DDTHH:MM:SS)"),
        sort_by: Optional[str] = Query("date_desc",
                                       description="Сортировка: date_desc, date_asc, amount_desc, amount_asc"),
        limit: int = Query(50, ge=1, le=100),
        offset: int = Query(0, ge=0),
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    statement = select(Transaction)

    # 1. НАДЕЖНАЯ ПРОВЕРКА РОЛИ (Исправление доступа)
    username = current_user.get("username")
    user_in_db = session.exec(
        select(User).where(User.username == username)).first()

    if not user_in_db:
        raise HTTPException(status_code=401, detail="Пользователь не найден")

    # Ограничиваем видимость чеков на основе реальной роли из БД
    if user_in_db.role == "seller":
        statement = statement.where(Transaction.seller_id == user_in_db.id)
    elif user_in_db.role == "admin":
        if seller_filter == "unassigned":
            statement = statement.where(Transaction.seller_id == None)
        elif seller_filter != "all" and seller_filter.isdigit():
            statement = statement.where(
                Transaction.seller_id == int(seller_filter))

    # 2. Фильтр по типу операции
    if type_filter and type_filter != "all":
        if type_filter == "rent_all":
            # Ищем и старые записи (rent), и новые (rent_balance, rent_own)
            statement = statement.where(
                Transaction.type.in_(["rent", "rent_balance", "rent_own"]))
        else:
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

    # Если аренда со своих средств, то баланс пользователя НЕ меняем
    if req.type != "rent_own":
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
        select(Transaction).where(Transaction.external_check_id != None).limit(
            1)
    ).first()

    is_first_sync = force_full or (existing_check is None)

    all_checks = []
    all_returns = []

    if is_first_sync:
        page = 1
        while True:
            checks = client.get_checks(limit=250, page=page)
            if not checks: break
            all_checks.extend(checks)
            page += 1

        page = 1
        while True:
            returns = client.get_returns(limit=250, page=page)
            if not returns: break
            all_returns.extend(returns)
            page += 1
    else:
        all_checks = client.get_checks(limit=100, page=1)
        all_returns = client.get_returns(limit=100, page=1)

    # Помечаем операции для удобной обработки
    for c in all_checks:
        c["is_return"] = False
    for r in all_returns:
        r["is_return"] = True

    # Объединяем списки продаж и возвратов в один массив
    all_operations = all_checks + all_returns

    sync_conflicts = []
    processed_count = 0
    skipped_count = 0
    total_revenue = 0.0

    TOMSK_TZ = timezone(timedelta(hours=7))

    for op in all_operations:
        is_return = op.get("is_return", False)
        raw_id = str(op.get("id", "")).strip()

        if not raw_id:
            continue

        external_id = f"return_{raw_id}" if is_return else raw_id

        # --- ПАРСИНГ РЕАЛЬНОЙ ДАТЫ ЧЕКА В ТОМСКОЕ ВРЕМЯ ---
        raw_date = op.get("date", "")
        check_date = datetime.now(TOMSK_TZ)
        if raw_date:
            try:
                clean_date = raw_date.replace(" MSK", "").strip()
                dt = datetime.strptime(clean_date, "%d.%m.%Y %H:%M:%S")
                # Бизнес.ру отдает по Москве (UTC+3), Томск - это UTC+7, значит прибавляем 4 часа
                dt += timedelta(hours=4)
                check_date = dt.replace(tzinfo=TOMSK_TZ)
            except ValueError:
                pass

        # === ЖЕСТКАЯ ЗАЩИТА И ПРОВЕРКА НА НОВИЗНУ ===
        is_new_check = True
        existing_txs = session.exec(
            select(Transaction).where(
                Transaction.external_check_id == external_id)
        ).all()

        if existing_txs:
            is_new_check = False
            has_manual = any(tx.is_manual_assigned for tx in existing_txs)

            if has_manual:
                skipped_count += 1
                sync_conflicts.append({"check_id": external_id,
                                       "products": "Содержит ручные правки админа"})
                continue

            # Всегда пересоздаем чек, если он попал в зону видимости (последние 100 или force_full),
            # чтобы неизвестные товары могли распознаться после импорта авторов. Спама и списаний не будет!
            for old_tx in existing_txs:
                if old_tx.seller_id:
                    seller = session.exec(select(User).where(
                        User.id == old_tx.seller_id).with_for_update()).first()
                    if seller:
                        seller.balance = round(seller.balance - old_tx.amount,
                                               2)
                        session.add(seller)
                session.delete(old_tx)
            session.flush()

        # === ОБРАБОТКА ТОВАРОВ ===
        grouped_data = {}

        for item in op.get("goods", []):
            b2b_good_id = str(item.get("good_id", "")).strip()
            price = float(item.get("price", 0))
            count = int(float(item.get("amount", 1)))

            product = session.exec(
                select(Product).where(Product.sku == b2b_good_id)).first()
            seller_id = product.seller_id if product else None

            if product:
                name = product.name
            else:
                raw_name = item.get("name", "Неизвестный товар")
                name = f"{raw_name} [ID: {b2b_good_id}]"

            # ОБНОВЛЕНИЕ СКЛАДА С УЧЕТОМ БЛОКОВ
            # Списываем остаток ТОЛЬКО если это абсолютно новый чек!
            if product and is_new_check:
                target_stock_product = product
                if product.parent_id:
                    parent_product = session.get(Product, product.parent_id)
                    if parent_product:
                        target_stock_product = parent_product

                if is_return:
                    target_stock_product.stock += count
                else:
                    target_stock_product.stock = max(0,
                                                     target_stock_product.stock - count)

                session.add(target_stock_product)

            # Формируем финансовые данные
            if seller_id not in grouped_data:
                grouped_data[seller_id] = {"full_amount": 0.0, "profit": 0.0,
                                           "commission": 0.0, "items": []}

            sign = -1 if is_return else 1
            total_item_price = (price * count) * sign

            grouped_data[seller_id]["full_amount"] += total_item_price
            grouped_data[seller_id]["items"].append(f"{name} ({count} шт.)")

            if seller_id:
                seller = session.get(User, seller_id)
                commission_rate = seller.commission_percent if (
                            seller and seller.is_active) else 15.0
            else:
                commission_rate = 15.0

            profit = total_item_price * (1 - commission_rate / 100.0)
            commission = total_item_price - profit

            grouped_data[seller_id]["profit"] += profit
            grouped_data[seller_id]["commission"] += commission

        # === СОЗДАНИЕ ОБЪЕДИНЕННЫХ ТРАНЗАКЦИЙ ===
        for s_id, data in grouped_data.items():
            items_str = ", ".join(data["items"])

            if is_return:
                tx_type = "return"
                orig_check = op.get("retail_check_id")
                comment = f"Возврат по чеку #{orig_check} (Бизнес.Ру)" if orig_check else f"Возврат #{raw_id} (Бизнес.Ру)"
            else:
                tx_type = "sale"
                comment = f"Чек #{raw_id} (Бизнес.Ру)"

            new_tx = Transaction(
                type=tx_type,
                full_amount=data["full_amount"],
                amount=round(data["profit"], 2),
                commission_amount=round(data["commission"], 2),
                seller_id=s_id,
                product_identifier=items_str,
                comment=comment,
                external_check_id=external_id,
                date=check_date
            )
            session.add(new_tx)

            if s_id:
                seller = session.exec(select(User).where(
                    User.id == s_id).with_for_update()).first()
                if seller and seller.is_active:
                    seller.balance = round(seller.balance + data["profit"],
                                               2)
                    session.add(seller)

                    # ОТПРАВКА ВК: Строго проверяем is_new_check, чтобы не спамить!
                    if seller.vk_id and seller.vk_notify_sales and is_new_check:
                        if is_return:
                            msg = (f"🔄 Оформлен возврат товара!\n\n"
                                       f"С вашего баланса списано: {abs(round(data['profit'], 2))} ₽\n"
                                       f"Товары возвращены на склад:\n• " + "\n• ".join(
                                    data["items"]))
                        else:
                            msg = (f"💰 Новая продажа!\n\n"
                                       f"Вам начислено: {round(data['profit'], 2)} ₽\n"
                                       f"Товары:\n• " + "\n• ".join(
                                    data["items"]))
                        send_vk_message_sync(seller.vk_id, msg)

                # Считаем только реально новые чеки для дашборда синхронизации
                # Этот if на одном уровне с if s_id:
            if is_new_check:
                processed_count += 1
                total_revenue += data["full_amount"]

            # Если чек уже был в базе и мы его просто тихо обновили (дораспознали),
            # отправляем его в счетчик "Пропущено" для фронтенда.
            # Этот if находится внутри цикла for op, но СНАРУЖИ цикла for s_id
        if not is_new_check:
            skipped_count += 1

        # === КОНЕЦ ЦИКЛА for op in all_operations ===

        # Сохраняем все изменения разом ПОСЛЕ того, как обработали все чеки
    session.commit()

    if processed_count == 0 and skipped_count == 0:
        return {
                "status": "error",
                "message": "Новых чеков и возвратов не найдено.",
                "processed_items": 0, "skipped_checks": 0, "total_revenue": 0,
                "conflicts": []
        }

    return {
            "status": "success",
            "message": f"Синхронизация завершена. Новых: {processed_count}, обновлено существующих: {skipped_count}.",
            "processed_items": processed_count,
            "skipped_checks": skipped_count,
            "total_revenue": total_revenue,
            "conflicts": sync_conflicts
    }


@router.post("/sync/sales")
def trigger_manual_sync(
        force_full: bool = Query(False),
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    global SYNC_IN_PROGRESS

    if SYNC_IN_PROGRESS:
        raise HTTPException(status_code=423,
                            detail="Синхронизация уже запущена. Пожалуйста, подождите завершения.")

    try:
        SYNC_IN_PROGRESS = True
        result = run_b2b_sync(session=session, force_full=force_full)
        return result
    finally:
        SYNC_IN_PROGRESS = False


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


@router.patch("/{transaction_id}", response_model=TransactionRead)
def update_transaction(
        transaction_id: int,
        req: TransactionUpdateRequest,
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    tx = session.exec(select(Transaction).where(
        Transaction.id == transaction_id).with_for_update()).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Транзакция не найдена")

    admin_username = admin_data.get("username", "admin")
    changes = {}

    # 1. Смена автора (только для типа "sale")
    # Пересчитываем балансы, если автор реально изменился
    if req.seller_id is not None and req.seller_id != tx.seller_id and tx.type == "sale":
        old_seller_id = tx.seller_id
        old_amount = tx.amount

        # Откатываем баланс у старого автора
        if old_seller_id is not None:
            old_seller = session.exec(select(User).where(
                User.id == old_seller_id).with_for_update()).first()
            if old_seller:
                old_seller.balance -= tx.amount
                session.add(old_seller)

        # Начисляем новому автору
        new_seller = session.get(User, req.seller_id)
        if new_seller:
            commission_rate = new_seller.commission_percent if new_seller.is_active else 15.0
            new_profit = tx.full_amount * (1 - commission_rate / 100.0)
            new_comm = tx.full_amount - new_profit

            new_seller.balance += new_profit
            session.add(new_seller)

            tx.amount = new_profit
            tx.commission_amount = new_comm
        else:
            # Если почему-то передали пустой ID
            tx.amount = tx.full_amount
            tx.commission_amount = 0.0

        changes["seller_id"] = {"old": tx.seller_id, "new": req.seller_id}
        changes["amount"] = {"old": old_amount, "new": tx.amount}
        tx.seller_id = req.seller_id

    # 2. Обновление текста проданных товаров (product_identifier)
    if req.product_identifier is not None and req.product_identifier != tx.product_identifier:
        changes["product_identifier"] = {"old": tx.product_identifier,
                                         "new": req.product_identifier}
        tx.product_identifier = req.product_identifier

    # 3. Обновление комментария
    if req.comment is not None and req.comment != tx.comment:
        changes["comment"] = {"old": tx.comment, "new": req.comment}
        tx.comment = req.comment

    if changes:
        tx.is_manual_assigned = True
        session.add(tx)

        # Логируем изменения
        create_audit_log(
            session=session,
            actor=admin_username,
            entity_name="Transaction",
            entity_id=tx.id,
            action="manual_edit",
            changes=changes
        )
        session.commit()
        session.refresh(tx)

    return tx