# Файл: utils.py (или services/audit.py)
from sqlmodel import Session
from models import AuditLog

def create_audit_log(
    session: Session,
    actor: str,
    entity_name: str,
    entity_id: int,
    action: str,
    changes: dict
):
    """
    Записывает событие в таблицу AuditLog.
    changes - это словарь (dict), который автоматически сохранится как JSON.
    """
    log_entry = AuditLog(
        actor=actor,
        entity_name=entity_name,
        entity_id=entity_id,
        action=action,
        changes=changes
    )
    session.add(log_entry)