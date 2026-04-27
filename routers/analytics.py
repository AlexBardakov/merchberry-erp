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
    tx_stmt = select(Transaction).where(Transaction.type == "sale")
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
        Transaction.type == "sale",
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
    product_counts = defaultdict(int)

    days_diff = (end_date - start_date).days

    for tx in transactions:
        total_full += tx.full_amount
        total_profit += tx.amount
        total_comm += tx.commission_amount

        # Группировка
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
            buckets[bucket_label]["items"].append(tx.product_identifier)

            # Лидеры продаж: Игнорируем "ничейные" товары
            if tx.seller_id is not None:
                matches = re.findall(r"(.+?)\s\((\d+)\sшт\.\)",
                                     tx.product_identifier)
                for name, count_str in matches:
                    product_counts[name.strip()] += int(count_str)

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

    sorted_top = sorted(product_counts.items(), key=lambda x: x[1],
                        reverse=True)[:5]
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
        Transaction.type == "sale",
        Transaction.date >= start_dt,
        Transaction.date <= end_dt
    ).order_by(Transaction.date)

    if target_seller_id:
        statement = statement.where(Transaction.seller_id == target_seller_id)

    transactions = session.exec(statement).all()

    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')

    # Если это админ и он выгружает общую статистику
    if is_admin and not target_seller_id:
        writer.writerow(["Дата", "Автор", "Проданные позиции", "Полная сумма",
                         "Чистый доход", "Комиссия"])

        users = session.exec(select(User)).all()
        user_map = {u.id: u.username for u in users}

        for tx in transactions:
            author_name = user_map.get(tx.seller_id,
                                       "Ничейный") if tx.seller_id else "Ничейный"
            writer.writerow([
                tx.date.strftime("%d.%m.%Y %H:%M"),
                author_name,
                tx.product_identifier or "",
                tx.full_amount,
                tx.amount,
                tx.commission_amount
            ])
    else:
        # Если это автор или админ выгружает по конкретному автору
        writer.writerow(
            ["Дата", "Проданные позиции", "Полная сумма", "Чистый доход",
             "Комиссия"])
        for tx in transactions:
            writer.writerow([
                tx.date.strftime("%d.%m.%Y %H:%M"),
                tx.product_identifier or "",
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