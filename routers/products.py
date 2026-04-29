import csv
import io
import secrets
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlmodel import Session, select, col, or_
from typing import List, Optional
from pydantic import BaseModel

from database import get_session
from models import Product, User
from auth import get_current_user, get_current_admin, get_password_hash
from schemas import ProductDiff, ImportConfirmRequest, ProductUpdateRequest, ProductRead
from utils import create_audit_log

router = APIRouter(prefix="/api/products", tags=["Products"])

class ProductMergeRequest(BaseModel):
    target_id: int
    source_ids: List[int]

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
    elif sort_by == "stock_asc":  # НОВОЕ
        statement = statement.order_by(Product.stock)
    elif sort_by == "stock_desc":  # НОВОЕ
        statement = statement.order_by(col(Product.stock).desc())

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

    # 1. Строгая проверка обязательных столбцов
    required_columns = [
        "Наименование",
        "Группа товаров",
        "Цены отпускные. Отпускные розничные",
        "Все склады. Общий остаток",
        "Внешние коды. ID из Бизнес.ру"
    ]

    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="Файл пуст или не содержит заголовков.")

    # Очищаем заголовки от возможных пробелов по краям
    actual_columns = [col.strip() for col in reader.fieldnames if col]

    missing_columns = [col for col in required_columns if col not in actual_columns]

    if missing_columns:
        missing_cols_str = ", ".join(f"'{col}'" for col in missing_columns)
        raise HTTPException(
            status_code=400,
            detail=f"Отсутствуют обязательные столбцы для выгрузки: {missing_cols_str}. Проверьте файл."
        )

    all_users = session.exec(select(User)).all()
    user_id_to_name = {u.id: u.username for u in all_users}

    new_products, changed_products, unchanged_products = [], [], []
    conflicts = []  # ДОБАВЛЕНО: Массив для конфликтов
    csv_authors = set()

    for row in reader:
        clean_row = {k.strip(): v for k, v in row.items() if k}

        name = str(clean_row.get("Наименование", "")).strip()
        group = str(clean_row.get("Группа товаров", "")).strip()
        price_raw = str(clean_row.get("Цены отпускные. Отпускные розничные", "0")).strip()
        stock_raw = str(clean_row.get("Все склады. Общий остаток", "0")).strip()
        external_id = str(clean_row.get("Внешние коды. ID из Бизнес.ру", "")).strip()

        if not name or not external_id:
            continue

        price_str = price_raw.replace(" ", "").replace("\xa0", "").replace(",",
                                                                           ".")
        try:
            price = float(price_str) if price_str else 0.0
        except ValueError:
            price = 0.0

        stock_str = stock_raw.replace(" ", "").replace("\xa0", "").replace(",",
                                                                           ".")
        try:
            stock = int(float(stock_str)) if stock_str else 0
        except ValueError:
            stock = 0

        sku = external_id
        db_product = session.exec(
            select(Product).where(Product.sku == sku)).first()

        # ДОБАВЛЕНО: Проверка конфликтов и сбор реальных авторов из CSV
        if db_product and db_product.seller_id is not None:
            current_author_name = user_id_to_name.get(db_product.seller_id,
                                                      "Неизвестно")
            csv_author_name = group if group else "Без автора"

            if current_author_name != csv_author_name and group:
                conflicts.append({
                    "product_name": db_product.name,
                    "current_author": current_author_name,
                    "csv_author": csv_author_name
                })
        else:
            # Если товар НОВЫЙ или НИЧЕЙНЫЙ, тогда нам реально нужен этот автор для привязки
            if group:
                csv_authors.add(group)

        diff = ProductDiff(
            sku=sku,
            name=name,
            old_price=db_product.base_price if db_product else 0.0,
            new_price=price,
            old_stock=db_product.stock if db_product else 0,
            new_stock=stock,
            seller_name=group if group else None
        )

        if not db_product:
            new_products.append(diff)
        elif db_product.base_price != price or db_product.stock != stock or db_product.name != name:
            changed_products.append(diff)
        else:
            unchanged_products.append(diff)

    existing_users = session.exec(select(User).where(User.username.in_(list(csv_authors)))).all()
    existing_usernames = {u.username for u in existing_users}
    new_authors = list(csv_authors - existing_usernames)

    return {
        "new_products": new_products,
        "changed_products": changed_products,
        "unchanged_products": unchanged_products,
        "new_authors": new_authors,
        "conflicts": conflicts  # ДОБАВЛЕНО: Отдаем конфликты на фронт
    }


@router.post("/import/confirm")
def confirm_products_import(
        request: ImportConfirmRequest,
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    stats = {"added": 0, "updated": 0, "authors_created": 0}
    admin_username = admin_data.get("username", "admin")

    # 1. Создаем новых авторов, если админ выбрал их на фронтенде
    if request.authors_to_create:
        for author_name in request.authors_to_create:
            existing = session.exec(select(User).where(User.username == author_name)).first()
            if not existing:
                random_pass = secrets.token_hex(4)  # Генерируем случайный пароль
                new_user = User(
                    username=author_name,
                    role="seller",
                    hashed_password=get_password_hash(random_pass),
                    is_active=True
                )
                session.add(new_user)
                stats["authors_created"] += 1
        session.commit()

    # Получаем словарь всех авторов для быстрой привязки
    all_users = session.exec(select(User)).all()
    user_map = {u.username: u.id for u in all_users}

    # 2. Обработка измененных товаров
    for diff in request.changed_products:
        # Дополнительная защита: работаем только если есть уникальный ID
        if not diff.sku:
            continue

        db_product = session.exec(select(Product).where(Product.sku == diff.sku)).first()

        # Если товар реально найден в базе
        if db_product:
            changes = {}

            if db_product.base_price != diff.new_price:
                changes["base_price"] = {"old": db_product.base_price, "new": diff.new_price}
                db_product.base_price = diff.new_price

            if db_product.stock != diff.new_stock:
                changes["stock"] = {"old": db_product.stock, "new": diff.new_stock}
                db_product.stock = diff.new_stock

            if db_product.name != diff.name:
                changes["name"] = {"old": db_product.name, "new": diff.name}
                db_product.name = diff.name

            # Привязка автора ТОЛЬКО если товар был ничейным (Задача 6)
            seller_id = user_map.get(diff.seller_name) if diff.seller_name else None
            if db_product.seller_id is None and seller_id is not None:
                changes["seller_id"] = {"old": None, "new": seller_id}
                db_product.seller_id = seller_id

            if changes:
                if request.comment:
                    changes["comment"] = request.comment

                session.add(db_product)

                create_audit_log(
                    session=session,
                    actor=admin_username,
                    entity_name="Product",
                    entity_id=db_product.id,
                    action="import_update",
                    changes=changes
                )
            stats["updated"] += 1

    # 3. Обработка абсолютно новых товаров
    for diff in request.new_products:
        if not diff.sku:
            continue

        seller_id = user_map.get(diff.seller_name) if diff.seller_name else None

        new_product = Product(
            sku=diff.sku,
            name=diff.name,
            base_price=diff.new_price,
            stock=diff.new_stock,
            seller_id=seller_id
        )
        session.add(new_product)
        session.commit()
        session.refresh(new_product)

        changes = {
            "status": "created",
            "initial_stock": diff.new_stock,
            "initial_price": diff.new_price
        }
        if seller_id:
            changes["seller_id"] = seller_id

        if request.comment:
            changes["comment"] = request.comment

        create_audit_log(
            session=session,
            actor=admin_username,
            entity_name="Product",
            entity_id=new_product.id,
            action="import_create",
            changes=changes
        )

        stats["added"] += 1

    session.commit()
    return {"message": "Импорт успешно завершен", "stats": stats}


@router.post("/merge")
def merge_products(
        req: ProductMergeRequest,
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    target = session.get(Product, req.target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Основной товар не найден")

    # Получаем все товары-дубликаты
    sources = session.exec(
        select(Product).where(col(Product.id).in_(req.source_ids))).all()

    total_stock_added = 0
    merged_names = []

    for source in sources:
        if source.id == target.id:
            continue

        total_stock_added += source.stock
        merged_names.append(source.name)

        # Обнуляем остаток и отправляем дубликат в архив
        source.stock = 0
        source.is_obsolete = True
        session.add(source)

    # Добавляем остатки в основной товар
    target.stock += total_stock_added
    session.add(target)

    # Логируем действие
    admin_username = admin_data.get("username", "admin")
    create_audit_log(
        session=session,
        actor=admin_username,
        entity_name="Product",
        entity_id=target.id,
        action="merge_products",
        changes={
            "stock_added": total_stock_added,
            "merged_from_ids": req.source_ids,
            "merged_names": merged_names
        }
    )

    session.commit()
    return {"status": "success", "message": "Товары успешно объединены",
            "added_stock": total_stock_added}


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