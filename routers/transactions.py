from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, col
from typing import List, Optional

from database import get_session
from models import Transaction, User
from auth import get_current_user, get_current_admin
from schemas import TransactionCreateRequest, TransactionRead

router = APIRouter(prefix="/api/transactions", tags=["Transactions"])


@router.get("/", response_model=List[TransactionRead])
def get_transactions(
        seller_id: Optional[int] = Query(None, description="Фильтр по продавцу (для админа)"),
        type_filter: Optional[str] = Query("all", description="Тип операции: sale, payout, rent, correction"),
        min_amount: Optional[float] = Query(None, description="Минимальная сумма"),
        max_amount: Optional[float] = Query(None, description="Максимальная сумма"),
        start_date: Optional[datetime] = Query(None, description="Начальная дата (YYYY-MM-DDTHH:MM:SS)"),
        end_date: Optional[datetime] = Query(None, description="Конечная дата (YYYY-MM-DDTHH:MM:SS)"),
        sort_by: Optional[str] = Query("date_desc",
                                       description="Сортировка: date_desc, date_asc, amount_desc, amount_asc"),
        limit: int = Query(50, ge=1, le=100),
        offset: int = Query(0, ge=0),
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    statement = select(Transaction)

    # 1. Фильтр по роли и продавцу
    if current_user.get("role") == "seller":
        user_in_db = session.exec(select(User).where(User.username == current_user.get("username"))).first()
        statement = statement.where(Transaction.seller_id == user_in_db.id)
    elif current_user.get("role") == "admin" and seller_id is not None:
        statement = statement.where(Transaction.seller_id == seller_id)

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
    seller = session.get(User, req.seller_id)
    if not seller:
        raise HTTPException(status_code=404, detail="Продавец не найден")

    new_transaction = Transaction(
        type=req.type,
        amount=req.amount,
        comment=req.comment,
        seller_id=seller.id
    )

    seller.balance += req.amount

    session.add(new_transaction)
    session.add(seller)
    session.commit()
    session.refresh(new_transaction)

    return new_transaction