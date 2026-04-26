import csv
import io
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlmodel import Session, select, col, or_
from typing import List, Optional

from database import get_session
from models import Product, User
from auth import get_current_user, get_current_admin
from schemas import ProductDiff, ImportConfirmRequest, ProductUpdateRequest, ProductRead
from utils import create_audit_log

router = APIRouter(prefix="/api/products", tags=["Products"])


# В файле routers/products.py
@router.get("/", response_model=List[ProductRead])
def get_products(
        seller_filter: Optional[str] = Query("all",
                                             description="all, unassigned, или ID продавца"),
        # НОВЫЙ ФИЛЬТР
        search: Optional[str] = Query("",
                                      description="Поиск по артикулу или названию"),
        # ПОИСК
        sort_by: Optional[str] = Query("name_asc"),
        include_obsolete: bool = Query(False),
        limit: int = Query(50, ge=1, le=100),
        offset: int = Query(0, ge=0),
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    statement = select(Product)

    if not include_obsolete:
        statement = statement.where(Product.is_obsolete == False)

    # Обработка текстового поиска (по артикулу ИЛИ названию)
    if search:
        statement = statement.where(
            or_(
                Product.name.ilike(f"%{search}%"),
                Product.sku.ilike(f"%{search}%")
            )
        )

    # Обработка ролей и фильтра по продавцу
    if current_user.get("role") == "seller":
        user_in_db = session.exec(select(User).where(
            User.username == current_user.get("username"))).first()
        statement = statement.where(Product.seller_id == user_in_db.id)
    elif current_user.get("role") == "admin":
        if seller_filter == "unassigned":
            statement = statement.where(Product.seller_id == None)
        elif seller_filter != "all" and seller_filter.isdigit():
            statement = statement.where(
                Product.seller_id == int(seller_filter))

    # Сортировка
    if sort_by == "name_asc":
        statement = statement.order_by(Product.name)
    elif sort_by == "price_asc":
        statement = statement.order_by(Product.base_price)
    elif sort_by == "price_desc":
        statement = statement.order_by(col(Product.base_price).desc())

    return session.exec(statement.offset(offset).limit(limit)).all()

@router.post("/", response_model=ProductRead)
def create_product(
        product: Product,
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    if product.seller_id:
        seller = session.get(User, product.seller_id)
        if not seller:
            raise HTTPException(status_code=404, detail="Продавец не найден")

    existing_product = session.exec(
        select(Product).where(Product.name == product.name)).first()
    if existing_product:
        raise HTTPException(status_code=400,
                            detail="Товар с таким наименованием уже существует")

    session.add(product)
    session.commit()
    session.refresh(product)
    return product


@router.patch("/{product_id}", response_model=ProductRead)
def update_product(
        product_id: int,
        update_data: ProductUpdateRequest,
        admin_data: dict = Depends(get_current_admin),  # Как в твоем коде, меняет только админ
        session: Session = Depends(get_session)
):
    db_product = session.get(Product, product_id)
    if not db_product:
        raise HTTPException(status_code=404, detail="Товар не найден")

    # Получаем только те поля, которые реально пришли в запросе
    update_dict = update_data.dict(exclude_unset=True)

    changes = {}

    # Динамически проверяем изменения и применяем их
    for key, new_value in update_dict.items():
        old_value = getattr(db_product, key, None)

        # Если значение действительно поменялось, записываем в лог и в объект
        if old_value != new_value:
            changes[key] = {"old": old_value, "new": new_value}
            setattr(db_product, key, new_value)

    # Если по факту ничего не изменилось (прислали те же самые цифры), базу не трогаем
    if not changes:
        return db_product

    session.add(db_product)

    # Берем логин админа (предполагается, что в JWT он лежит под ключом username)
    admin_username = admin_data.get("username", "admin")

    # Создаем ОДНУ запись в логах со всеми измененными полями
    create_audit_log(
        session=session,
        actor=admin_username,
        entity_name="Product",
        entity_id=db_product.id,
        action="product_update",
        changes=changes
    )

    session.commit()
    session.refresh(db_product)

    return db_product


@router.post("/import/preview")
async def preview_products_import(
        file: UploadFile = File(...),
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    content = await file.read()

    text = ""
    for encoding in ['utf-8-sig', 'utf-8', 'windows-1251', 'cp1251']:
        try:
            text = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue

    if not text:
        raise HTTPException(status_code=400,
                            detail="Не удалось прочитать файл. Проверьте кодировку.")

    first_line = text.split('\n')[0]
    delimiter = ';' if ';' in first_line else ','

    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)

    new_products, changed_products, unchanged_products = [], [], []

    for row in reader:
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
            continue

        try:
            price = float(price_raw.replace(" ", "").replace(",", "."))
            stock = int(float(stock_raw.replace(" ", "").replace(",", ".")))
        except ValueError:
            price, stock = 0.0, 0

        db_product = None
        if sku:
            db_product = session.exec(
                select(Product).where(Product.sku == sku)).first()
        if not db_product:
            db_product = session.exec(
                select(Product).where(Product.name == name)).first()

        diff = ProductDiff(
            sku=sku, name=name,
            old_price=db_product.base_price if db_product else 0.0,
            new_price=price,
            old_stock=db_product.stock if db_product else 0,
            new_stock=stock
        )

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


@router.post("/import/confirm")
def confirm_products_import(
        request: ImportConfirmRequest,
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    stats = {"added": 0, "updated": 0}

    for diff in request.changed_products:
        db_product = None
        if diff.sku:
            db_product = session.exec(
                select(Product).where(Product.sku == diff.sku)).first()
        if not db_product:
            db_product = session.exec(
                select(Product).where(Product.name == diff.name)).first()

        if db_product:
            db_product.base_price = diff.new_price
            db_product.stock = diff.new_stock
            session.add(db_product)
            stats["updated"] += 1

    for diff in request.new_products:
        new_product = Product(
            sku=diff.sku,
            name=diff.name,
            base_price=diff.new_price,
            stock=diff.new_stock,
            seller_id=None
        )
        session.add(new_product)
        stats["added"] += 1

    session.commit()
    return {"message": "Импорт успешно завершен", "stats": stats}


@router.get("/low-stock", response_model=List[ProductRead])
def get_low_stock_products(
        current_user: dict = Depends(get_current_user),
        session: Session = Depends(get_session)
):
    user = session.exec(select(User).where(User.username == current_user.get("username"))).first()

    # Если уведомления выключены в профиле, список всегда пуст
    if not user or not user.notifications_enabled:
        return []

    # Фильтруем товары по порогу, заданному пользователем
    statement = select(Product).where(
        Product.seller_id == user.id,
        Product.stock <= user.low_stock_threshold,
        Product.is_obsolete == False
    )

    return session.exec(statement).all()