import re
from datetime import datetime, timedelta, timezone, date
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select, func
from typing import List, Optional
from collections import defaultdict

from database import get_session
from models import Transaction, Product, User
from auth import get_current_user
from schemas import DashboardSummary, WidgetStats, ChartDataPoint, TopProductRead

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


@router.get("/widgets", response_model=WidgetStats)
def get_widget_stats(
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    now = datetime.now(timezone.utc)
    thirty_days_ago = now - timedelta(days=30)
    sixty_days_ago = now - timedelta(days=60)

    user = session.exec(select(User).where(User.username == current_user.get("username"))).first()
    is_admin = current_user.get("role") == "admin"

    # 1. Текущий баланс
    if is_admin:
        # Для админа можно показывать сумму всех балансов или 0, в зависимости от бизнес-логики.
        # Покажем сумму балансов всех активных продавцов
        current_balance = session.exec(select(func.sum(User.balance)).where(User.is_active == True)).first() or 0.0
    else:
        current_balance = user.balance

    # 2. Товаров на полках (только актуальные)
    prod_stmt = select(func.sum(Product.stock)).where(Product.is_obsolete == False)
    if not is_admin:
        prod_stmt = prod_stmt.where(Product.seller_id == user.id)
    products_on_shelves = session.exec(prod_stmt).first() or 0

    # 3. Продажи за 30 дней и предыдущие 30 дней (Задача 5)
    tx_stmt = select(Transaction).where(Transaction.type == "sale")
    if not is_admin:
        tx_stmt = tx_stmt.where(Transaction.seller_id == user.id)

    sales_30 = session.exec(tx_stmt.where(Transaction.date >= thirty_days_ago)).all()
    sales_prev_30 = session.exec(
        tx_stmt.where(Transaction.date >= sixty_days_ago, Transaction.date < thirty_days_ago)).all()

    sales_30_sum = sum(tx.amount for tx in sales_30)
    sales_prev_30_sum = sum(tx.amount for tx in sales_prev_30)

    # 4. Расчет тренда (в процентах)
    if sales_prev_30_sum == 0:
        trend = 100.0 if sales_30_sum > 0 else 0.0
    else:
        trend = ((sales_30_sum - sales_prev_30_sum) / sales_prev_30_sum) * 100

    return WidgetStats(
        current_balance=float(current_balance),
        products_on_shelves=int(products_on_shelves),
        sales_30_days=sales_30_sum,
        sales_prev_30_days=sales_prev_30_sum,
        sales_trend_percent=round(trend, 1)
    )


@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(
        start_date: date = Query(..., description="Начальная дата (YYYY-MM-DD)"),
        end_date: date = Query(..., description="Конечная дата (YYYY-MM-DD)"),
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    start_dt = datetime.combine(start_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    end_dt = datetime.combine(end_date, datetime.max.time()).replace(tzinfo=timezone.utc)

    user = session.exec(select(User).where(User.username == current_user.get("username"))).first()
    is_admin = current_user.get("role") == "admin"

    # Получаем транзакции за период
    statement = select(Transaction).where(Transaction.type == "sale", Transaction.date >= start_dt,
                                          Transaction.date <= end_dt)
    if not is_admin:
        statement = statement.where(Transaction.seller_id == user.id)

    transactions = session.exec(statement).all()

    total_full = 0.0
    total_profit = 0.0
    total_comm = 0.0

    # Структуры для агрегации
    buckets = defaultdict(lambda: {"full": 0.0, "profit": 0.0, "comm": 0.0, "items": []})
    product_counts = defaultdict(int)

    days_diff = (end_date - start_date).days

    for tx in transactions:
        total_full += tx.full_amount
        total_profit += tx.amount
        total_comm += tx.commission_amount

        # Задача 1: Группировка (до 14 дней - по дням, 15+ - по неделям)
        if days_diff <= 14:
            # Формат: "ДД.ММ (День недели)"
            weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
            bucket_label = f"{tx.date.strftime('%d.%m')} ({weekdays[tx.date.weekday()]})"
        else:
            # Дробление по 7 дней от начальной даты
            days_from_start = (tx.date.date() - start_date).days
            week_index = days_from_start // 7
            week_start = start_date + timedelta(days=week_index * 7)
            week_end = min(end_date, week_start + timedelta(days=6))
            bucket_label = f"{week_start.strftime('%d.%m')} - {week_end.strftime('%d.%m')}"

        buckets[bucket_label]["full"] += tx.full_amount
        buckets[bucket_label]["profit"] += tx.amount
        buckets[bucket_label]["comm"] += tx.commission_amount

        if tx.product_identifier:
            buckets[bucket_label]["items"].append(tx.product_identifier)

            # Задача 4: Парсинг товаров для "Лидеров продаж"
            # Ищем паттерн "Название (X шт.)"
            matches = re.findall(r"(.+?)\s\((\d+)\sшт\.\)", tx.product_identifier)
            for name, count_str in matches:
                product_counts[name.strip()] += int(count_str)

    # Формируем и сортируем данные для графика (сохраняя хронологию)
    # Для правильной сортировки ключей словаря мы опираемся на логику их создания
    chart_data = []
    # Сначала генерируем пустые бакеты, чтобы график не прерывался, если в какой-то день/неделю не было продаж
    if days_diff <= 14:
        for i in range(days_diff + 1):
            d = start_date + timedelta(days=i)
            weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
            lbl = f"{d.strftime('%d.%m')} ({weekdays[d.weekday()]})"
            b_data = buckets.get(lbl, {"full": 0.0, "profit": 0.0, "comm": 0.0, "items": []})
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
            b_data = buckets.get(lbl, {"full": 0.0, "profit": 0.0, "comm": 0.0, "items": []})
            chart_data.append(ChartDataPoint(
                label=lbl, full_amount=b_data["full"], profit=b_data["profit"],
                commission=b_data["comm"], products_info=b_data["items"]
            ))

    # Сортируем лидеров продаж
    sorted_top = sorted(product_counts.items(), key=lambda x: x[1], reverse=True)[:5]
    top_products = [
        TopProductRead(rank=idx + 1, name=name, quantity=qty)
        for idx, (name, qty) in enumerate(sorted_top)
    ]

    return DashboardSummary(
        total_full_amount=total_full,
        total_profit=total_profit,
        total_commission=total_comm,
        chart_data=chart_data,
        top_products=top_products
    )