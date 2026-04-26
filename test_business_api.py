import hashlib
import requests
import json
from urllib.parse import urlencode

ACCOUNT = "w614429"
APP_ID = "321845"
SECRET = "XD6T08K4KGITKISvua24vlYLBffPmdFG"
BASE_URL = f"https://{ACCOUNT}.business.ru/api/rest"


def get_token():
    print("1. Запрашиваем системный токен (repair.json)...")
    url = f"{BASE_URL}/repair.json"

    params = {"app_id": APP_ID}

    # 1. Сортируем и превращаем в URL-строку (аналог ksort + http_build_query)
    sorted_params = sorted(params.items())
    params_string = urlencode(sorted_params)

    # 2. Формула SDK: MD5( TOKEN + SECRET + PARAMS_STRING )
    # Для метода repair токен считается пустой строкой ""
    token_for_hash = ""
    raw_string = token_for_hash + SECRET + params_string
    app_psw = hashlib.md5(raw_string.encode('utf-8')).hexdigest()

    params["app_psw"] = app_psw

    res = requests.get(url, params=params)
    if res.status_code == 200:
        token = res.json().get("token")
        print(f"✅ Токен успешно получен: {token}\n")
        return token
    else:
        print(f"❌ Ошибка {res.status_code}: {res.text}")
        return None


def get_last_check(token):
    print("2. Запрашиваем последний чек (retailchecks.json)...")
    url = f"{BASE_URL}/retailchecks.json"

    # Заметь: мы НЕ добавляем сюда сам token, он нужен только для хэша
    params = {
        "app_id": APP_ID,
        "limit": 1,
        "with_goods": 1,
        "order_by[date]": "DESC"  # Сортируем по дате от новых к старым
    }

    # 1. Сортируем и превращаем в URL-строку
    sorted_params = sorted(params.items())
    params_string = urlencode(sorted_params)

    # 2. Формула SDK: MD5( TOKEN + SECRET + PARAMS_STRING )
    raw_string = token + SECRET + params_string
    app_psw = hashlib.md5(raw_string.encode('utf-8')).hexdigest()

    # 3. Добавляем в запрос только подпись
    params["app_psw"] = app_psw

    res = requests.get(url, params=params)

    if res.status_code == 200:
        print("✅ Чек успешно получен!")
        print(json.dumps(res.json(), indent=2, ensure_ascii=False))
    else:
        print(f"❌ Ошибка {res.status_code}: {res.text}")
        print(f"Сырая строка хэша была: {raw_string}")


if __name__ == "__main__":
    current_token = get_token()
    if current_token:
        get_last_check(current_token)