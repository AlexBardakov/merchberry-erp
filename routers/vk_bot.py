# Файл: routers/vk_bot.py
import os
import httpx
from fastapi import APIRouter, Request, Depends
from sqlmodel import Session, select
from dotenv import load_dotenv
from database import get_session
from models import User

# Загружаем переменные окружения прямо здесь
load_dotenv()

router = APIRouter(prefix="/api/vk-callback", tags=["VK Bot"])

# Получаем настройки из .env
VK_API_TOKEN = os.getenv("VK_API_TOKEN")
VK_CONFIRM_TOKEN = os.getenv("VK_CONFIRM_TOKEN")


async def send_vk_message(user_id: int, text: str):
    url = "https://api.vk.com/method/messages.send"
    params = {
        "user_id": user_id,
        "message": text,
        "random_id": 0,
        "access_token": VK_API_TOKEN,
        "v": "5.131"
    }
    async with httpx.AsyncClient() as client:
        await client.post(url, params=params)


@router.post("")
async def vk_callback(request: Request,
                      session: Session = Depends(get_session)):
    data = await request.json()

    # 1. ВК проверяет доступность сервера
    if data.get("type") == "confirmation":
        # Возвращаем код, который прописан в нашем .env
        return VK_CONFIRM_TOKEN

    # 2. Обработка нового сообщения
    if data.get("type") == "message_new":
        msg_obj = data["object"]["message"]
        user_vk_id = str(msg_obj["from_id"])

        # ВК передает ref, только если пользователь перешел по ссылке vk.me/...?ref=token
        ref_token = msg_obj.get("ref")

        if ref_token:
            user = session.exec(
                select(User).where(User.vk_link_token == ref_token)).first()
            if user:
                user.vk_id = user_vk_id
                user.vk_link_token = None  # Токен больше не нужен
                session.add(user)
                session.commit()
                await send_vk_message(user_vk_id,
                                      f"✅ Аккаунт {user.username} успешно привязан!")
            else:
                await send_vk_message(user_vk_id,
                                      "❌ Срок действия ссылки истек или она неверна.")
        else:
            # Если сообщения приходят без токена
            user = session.exec(
                select(User).where(User.vk_id == user_vk_id)).first()
            if not user:
                await send_vk_message(user_vk_id,
                                      "Привет! Для получения уведомлений привяжите аккаунт в настройках ERP.")
            else:
                await send_vk_message(user_vk_id,
                                      "Ваш аккаунт уже привязан. Ожидайте уведомлений о продажах.")

    return "ok"