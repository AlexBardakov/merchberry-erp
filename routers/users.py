from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import List

from database import get_session
from models import User
from auth import get_password_hash, get_current_admin
from schemas import UserCreate

router = APIRouter(prefix="/api/users", tags=["Users"])


@router.post("/", response_model=User)
def create_user(
        user_in: UserCreate,
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    existing_user = session.exec(
        select(User).where(User.username == user_in.username)).first()
    if existing_user:
        raise HTTPException(status_code=400,
                            detail="Пользователь уже существует")

    hashed_pw = get_password_hash(user_in.password)

    user = User(
        username=user_in.username,
        role=user_in.role,
        full_name=user_in.full_name,
        phone=user_in.phone,
        commission_percent=user_in.commission_percent,
        hashed_password=hashed_pw
    )

    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@router.get("/", response_model=List[User])
def read_users(
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    users = session.exec(select(User)).all()
    return users