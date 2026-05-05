import re
import csv
import io
from datetime import datetime, timedelta, timezone, date
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select, func
from typing import List, Optional
from collections import defaultdict

from database import get_session
from models import Transaction, Product, User
from auth import get_current_user
from schemas import DashboardSummary, ChartDataPoint, TopProductRead

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


@router.get("/widgets")
def get_widget_stats(
        seller_id: Optional[int] = Query(None,
                                         description="ID автора для фильтрации (только для админа)"),
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    now = datetime.now(timezone.utc)
    thirty_days_ago = now - timedelta(days=30)
    sixty_days_ago = now - timedelta(days=60)

    is_admin = current_user.get("role") == "admin"
    target_seller_id = None

    if not is_admin:
        user = session.exec(select(User).where(
            User.username == current_user.get("username"))).first()
        target_seller_id = user.id
    elif is_admin and seller_id:
        target_seller_id = seller_id

    # 1. Текущий баланс
    if is_admin and not target_seller_id:
        # Общий баланс всех активных авторов
        current_balance = session.exec(select(func.sum(User.balance)).where(
            User.is_active == True)).first() or 0.0
    else:
        target_user = session.get(User,
                                  target_seller_id) if target_seller_id else None
        current_balance = target_user.balance if target_user else 0.0

    # 2. Товаров на полках (актуальные)
    prod_stmt = select(Product).where(Product.is_obsolete == False)
    if target_seller_id:
        prod_stmt = prod_stmt.where(Product.seller_id == target_seller_id)

    active_products = session.exec(prod_stmt).all()

    total_units = sum(p.stock for p in active_products)
    unique_names = len(active_products)
    total_value = sum(p.base_price * p.stock for p in active_products)

    # 3. Продажи за 30 дней и предыдущие 30 дней
    tx_stmt = select(Transaction).where(
        Transaction.type.in_(["sale", "return"]))
    if target_seller_id:
        tx_stmt = tx_stmt.where(Transaction.seller_id == target_seller_id)

    sales_30 = session.exec(
        tx_stmt.where(Transaction.date >= thirty_days_ago)).all()
    sales_prev_30 = session.exec(
        tx_stmt.where(Transaction.date >= sixty_days_ago,
                      Transaction.date < thirty_days_ago)).all()

    sales_30_sum = sum(tx.amount for tx in sales_30)
    sales_prev_30_sum = sum(tx.amount for tx in sales_prev_30)

    # 4. Расчет тренда (в процентах)
    if sales_prev_30_sum == 0:
        trend = 100.0 if sales_30_sum > 0 else 0.0
    else:
        trend = ((sales_30_sum - sales_prev_30_sum) / sales_prev_30_sum) * 100

    # Возвращаем словарь напрямую (расширенная версия для фронтенда)
    return {
        "current_balance": float(current_balance),
        "products_on_shelves": int(total_units),
        "unique_names": int(unique_names),
        "total_value": float(total_value),
        "sales_30_days": float(sales_30_sum),
        "sales_prev_30_days": float(sales_prev_30_sum),
        "sales_trend_percent": float(round(trend, 1))
    }


@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(
        start_date: date = Query(...,
                                 description="Начальная дата (YYYY-MM-DD)"),
        end_date: date = Query(..., description="Конечная дата (YYYY-MM-DD)"),
        seller_id: Optional[int] = Query(None,
                                         description="ID автора для фильтрации"),
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    start_dt = datetime.combine(start_date, datetime.min.time()).replace(
        tzinfo=timezone.utc)
    end_dt = datetime.combine(end_date, datetime.max.time()).replace(
        tzinfo=timezone.utc)

    is_admin = current_user.get("role") == "admin"
    target_seller_id = None

    if not is_admin:
        user = session.exec(select(User).where(
            User.username == current_user.get("username"))).first()
        target_seller_id = user.id
    elif is_admin and seller_id:
        target_seller_id = seller_id

    # Получаем транзакции за период
    statement = select(Transaction).where(
        Transaction.type.in_(["sale", "return"]),
        Transaction.date >= start_dt,
        Transaction.date <= end_dt
    )
    if target_seller_id:
        statement = statement.where(Transaction.seller_id == target_seller_id)

    transactions = session.exec(statement).all()

    total_full = 0.0
    total_profit = 0.0
    total_comm = 0.0

    buckets = defaultdict(
        lambda: {"full": 0.0, "profit": 0.0, "comm": 0.0, "items": []})

    # Словари для топов
    product_counts = defaultdict(int)
    product_revenues = defaultdict(float)

    days_diff = (end_date - start_date).days

    # --- Создаем словарь для быстрой подмены имен в Топ-5 и цен ---
    all_products = session.exec(select(Product)).all()
    users = session.exec(select(User)).all()
    user_map = {u.id: u.username for u in users}

    product_name_mapping = {}
    product_prices = {}  # Словарь цен для подсчета выручки
    product_authors = {}

    for p in all_products:
        # Определяем "финальное" имя (родительское)
        final_name = p.name
        if p.parent_id:
            parent = next(
                (prod for prod in all_products if prod.id == p.parent_id),
                None)
            if parent: final_name = parent.name

        product_name_mapping[p.name] = final_name
        product_prices[final_name] = p.base_price

        # Запоминаем автора товара
        if final_name not in product_authors:
            product_authors[final_name] = user_map.get(p.seller_id, "Ничейный")
    # ---------------------------------------------------------------------------------

    for tx in transactions:
        total_full += tx.full_amount
        total_profit += tx.amount
        total_comm += tx.commission_amount

        # Группировка для графиков
        if days_diff <= 14:
            weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
            bucket_label = f"{tx.date.strftime('%d.%m')} ({weekdays[tx.date.weekday()]})"
        else:
            days_from_start = (tx.date.date() - start_date).days
            week_index = days_from_start // 7
            week_start = start_date + timedelta(days=week_index * 7)
            week_end = min(end_date, week_start + timedelta(days=6))
            bucket_label = f"{week_start.strftime('%d.%m')} - {week_end.strftime('%d.%m')}"

        buckets[bucket_label]["full"] += tx.full_amount
        buckets[bucket_label]["profit"] += tx.amount
        buckets[bucket_label]["comm"] += tx.commission_amount

        if tx.product_identifier:
            if tx.type == "sale":
                buckets[bucket_label]["items"].append(tx.product_identifier)
            else:
                buckets[bucket_label]["items"].append(
                    f"Возврат: {tx.product_identifier}")

            # Лидеры продаж: Игнорируем "ничейные" товары
            if tx.seller_id is not None:
                matches = re.findall(r"(.+?)\s\((\d+)\sшт\.\)",
                                     tx.product_identifier)
                for name, count_str in matches:
                    clean_name = name.strip().lstrip(',').strip()
                    final_name = product_name_mapping.get(clean_name,
                                                          clean_name)

                    qty = int(count_str)
                    price = product_prices.get(final_name,
                                               0.0)  # Берем базовую цену

                    if tx.type == "return":
                        product_counts[final_name] -= qty
                        product_revenues[final_name] -= (price * qty)
                    else:
                        product_counts[final_name] += qty
                        product_revenues[final_name] += (price * qty)

    # Формирование данных для графика
    chart_data = []
    if days_diff <= 14:
        for i in range(days_diff + 1):
            d = start_date + timedelta(days=i)
            weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
            lbl = f"{d.strftime('%d.%m')} ({weekdays[d.weekday()]})"
            b_data = buckets.get(lbl, {"full": 0.0, "profit": 0.0, "comm": 0.0,
                                       "items": []})
            chart_data.append(ChartDataPoint(
                label=lbl, full_amount=b_data["full"], profit=b_data["profit"],
                commission=b_data["comm"], products_info=b_data["items"]
            ))
    else:
        num_weeks = (days_diff // 7) + 1
        for i in range(num_weeks):
            w_start = start_date + timedelta(days=i * 7)
            if w_start > end_date: break
            w_end = min(end_date, w_start + timedelta(days=6))
            lbl = f"{w_start.strftime('%d.%m')} - {w_end.strftime('%d.%m')}"
            b_data = buckets.get(lbl, {"full": 0.0, "profit": 0.0, "comm": 0.0,
                                       "items": []})
            chart_data.append(ChartDataPoint(
                label=lbl, full_amount=b_data["full"], profit=b_data["profit"],
                commission=b_data["comm"], products_info=b_data["items"]
            ))

        # Функция-помощник для формирования списков с учетом авторов
    def format_top_list(sorted_items):
        res = []
        for idx, (name, val) in enumerate(sorted_items):
            author_name = None
                # Если админ смотрит общую статистику, передаем имя автора
            if is_admin and not target_seller_id:
                author_name = product_authors.get(name)

            res.append(TopProductRead(
                rank=idx + 1,
                name=name,
                value=float(val),
                author=author_name
            ))
        return res

        # Формируем итоговые списки Топ-5
    valid_top = {k: v for k, v in product_counts.items() if v > 0}
    top_products = format_top_list(
        sorted(valid_top.items(), key=lambda x: x[1], reverse=True)[:5]
    )

    valid_revenue = {k: v for k, v in product_revenues.items() if v > 0}
    top_revenue_products = format_top_list(
        sorted(valid_revenue.items(), key=lambda x: x[1], reverse=True)[:5]
    )
        # --- КОНЕЦ ВСТАВКИ ---

    return DashboardSummary(
        total_full_amount=total_full,
        total_profit=total_profit,
        total_commission=total_comm,
        chart_data=chart_data,
        top_products=top_products,
        top_revenue_products=top_revenue_products
    )


@router.get("/export")
def export_analytics(
        start_date: date = Query(...,
                                 description="Начальная дата (YYYY-MM-DD)"),
        end_date: date = Query(..., description="Конечная дата (YYYY-MM-DD)"),
        seller_id: Optional[int] = Query(None,
                                         description="ID автора для фильтрации"),
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    start_dt = datetime.combine(start_date, datetime.min.time()).replace(
        tzinfo=timezone.utc)
    end_dt = datetime.combine(end_date, datetime.max.time()).replace(
        tzinfo=timezone.utc)

    is_admin = current_user.get("role") == "admin"
    target_seller_id = None

    if not is_admin:
        user = session.exec(select(User).where(
            User.username == current_user.get("username"))).first()
        target_seller_id = user.id
    elif is_admin and seller_id:
        target_seller_id = seller_id

    statement = select(Transaction).where(
        Transaction.type.in_(["sale", "return"]),  # Добавили возвраты
        Transaction.date >= start_dt,
        Transaction.date <= end_dt
    ).order_by(Transaction.date.desc())  # Сортируем от новых к старым

    if target_seller_id:
        statement = statement.where(Transaction.seller_id == target_seller_id)

    transactions = session.exec(statement).all()

    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')

    current_day = None

    if is_admin and not target_seller_id:
        writer.writerow(["Дата", "Автор", "Проданные позиции", "Полная сумма",
                         "Чистый доход", "Комиссия"])
        users = session.exec(select(User)).all()
        user_map = {u.id: u.username for u in users}

        for tx in transactions:
            # Визуальное разделение по дням
            tx_day = tx.date.strftime("%d.%m.%Y")
            if current_day and current_day != tx_day:
                writer.writerow([])
            current_day = tx_day

            author_name = user_map.get(tx.seller_id,
                                       "Ничейный") if tx.seller_id else "Ничейный"
            type_label = " [ВОЗВРАТ]" if tx.type == "return" else ""

            writer.writerow([
                tx.date.strftime("%d.%m.%Y %H:%M"),
                author_name,
                f"{tx.product_identifier or ''}{type_label}",
                tx.full_amount,
                tx.amount,
                tx.commission_amount
            ])
    else:
        writer.writerow(
            ["Дата", "Проданные позиции", "Полная сумма", "Чистый доход",
             "Комиссия"])
        for tx in transactions:
            tx_day = tx.date.strftime("%d.%m.%Y")
            if current_day and current_day != tx_day:
                writer.writerow([])
            current_day = tx_day

            type_label = " [ВОЗВРАТ]" if tx.type == "return" else ""

            writer.writerow([
                tx.date.strftime("%d.%m.%Y %H:%M"),
                f"{tx.product_identifier or ''}{type_label}",
                tx.full_amount,
                tx.amount,
                tx.commission_amount
            ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=analytics_{start_date}_to_{end_date}.csv"}
    )


@router.get("/export-tops")
def export_analytics_tops(
        start_date: date = Query(...),
        end_date: date = Query(...),
        seller_id: Optional[int] = Query(None),
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    # Аналогичная логика сбора данных, но для ВСЕХ товаров
    is_admin = current_user.get("role") == "admin"
    target_seller_id = seller_id if is_admin and seller_id else (
        None if is_admin else session.exec(select(User).where(
            User.username == current_user["username"])).first().id)

    # 1. Считаем продажи из транзакций
    start_dt = datetime.combine(start_date, datetime.min.time()).replace(
        tzinfo=timezone.utc)
    end_dt = datetime.combine(end_date, datetime.max.time()).replace(
        tzinfo=timezone.utc)

    tx_stmt = select(Transaction).where(
        Transaction.type.in_(["sale", "return"]), Transaction.date >= start_dt,
        Transaction.date <= end_dt)
    if target_seller_id: tx_stmt = tx_stmt.where(
        Transaction.seller_id == target_seller_id)
    transactions = session.exec(tx_stmt).all()

    # 2. Собираем все активные товары склада
    prod_stmt = select(Product).where(Product.is_obsolete == False)
    if target_seller_id: prod_stmt = prod_stmt.where(
        Product.seller_id == target_seller_id)
    active_products = session.exec(prod_stmt).all()

    # Маппинг и агрегация
    user_map = {u.id: u.username for u in session.exec(select(User)).all()}
    stats = defaultdict(lambda: {"qty": 0, "rev": 0, "author": "", "price": 0})

    for p in active_products:
        name = p.name
        if p.parent_id:
            parent = next(
                (prod for prod in active_products if prod.id == p.parent_id),
                None)
            if parent: name = parent.name
        stats[name]["author"] = user_map.get(p.seller_id, "Ничейный")
        stats[name]["price"] = p.base_price

    # Считаем реальные продажи
    for tx in transactions:
        matches = re.findall(r"(.+?)\s\((\d+)\sшт\.\)",
                             tx.product_identifier or "")
        for name, count_str in matches:
            clean_name = name.strip().lstrip(',').strip()
            # Проверяем, есть ли товар в наших "активных" для маппинга
            final_name = clean_name
            # (Упрощенный поиск родителя для CSV)
            if clean_name in stats:
                qty = int(count_str) * (-1 if tx.type == "return" else 1)
                stats[clean_name]["qty"] += qty
                stats[clean_name]["rev"] += (stats[clean_name]["price"] * qty)

    # Формируем CSV
    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')

    # Таблица 1: Топ по количеству
    writer.writerow(["ТОП ПРОДАЖ ПО КОЛИЧЕСТВУ (за период)"])
    writer.writerow(["Наименование", "Автор", "Продано (шт)"])
    sorted_qty = sorted(stats.items(), key=lambda x: (-x[1]["qty"], x[0]))
    for name, data in sorted_qty:
        writer.writerow([name, data["author"], data["qty"]])

    writer.writerow([])  # Разделитель

    # Таблица 2: Топ по сумме
    writer.writerow(["ТОП ПРОДАЖ ПО СУММЕ (за период)"])
    writer.writerow(["Наименование", "Автор", "Сумма выручки (руб)"])
    sorted_rev = sorted(stats.items(), key=lambda x: -x[1]["rev"])
    for name, data in sorted_rev:
        writer.writerow([name, data["author"], data["rev"]])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=tops_{start_date}_{end_date}.csv"}
    )