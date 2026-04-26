from fastapi import APIRouter, Depends, Query, HTTPException
from sqlmodel import Session, select, desc
from typing import List, Optional
from datetime import datetime, date

from database import get_session
from models import AuditLog, Product, User
from auth import get_current_user
from schemas import AuditLogRead

router = APIRouter(prefix="/api/audit", tags=["Audit"])


# ТВОЯ СТАРАЯ ФУНКЦИЯ ДЛЯ АДМИНА (мы ее сохранили)
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

    statement = statement.order_by(desc(AuditLog.timestamp))
    return session.exec(statement.offset(offset).limit(limit)).all()


# НАША НОВАЯ ФУНКЦИЯ ДЛЯ ИНВЕНТАРИЗАЦИИ (Задача 8)
@router.get("/inventory", response_model=List[AuditLogRead])
def get_inventory_logs(
        start_date: Optional[date] = Query(None),
        end_date: Optional[date] = Query(None),
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    # Получаем пользователя из БД
    user = session.exec(select(User).where(User.username == current_user.get("username"))).first()

    # Базовый запрос
    statement = select(AuditLog).where(AuditLog.entity_name == "Product").order_by(desc(AuditLog.timestamp))

    if start_date:
        statement = statement.where(AuditLog.timestamp >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        statement = statement.where(AuditLog.timestamp <= datetime.combine(end_date, datetime.max.time()))

    logs = session.exec(statement).all()

    result = []

    # Словарик для быстрого получения названий товаров
    products = session.exec(select(Product)).all()
    product_map = {p.id: p.name for p in products}

    for log in logs:
        # Копируем словарь изменений, чтобы безопасно его модифицировать
        changes = dict(log.changes)

        # Определяем, относится ли этот лог к текущему пользователю
        is_relevant_to_user = False

        if current_user.get("role") == "admin":
            is_relevant_to_user = True
        else:
            # Логика для обычного продавца
            # 1. Товар сейчас принадлежит ему?
            current_product = session.get(Product, log.entity_id)
            if current_product and current_product.seller_id == user.id:
                is_relevant_to_user = True

            # 2. Была ли затронута его привязка в этом логе?
            if "seller_id" in changes:
                old_seller = changes["seller_id"].get("old")
                new_seller = changes["seller_id"].get("new")
                if old_seller == user.id or new_seller == user.id:
                    is_relevant_to_user = True

        if not is_relevant_to_user:
            continue

        # Маскировка данных для пользователя (Задача 8)
        if current_user.get("role") != "admin" and "seller_id" in changes:
            old_seller = changes["seller_id"].get("old")
            new_seller = changes["seller_id"].get("new")

            # Очищаем лишние данные о других авторах
            changes.pop("seller_id", None)

            if new_seller == user.id:
                changes["account_status"] = "Товар добавлен на аккаунт"
            elif old_seller == user.id:
                changes["account_status"] = "Товар исключен из аккаунта"
                # Если товар ушел, остальные изменения (цена/остаток) ему видеть не нужно
                changes = {"account_status": "Товар исключен из аккаунта"}

        result.append(
            AuditLogRead(
                id=log.id,
                timestamp=log.timestamp,
                actor=log.actor,
                entity_name=log.entity_name,
                entity_id=log.entity_id,
                action=log.action,
                changes=changes,
                product_name=product_map.get(log.entity_id, "Неизвестный товар")
            )
        )

    return result