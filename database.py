import os
from sqlmodel import SQLModel, create_engine, Session
from dotenv import load_dotenv

load_dotenv()

# Забираем URL базы из .env (по умолчанию fallback на sqlite)
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///database.db")

# Параметр check_same_thread нужен ТОЛЬКО для SQLite. Для Postgres он вызовет ошибку.
connect_args = {"check_same_thread": False} if "sqlite" in DATABASE_URL else {}

engine = create_engine(DATABASE_URL, echo=False, connect_args=connect_args)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session