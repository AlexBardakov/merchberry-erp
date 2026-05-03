# Файл: main.py
import json
import os
import routers.transactions as tx_module

from routers import ws
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from sqlmodel import Session, select
from datetime import datetime, timedelta, timezone
from models import User, AuditLog, Product
from routers.vk_bot import send_vk_message_sync

from database import create_db_and_tables, engine
from routers import auth_router, users, products, transactions, analytics, \
    audit, vk_bot, payouts
from routers.transactions import run_b2b_sync  # Импортируем нашу функцию

app = FastAPI(title="Merchberry ERP API")
TOMSK_TZ = timezone(timedelta(hours=7))
os.makedirs("uploads/payouts", exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory="uploads"), name="uploads")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

scheduler = BackgroundScheduler()


# Задача, которая будет выполняться в фоне
def scheduled_sync_job():
    print("🤖 Запуск автоматической фоновой синхронизации с Бизнес.Ру...")
    if tx_module.SYNC_IN_PROGRESS:
        print(
            "⏳ Синхронизация уже идет. Защита от дублирования активна. Пропуск...")
        return

    tx_module.SYNC_IN_PROGRESS = True
    try:
        with Session(engine) as session:
            result = tx_module.run_b2b_sync(session=session)
            print(
                f"✅ Синхронизация завершена: обработано {result['processed_items']} позиций.")
    except Exception as e:
        print(f"❌ Ошибка фоновой синхронизации: {e}")
    finally:
        tx_module.SYNC_IN_PROGRESS = False


def scheduled_inventory_notify_job():
    print("📦 Запуск ежедневной рассылки об изменениях склада...")
    with Session(engine) as session:
        try:
            users_to_notify = session.exec(
                select(User).where(User.vk_id != None, User.vk_notify_inventory == True)
            ).all()

            if not users_to_notify:
                return

            yesterday = datetime.now(TOMSK_TZ) - timedelta(days=1)

            for user in users_to_notify:
                # Получаем ID всех товаров пользователя
                products = session.exec(
                    select(Product).where(Product.seller_id == user.id)).all()
                product_map = {p.id: p.name for p in products}

                if not product_map:
                    continue

                # Ищем логи для этих товаров за последние 24 часа
                logs = session.exec(
                    select(AuditLog).where(
                        AuditLog.entity_name.in_(["Product", "product"]),
                        AuditLog.entity_id.in_(list(product_map.keys())),
                        AuditLog.timestamp >= yesterday
                    ).order_by(AuditLog.timestamp)
                ).all()

                if not logs:
                    continue

                # Формируем красивое сообщение
                msg_lines = ["📦 Сводка изменений вашего склада за сутки:\n"]
                changes_count = 0

                for log in logs:
                    p_name = product_map.get(log.entity_id,
                                             "Неизвестный товар")

                    changes = log.changes
                    if isinstance(changes, str):
                        try:
                            changes = json.loads(changes)
                        except:
                            changes = {}

                    # Фильтруем: показываем только изменения остатков
                    if "stock" in changes and isinstance(changes["stock"],
                                                         dict):
                        old_s = changes["stock"].get("old", 0)
                        new_s = changes["stock"].get("new", 0)
                        msg_lines.append(
                            f"• {p_name}: {old_s} шт. ➔ {new_s} шт.")
                        changes_count += 1

                    elif "initial_stock" in changes:
                        msg_lines.append(
                            f"• {p_name}: добавлен (Остаток: {changes['initial_stock']} шт.)")
                        changes_count += 1

                if changes_count > 0:
                    send_vk_message_sync(user.vk_id, "\n".join(msg_lines))

            print("✅ Рассылка по складу успешно завершена.")
        except Exception as e:
            print(f"❌ Ошибка рассылки по складу: {e}")


@app.on_event("startup")
def on_startup():
    create_db_and_tables()

    # Синхронизация с Бизнес.Ру (каждый час)
    scheduler.add_job(scheduled_sync_job, 'interval', hours=1)

    # НОВОЕ: Рассылка по складу (каждый день в 20:00)
    scheduler.add_job(scheduled_inventory_notify_job, 'cron', hour=20,
                      minute=0)

    scheduler.start()
    print("⏱️ Планировщик фоновых задач запущен!")


app.include_router(auth_router.router)
app.include_router(users.router)
app.include_router(products.router)
app.include_router(transactions.router)
app.include_router(analytics.router)
app.include_router(audit.router)
app.include_router(vk_bot.router)
app.include_router(payouts.router)
app.include_router(ws.router)