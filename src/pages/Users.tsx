// src/pages/Users.tsx
import React, { useState, useEffect } from 'react';
import { UserPlus, Key, Shield, Copy, CheckCircle } from 'lucide-react';
import apiClient from '../api/axios';

interface User {
  id: number;
  username: string;
  full_name: string | null;
  phone: string | null;
  role: string;
  commission_percent: number;
  balance: number;
}

export const Users = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Состояние формы нового продавца
  const [formData, setFormData] = useState({
    username: '',
    full_name: '',
    phone: '',
    commission_percent: 15
  });

  // Для отображения сгенерированного пароля админу
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      const res = await apiClient.get('/users/');
      // Отфильтруем админа, чтобы не показывать его в списке продавцов
      setUsers(res.data.filter((u: User) => u.role === 'seller'));
    } catch (error) {
      console.error("Ошибка загрузки пользователей:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Генератор случайного пароля (8 символов)
  const generatePassword = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
    let pass = '';
    for (let i = 0; i < 8; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setGeneratedPassword(pass);
    setCopied(false);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!generatedPassword) {
      alert("Сначала сгенерируйте пароль для продавца!");
      return;
    }

    try {
      await apiClient.post('/users/', {
        ...formData,
        password: generatedPassword, // Передаем чистый пароль, бэкенд сам его зашифрует
        role: 'seller'
      });

      alert("Продавец успешно создан!");
      setIsModalOpen(false);
      setGeneratedPassword('');
      setFormData({ username: '', full_name: '', phone: '', commission_percent: 15 });
      fetchUsers(); // Обновляем таблицу
    } catch (error: any) {
      alert(error.response?.data?.detail || "Ошибка при создании продавца");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Авторы и Арендаторы</h1>
          <p className="text-gray-500 mt-1">Управление продавцами мерча и комиссиями</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors"
        >
          <UserPlus size={18} />
          Добавить автора
        </button>
      </div>

      {/* ТАБЛИЦА */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Загрузка данных...</div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center">
            <Shield className="w-12 h-12 text-gray-300 mb-3" />
            <p className="text-gray-500 text-lg">Пока нет ни одного добавленного автора</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="p-4 text-sm font-semibold text-gray-600">ID / Логин</th>
                <th className="p-4 text-sm font-semibold text-gray-600">ФИО</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Комиссия точки</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Баланс к выплате</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="p-4">
                    <p className="font-medium text-gray-900">{user.username}</p>
                    <p className="text-xs text-gray-500">ID: {user.id}</p>
                  </td>
                  <td className="p-4 text-sm text-gray-700">
                    {user.full_name || '—'}
                    {user.phone && <span className="block text-xs text-gray-400">{user.phone}</span>}
                  </td>
                  <td className="p-4 text-sm text-indigo-600 font-bold">{user.commission_percent}%</td>
                  <td className="p-4 text-sm font-bold text-gray-900">{user.balance.toLocaleString('ru-RU')} ₽</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* МОДАЛЬНОЕ ОКНО СОЗДАНИЯ ПРОДАВЦА */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl animate-in fade-in zoom-in-95">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Новый автор</h2>

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Логин (никнейм) *</label>
                <input
                  required
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  value={formData.username}
                  onChange={(e) => setFormData({...formData, username: e.target.value})}
                  placeholder="Например: togipi_art"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ФИО (для переводов)</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  value={formData.full_name}
                  onChange={(e) => setFormData({...formData, full_name: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Комиссия (%) *</label>
                  <input
                    required
                    type="number"
                    min="0" max="100"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    value={formData.commission_percent}
                    onChange={(e) => setFormData({...formData, commission_percent: parseFloat(e.target.value)})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Телефон</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                  />
                </div>
              </div>

              {/* Блок генерации пароля */}
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-3 mt-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-gray-800 flex items-center gap-2">
                    <Key size={16} className="text-indigo-600" />
                    Пароль для входа
                  </label>
                  <button
                    type="button"
                    onClick={generatePassword}
                    className="text-xs text-indigo-600 font-medium hover:underline"
                  >
                    Сгенерировать
                  </button>
                </div>

                {generatedPassword ? (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 p-2 bg-white border border-gray-300 rounded text-center font-mono text-lg tracking-wider text-gray-900">
                      {generatedPassword}
                    </code>
                    <button
                      type="button"
                      onClick={copyToClipboard}
                      className="p-2 bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-600"
                    >
                      {copied ? <CheckCircle size={20} className="text-green-600" /> : <Copy size={20} />}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 text-center">Нажмите кнопку, чтобы создать безопасный пароль</p>
                )}
                <p className="text-xs text-orange-600 text-center font-medium">Обязательно скопируйте пароль и передайте автору!</p>
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium transition-colors"
                >
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};