from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, or_
from typing import List, Optional

from database import get_session
from models import User
from auth import get_password_hash, get_current_admin
from schemas import UserCreate, UserUpdate, PasswordUpdate

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
        search: Optional[str] = Query("", description="Поиск по нику, ФИО или телефону"),
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    statement = select(User)

    if search:
        statement = statement.where(
            or_(
                User.username.ilike(f"%{search}%"),
                User.full_name.ilike(f"%{search}%"),
                User.phone.ilike(f"%{search}%")
            )
        )

    return session.exec(statement).all()


@router.patch("/{user_id}", response_model=User)
def update_user(
        user_id: int,
        update_data: UserUpdate,
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    update_dict = update_data.dict(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(user, key, value)

    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@router.patch("/{user_id}/password")
def update_user_password(
        user_id: int,
        pass_data: PasswordUpdate,
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    user.hashed_password = get_password_hash(pass_data.new_password)
    session.add(user)
    session.commit()
    return {"message": "Пароль успешно изменен"}


@router.get("/me", response_model=User)
def get_my_profile(
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    user = session.exec(select(User).where(User.username == current_user.get("username"))).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return user


@router.delete("/{user_id}")
def delete_user(
        user_id: int,
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    # Проверка на 72 часа
    now = datetime.now(timezone.utc)
    created_at = user.created_at
    # Убеждаемся, что время с правильным часовым поясом
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    if now - created_at > timedelta(hours=72):
        raise HTTPException(status_code=400, detail="Прошло более 72 часов. Удаление невозможно.")

    session.delete(user)
    session.commit()
    return {"message": "Пользователь успешно удален"}