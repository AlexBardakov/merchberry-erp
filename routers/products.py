import csv
import io
import secrets
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, BackgroundTasks
from sqlmodel import Session, select, col, or_, func
from typing import List, Optional
from pydantic import BaseModel

from services.websocket import manager
from database import get_session
from models import Product, User
from auth import get_current_user, get_current_admin, get_password_hash
from schemas import ProductDiff, ImportConfirmRequest, ProductUpdateRequest, ProductRead, ProductUnmergeRequest
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
        search_lower = f"%{search.lower()}%"
        statement = statement.where(
            or_(
                func.lower(Product.name).like(search_lower),
                func.lower(Product.sku).like(search_lower)
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
async def update_product(
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
    await manager.broadcast({"event": "inventory_updated"})
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
        raise HTTPException(status_code=400, detail="Не удалось прочитать файл. Проверьте кодировку.")

    first_line = text.split('\n')[0]
    delimiter = ';' if ';' in first_line else ','
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)

    required_columns = ["Наименование", "Группа товаров", "Цены отпускные. Отпускные розничные", "Все склады. Общий остаток", "Внешние коды. ID из Бизнес.ру"]
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="Файл пуст или не содержит заголовков.")

    actual_columns = [col.strip() for col in reader.fieldnames if col]
    missing_columns = [col for col in required_columns if col not in actual_columns]
    if missing_columns:
        missing_cols_str = ", ".join(f"'{col}'" for col in missing_columns)
        raise HTTPException(status_code=400, detail=f"Отсутствуют обязательные столбцы для выгрузки: {missing_cols_str}. Проверьте файл.")

    all_users = session.exec(select(User)).all()
    user_id_to_name = {u.id: u.username for u in all_users}
    existing_usernames = {u.username for u in all_users}

    # Читаем все строки CSV
    csv_items = []
    for row in reader:
        clean_row = {k.strip(): v for k, v in row.items() if k}
        name = str(clean_row.get("Наименование", "")).strip()
        group = str(clean_row.get("Группа товаров", "")).strip()
        sku = str(clean_row.get("Внешние коды. ID из Бизнес.ру", "")).strip()

        if not name or not sku: continue

        price_str = str(clean_row.get("Цены отпускные. Отпускные розничные", "0")).strip().replace(" ", "").replace("\xa0", "").replace(",", ".")
        stock_str = str(clean_row.get("Все склады. Общий остаток", "0")).strip().replace(" ", "").replace("\xa0", "").replace(",", ".")

        price = float(price_str) if price_str else 0.0
        try:
            stock = int(float(stock_str)) if stock_str else 0
        except ValueError:
            stock = 0

        csv_items.append({"sku": sku, "name": name, "price": price, "stock": stock, "seller_name": group})

    # Достаем все затронутые товары из БД для быстрой проверки
    skus = [item["sku"] for item in csv_items]
    db_products_list = session.exec(select(Product).where(Product.sku.in_(skus))).all()
    db_products_map = {p.sku: p for p in db_products_list}

    blocks = {}
    csv_authors = set()
    conflicts = []

    # АГРЕГАЦИЯ ОСТАТКОВ И ЦЕН ПО БЛОКАМ
    for item in csv_items:
        if item["seller_name"]: csv_authors.add(item["seller_name"])
        db_p = db_products_map.get(item["sku"])

        # Конфликты авторов
        if db_p and db_p.seller_id is not None:
            current_author = user_id_to_name.get(db_p.seller_id, "Неизвестно")
            csv_author = item["seller_name"] if item["seller_name"] else "Без автора"
            if current_author != csv_author and item["seller_name"]:
                conflicts.append({"product_name": db_p.name, "current_author": current_author, "csv_author": csv_author})

        # Если это ребенок, агрегируем данные на его родителя
        if db_p:
            main_id = db_p.parent_id if db_p.parent_id else db_p.id
        else:
            main_id = f"new_{item['sku']}"

        if main_id not in blocks:
            blocks[main_id] = {"stock": 0, "price": item["price"], "seller_name": item["seller_name"], "db_main": session.get(Product, main_id) if isinstance(main_id, int) else None}

        # Складываем остатки всех товаров блока
        blocks[main_id]["stock"] += item["stock"]
        # Последняя считанная цена перекрывает предыдущие
        blocks[main_id]["price"] = item["price"]
        if item["seller_name"]: blocks[main_id]["seller_name"] = item["seller_name"]

    new_products, changed_products, unchanged_products = [], [], []

    # 1. Генерируем изменения для Главных и Новых товаров
    for main_id, b_data in blocks.items():
        if isinstance(main_id, str) and main_id.startswith("new_"):
            sku = main_id.replace("new_", "")
            orig_item = next(i for i in csv_items if i["sku"] == sku)
            diff = ProductDiff(sku=sku, name=orig_item["name"], old_price=0.0, new_price=b_data["price"], old_stock=0, new_stock=b_data["stock"], seller_name=b_data["seller_name"])
            new_products.append(diff)
        else:
            db_main = b_data["db_main"]
            main_csv_item = next((i for i in reversed(csv_items) if i["sku"] == db_main.sku), None)
            new_name = main_csv_item["name"] if main_csv_item else db_main.name

            price_changed = db_main.base_price != b_data["price"]
            stock_changed = db_main.stock != b_data["stock"]
            name_changed = db_main.name != new_name
            seller_changed = (db_main.seller_id is None and b_data["seller_name"])

            if price_changed or stock_changed or name_changed or seller_changed:
                diff = ProductDiff(sku=db_main.sku, name=new_name, old_price=db_main.base_price, new_price=b_data["price"], old_stock=db_main.stock, new_stock=b_data["stock"], seller_name=b_data["seller_name"])
                changed_products.append(diff)
            else:
                diff = ProductDiff(sku=db_main.sku, name=db_main.name, old_price=db_main.base_price, new_price=db_main.base_price, old_stock=db_main.stock, new_stock=db_main.stock, seller_name=b_data["seller_name"])
                unchanged_products.append(diff)

    # 2. Генерируем изменения для Вложенных товаров (ТОЛЬКО если изменилось имя)
    for item in csv_items:
        db_p = db_products_map.get(item["sku"])
        if db_p and db_p.parent_id:
            if db_p.name != item["name"]:
                diff = ProductDiff(sku=db_p.sku, name=item["name"], old_price=db_p.base_price, new_price=db_p.base_price, old_stock=0, new_stock=0, seller_name=item["seller_name"])
                changed_products.append(diff)

    unique_conflicts = list({c['product_name']: c for c in conflicts}.values())
    new_authors = list(csv_authors - existing_usernames)

    return {
        "new_products": new_products,
        "changed_products": changed_products,
        "unchanged_products": unchanged_products,
        "new_authors": new_authors,
        "conflicts": unique_conflicts
    }


@router.post("/import/confirm")
def confirm_products_import(  # <--- Убрали async!
        request: ImportConfirmRequest,
        background_tasks: BackgroundTasks,  # <--- Добавили фоновые задачи
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
                random_pass = secrets.token_hex(4)
                new_user = User(
                    username=author_name,
                    role="seller",
                    hashed_password=get_password_hash(random_pass),
                    is_active=True
                )
                session.add(new_user)
                stats["authors_created"] += 1
        session.commit()

    all_users = session.exec(select(User)).all()
    user_map = {u.username: u.id for u in all_users}

    # 2. Обработка измененных товаров
    for diff in request.changed_products:
        if not diff.sku:
            continue

        # Убрали with_for_update(), чтобы SQLite не блокировался
        db_product = session.exec(select(Product).where(Product.sku == diff.sku)).first()

        if db_product:
            changes = {}

            if db_product.base_price != diff.new_price:
                changes["base_price"] = {"old": db_product.base_price, "new": diff.new_price}
                db_product.base_price = diff.new_price

                if db_product.parent_id is None:
                    children = session.exec(select(Product).where(Product.parent_id == db_product.id)).all()
                    for child in children:
                        child.base_price = diff.new_price
                        session.add(child)

            if db_product.stock != diff.new_stock:
                changes["stock"] = {"old": db_product.stock, "new": diff.new_stock}
                db_product.stock = diff.new_stock

            if db_product.name != diff.name:
                changes["name"] = {"old": db_product.name, "new": diff.name}
                db_product.name = diff.name

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
        session.flush()  # Получаем ID, но не коммитим сразу (намного быстрее!)

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

    # Сохраняем всё разом в конце (оптимизация скорости)
    session.commit()

    # Передаем отправку уведомления в фон
    background_tasks.add_task(manager.broadcast, {"event": "inventory_updated"})

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

    # ЗАЩИТА: Если выбранный главный товар сам является вложенным,
    # делаем главным его родителя (плоская структура без "матрешек")
    if target.parent_id:
        target = session.get(Product, target.parent_id)

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

        # Переносим вложенный товар в блок
        source.parent_id = target.id
        source.stock = 0
        source.is_obsolete = False  # Восстанавливаем из архива, если он там был
        source.base_price = target.base_price
        session.add(source)

        # ЗАЩИТА: Если у источника были свои дети, перекидываем их на нового родителя
        children = session.exec(select(Product).where(Product.parent_id == source.id)).all()
        for child in children:
            child.parent_id = target.id
            child.base_price = target.base_price
            session.add(child)

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

@router.post("/unmerge")
def unmerge_product(
        req: ProductUnmergeRequest,
        admin_data: dict = Depends(get_current_admin),
        session: Session = Depends(get_session)
):
    child = session.get(Product, req.child_id)
    if not child or not child.parent_id:
        raise HTTPException(status_code=400, detail="Товар не найден или не является вложенным")

    old_parent_id = child.parent_id
    child.parent_id = None
    child.stock = 0  # При выходе из блока остаток всегда 0 (до первой выгрузки или ручной правки)
    session.add(child)

    admin_username = admin_data.get("username", "admin")
    create_audit_log(
        session=session,
        actor=admin_username,
        entity_name="Product",
        entity_id=child.id,
        action="unmerge_product",
        changes={"old_parent_id": old_parent_id}
    )

    session.commit()
    return {"status": "success", "message": "Товар исключен из блока"}


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