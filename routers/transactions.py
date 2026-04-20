from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from typing import List, Optional

from database import get_session
from models import Transaction, User
from auth import get_current_user, get_current_admin
from schemas import TransactionCreateRequest, \
    TransactionRead  # ИМПОРТ НОВОЙ СХЕМЫ

router = APIRouter(prefix="/api/transactions", tags=["Transactions"])


@router.get("/", response_model=List[
    TransactionRead])  # <-- ТЕПЕРЬ ОТДАЕМ БЕЗОПАСНУЮ СХЕМУ
def get_transactions(
        seller_id: Optional[int] = Query(None,
                                         description="Фильтр по продавцу (для админа)"),
        limit: int = Query(50, ge=1, le=100),
        offset: int = Query(0, ge=0),
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    statement = select(Transaction)

    if current_user.get("role") == "seller":
        user_in_db = session.exec(select(User).where(
            User.username == current_user.get("username"))).first()
        statement = statement.where(Transaction.seller_id == user_in_db.id)
    elif current_user.get("role") == "admin" and seller_id is not None:
        statement = statement.where(Transaction.seller_id == seller_id)

    # Сортируем от новых к старым по ID
    statement = statement.order_by(Transaction.id.desc())

    return session.exec(statement.offset(offset).limit(limit)).all()


@router.post("/", response_model=TransactionRead)  # <-- И ЗДЕСЬ ТОЖЕ
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