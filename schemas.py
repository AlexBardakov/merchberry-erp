from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class LoginRequest(BaseModel):
    username: str
    password: str

class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "seller"
    full_name: Optional[str] = None
    phone: Optional[str] = None
    commission_percent: float = 15.0

class ProductDiff(BaseModel):
    sku: Optional[str] = None
    name: str
    old_price: float = 0.0
    new_price: float
    old_stock: int = 0
    new_stock: int

class ImportConfirmRequest(BaseModel):
    new_products: List[ProductDiff]
    changed_products: List[ProductDiff]

class ProductUpdateRequest(BaseModel):
    name: Optional[str] = None
    base_price: Optional[float] = None
    stock: Optional[int] = None
    seller_id: Optional[int] = None
    is_obsolete: Optional[bool] = None

class TransactionCreateRequest(BaseModel):
    seller_id: int
    type: str
    amount: float
    comment: Optional[str] = None

class ChartDataPoint(BaseModel):
    label: str
    total_amount: float
    products: List[str]

class TransactionRead(BaseModel):
    id: int
    type: str
    amount: float
    commission_amount: float
    date: datetime
    comment: Optional[str] = None
    seller_id: int
    product_identifier: Optional[str] = None

# Безопасная схема товара (на будущее, чтобы Склад не упал)
class ProductRead(BaseModel):
    id: int
    sku: Optional[str] = None
    name: str
    base_price: float
    stock: int
    seller_id: Optional[int] = None
    is_obsolete: bool

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    commission_percent: Optional[float] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None

class PasswordUpdate(BaseModel):
    new_password: str