from fastapi import APIRouter, Depends, Query, HTTPException
from sqlmodel import Session, select, col
from typing import List, Optional

from database import get_session
from models import AuditLog
from auth import get_current_user

router = APIRouter(prefix="/api/audit", tags=["Audit"])


@router.get("/")
def get_audit_logs(
        actor: Optional[str] = Query(None, description="Фильтр по автору действия (например, admin)"),
        entity_name: Optional[str] = Query(None, description="Фильтр по сущности (Product, User, Transaction)"),
        action: Optional[str] = Query(None, description="Фильтр по типу действия"),
        limit: int = Query(50, ge=1, le=100),
        offset: int = Query(0, ge=0),
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    # Строгая проверка: доступ к логам есть только у администратора
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Доступ запрещен. Только для администратора.")

    statement = select(AuditLog)

    # Применяем фильтры, если они переданы
    if actor:
        statement = statement.where(AuditLog.actor == actor)
    if entity_name:
        statement = statement.where(AuditLog.entity_name == entity_name)
    if action:
        statement = statement.where(AuditLog.action == action)

    # Сортируем от новых к старым
    statement = statement.order_by(col(AuditLog.timestamp).desc())

    logs = session.exec(statement.offset(offset).limit(limit)).all()
    return logs