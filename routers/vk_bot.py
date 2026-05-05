# Файл: routers/vk_bot.py
import os
import httpx
import random
import re
import uuid
from fastapi import APIRouter, Request, Depends
from fastapi.responses import PlainTextResponse
from sqlmodel import Session, select
from dotenv import load_dotenv
from database import get_session
from models import User, PayoutRequest, Transaction
from utils import create_audit_log
from services.websocket import manager

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
                "peer_id": user_id,
                "message": text,
                "random_id": random.randint(1, 2147483647),
                "access_token": VK_API_TOKEN,
                "v": "5.131"
            })
    except Exception as e:
        print(f"Ошибка отправки ВК: {e}")


async def send_vk_message(user_id: int, text: str):
    url = "https://api.vk.com/method/messages.send"
    params = {
        "peer_id": user_id,
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
        peer_id = msg_obj.get("peer_id")
        text = msg_obj.get("text", "").strip()

        reply = msg_obj.get("reply_message")
        if reply:
            reply_text = reply.get("text", "")
            # Ищем, отвечает ли админ на сообщение с номером заявки
            match = re.search(r"заявка на выплату #(\d+)", reply_text,
                              re.IGNORECASE)

            if match:
                payout_id = int(match.group(1))

                # 1. Проверяем, что отвечает именно администратор
                admin_user = session.exec(
                    select(User).where(User.vk_id == user_vk_id)).first()
                if not admin_user or admin_user.role != "admin":
                    await send_vk_message(peer_id,
                                          "❌ У вас нет прав для подтверждения выплат.")
                    return PlainTextResponse(content="ok")

                # 2. Проверка наличия файла (ОШИБКА, если админ просто написал текст)
                attachments = msg_obj.get("attachments", [])
                if not attachments:
                    await send_vk_message(peer_id,
                                          "❌ Ошибка: Для подтверждения выплаты необходимо прикрепить файл или фото (чек). Любой другой ответ не принимается.")
                    return PlainTextResponse(content="ok")

                # 3. Ищем URL файла (учитываем, что могут скинуть как "фото", так и "документ")
                file_url = None
                ext = "jpg"
                for att in attachments:
                    if att["type"] == "photo":
                        sizes = att["photo"]["sizes"]
                        # Выбираем фото с максимальным разрешением
                        largest = \
                        sorted(sizes, key=lambda s: s["width"] * s["height"])[
                            -1]
                        file_url = largest["url"]
                        break
                    elif att["type"] == "doc":
                        file_url = att["doc"]["url"]
                        ext = att["doc"]["ext"]
                        break

                if not file_url:
                    await send_vk_message(peer_id,
                                          "❌ Ошибка: Не удалось найти подходящий файл во вложениях (нужно изображение или документ).")
                    return PlainTextResponse(content="ok")

                # 4. Проверяем заявку в БД
                payout = session.get(PayoutRequest, payout_id)
                if not payout:
                    await send_vk_message(peer_id,
                                          f"❌ Ошибка: Заявка #{payout_id} не найдена в базе данных.")
                    return PlainTextResponse(content="ok")

                if payout.status != "pending":
                    await send_vk_message(peer_id,
                                          f"❌ Заявка #{payout_id} уже обработана (текущий статус: {payout.status}).")
                    return PlainTextResponse(content="ok")

                seller = session.exec(select(User).where(
                    User.id == payout.seller_id).with_for_update()).first()
                if not seller:
                    await send_vk_message(peer_id,
                                          "❌ Ошибка: Автор заявки не найден.")
                    return PlainTextResponse(content="ok")

                # 5. Скачиваем файл на сервер
                filename = f"proof_{payout_id}_{uuid.uuid4().hex[:8]}.{ext}"
                filepath = os.path.join("uploads/payouts", filename)

                try:
                    async with httpx.AsyncClient() as client:
                        resp = await client.get(file_url)
                        resp.raise_for_status()
                        with open(filepath, "wb") as f:
                            f.write(resp.content)
                except Exception as e:
                    await send_vk_message(peer_id,
                                          f"❌ Ошибка при скачивании файла: {e}")
                    return PlainTextResponse(content="ok")

                # 6. Подтверждаем выплату и списываем средства
                old_balance = seller.balance
                seller.balance -= payout.amount

                tx = Transaction(
                    type="payout",
                    amount=-payout.amount,
                    comment=f"Выплата средств по заявке #{payout.id}",
                    seller_id=seller.id
                )
                session.add(tx)

                payout.status = "approved"
                payout.admin_comment = "Подтверждено администратором через ВК"
                payout.proof_file_url = f"/api/uploads/payouts/{filename}"

                session.add(seller)
                session.add(payout)
                session.flush()  # Получаем ID транзакции для логов

                create_audit_log(
                    session=session,
                    actor=admin_user.username,
                    entity_name="PayoutRequest",
                    entity_id=payout.id,
                    action="approve_payout_vk",
                    changes={
                        "status": {"old": "pending", "new": "approved"},
                        "balance": {"old": old_balance, "new": seller.balance},
                        "transaction_id": tx.id
                    }
                )

                session.commit()

                # 7. Отправляем сообщения об успехе
                await send_vk_message(peer_id,
                                      f"✅ Заявка #{payout.id} успешно подтверждена!\nС баланса автора списано {payout.amount} ₽. Чек сохранен на сервере.")

                # Уведомляем автора (Если у него включена галочка уведомлений о финансах)
                if seller.vk_id and seller.vk_notify_sales:
                    send_vk_message_sync(seller.vk_id,
                                         f"💸 Ваша заявка на выплату #{payout.id} на сумму {payout.amount} ₽ успешно переведена!\nЧек прикреплен к заявке в личном кабинете.")

                # 8. Уведомляем фронтенд (вкладка Финансы обновится у всех в реальном времени)
                await manager.broadcast({
                    "event": "payout_status_changed",
                    "payout_id": payout.id,
                    "new_status": payout.status
                })

                return PlainTextResponse(content="ok")

        # Проверяем, является ли это групповой беседой (ID > 2 млрд)
        is_group_chat = int(peer_id) >= 2000000000

        # === КОМАНДЫ ДЛЯ БЕСЕД ===
        # Используем "in", чтобы команда сработала даже при упоминании бота (например: "@bot /chatid")
        if "/chatid" in text.lower():
            await send_vk_message(peer_id, f"ID этой беседы: {peer_id}")
            return PlainTextResponse(content="ok")

        # === ПРИВЯЗКА АККАУНТА (Только для личных сообщений) ===
        # Если это беседа, мы просто игнорируем текст и не дергаем базу данных
        if not is_group_chat:
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
                    return PlainTextResponse(content="ok")

    return PlainTextResponse(content="ok")