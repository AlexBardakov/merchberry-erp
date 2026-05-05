import sqlite3

def run_migration():
    # Имя файла базы данных (если у тебя в .env другое, замени здесь)
    db_file = 'database.db'

    print(f"Подключаемся к базе {db_file}...")
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()

    try:
        # Добавляем новую колонку. В SQLite boolean хранится как 0 (False) или 1 (True)
        # Указываем DEFAULT 0, чтобы у всех старых пользователей галочка была выключена по умолчанию
        cursor.execute(
            "ALTER TABLE user ADD COLUMN vk_notify_low_stock BOOLEAN DEFAULT 0")
        conn.commit()
        print(
            "✅ Колонка 'vk_notify_low_stock' успешно добавлена в таблицу 'user'!")
    except sqlite3.OperationalError as e:
        print(f"⚠️ Ошибка: {e}")
        print(
            "Скорее всего, колонка уже существует. Ничего страшного не произошло.")
    finally:
        conn.close()


if __name__ == "__main__":
    run_migration()