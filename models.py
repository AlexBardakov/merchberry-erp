from typing import Optional, List
from datetime import datetime, timezone
from sqlmodel import Field, SQLModel, Relationship

# --- ТАБЛИЦА: ПОЛЬЗОВАТЕЛИ (Арендаторы и Админ) ---
class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True) # Логин
    role: str = Field(default="seller")            # "admin" или "seller"
    hashed_password: str
    
    # 1. ИДЕНТИФИКАЦИЯ И КОНТАКТЫ
    full_name: Optional[str] = Field(default=None)       # Имя/ФИО
    phone: Optional[str] = Field(default=None)           # Актуальный номер
    payment_details: Optional[str] = Field(default=None) # Реквизиты для выплат
    
    # Отслеживание изменений профиля
    profile_last_modified: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    profile_modified_by: str = Field(default="admin")    # Кто менял последним: "admin" или "seller"

    # 2. ФИНАНСОВЫЕ УСЛОВИЯ (Меняет только Админ)
    shelf_location: Optional[str] = Field(default=None)  # Расположение/номера полок (например: "A12, B04")
    rent_rate: float = Field(default=0.0)                # Стоимость аренды за эти полки
    commission_percent: float = Field(default=15.0)      # Процент комиссии магазина
    
    # Текущий расчетный баланс продавца
    balance: float = Field(default=0.0)

    # Связи с другими таблицами
    products: List["Product"] = Relationship(back_populates="seller")
    transactions: List["Transaction"] = Relationship(back_populates="seller")


# --- ТАБЛИЦА: ТОВАРЫ ---
class Product(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    
    # Артикул Бизнес.Ру.
    sku: Optional[str] = Field(default=None, unique=True, index=True) 
    
    # НАИМЕНОВАНИЕ  УНИКАЛЬНО
    name: str = Field(unique=True, index=True) 
    
    base_price: float                              # Справочная цена
    stock: int = Field(default=0)                  # Актуальный остаток на полке
    
    # Связь: чей это товар (ID пользователя)
    seller_id: Optional[int] = Field(default=None, foreign_key="user.id")
    is_obsolete: bool = Field(default=False)
    seller: Optional[User] = Relationship(back_populates="products")


# --- ТАБЛИЦА: ТРАНЗАКЦИИ (Продажи, возвраты, аренды, выплаты) ---
class Transaction(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    
    # Типы операций: "sale" (продажа), "return" (возврат покупателем), 
    # "rent" (списание аренды), "payout" (выплата), "correction" (ручная корректировка)
    type: str 
    
    amount: float                                  # Сумма операции
    commission_amount: float = Field(default=0.0)  # Сумма удержанной комиссии (если это продажа)
    
    date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    comment: Optional[str] = Field(default=None)   # Свободный комментарий или период
    
    # Чья это транзакция
    seller_id: int = Field(foreign_key="user.id")
    seller: Optional[User] = Relationship(back_populates="transactions")
    
    # Если это продажа конкретного товара (привязка по SKU или Наименованию)
    product_identifier: Optional[str] = Field(default=None)