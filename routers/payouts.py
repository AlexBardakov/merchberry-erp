# routers/payouts.py
import os
import shutil
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlmodel import Session, select
from typing import List

from database import get_session
from models import PayoutRequest, User, Transaction
from auth import get_current_user, get_current_admin
from schemas import PayoutRequestCreate, PayoutRequestAction, PayoutRequestRead
from utils import create_audit_log
from routers.vk_bot import send_vk_message_sync

router = APIRouter(prefix="/api/payouts", tags=["Payouts"])

# Папка для сохранения загруженных файлов
UPLOAD_DIR = "uploads/payouts"
os.makedirs(UPLOAD_DIR, exist_ok=True)


# 1. Создание запроса (Для автора)
@router.post("/", response_model=PayoutRequestRead)
def create_payout_request(
        req: PayoutRequestCreate,
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    user = session.exec(select(User).where(User.username == current_user.get(
        "username")).with_for_update()).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    if req.amount <= 0:
        raise HTTPException(status_code=400,
                            detail="Сумма должна быть больше нуля")

    if req.amount > user.balance:
        raise HTTPException(status_code=400,
                            detail=f"Сумма превышает текущий баланс ({user.balance} ₽)")

    # Проверка: запрещаем создавать новый запрос, если старый еще висит
    existing_pending = session.exec(
        select(PayoutRequest).where(PayoutRequest.seller_id == user.id,
                                    PayoutRequest.status == "pending")
    ).first()
    if existing_pending:
        raise HTTPException(status_code=400,
                            detail="У вас уже есть активный запрос в ожидании.")

    payout = PayoutRequest(
        seller_id=user.id,
        amount=req.amount,
        comment=req.comment,
        status="pending"
    )
    session.add(payout)
    session.commit()
    session.refresh(payout)

    # Уведомление в беседу администраторов (Задача 4)
    admin_chat_id = os.getenv("VK_ADMIN_CHAT_ID")
    if admin_chat_id:
        msg = (
            f"🔔 НОВЫЙ ЗАПРОС НА ВЫПЛАТУ\n"
            f"👤 Автор: {user.username}\n"
            f"📝 ФИО: {user.full_name or 'Не указано'}\n"
            f"💰 Текущий баланс: {user.balance} ₽\n"
            f"📤 К выводу: {req.amount} ₽\n\n"
            f"--- Приватная заметка (реквизиты) ---\n"
            f"{user.notes or 'Нет заметок в профиле'}\n\n"
        )
        # Визуальное разделение комментариев
        if req.comment:
            msg += (
                f"--- Комментарий от автора к запросу ---\n"
                f"{req.comment}"
            )
        send_vk_message_sync(admin_chat_id, msg)

    return payout


# 2. Получение списка запросов (Для админа)
@router.get("/all", response_model=List[PayoutRequestRead])
def get_all_payout_requests(
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    requests = session.exec(
        select(PayoutRequest).order_by(PayoutRequest.created_at.desc())).all()
    result = []
    for req in requests:
        seller = session.get(User, req.seller_id)
        req_dict = req.dict()
        if seller:
            req_dict["seller_username"] = seller.username
            req_dict["seller_full_name"] = seller.full_name
            req_dict["seller_balance"] = seller.balance
            req_dict["seller_notes"] = seller.notes
        result.append(req_dict)
    return result


# 3. Получение своих запросов (Для автора)
@router.get("/me", response_model=List[PayoutRequestRead])
def get_my_payout_requests(
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    user = session.exec(select(User).where(
        User.username == current_user.get("username"))).first()
    requests = session.exec(select(PayoutRequest).where(
        PayoutRequest.seller_id == user.id).order_by(
        PayoutRequest.created_at.desc())).all()
    return requests


# 4. Обработка запроса (Подтвердить / Отказать)
@router.post("/{request_id}/process", response_model=PayoutRequestRead)
def process_payout_request(
        request_id: int,
        action_data: PayoutRequestAction,
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    payout = session.exec(select(PayoutRequest).where(
        PayoutRequest.id == request_id).with_for_update()).first()
    if not payout:
        raise HTTPException(status_code=404, detail="Запрос не найден")

    if payout.status != "pending":
        raise HTTPException(status_code=400,
                            detail="Этот запрос уже обработан")

    seller = session.exec(select(User).where(
        User.id == payout.seller_id).with_for_update()).first()

    if action_data.action == "approve":
        if seller.balance < payout.amount:
            raise HTTPException(status_code=400,
                                detail="Недостаточно средств на балансе автора (баланс изменился)")

        payout.status = "approved"
        payout.admin_comment = action_data.admin_comment
        seller.balance -= payout.amount
        session.add(seller)

        # Создаем транзакцию выплаты (уйдет в раздел Финансы)
        tx = Transaction(
            type="payout",
            amount=-payout.amount,
            full_amount=-payout.amount,
            comment=f"Вывод средств по запросу #{payout.id}",
            seller_id=seller.id
        )
        session.add(tx)

    elif action_data.action == "reject":
        payout.status = "rejected"
        payout.admin_comment = action_data.admin_comment
    else:
        raise HTTPException(status_code=400, detail="Неизвестное действие")

    payout.updated_at = datetime.now(timezone.utc)
    session.add(payout)
    session.commit()
    session.refresh(payout)

    # Уведомление пользователю в личку ВК (Задача 5)
    if seller.vk_id:
        status_text = "✅ ОДОБРЕНА" if payout.status == "approved" else "❌ ОТКЛОНЕНА"
        msg = f"💳 Статус вашего запроса на выплату ({payout.amount} ₽) изменился:\nЗаявка {status_text}."
        if payout.status == "rejected" and payout.admin_comment:
            msg += f"\n\nКомментарий администратора: {payout.admin_comment}"
        if payout.proof_file_url:
            msg += f"\n\nС подтверждающими документами вы можете ознакомиться внутри запроса на сайте."
        send_vk_message_sync(seller.vk_id, msg)

    return payout


# 5. Загрузка файла доказательства
@router.post("/{request_id}/upload-proof")
def upload_proof_file(
        request_id: int,
        file: UploadFile = File(...),
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    payout = session.get(PayoutRequest, request_id)
    if not payout:
        raise HTTPException(status_code=404, detail="Запрос не найден")

    # Генерируем уникальное имя файла
    ext = file.filename.split('.')[-1] if '.' in file.filename else 'png'
    filename = f"proof_{request_id}_{uuid.uuid4().hex[:8]}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    # Сохраняем файл на диск
    with open(filepath, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Сохраняем путь к файлу в БД
    payout.proof_file_url = f"/uploads/payouts/{filename}"
    session.add(payout)
    session.commit()

    return {"status": "success", "url": payout.proof_file_url}