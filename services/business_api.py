# Файл: services/business_api.py
import os
import hashlib
import json
import requests
from urllib.parse import urlencode
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()


class BusinessRuClient:
    def __init__(self):
        self.account = os.getenv("B2B_ACCOUNT", "demo_account")
        self.app_id = os.getenv("B2B_APP_ID", "demo_app_id")
        self.secret = os.getenv("B2B_SECRET", "demo_secret")

        # Базовый URL API Бизнес.Ру
        self.base_url = f"https://{self.account}.business.ru/api/rest"

    def _generate_signature(self, params: dict) -> str:
        """
        Магия Бизнес.Ру: Генерация MD5 подписи (app_psw).
        Правило: берем секрет, склеиваем с отсортированными ключами и значениями, и хэшируем.
        """
        # 1. Сортируем параметры по алфавиту (по названию ключа)
        sorted_params = sorted(params.items())

        # 2. Склеиваем параметры в строку (без амперсандов, просто ключ=значение)
        # Внимание: у Бизнес.Ру бывают нюансы склейки, но базовый алгоритм такой:
        params_string = "".join([f"{k}={v}" for k, v in sorted_params if k != 'app_psw'])

        # 3. Добавляем секретный ключ в начало (согласно документации Бизнес.Ру)
        raw_string = self.secret + params_string

        # 4. Превращаем в MD5 хэш
        return hashlib.md5(raw_string.encode('utf-8')).hexdigest()

    def _make_request(self, model: str, action: str, additional_params: dict = None):
        """
        Универсальная функция для отправки запросов к API.
        model - сущность (например, 'check' или 'sale')
        action - действие (например, 'get')
        """
        params = {
            "app_id": self.app_id,
        }
        if additional_params:
            params.update(additional_params)

        # Генерируем подпись и добавляем в параметры
        params["app_psw"] = self._generate_signature(params)

        url = f"{self.base_url}/{model}.json"

        try:
            # Отправляем GET-запрос
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()  # Проверка на ошибки (404, 500 и т.д.)

            data = response.json()
            if data.get("status") == "error":
                print(f"Ошибка от Бизнес.Ру: {data.get('error_code')} - {data.get('error_text')}")
                return []

            return data.get("result", [])

        except requests.RequestException as e:
            print(f"Сетевая ошибка при обращении к Бизнес.Ру: {e}")
            return []

    # --- КОНКРЕТНЫЕ МЕТОДЫ ДЛЯ НАШЕЙ ERP ---

    def get_recent_sales(self, date_from: datetime):
        """
        Получает список проданных товаров (чеков) начиная с указанной даты.
        """
        date_str = date_from.strftime("%Y-%m-%d %H:%M:%S")

        params = {
            "limit": 250,
            "date_from": date_str,
            # "status": "closed" # раскомментировать, если API отдает пустые/отмененные чеки
        }

        print(f"Синхронизация: Запрашиваем продажи с {date_str}...")

        # БОЕВОЙ РЕЖИМ (Делаем реальный запрос)
        return self._make_request(model="sale", action="get", additional_params=params)

        # Моковые данные отключены:
        # return self._get_mock_sales_data()

    def _get_mock_sales_data(self):
        """ Временная функция, имитирующая ответ от Бизнес.Ру для тестирования логики """
        return [
            {
                "id": 1001,
                "date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "sum": 1200.0,
                "goods": [
                    {"sku": "1", "name": "Кейкап", "price": 1200.0, "count": 1}
                ]
            },
            {
                "id": 1002,
                "date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "sum": 750.0,
                "goods": [
                    {"sku": "2", "name": "Брелок", "price": 750.0, "count": 1}
                ]
            }
        ]