# Файл: main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
# from apscheduler.schedulers.background import BackgroundScheduler

from database import create_db_and_tables
from routers import auth_router, users, products, transactions, analytics, audit

app = FastAPI(title="Merchberry ERP API")

# Настройка CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# scheduler = BackgroundScheduler()

@app.on_event("startup")
def on_startup():
    create_db_and_tables()
    # scheduler.start()

# Подключаем все наши маршруты (роутеры)
app.include_router(auth_router.router)
app.include_router(users.router)
app.include_router(products.router)
app.include_router(transactions.router)
app.include_router(analytics.router)
app.include_router(audit.router)

# Если захочешь проверить, работает ли сервер, перейди на http://127.0.0.1:8000/docs