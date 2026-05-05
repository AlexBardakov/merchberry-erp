import sqlite3

def run_migration():
    db_file = 'database.db'
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()
    try:
        # Добавляем колонку для ссылки на аватарку
        cursor.execute("ALTER TABLE user ADD COLUMN avatar_url VARCHAR DEFAULT NULL")
        conn.commit()
        print("✅ Колонка 'avatar_url' успешно добавлена!")
    except sqlite3.OperationalError as e:
        print(f"⚠️ Ошибка (возможно, колонка уже есть): {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    run_migration()