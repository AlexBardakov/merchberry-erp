from fastapi import APIRouter, Depends, Query, HTTPException
from sqlmodel import Session, select, desc, or_
from typing import List, Optional
import json

from database import get_session
from models import AuditLog, Product, User
from auth import get_current_user

router = APIRouter(prefix="/api/audit", tags=["Audit"])


@router.get("/")
def get_audit_logs(
        actor: Optional[str] = Query(None,
                                     description="Фильтр по автору действия"),
        entity_name: Optional[str] = Query(None,
                                           description="Фильтр по сущности"),
        action: Optional[str] = Query(None,
                                      description="Фильтр по типу действия"),
        limit: int = Query(50, ge=1, le=100),
        offset: int = Query(0, ge=0),
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Доступ запрещен.")

    statement = select(AuditLog)
    if actor:
        statement = statement.where(AuditLog.actor == actor)
    if entity_name:
        statement = statement.where(AuditLog.entity_name == entity_name)
    if action:
        statement = statement.where(AuditLog.action == action)

    statement = statement.order_by(desc(AuditLog.timestamp))
    return session.exec(statement.offset(offset).limit(limit)).all()


# Файл: routers/audit.py (замените функцию get_inventory_logs)

@router.get("/inventory")
def get_inventory_logs(
        page: int = Query(1, ge=1),
        limit: int = Query(50, ge=1, le=100),
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    user = None
    if current_user.get("role") == "seller":
        user = session.exec(select(User).where(
            User.username == current_user.get("username"))).first()
        if not user:
            return {"items": [], "total": 0, "page": page, "pages": 0}

    statement = select(AuditLog).where(
        or_(
            AuditLog.entity_name == "Product",
            AuditLog.entity_name == "product"
        )
    ).order_by(desc(AuditLog.timestamp))
    all_logs = session.exec(statement).all()

    products = session.exec(select(Product)).all()
    product_map = {p.id: p for p in products}

    users = session.exec(select(User)).all()
    user_map = {u.id: u.username for u in users}

    filtered_logs = []

    for log in all_logs:
        changes = {}
        if log.changes:
            if isinstance(log.changes, dict):
                import copy
                changes = copy.deepcopy(
                    log.changes)  # Глубокая копия защищает от мутации
            elif isinstance(log.changes, str):
                try:
                    changes = json.loads(log.changes)
                except:
                    pass
        if not isinstance(changes, dict):
            changes = {}  # Если вдруг JSON оказался списком, сбрасываем в пустой словарь

        is_relevant = False
        current_product = product_map.get(log.entity_id)

        if current_user.get("role") == "admin":
            is_relevant = True
        else:
            if current_product and current_product.seller_id == user.id:
                is_relevant = True

            if "seller_id" in changes:
                # Если это изменение владельца (словарь)
                if isinstance(changes["seller_id"], dict):
                    old_seller = changes["seller_id"].get("old")
                    new_seller = changes["seller_id"].get("new")
                    if old_seller == user.id or new_seller == user.id:
                        is_relevant = True
                # Если это создание нового товара (число)
                elif isinstance(changes["seller_id"], int):
                    if changes["seller_id"] == user.id:
                        is_relevant = True

        if not is_relevant:
            continue

        # Обработка данных для админа и продавца
        if current_user.get("role") == "admin":
            if "seller_id" in changes:
                if isinstance(changes["seller_id"], dict):
                    old_id = changes["seller_id"].get("old")
                    new_id = changes["seller_id"].get("new")
                    old_name = user_map.get(old_id, "Ничейный") if old_id else "Ничейный"
                    new_name = user_map.get(new_id, "Ничейный") if new_id else "Ничейный"
                    changes["admin_seller_change"] = f"{old_name} ➔ {new_name}"
                elif isinstance(changes["seller_id"], int):
                    new_id = changes["seller_id"]
                    new_name = user_map.get(new_id, "Ничейный")
                    changes["admin_seller_change"] = f"Привязан к: {new_name}"
        else:
            if "seller_id" in changes:
                if isinstance(changes["seller_id"], dict):
                    old_seller = changes["seller_id"].get("old")
                    new_seller = changes["seller_id"].get("new")
                    changes.pop("seller_id", None)

                    if new_seller == user.id:
                        changes["account_status"] = "Товар добавлен на аккаунт"
                    elif old_seller == user.id:
                        changes["account_status"] = "Товар исключен из аккаунта"
                        # Очищаем остальные изменения, чтобы продавец не видел лишнего при отвязке
                        changes = {"account_status": "Товар исключен из аккаунта"}
                elif isinstance(changes["seller_id"], int):
                    if changes["seller_id"] == user.id:
                        changes["account_status"] = "Товар добавлен на аккаунт"
                        changes.pop("seller_id", None)

        p_name = current_product.name if current_product else "Удаленный товар"
        p_sku = current_product.sku if current_product else "N/A"

        filtered_logs.append({
            "id": log.id,
            "timestamp": log.timestamp,
            "action": log.action,
            "product_name": p_name,
            "product_sku": p_sku,
            "changes": changes,
            "actor": log.actor
        })

    total_count = len(filtered_logs)
    start_idx = (page - 1) * limit
    end_idx = start_idx + limit
    paginated_logs = filtered_logs[start_idx:end_idx]

    return {
        "items": paginated_logs,
        "total": total_count,
        "page": page,
        "pages": (total_count + limit - 1) // limit if total_count > 0 else 1
    }