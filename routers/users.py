import os
import csv
import io
import string
import secrets

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlmodel import Session, select, or_, col, func
from typing import List, Optional
from datetime import date, timedelta, datetime, time, timezone

from database import get_session
from models import User
from auth import get_password_hash, get_current_admin, get_current_user
from schemas import UserCreate, UserUpdate, PasswordUpdate, UserUpdateSettings, \
    UserRenameRequest, UserDeleteConfirmRequest, UserVKSettingsUpdate, \
    BulkPasswordResetRequest
from utils import create_audit_log

load_dotenv()

router = APIRouter(prefix="/api/users", tags=["Users"])

VK_GROUP_URL = os.getenv("VK_GROUP_URL")
VK_GROUP_ID = os.getenv("VK_GROUP_ID")
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
        search_lower = f"%{search.lower()}%"
        statement = statement.where(
            or_(
                func.lower(User.username).like(search_lower),
                func.lower(User.full_name).like(search_lower),
                func.lower(User.phone).like(search_lower)
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

    if 'is_active' in update_dict and not update_dict['is_active']:
        user.vk_id = None
        user.vk_link_token = None
        user.vk_notify_sales = False
        user.vk_notify_inventory = False

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


@router.patch("/me/settings")
def update_my_settings(
        settings: UserUpdateSettings,
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    user = session.exec(select(User).where(User.username == current_user.get("username"))).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    if settings.notifications_enabled is not None:
        user.notifications_enabled = settings.notifications_enabled
    if settings.low_stock_threshold is not None:
        user.low_stock_threshold = settings.low_stock_threshold

    session.add(user)
    session.commit()
    return {"status": "success", "settings": {
        "notifications_enabled": user.notifications_enabled,
        "low_stock_threshold": user.low_stock_threshold
    }}


@router.post("/{user_id}/rename")
def rename_user(
        user_id: int,
        req: UserRenameRequest,
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    # 1. Проверка занятости имени
    existing = session.exec(select(User).where(User.username == req.new_username)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Это имя (логин) уже занято другим автором")

    old_username = user.username
    user.username = req.new_username
    session.add(user)

    # 2. Логирование смены имени
    create_audit_log(
        session=session,
        actor=admin_data.get("username", "admin"),
        entity_name="User",
        entity_id=user.id,
        action="rename_user",
        changes={"username": {"old": old_username, "new": req.new_username}}
    )

    session.commit()
    return {"status": "success", "message": f"Имя изменено на {req.new_username}"}


@router.delete("/{user_id}")
def delete_user_account(
        user_id: int,
        req: UserDeleteConfirmRequest,
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    # 1. Подтверждение по имени
    if user.username != req.confirm_username:
        raise HTTPException(status_code=400, detail="Имя пользователя не совпадает. Удаление отменено.")

    # 2. Проверка правила 72 часов и архива (Задача 2)
    created_time = user.created_at
    if created_time.tzinfo is None:
        created_time = created_time.replace(tzinfo=timezone.utc)

    time_elapsed = datetime.now(timezone.utc) - created_time

    # Если прошло больше 72 часов и профиль НЕ в архиве (is_active == True), удалять нельзя
    if time_elapsed > timedelta(hours=72) and user.is_active:
        raise HTTPException(
            status_code=400,
            detail="Прошло более 72 часов с момента создания. Чтобы удалить аккаунт, сначала перенесите его в архив (деактивируйте)."
        )

    # 3. Полное удаление
    session.delete(user)

    create_audit_log(
        session=session,
        actor=admin_data.get("username", "admin"),
        entity_name="User",
        entity_id=user_id,
        action="delete_user",
        changes={"username": user.username, "deleted": True}
    )

    session.commit()
    return {"status": "success", "message": "Аккаунт успешно удален"}


@router.patch("/{user_id}/vk")
def update_vk_settings(
        user_id: int,
        req: UserVKSettingsUpdate,
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    # Проверка прав: менять настройки ВК может либо админ, либо сам владелец профиля
    if current_user.get("role") != "admin":
        current_db_user = session.exec(select(User).where(User.username == current_user.get("username"))).first()
        if not current_db_user or current_db_user.id != user_id:
            raise HTTPException(status_code=403, detail="Нет прав для изменения настроек этого пользователя")

    if req.vk_id is not None:
        user.vk_id = req.vk_id
    if req.vk_notify_inventory is not None:
        user.vk_notify_inventory = req.vk_notify_inventory
    if req.vk_notify_sales is not None:
        user.vk_notify_sales = req.vk_notify_sales

    session.add(user)
    session.commit()
    session.refresh(user)

    return user


@router.post("/{user_id}/vk-unbind")
def unbind_vk_account(
        user_id: int,
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    # Проверка прав: отвязать может либо админ, либо сам владелец
    if current_user.get("role") != "admin":
        current_db_user = session.exec(select(User).where(
            User.username == current_user.get("username"))).first()
        if not current_db_user or current_db_user.id != user_id:
            raise HTTPException(status_code=403,
                                detail="Нет прав для этого действия")

    user.vk_id = None
    user.vk_link_token = None
    user.vk_notify_sales = False
    user.vk_notify_inventory = False

    session.add(user)
    session.commit()
    return {"status": "success", "message": "ВК аккаунт успешно отвязан"}

@router.get("/me/vk-link")
def get_my_vk_link(
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    user = session.exec(select(User).where(User.username == current_user.get("username"))).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    # Если токена еще нет, генерируем его (8 случайных байт, безопасных для URL)
    if not user.vk_link_token:
        user.vk_link_token = secrets.token_urlsafe(8)
        session.add(user)
        session.commit()
        session.refresh(user)

    if user.vk_id:
        return {
            "vk_link": None,
            "is_bound": True,
            "message": "Аккаунт уже привязан"
        }
    # Формируем прямую ссылку на диалог с ботом с передачей параметра ref
    group_address = VK_GROUP_URL if VK_GROUP_URL else f"club{VK_GROUP_ID}"
    vk_url = f"https://vk.me/{group_address}?ref={user.vk_link_token}"

    return {
        "vk_link": vk_url,
        "token": user.vk_link_token,
        "is_bound": user.vk_id is not None # Флаг, чтобы фронтенд знал, привязан ли уже аккаунт
    }


def generate_random_password(length=8):
    alphabet = string.ascii_letters + string.digits + "!@#$"
    return ''.join(secrets.choice(alphabet) for _ in range(length))


@router.post("/bulk-password-reset")
def bulk_password_reset(
        req: BulkPasswordResetRequest,
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    # Получаем выбранных пользователей
    users = session.exec(
        select(User).where(col(User.id).in_(req.user_ids))).all()

    if not users:
        raise HTTPException(status_code=404, detail="Пользователи не найдены")

    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')
    # Добавили ID и Логин в заголовки
    writer.writerow(['ID', 'Логин', 'ФИО', 'Новый пароль'])

    for user in users:
        new_password = generate_random_password()
        user.hashed_password = get_password_hash(new_password)
        session.add(user)

        # Выгружаем расширенные данные
        writer.writerow(
            [user.id, user.username, user.full_name or '', new_password])

    session.commit()
    output.seek(0)

    content = '\ufeff' + output.getvalue()

    return Response(
        content=content,
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=passwords_reset.csv"}
    )