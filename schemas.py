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
    seller_name: Optional[str] = None  # ДОБАВЛЕНО: имя автора из CSV

class ImportConfirmRequest(BaseModel):
    new_products: List[ProductDiff]
    changed_products: List[ProductDiff]
    comment: Optional[str] = None
    authors_to_create: Optional[List[str]] = None  # ДОБАВЛЕНО: список авторов для создания

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

class RentChargeRequest(BaseModel):
    seller_id: int
    amount: float
    payment_method: str  # "balance" (с баланса) или "own_funds" (со своих средств)

class TransactionUpdateRequest(BaseModel):
    seller_id: Optional[int] = None
    product_identifier: Optional[str] = None
    comment: Optional[str] = None

class TransactionRead(BaseModel):
    id: int
    type: str
    full_amount: float
    amount: float
    commission_amount: float
    date: datetime
    comment: Optional[str] = None
    seller_id: Optional[int] = None
    product_identifier: Optional[str] = None
    external_check_id: Optional[str] = None
    is_manual_assigned: bool = False

# Безопасная схема товара (на будущее, чтобы Склад не упал)
class ProductRead(BaseModel):
    id: int
    sku: Optional[str] = None
    name: str
    base_price: float
    stock: int
    seller_id: Optional[int] = None
    is_obsolete: bool
    parent_id: Optional[int] = None

class ProductUnmergeRequest(BaseModel):
    child_id: int

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    commission_percent: Optional[float] = None
    rent_rate: Optional[float] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None

class PasswordUpdate(BaseModel):
    new_password: str

class UserUpdateSettings(BaseModel):
    notifications_enabled: Optional[bool] = None
    low_stock_threshold: Optional[int] = None

class UserUpdateSettings(BaseModel):
    notifications_enabled: Optional[bool] = None
    low_stock_threshold: Optional[int] = None

class AuthorConflict(BaseModel):
    product_name: str
    current_author: str
    csv_author: str

class AuditLogRead(BaseModel):
    id: int
    timestamp: datetime
    actor: str
    entity_name: str
    entity_id: Optional[int]
    action: str
    changes: dict
    product_name: Optional[str] = None  # Добавим название товара для удобства фронта

class TransactionBulkReassignRequest(BaseModel):
    transaction_ids: List[int]
    new_seller_id: Optional[int] = None  # Если None, транзакция становится "ничейной"


class UserRenameRequest(BaseModel):
    new_username: str


class UserDeleteConfirmRequest(BaseModel):
    confirm_username: str


class UserVKSettingsUpdate(BaseModel):
    vk_id: Optional[str] = None
    vk_notify_inventory: Optional[bool] = None
    vk_notify_sales: Optional[bool] = None


# Обновим UserRead, чтобы фронтенд получал данные о ВК
class UserRead(BaseModel):
    id: int
    username: str
    role: str
    full_name: Optional[str] = None
    phone: Optional[str] = None
    payment_details: Optional[str] = None
    shelf_location: Optional[str] = None
    rent_rate: float
    commission_percent: float
    balance: float
    notifications_enabled: bool
    low_stock_threshold: int
    vk_id: Optional[str] = None
    vk_notify_inventory: bool
    vk_notify_sales: bool
    notes: Optional[str] = None
    is_active: bool
    created_at: datetime

class TopProductRead(BaseModel):
    rank: int
    name: str
    value: float
    author: Optional[str] = None

class ChartDataPoint(BaseModel):
    label: str
    full_amount: float
    profit: float
    commission: float
    products_info: List[str]  # Массив строк для всплывающего окна (тултипа)

class DashboardSummary(BaseModel):
    total_full_amount: float
    total_profit: float
    total_commission: float
    chart_data: List[ChartDataPoint]
    top_products: List[TopProductRead]
    top_revenue_products: List[TopProductRead]

class WidgetStats(BaseModel):
    current_balance: float
    products_on_shelves: int
    sales_30_days: float
    sales_prev_30_days: float
    sales_trend_percent: float


class BulkPasswordResetRequest(BaseModel):
    user_ids: List[int]


class PayoutRequestCreate(BaseModel):
    amount: float
    comment: Optional[str] = None


class PayoutRequestAction(BaseModel):
    action: str  # "approve" или "reject"
    admin_comment: Optional[str] = None


class PayoutRequestRead(BaseModel):
    id: int
    seller_id: int
    amount: float
    comment: Optional[str] = None
    status: str
    admin_comment: Optional[str] = None
    proof_file_url: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    # Дополнительные поля для удобного отображения в админке
    seller_username: Optional[str] = None
    seller_full_name: Optional[str] = None
    seller_balance: Optional[float] = None
    seller_notes: Optional[str] = None