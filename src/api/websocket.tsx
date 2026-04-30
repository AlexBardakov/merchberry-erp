import React, { createContext, useContext, useEffect, useRef } from 'react';

const WebSocketContext = createContext<any>(null);

export const useWebSocket = () => useContext(WebSocketContext);

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Подключаемся к нашему новому эндпоинту
    // Используем ws:// для локальной разработки или wss:// для продакшена
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => console.log("WebSocket connected");

      ws.onclose = () => {
        console.log("WebSocket disconnected. Retrying in 3s...");
        setTimeout(connect, 3000); // Авто-переподключение
      };

      ws.onerror = (err) => console.error("WebSocket error:", err);
    };

    connect();

    return () => {
      socketRef.current?.close();
    };
  }, []);

  // Функция для подписки на конкретные события
  const subscribe = (eventName: string, callback: () => void) => {
    const handler = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      if (data.event === eventName) {
        callback();
      }
    };

    socketRef.current?.addEventListener('message', handler);
    return () => socketRef.current?.removeEventListener('message', handler);
  };

  return (
    <WebSocketContext.Provider value={{ subscribe }}>
      {children}
    </WebSocketContext.Provider>
  );
};