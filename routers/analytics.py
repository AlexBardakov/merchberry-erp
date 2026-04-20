from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select
from datetime import date, timedelta, datetime
from typing import List, Optional

from database import get_session
from models import Transaction, User
from auth import get_current_user
from schemas import ChartDataPoint

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


@router.get("/chart", response_model=List[ChartDataPoint])
def get_chart_data(
        start_date: date,
        end_date: date,
        seller_id: Optional[int] = Query(None),
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    target_seller_id = seller_id
    if current_user.get("role") == "seller":
        user_in_db = session.exec(select(User).where(
            User.username == current_user.get("username"))).first()
        target_seller_id = user_in_db.id

    query = select(Transaction).where(
        Transaction.type == "sale",
        Transaction.date >= datetime.combine(start_date, datetime.min.time()),
        Transaction.date <= datetime.combine(end_date, datetime.max.time())
    )

    if target_seller_id:
        query = query.where(Transaction.seller_id == target_seller_id)

    transactions = session.exec(query).all()

    delta_days = (end_date - start_date).days
    use_weekly = delta_days >= 15

    buckets = []
    current_start = start_date

    while current_start <= end_date:
        if use_weekly:
            current_end = current_start + timedelta(days=6)
            if current_end > end_date:
                current_end = end_date
            label = f"{current_start.strftime('%d.%m')} - {current_end.strftime('%d.%m')}"
        else:
            current_end = current_start
            label = current_start.strftime("%d.%m")

        buckets.append({
            "start": current_start,
            "end": current_end,
            "label": label,
            "total_amount": 0.0,
            "products": []
        })
        current_start = current_end + timedelta(days=1)

    for txn in transactions:
        txn_date = txn.date.date()
        for b in buckets:
            if b["start"] <= txn_date <= b["end"]:
                b["total_amount"] += txn.amount
                if txn.product_identifier:
                    prod_str = f"{txn.product_identifier} - {txn.amount} руб."
                    b["products"].append(prod_str)
                break

    return [ChartDataPoint(label=b["label"], total_amount=b["total_amount"],
                           products=b["products"]) for b in buckets]