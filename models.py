# Файл: models.py
from typing import Optional, List, Dict
from datetime import datetime, timezone
from sqlmodel import Field, SQLModel, Relationship, Column, JSON


# --- ТАБЛИЦА: ПОЛЬЗОВАТЕЛИ (Арендаторы и Админ) ---
class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True)
    role: str = Field(default="seller")
    hashed_password: str

    full_name: Optional[str] = Field(default=None)
    phone: Optional[str] = Field(default=None)
    payment_details: Optional[str] = Field(default=None)

    profile_last_modified: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    profile_modified_by: str = Field(default="admin")

    shelf_location: Optional[str] = Field(default=None)
    rent_rate: float = Field(default=0.0)
    commission_percent: float = Field(default=15.0)
    balance: float = Field(default=0.0)

    # Настройки уведомлений внутри системы
    notifications_enabled: bool = Field(default=True)
    low_stock_threshold: int = Field(default=3)

    # --- НОВОЕ: Интеграция с ВКонтакте (Задачи 3 и 4) ---
    vk_id: Optional[str] = Field(default=None)
    vk_link_token: Optional[str] = Field(default=None, unique=True, index=True)
    vk_notify_inventory: bool = Field(default=False)
    vk_notify_sales: bool = Field(default=False)

    notes: Optional[str] = None
    is_active: bool = Field(default=True) # Используется как статус архивации (False = в архиве)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    products: List["Product"] = Relationship(back_populates="seller")
    transactions: List["Transaction"] = Relationship(back_populates="seller")


# --- ТАБЛИЦА: ТОВАРЫ ---
class Product(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    sku: Optional[str] = Field(default=None, unique=True, index=True)
    name: str = Field(index=True)
    base_price: float
    stock: int = Field(default=0)

    seller_id: Optional[int] = Field(default=None, foreign_key="user.id")
    is_obsolete: bool = Field(default=False)
    seller: Optional[User] = Relationship(back_populates="products")

# --- ТАБЛИЦА: ТРАНЗАКЦИИ ---
class Transaction(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    type: str

    # Финансы
    full_amount: float = Field(default=0.0)  # Полная сумма продажи
    amount: float  # Чистая прибыль (за вычетом комиссии)
    commission_amount: float = Field(default=0.0)  # Сумма комиссии

    date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    comment: Optional[str] = Field(default=None)

    # Привязка к продавцу теперь опциональна (для "ничейных" транзакций)
    seller_id: Optional[int] = Field(default=None, foreign_key="user.id")
    seller: Optional[User] = Relationship(back_populates="transactions")

    # Хранение списка проданных товаров в виде строки для всплывающего окна
    product_identifier: Optional[str] = Field(default=None)

    # Идентификатор чека из Бизнес.ру для жесткой защиты от дублирования
    external_check_id: Optional[str] = Field(default=None, index=True)

    # Флаг ручной перепривязки админом, чтобы синхронизация не сбрасывала изменения
    is_manual_assigned: bool = Field(default=False)


# --- НОВОЕ: ТАБЛИЦА ЛОГОВ (Шаг 2) ---
class AuditLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Кто инициировал: логин админа/продавца или "system" (при синхронизации)
    actor: str = Field(index=True)

    # Сущность: "Product", "User", "Transaction"
    entity_name: str
    entity_id: Optional[int] = Field(default=None)

    # Действие: "sync_update", "manual_edit", "status_change"
    action: str

    # Храним изменения в JSON, чтобы объединять цену и остаток в одной записи
    # Пример: {"stock": {"old": 5, "new": 10}, "base_price": {"old": 1000, "new": 1200}}
    changes: dict = Field(default_factory=dict, sa_column=Column(JSON))