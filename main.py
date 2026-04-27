# Файл: main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from sqlmodel import Session

from database import create_db_and_tables, engine
from routers import auth_router, users, products, transactions, analytics, audit, vk_bot
from routers.transactions import run_b2b_sync  # Импортируем нашу функцию

app = FastAPI(title="Merchberry ERP API")

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
    with Session(engine) as session:
        try:
            # Запрашиваем данные только за последний день, чтобы не перегружать API
            result = run_b2b_sync(session=session, days_back=1)
            print(f"✅ Синхронизация завершена: обработано {result['processed_items']} позиций.")
        except Exception as e:
            print(f"❌ Ошибка фоновой синхронизации: {e}")


@app.on_event("startup")
def on_startup():
    create_db_and_tables()

    # Настраиваем робота на запуск каждый час
    scheduler.add_job(scheduled_sync_job, 'interval', hours=1)
    scheduler.start()
    print("⏱️ Планировщик фоновых задач запущен!")


app.include_router(auth_router.router)
app.include_router(users.router)
app.include_router(products.router)
app.include_router(transactions.router)
app.include_router(analytics.router)
app.include_router(audit.router)
app.include_router(vk_bot.router)