# Файл: main.py
import csv
import io
import hashlib
import time
import requests
from datetime import date, timedelta, datetime
from fastapi import FastAPI, Depends, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import SQLModel, create_engine, Session, select, col
from sqlalchemy import and_
from models import User, Product, Transaction
from typing import List, Optional
# Импортируем функции безопасности из нашего нового файла
from auth import get_password_hash, verify_password, create_access_token, get_current_admin, get_current_user
from pydantic import BaseModel

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

sqlite_file_name = "database.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"
engine = create_engine(sqlite_url, echo=False, connect_args={"check_same_thread": False})

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session

app = FastAPI(title="Merchberry ERP API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], # Разрешаем нашему Vite-фронтенду делать запросы
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    create_db_and_tables()
    scheduler.start()

# --- СХЕМА ДЛЯ ЛОГИНА ---
class LoginRequest(BaseModel):
    username: str
    password: str

# Эндпоинт входа в систему (Открыт для всех)
@app.post("/api/login/")
def login(request: LoginRequest, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.username == request.username)).first()
    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Неверный логин или пароль")
    
    # Если пароль верный, выдаем токен
    access_token = create_access_token(data={"sub": user.username, "role": user.role})
    return {"access_token": access_token, "token_type": "bearer"}


# Эндпоинт: Создать пользователя (Закрыт! Только для Админа)
# Обратите внимание на Depends(get_current_admin)
@app.post("/api/users/", response_model=User)
def create_user(user: User, admin_data: dict = Depends(get_current_admin), session: Session = Depends(get_session)):
    existing_user = session.exec(select(User).where(User.username == user.username)).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Пользователь уже существует")
    
    # Перед сохранением шифруем пароль (для простоты передаем его в поле hashed_password при создании)
    user.hashed_password = get_password_hash(user.hashed_password) 
    
    session.add(user)
    session.commit()
    session.refresh(user)
    return user

# Эндпоинт: Получить список пользователей (Закрыт! Только для Админа)
@app.get("/api/users/", response_model=List[User])
def read_users(admin_data: dict = Depends(get_current_admin), session: Session = Depends(get_session)):
    users = session.exec(select(User)).all()
    return users
    
# Эндпоинт: Получить список товаров (Сортировка и Фильтрация)
@app.get("/api/products/", response_model=List[Product])
def get_products(
    seller_id: Optional[int] = Query(None, description="ID продавца (только для админа)"),
    sort_by: Optional[str] = Query("name_asc", description="name_asc, name_desc, price_asc, price_desc"),
    current_user: dict = Depends(get_current_user), # Пропускаем любого авторизованного
    session: Session = Depends(get_session)
):
    # Начинаем собирать запрос к базе
    statement = select(Product)
    
    # 1. ПРОВЕРКА ПРАВ: Если это продавец, принудительно показываем только ЕГО товары
    if current_user.get("role") == "seller":
        # Ищем ID пользователя по его логину из токена
        user_in_db = session.exec(select(User).where(User.username == current_user.get("username"))).first()
        statement = statement.where(Product.seller_id == user_in_db.id)
    # Если это админ и он передал seller_id, фильтруем по этому продавцу
    elif current_user.get("role") == "admin" and seller_id is not None:
        statement = statement.where(Product.seller_id == seller_id)

    # 2. ЛОГИКА СОРТИРОВКИ
    if sort_by == "name_asc":
        statement = statement.order_by(Product.name)
    elif sort_by == "name_desc":
        statement = statement.order_by(col(Product.name).desc())
    elif sort_by == "price_asc":
        statement = statement.order_by(Product.base_price)
    elif sort_by == "price_desc":
        statement = statement.order_by(col(Product.base_price).desc())

    # Выполняем запрос и возвращаем результат
    products = session.exec(statement).all()
    return products


# Эндпоинт: Добавить товар вручную (Только для Админа)
@app.post("/api/products/", response_model=Product)
def create_product(
    product: Product, 
    admin_data: dict = Depends(get_current_admin), # Охранник: только админ!
    session: Session = Depends(get_session)
):
    # Проверяем, существует ли продавец, к которому привязывают товар
    seller = session.get(User, product.seller_id)
    if not seller:
        raise HTTPException(status_code=404, detail="Продавец не найден")
        
    # Проверяем уникальность названия товара
    existing_product = session.exec(select(Product).where(Product.name == product.name)).first()
    if existing_product:
        raise HTTPException(status_code=400, detail="Товар с таким наименованием уже существует")

    session.add(product)
    session.commit()
    session.refresh(product)
    return product
    
# --- 5. ИМПОРТ ТОВАРОВ ИЗ CSV ---

# 1. ГИБКИЙ СЛОВАРЬ КОЛОНОК (Конфигурация)
# Здесь мы перечисляем все возможные варианты названий колонок в CSV файле.
# Когда получите реальный файл, просто дополните этот словарь.
CSV_MAPPING = {
    "sku": ["Артикул", "sku", "Код", "Идентификатор"],
    "name": ["Наименование", "Название", "Товар", "Имя"],
    "price": ["Цена", "Розничная цена", "Прайс"],
    "stock": ["Остаток", "В наличии", "Количество", "Остаток на складе"]
}

# Функция-помощник: ищет правильный ключ в строке CSV
def get_csv_value(row: dict, field_type: str) -> Optional[str]:
    for possible_name in CSV_MAPPING[field_type]:
        if possible_name in row:
            return row[possible_name]
    return None

# 2. СХЕМЫ ДЛЯ ОТВЕТА (Как будет выглядеть отчет для фронтенда)
class ProductDiff(BaseModel):
    sku: Optional[str]
    name: str
    old_price: Optional[float] = None
    new_price: float
    old_stock: Optional[int] = None
    new_stock: int
    status: str  # "new" (новый), "changed" (изменился), "unchanged" (без изменений)

class ImportPreviewResponse(BaseModel):
    new_products: List[ProductDiff]
    changed_products: List[ProductDiff]
    unchanged_products: List[ProductDiff]

# 3. ЭНДПОИНТ: Превью импорта (Только для Админа)
@app.post("/api/products/import/preview", response_model=ImportPreviewResponse)
def preview_products_import(
    file: UploadFile = File(...),
    admin_data: dict = Depends(get_current_admin), # Охранник: только админ
    session: Session = Depends(get_session)
):
    # Читаем файл в память и декодируем (обычно Бизнес.Ру выгружает в utf-8 или cp1251)
    content = file.file.read()
    try:
         # Пробуем стандартную кодировку
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        # Если Excel/Бизнес.Ру сохранил в кодировке Windows
        text = content.decode("cp1251") 

    # Парсим CSV
    reader = csv.DictReader(io.StringIO(text), delimiter=",") # Разделитель может быть ";" - можно будет поменять
    
    new_products = []
    changed_products = []
    unchanged_products = []

    for row in reader:
        # Извлекаем данные с помощью нашего гибкого словаря
        sku_val = get_csv_value(row, "sku")
        name_val = get_csv_value(row, "name")
        price_val = get_csv_value(row, "price")
        stock_val = get_csv_value(row, "stock")

        # Если в строке нет хотя бы названия или цены, пропускаем её
        if not name_val or not price_val:
            continue

        new_price = float(price_val.replace(" ", "").replace(",", "."))
        new_stock = int(float(stock_val)) if stock_val else 0
        name_val = name_val.strip()
        sku_val = sku_val.strip() if sku_val else None

        # Ищем товар в базе данных (сначала по Артикулу, затем по Названию)
        db_product = None
        if sku_val:
            db_product = session.exec(select(Product).where(Product.sku == sku_val)).first()
        if not db_product:
            db_product = session.exec(select(Product).where(Product.name == name_val)).first()

        diff = ProductDiff(
            sku=sku_val, name=name_val, new_price=new_price, new_stock=new_stock, status="new"
        )

        if db_product:
            diff.old_price = db_product.base_price
            diff.old_stock = db_product.stock
            
            # Проверяем, изменилось ли что-то
            if db_product.base_price != new_price or db_product.stock != new_stock:
                diff.status = "changed"
                changed_products.append(diff)
            else:
                diff.status = "unchanged"
                unchanged_products.append(diff)
        else:
            diff.status = "new"
            new_products.append(diff)

    return ImportPreviewResponse(
        new_products=new_products,
        changed_products=changed_products,
        unchanged_products=unchanged_products
    )
    
# --- СХЕМА ДЛЯ ПЕРЕДАЧИ ДАННЫХ ИМПОРТА ---
class ProductDiff(BaseModel):
    sku: Optional[str] = None
    name: str
    old_price: float = 0.0
    new_price: float
    old_stock: int = 0
    new_stock: int

# --- 5.9 СУПЕР-ЖЕЛЕЗОБЕТОННЫЙ ПАРСЕР CSV (ПРЕВЬЮ) ---
@app.post("/api/products/import/preview")
async def preview_products_import(
    file: UploadFile = File(...),
    admin_data: dict = Depends(get_current_admin),
    session: Session = Depends(get_session)
):
    content = await file.read()
    
    # 1. Угадываем кодировку
    text = ""
    for encoding in ['utf-8-sig', 'utf-8', 'windows-1251', 'cp1251']:
        try:
            text = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
            
    if not text:
        raise HTTPException(status_code=400, detail="Не удалось прочитать файл. Проверьте кодировку.")

    # 2. Определение разделителя
    first_line = text.split('\n')[0]
    delimiter = ';' if ';' in first_line else ','

    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    
    new_products = []
    changed_products = []
    unchanged_products = []

    for row in reader:
        # 3. УМНЫЙ ПОИСК КОЛОНОК (Ищем по корням слов, игнорируя невидимые символы и пробелы)
        name, sku, price_raw, stock_raw = "", "", "0", "0"
        
        for k, v in row.items():
            if not k: continue
            k_lower = str(k).lower()
            val = str(v).strip() if v is not None else ""
            
            if 'наименов' in k_lower or 'назван' in k_lower or 'name' in k_lower:
                name = val
            elif 'артикул' in k_lower or 'sku' in k_lower or 'код' in k_lower:
                sku = val
            elif 'цен' in k_lower or 'price' in k_lower:
                price_raw = val
            elif 'остат' in k_lower or 'stock' in k_lower or 'кол' in k_lower:
                stock_raw = val

        if not name:
            continue # Пропускаем пустые строки

        # Безопасный парсинг чисел
        try:
            price = float(price_raw.replace(" ", "").replace(",", "."))
            stock = int(float(stock_raw.replace(" ", "").replace(",", ".")))
        except ValueError:
            price, stock = 0.0, 0

        # 4. ИЩЕМ ТОВАР В БАЗЕ 
        db_product = None
        if sku:
            db_product = session.exec(select(Product).where(Product.sku == sku)).first()
        if not db_product:
            db_product = session.exec(select(Product).where(Product.name == name)).first()

        diff = ProductDiff(
            sku=sku, name=name, 
            old_price=db_product.base_price if db_product else 0.0,
            new_price=price,
            old_stock=db_product.stock if db_product else 0,
            new_stock=stock
        )

        # 5. РАСПРЕДЕЛЯЕМ ПО КАТЕГОРИЯМ
        if not db_product:
            new_products.append(diff)
        elif db_product.base_price != price or db_product.stock != stock:
            changed_products.append(diff)
        else:
            unchanged_products.append(diff)

    return {
        "new_products": new_products,
        "changed_products": changed_products,
        "unchanged_products": unchanged_products
    }

    
# --- 6. ПОДТВЕРЖДЕНИЕ ИМПОРТА И ОБНОВЛЕНИЕ ТОВАРОВ ---

# Схема того, что фронтенд пришлет нам после нажатия "Подтвердить"
class ImportConfirmRequest(BaseModel):
    # Присылаем только те товары, которые админ оставил отмеченными
    new_products: List[ProductDiff] 
    changed_products: List[ProductDiff]

@app.post("/api/products/import/confirm")
def confirm_products_import(
    request: ImportConfirmRequest,
    admin_data: dict = Depends(get_current_admin), # Только админ
    session: Session = Depends(get_session)
):
    stats = {"added": 0, "updated": 0}

    # 1. ОБНОВЛЯЕМ СУЩЕСТВУЮЩИЕ ТОВАРЫ
    for diff in request.changed_products:
        # Ищем товар в БД (по артикулу, либо по имени)
        db_product = None
        if diff.sku:
            db_product = session.exec(select(Product).where(Product.sku == diff.sku)).first()
        if not db_product:
            db_product = session.exec(select(Product).where(Product.name == diff.name)).first()
            
        if db_product:
            # Обновляем только цену и остаток (название не трогаем)
            db_product.base_price = diff.new_price
            db_product.stock = diff.new_stock
            session.add(db_product)
            stats["updated"] += 1

    # 2. ДОБАВЛЯЕМ НОВЫЕ ТОВАРЫ ("Буферная зона")
    for diff in request.new_products:
        new_product = Product(
            sku=diff.sku,
            name=diff.name,
            base_price=diff.new_price,
            stock=diff.new_stock,
            seller_id=None # <-- Товар падает в буферную зону (ничей)
        )
        session.add(new_product)
        stats["added"] += 1

    # 3. ФИКСИРУЕМ ИЗМЕНЕНИЯ В БАЗЕ (Один раз для скорости)
    session.commit()

    return {"message": "Импорт успешно завершен", "stats": stats}


# Эндпоинт: Редактирование товара (Назначение продавца)
class ProductUpdateRequest(BaseModel):
    name: Optional[str] = None
    base_price: Optional[float] = None
    stock: Optional[int] = None
    seller_id: Optional[int] = None # Вот здесь админ передаст ID продавца

@app.patch("/api/products/{product_id}", response_model=Product)
def update_product(
    product_id: int,
    update_data: ProductUpdateRequest,
    admin_data: dict = Depends(get_current_admin), # Только админ
    session: Session = Depends(get_session)
):
    # Ищем товар
    db_product = session.get(Product, product_id)
    if not db_product:
        raise HTTPException(status_code=404, detail="Товар не найден")
    
    # Применяем новые данные
    update_dict = update_data.dict(exclude_unset=True) # Берем только то, что прислали
    for key, value in update_dict.items():
        setattr(db_product, key, value)
        
    session.add(db_product)
    session.commit()
    session.refresh(db_product)
    return db_product
    

# --- 7. ТРАНЗАКЦИИ И ФИНАНСЫ ---

# Эндпоинт: Получить историю транзакций (Для отчетов и графиков)
@app.get("/api/transactions/", response_model=List[Transaction])
def get_transactions(
    seller_id: Optional[int] = Query(None, description="Фильтр по продавцу (для админа)"),
    current_user: dict = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    statement = select(Transaction)
    
    # Ролевая модель: продавец видит только свои деньги
    if current_user.get("role") == "seller":
        user_in_db = session.exec(select(User).where(User.username == current_user.get("username"))).first()
        statement = statement.where(Transaction.seller_id == user_in_db.id)
    # Админ может фильтровать по конкретному продавцу
    elif current_user.get("role") == "admin" and seller_id is not None:
        statement = statement.where(Transaction.seller_id == seller_id)
        
    # Сортируем от новых к старым
    statement = statement.order_by(col(Transaction.date).desc())
    
    return session.exec(statement).all()


# Схема для создания ручной транзакции Админом
class TransactionCreateRequest(BaseModel):
    seller_id: int
    type: str         # "payout" (выплата), "rent" (оплата аренды), "correction" (корректировка)
    amount: float     # Сумма (положительная для начислений, отрицательная для списаний)
    comment: Optional[str] = None

# Эндпоинт: Создать ручную транзакцию (Только Админ)
@app.post("/api/transactions/", response_model=Transaction)
def create_manual_transaction(
    req: TransactionCreateRequest,
    admin_data: dict = Depends(get_current_admin),
    session: Session = Depends(get_session)
):
    # Находим продавца, чей баланс мы собираемся изменить
    seller = session.get(User, req.seller_id)
    if not seller:
        raise HTTPException(status_code=404, detail="Продавец не найден")
        
    # Создаем запись о транзакции
    new_transaction = Transaction(
        type=req.type,
        amount=req.amount,
        comment=req.comment,
        seller_id=seller.id
    )
    
    # ОБНОВЛЯЕМ БАЛАНС ПРОДАВЦА
    # Если это выплата (-), аренда (-) или плюсовая корректировка (+)
    seller.balance += req.amount
    
    session.add(new_transaction)
    session.add(seller)
    session.commit()
    session.refresh(new_transaction)
    
    return new_transaction


class BusinessRuClient:
    def __init__(self):
        self.app_id = "ВАШ_APP_ID"
        self.secret = "ВАШ_SECRET"
        # Замените 'account' на имя вашего поддомена в бизнес.ру
        self.base_url = "https://account.business.ru/api/rest/1.0"

    def get_sales_for_date(self, target_date: date):
        """
        Метод обращается к Бизнес.Ру и забирает розничные чеки за указанный день.
        Документация Бизнес.Ру (Метод: GET /api/rest/1.0/receipts)
        """
        # В реальной жизни раскомментируете этот код:
        """
        params = {
            "app_id": self.app_id,
            "date": target_date.strftime("%Y-%m-%d")
        }
        # Бизнес.ру требует MD5 подпись всех параметров + секретный ключ
        sign_str = self.secret + "".join([f"{k}={v}" for k, v in sorted(params.items())])
        params["app_psw"] = hashlib.md5(sign_str.encode('utf-8')).hexdigest()

        response = requests.get(f"{self.base_url}/receipts", params=params)
        return response.json()
        """
        
        # Пока возвращаем заглушку (Mock) для тестирования
        return [
            {"sku": "12345", "name": "Брелок Котик", "price": 500, "quantity": 1},
            {"sku": "67890", "name": "Кейкап", "price": 1200, "quantity": 2}
        ]

# Выносим логику синхронизации в отдельную функцию, чтобы вызывать её откуда угодно
def run_sync_task(session: Session, target_date: date = None):
    if not target_date:
        target_date = date.today()
        
    client = BusinessRuClient()
    sales_data = client.get_sales_for_date(target_date)
    
    stats = {"processed": 0, "errors": 0}
    
    for item in sales_data:
        # Ищем товар по артикулу или имени
        product = session.exec(select(Product).where(
            (Product.sku == item.get("sku")) | (Product.name == item.get("name"))
        )).first()
        
        if product and product.seller_id:
            seller = session.get(User, product.seller_id)
            total_sale_amount = item["price"] * item["quantity"]
            commission = total_sale_amount * (seller.commission_percent / 100)
            net_profit = total_sale_amount - commission
            
            # Записываем транзакцию
            txn = Transaction(
                type="sale",
                amount=net_profit,
                commission_amount=commission,
                seller_id=seller.id,
                product_identifier=product.name,
                comment=f"{item['quantity']} шт."
            )
            
            seller.balance += net_profit
            product.stock -= item["quantity"]
            
            session.add(txn)
            session.add(seller)
            session.add(product)
            stats["processed"] += 1
        else:
            stats["errors"] += 1 # Товар не найден или не привязан к продавцу
            
    session.commit()
    return stats


# Эндпоинт для РУЧНОГО запуска (Только Админ)
@app.post("/api/sync/manual")
def manual_sync(
    target_date: date = Query(default_factory=date.today), # По умолчанию за сегодня
    admin_data: dict = Depends(get_current_admin),
    session: Session = Depends(get_session)
):
    result = run_sync_task(session, target_date)
    return {"message": f"Синхронизация за {target_date} завершена", "stats": result}


# --- 8. АВТОМАТИЗАЦИЯ (ПЛАНИРОВЩИК ЗАДАЧ) ---

scheduler = BackgroundScheduler()

def sync_sales_from_business_ru():
    """
    Эта функция будет запускаться автоматически каждый день.
    Сейчас здесь логический "скелет". Когда появится доступ к API Бизнес.Ру, 
    мы просто впишем сюда HTTP-запросы.
    """
    print(f"[{datetime.now()}] Запуск синхронизации продаж с Бизнес.Ру...")
    
    with Session(engine) as session:
        # 1. Сделать запрос к API Бизнес.Ру за чеками за текущий день
        # mock_sales_data = requests.get('https://api.business.ru/...', ...).json()
        
        # 2. Пройтись по каждой продаже в ответе
        # for sale in mock_sales_data:
        #     product = session.exec(select(Product).where(Product.sku == sale.sku)).first()
        #     if product and product.seller_id:
        #         
        #         # Считаем комиссию
        #         seller = session.get(User, product.seller_id)
        #         commission = sale.price * (seller.commission_percent / 100)
        #         net_profit = sale.price - commission
        #
        #         # Создаем транзакцию продажи
        #         transaction = Transaction(
        #             type="sale",
        #             amount=net_profit, # Продавцу падает сумма за вычетом комиссии
        #             commission_amount=commission, # Записываем комиссию магазина для отчета
        #             seller_id=seller.id,
        #             product_identifier=product.name
        #         )
        #         
        #         # Обновляем баланс и остатки
        #         seller.balance += net_profit
        #         product.stock -= sale.quantity
        #
        #         session.add(transaction)
        #         session.add(seller)
        #         session.add(product)
        # 
        # session.commit()
        pass

# Настраиваем расписание. 
# 21:00 по времени UTC+7 — это 14:00 по UTC (гринвичу). Сервер обычно работает в UTC.
scheduler.add_job(sync_sales_from_business_ru, CronTrigger(hour=14, minute=0, timezone='UTC'))


# --- 9. Построение графиков ---

class ChartDataPoint(BaseModel):
    label: str               # Например: "15 Апр" или "01.04 - 07.04"
    total_amount: float      # Сумма продаж за этот период
    products: List[str]      # Список проданных товаров (для тултипа и списка под графиком)

@app.get("/api/analytics/chart", response_model=List[ChartDataPoint])
def get_chart_data(
    start_date: date,
    end_date: date,
    seller_id: Optional[int] = Query(None),
    current_user: dict = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    # 1. Проверяем права (Продавец видит только свое)
    target_seller_id = seller_id
    if current_user.get("role") == "seller":
        user_in_db = session.exec(select(User).where(User.username == current_user.get("username"))).first()
        target_seller_id = user_in_db.id

    # 2. Достаем все продажи ("sale") за указанный период
    query = select(Transaction).where(
        Transaction.type == "sale",
        # Сравниваем даты, отбрасывая время
        Transaction.date >= datetime.combine(start_date, datetime.min.time()),
        Transaction.date <= datetime.combine(end_date, datetime.max.time())
    )
    
    if target_seller_id:
        query = query.where(Transaction.seller_id == target_seller_id)
        
    transactions = session.exec(query).all()

    # 3. Вычисляем количество дней
    delta_days = (end_date - start_date).days
    use_weekly = delta_days >= 15

    # 4. Формируем "корзины" (buckets) для графика
    buckets = []
    current_start = start_date
    
    while current_start <= end_date:
        if use_weekly:
            current_end = current_start + timedelta(days=6)
            if current_end > end_date:
                current_end = end_date # Обрезаем последнюю неделю
            label = f"{current_start.strftime('%d.%m')} - {current_end.strftime('%d.%m')}"
        else:
            current_end = current_start
            label = current_start.strftime("%d.%m")
            
        buckets.append({
            "start": current_start,
            "end": current_end,
            "label": label,
            "total_amount": 0.0,
            "products": []
        })
        
        current_start = current_end + timedelta(days=1)

    # 5. Раскладываем транзакции по корзинам
    for txn in transactions:
        txn_date = txn.date.date()
        for b in buckets:
            if b["start"] <= txn_date <= b["end"]:
                b["total_amount"] += txn.amount
                if txn.product_identifier:
                    # Добавляем в список с количеством (например: "Брелок Котик (2 шт.)")
                    prod_str = f"{txn.product_identifier} - {txn.amount} руб."
                    b["products"].append(prod_str)
                break

    # 6. Преобразуем в ответ для фронтенда
    result = [ChartDataPoint(label=b["label"], total_amount=b["total_amount"], products=b["products"]) for b in buckets]
    return result