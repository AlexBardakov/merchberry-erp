from sqlmodel import Session, select
from database import engine, create_db_and_tables # Исправленный импорт
from models import User
from auth import get_password_hash

# Создаем файл базы данных и таблицы (если их еще нет)
create_db_and_tables()

with Session(engine) as session:
    # Проверяем, есть ли уже пользователи в базе
    existing_user = session.exec(select(User)).first()
    if not existing_user:
        # Создаем первого админа
        admin = User(
            username="admin",
            role="admin",
            hashed_password=get_password_hash("admin123"), # Пароль будет admin123
            full_name="Главный Администратор"
        )
        session.add(admin)
        session.commit()
        print("✅ Успех! Создан пользователь — Логин: admin | Пароль: admin123")
    else:
        print("⚠️ База данных не пуста. Пользователи уже существуют.")