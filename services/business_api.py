# services/business_api.py
import os
import hashlib
import requests
from urllib.parse import urlencode


class BusinessRuClient:
    def __init__(self):
        self.account = os.getenv("B2B_ACCOUNT").strip()
        self.app_id = os.getenv("B2B_APP_ID").strip()
        self.secret = os.getenv("B2B_SECRET").strip()
        self.base_url = f"https://{self.account}.business.ru/api/rest"
        self.token = None

    def _repair_token(self):
        params = {"app_id": self.app_id}
        params_string = urlencode(sorted(params.items()))
        # Подпись для repair: "" + secret + params
        raw_string = self.secret + params_string
        params["app_psw"] = hashlib.md5(raw_string.encode('utf-8')).hexdigest()

        res = requests.get(f"{self.base_url}/repair.json", params=params)
        if res.status_code == 200:
            self.token = res.json().get("token")

    def get_checks(self, limit=100, page=1):
        if not self.token: self._repair_token()

        params = {
            "app_id": self.app_id,
            "limit": limit,
            "page": page,
            "with_goods": 1,
            "order_by[date]": "DESC"
        }

        params_string = urlencode(sorted(params.items()))
        # Подпись для данных: token + secret + params
        raw_string = self.token + self.secret + params_string
        params["app_psw"] = hashlib.md5(raw_string.encode('utf-8')).hexdigest()

        res = requests.get(f"{self.base_url}/retailchecks.json", params=params)
        return res.json().get("result", []) if res.status_code == 200 else []