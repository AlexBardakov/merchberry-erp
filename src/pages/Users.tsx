// src/pages/Users.tsx
import React, { useState, useEffect } from 'react';
import { UserPlus, Key, Shield, Copy, CheckCircle, Search, Edit2, UserX, UserCheck, Lock, Trash2 } from 'lucide-react';
import apiClient from '../api/axios';

interface User {
  id: number;
  username: string;
  full_name: string | null;
  phone: string | null;
  role: string;
  commission_percent: number;
  balance: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export const Users = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Состояния модальных окон
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  // Выбранный пользователь для редактирования
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Формы
  const [createData, setCreateData] = useState({ username: '', full_name: '', phone: '', commission_percent: 15 });
  const [editData, setEditData] = useState({ full_name: '', phone: '', commission_percent: 15, notes: '' });

  // Генерация паролей
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      const res = await apiClient.get('/users/', {
        params: { search: searchQuery }
      });
      // Оставляем только продавцов
      setUsers(res.data.filter((u: User) => u.role === 'seller'));
    } catch (error) {
      console.error("Ошибка загрузки пользователей:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // --- ГЕНЕРАТОР ПАРОЛЕЙ ---
  const generatePassword = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$';
    let pass = '';
    for (let i = 0; i < 8; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
    setGeneratedPassword(pass);
    setCopied(false);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // --- API ДЕЙСТВИЯ ---
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!generatedPassword) return alert("Сгенерируйте пароль!");
    try {
      await apiClient.post('/users/', { ...createData, password: generatedPassword, role: 'seller' });
      setIsCreateModalOpen(false);
      setGeneratedPassword('');
      setCreateData({ username: '', full_name: '', phone: '', commission_percent: 15 });
      fetchUsers();
    } catch (error: any) {
      alert(error.response?.data?.detail || "Ошибка при создании");
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    try {
      await apiClient.patch(`/users/${selectedUser.id}`, editData);
      setIsEditModalOpen(false);
      fetchUsers();
    } catch (error) {
      alert("Ошибка при сохранении");
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !generatedPassword) return alert("Сгенерируйте новый пароль!");
    try {
      await apiClient.patch(`/users/${selectedUser.id}/password`, { new_password: generatedPassword });
      alert("Пароль успешно изменен!");
      setIsPasswordModalOpen(false);
      setGeneratedPassword('');
    } catch (error) {
      alert("Ошибка при смене пароля");
    }
  };

  const handleToggleStatus = async (user: User) => {
    const action = user.is_active ? "заблокировать" : "разблокировать";
    if (!window.confirm(`Вы уверены, что хотите ${action} пользователя ${user.username}?`)) return;
    try {
      await apiClient.patch(`/users/${user.id}`, { is_active: !user.is_active });
      fetchUsers();
    } catch (error) {
      alert("Ошибка изменения статуса");
    }
  };

  const handleDeleteUser = async (user: User) => {
      if (!window.confirm(`ВНИМАНИЕ! Вы навсегда удаляете аккаунт "${user.username}". Продолжить?`)) return;
      try {
        await apiClient.delete(`/users/${user.id}`);
        fetchUsers();
      } catch (error: any) {
        alert(error.response?.data?.detail || "Ошибка при удалении");
      }
    };

  // --- ХЕНДЛЕРЫ ОТКРЫТИЯ ОКОН ---
  const openEditModal = (user: User) => {
    setSelectedUser(user);
    setEditData({
      full_name: user.full_name || '',
      phone: user.phone || '',
      commission_percent: user.commission_percent,
      notes: user.notes || ''
    });
    setIsEditModalOpen(true);
  };

  const openPasswordModal = (user: User) => {
    setSelectedUser(user);
    setGeneratedPassword('');
    setIsPasswordModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Авторы и Арендаторы</h1>
          <p className="text-gray-500 mt-1">Управление профилями, комиссиями и доступом</p>
        </div>
        <button
          onClick={() => { setGeneratedPassword(''); setIsCreateModalOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors"
        >
          <UserPlus size={18} /> Добавить автора
        </button>
      </div>

      {/* ПАНЕЛЬ ПОИСКА */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
        <div className="flex flex-1 max-w-md relative">
          <input
            type="text" placeholder="Поиск по логину, ФИО или телефону..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchUsers()}
            onBlur={fetchUsers}
          />
          <Search size={18} className="absolute left-3 top-2.5 text-gray-400" />
        </div>
      </div>

      {/* ТАБЛИЦА */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
        {isLoading && <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div></div>}

        {users.length === 0 && !isLoading ? (
          <div className="p-12 text-center flex flex-col items-center">
            <Shield className="w-12 h-12 text-gray-300 mb-3" />
            <p className="text-gray-500 text-lg">Авторы не найдены</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="p-4 text-sm font-semibold text-gray-600">Аккаунт</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Контакты</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Комиссия точки</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Баланс</th>
                <th className="p-4 text-sm font-semibold text-gray-600 text-right">Управление</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => {
                  // Вычисляем, прошло ли 72 часа
                  const isDeleteAllowed = (new Date().getTime() - new Date(user.created_at).getTime()) < 72 * 60 * 60 * 1000;

                  return (
                    <tr key={user.id} className={`transition-colors ${!user.is_active ? 'bg-red-50/30' : 'hover:bg-gray-50'}`}>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <p className={`font-bold ${!user.is_active ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{user.username}</p>
                      {!user.is_active && <span className="bg-red-100 text-red-600 text-[10px] px-2 py-0.5 rounded uppercase font-bold">Блок</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">ID: {user.id}</p>
                  </td>
                  <td className="p-4 text-sm">
                    <p className="text-gray-900 font-medium">{user.full_name || '—'}</p>
                    <p className="text-gray-500">{user.phone || '—'}</p>
                  </td>
                  <td className="p-4">
                    <span className="bg-indigo-50 text-indigo-700 font-bold px-2 py-1 rounded text-sm">{user.commission_percent}%</span>
                  </td>
                  <td className="p-4 text-sm font-bold text-gray-900">{user.balance.toLocaleString('ru-RU')} ₽</td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEditModal(user)} className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded transition-colors" title="Профиль и заметки">
                        <Edit2 size={16} />
                      </button>
                      <button onClick={() => openPasswordModal(user)} className="p-1.5 text-orange-600 hover:bg-orange-100 rounded transition-colors" title="Сменить пароль">
                        <Key size={16} />
                      </button>
                      <button onClick={() => handleToggleStatus(user)} className={`p-1.5 rounded transition-colors ${user.is_active ? 'text-red-500 hover:bg-red-100' : 'text-green-600 hover:bg-green-100'}`} title={user.is_active ? "Заблокировать" : "Разблокировать"}>
                        {user.is_active ? <UserX size={16} /> : <UserCheck size={16} />}
                      </button>
                      {isDeleteAllowed && (
                          <button onClick={() => handleDeleteUser(user)} className="p-1.5 text-red-600 hover:bg-red-100 rounded transition-colors" title="Удалить навсегда (доступно 72ч)">
                            <Trash2 size={16} />
                          </button>
                        )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* МОДАЛЬНОЕ ОКНО СОЗДАНИЯ (Оставлено почти без изменений) */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Новый автор</h2>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Логин (никнейм) *</label>
                <input required type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500" value={createData.username} onChange={(e) => setCreateData({...createData, username: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ФИО</label>
                <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500" value={createData.full_name} onChange={(e) => setCreateData({...createData, full_name: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Комиссия (%) *</label>
                  <input required type="number" className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500" value={createData.commission_percent} onChange={(e) => setCreateData({...createData, commission_percent: parseFloat(e.target.value)})} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Телефон</label>
                  <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500" value={createData.phone} onChange={(e) => setCreateData({...createData, phone: e.target.value})} />
                </div>
              </div>

              <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-3 mt-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-gray-800 flex items-center gap-2"><Key size={16} className="text-indigo-600" /> Пароль</label>
                  <button type="button" onClick={generatePassword} className="text-xs text-indigo-600 font-medium hover:underline">Сгенерировать</button>
                </div>
                {generatedPassword ? (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 p-2 bg-white border border-gray-300 rounded text-center font-mono text-lg tracking-wider text-gray-900">{generatedPassword}</code>
                    <button type="button" onClick={copyToClipboard} className="p-2 bg-white border border-gray-300 rounded hover:bg-gray-50">{copied ? <CheckCircle size={20} className="text-green-600" /> : <Copy size={20} />}</button>
                  </div>
                ) : <p className="text-xs text-gray-500 text-center">Нажмите кнопку для создания пароля</p>}
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setIsCreateModalOpen(false)} className="flex-1 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium">Отмена</button>
                <button type="submit" className="flex-1 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium">Сохранить</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ПРОФИЛЯ */}
      {isEditModalOpen && selectedUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Профиль: {selectedUser.username}</h2>
            <p className="text-sm text-gray-500 mb-4">Изменение данных и приватные заметки</p>

            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ФИО / Реквизиты</label>
                <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500" value={editData.full_name} onChange={(e) => setEditData({...editData, full_name: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Комиссия точки (%)</label>
                  <input required type="number" className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500" value={editData.commission_percent} onChange={(e) => setEditData({...editData, commission_percent: parseFloat(e.target.value)})} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Телефон</label>
                  <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500" value={editData.phone} onChange={(e) => setEditData({...editData, phone: e.target.value})} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Приватная заметка (видит только Админ)</label>
                <textarea
                  rows={3} placeholder="Например: Переводить только на Т-Банк по номеру телефона..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 resize-none"
                  value={editData.notes} onChange={(e) => setEditData({...editData, notes: e.target.value})}
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="flex-1 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium">Отмена</button>
                <button type="submit" className="flex-1 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium">Сохранить</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* МОДАЛЬНОЕ ОКНО СБРОСА ПАРОЛЯ */}
      {isPasswordModalOpen && selectedUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-orange-100 text-orange-600 rounded-full"><Lock size={24} /></div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Сброс пароля</h2>
                <p className="text-sm text-gray-500">{selectedUser.username}</p>
              </div>
            </div>

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-gray-800">Новый пароль</label>
                  <button type="button" onClick={generatePassword} className="text-xs text-indigo-600 font-medium hover:underline">Сгенерировать</button>
                </div>
                {generatedPassword ? (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 p-2 bg-white border border-gray-300 rounded text-center font-mono text-lg tracking-wider text-gray-900">{generatedPassword}</code>
                    <button type="button" onClick={copyToClipboard} className="p-2 bg-white border border-gray-300 rounded hover:bg-gray-50">{copied ? <CheckCircle size={20} className="text-green-600" /> : <Copy size={20} />}</button>
                  </div>
                ) : <p className="text-xs text-gray-500 text-center py-2">Нажмите кнопку для создания</p>}
                <p className="text-[11px] text-orange-600 text-center leading-tight">После сохранения старый пароль продавца перестанет работать.</p>
              </div>

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsPasswordModalOpen(false)} className="flex-1 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium">Отмена</button>
                <button type="submit" disabled={!generatedPassword} className="flex-1 py-2 text-white bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 rounded-lg font-medium">Сохранить</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};