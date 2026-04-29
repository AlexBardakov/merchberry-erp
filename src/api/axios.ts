// src/api/axios.ts
import axios from 'axios';

// Создаем экземпляр axios с базовым URL нашего бэкенда
const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Добавляем "Перехватчик" (Interceptor) запросов
apiClient.interceptors.request.use(
  (config) => {
    // Перед каждым запросом ищем токен в локальном хранилище браузера
    const token = localStorage.getItem('token');
    if (token) {
      // Если токен есть, прикрепляем его к заголовкам
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Перехватчик ответов (для обработки просроченного токена)
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Если сервер ответил 401 (Не авторизован) - выкидываем на страницу логина
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('userRole');
      window.location.href = '/login'; 
    }
    return Promise.reject(error);
  }
);

export default apiClient;