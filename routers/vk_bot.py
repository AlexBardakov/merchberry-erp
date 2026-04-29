# Файл: routers/vk_bot.py
import os
import httpx
import random
from fastapi import APIRouter, Request, Depends
from fastapi.responses import PlainTextResponse
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


def send_vk_message_sync(user_id: str, text: str):
    """Синхронная функция для вызова из других скриптов (например, transactions.py)"""
    if not VK_API_TOKEN or not user_id:
        return
    try:
        with httpx.Client() as client:
            client.post("https://api.vk.com/method/messages.send", params={
                "user_id": user_id,
                "message": text,
                "random_id": random.randint(1, 2147483647),
                # Исправлен random_id
                "access_token": VK_API_TOKEN,
                "v": "5.131"
            })
    except Exception as e:
        print(f"Ошибка отправки ВК: {e}")


async def send_vk_message(user_id: int, text: str):
    url = "https://api.vk.com/method/messages.send"
    params = {
        "user_id": user_id,
        "message": text,
        "random_id": random.randint(1, 2147483647),
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
        return PlainTextResponse(content=VK_CONFIRM_TOKEN)

    # 2. Обработка нового сообщения
    if data.get("type") == "message_new":
        msg_obj = data["object"]["message"]
        user_vk_id = str(msg_obj["from_id"])
        text = msg_obj.get("text", "").strip()

        # Проверяем скрытый токен (если переход по ссылке) или текст сообщения
        ref_token = msg_obj.get("ref")
        search_token = ref_token if ref_token else text

        if search_token:
            user = session.exec(
                select(User).where(User.vk_link_token == search_token)).first()
            if user:
                user.vk_id = user_vk_id
                user.vk_link_token = None
                user.vk_notify_sales = True
                session.add(user)
                session.commit()
                await send_vk_message(user_vk_id,
                                      f"✅ Аккаунт {user.username} успешно привязан!")

                # ИСПРАВЛЕНА ОШИБКА: Возвращаем сырой текст без кавычек
                return PlainTextResponse(content="ok")


    return PlainTextResponse(content="ok")