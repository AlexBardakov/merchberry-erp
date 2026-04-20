from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from database import get_session
from models import User
from auth import verify_password, create_access_token
from schemas import LoginRequest

router = APIRouter(tags=["Authentication"])


@router.post("/api/login/")
def login(request: LoginRequest, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.username == request.username)).first()

    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Неверный логин или пароль")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Ваш аккаунт заблокирован. Обратитесь к администратору.")

    access_token = create_access_token(data={"sub": user.username, "role": user.role})
    return {"access_token": access_token, "token_type": "bearer"}