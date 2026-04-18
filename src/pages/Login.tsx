// src/pages/Login.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import apiClient from '../api/axios';

export const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); // Останавливаем стандартную перезагрузку страницы
    setError('');
    setIsLoading(true);

    try {
      // Отправляем запрос на наш Python-сервер
      const response = await apiClient.post('/login/', {
        username,
        password,
      });

      const { access_token } = response.data;

      // Извлекаем роль из токена (расшифровываем payload)
      // Токен состоит из 3 частей, разделенных точкой. Вторая часть - это данные.
      const payloadBase64 = access_token.split('.')[1];
      const decodedPayload = JSON.parse(atob(payloadBase64));
      
      // Сохраняем "ключи" в хранилище браузера
      localStorage.setItem('token', access_token);
      localStorage.setItem('userRole', decodedPayload.role);
      localStorage.setItem('username', decodedPayload.sub);

      // Успешно! Перекидываем на главную страницу
      navigate('/');
    } catch (err: any) {
      // Если сервер вернул 400 - показываем текст ошибки
      if (err.response && err.response.data) {
        setError(err.response.data.detail || 'Ошибка при входе');
      } else {
        setError('Нет связи с сервером. Проверьте подключение.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 space-y-6">
        
        {/* Заголовок */}
        <div className="text-center">
          <div className="bg-indigo-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-indigo-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Merchberry ERP</h2>
          <p className="text-gray-500 mt-2">Войдите в систему управления</p>
        </div>

        {/* Форма */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Логин
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              placeholder="Введите логин"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Пароль
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              placeholder="••••••••"
              required
            />
          </div>

          {/* Блок ошибки (рендерится только если error не пустой) */}
          {error && (
            <div className="text-red-500 text-sm text-center bg-red-50 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className={`w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors ${
              isLoading ? 'opacity-70 cursor-not-allowed' : ''
            }`}
          >
            {isLoading ? 'Вход...' : 'Войти'}
          </button>
        </form>
        
      </div>
    </div>
  );
};