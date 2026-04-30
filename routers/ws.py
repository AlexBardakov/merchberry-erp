# routers/ws.py
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from services.websocket import manager

router = APIRouter(tags=["WebSockets"])

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Просто держим соединение открытым и слушаем.
            # Если нужно, фронтенд может слать сюда ping/pong для поддержания активности
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)