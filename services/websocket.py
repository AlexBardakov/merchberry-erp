# services/websocket.py
from fastapi import WebSocket
from typing import List

class ConnectionManager:
    def __init__(self):
        # Здесь мы храним все активные подключения (открытые вкладки пользователей)
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        """Отправляет JSON-сообщение всем подключенным клиентам"""
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                # Если клиент отвалился, но мы еще не успели его удалить
                pass

# Создаем единственный экземпляр менеджера на всё приложение
manager = ConnectionManager()