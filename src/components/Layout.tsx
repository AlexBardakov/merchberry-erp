// src/components/Layout.tsx
import React, { useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Package, Wallet, Users, RefreshCw, LogOut, User as UserIcon, X, Info } from 'lucide-react';
import apiClient from '../api/axios';

export const Layout = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const userRole = localStorage.getItem('userRole');
  const username = localStorage.getItem('username') || 'Пользователь';

  // Состояния для модального окна профиля
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileData, setProfileData] = useState<any>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);

  const handleLogout = () => {
    localStorage.clear();
    navigate('/login');
  };

  // Загрузка данных профиля
  const openProfile = async () => {
    setIsProfileOpen(true);
    setIsLoadingProfile(true);
    try {
      const res = await apiClient.get('/users/me');
      setProfileData(res.data);
    } catch (error) {
      console.error("Ошибка загрузки профиля");
    } finally {
      setIsLoadingProfile(false);
    }
  };

  // Базовое меню (доступно всем)
  const menuItems = [
    { name: 'Дашборд', path: '/', icon: <LayoutDashboard className="w-5 h-5" /> },
    { name: 'Мои товары', path: '/inventory', icon: <Package className="w-5 h-5" /> },
    { name: 'Финансы', path: '/finance', icon: <Wallet className="w-5 h-5" /> },
  ];

  // Добавляем админские пункты
  if (userRole === 'admin') {
    menuItems.push(
      { name: 'Продавцы', path: '/users', icon: <Users className="w-5 h-5" /> },
      { name: 'Синхронизация', path: '/sync', icon: <RefreshCw className="w-5 h-5" /> }
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* ЛЕВАЯ ПАНЕЛЬ (Sidebar) */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-gray-200">
          <span className="text-xl font-bold text-indigo-600 tracking-wide">Merchberry</span>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {menuItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                {item.icon}
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Кнопка выхода в самом низу */}
        <div className="p-4 border-t border-gray-200">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Выйти
          </button>
        </div>
      </aside>

      {/* ОСНОВНАЯ РАБОЧАЯ ОБЛАСТЬ */}
      <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* ВЕРХНЯЯ ПАНЕЛЬ (Header) */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 shrink-0">
          <h1 className="text-xl font-semibold text-gray-800">
            {menuItems.find(i => i.path === location.pathname)?.name || 'Merchberry ERP'}
          </h1>

          {/* Кликабельный профиль */}
          <button
            onClick={openProfile}
            className="flex items-center gap-4 text-left hover:bg-gray-50 px-3 py-1.5 rounded-xl transition-colors border border-transparent hover:border-gray-200"
          >
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">{username}</p>
              <p className="text-xs text-gray-500 uppercase font-semibold">
                {userRole === 'admin' ? 'Администратор' : 'Продавец'}
              </p>
            </div>
            {/* Круглая аватарка с первой буквой логина */}
            <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold text-lg shadow-sm">
              {username.charAt(0).toUpperCase()}
            </div>
          </button>
        </header>

        {/* КОНТЕНТ СТРАНИЦЫ */}
        <div className="flex-1 overflow-auto p-8">
          <Outlet />
        </div>
      </main>

      {/* МОДАЛЬНОЕ ОКНО ПРОФИЛЯ */}
      {isProfileOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl animate-in fade-in zoom-in-95 relative">
            <button
              onClick={() => setIsProfileOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <X size={20} />
            </button>

            <div className="flex flex-col items-center mb-6 pt-2">
              <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-3">
                <UserIcon size={32} />
              </div>
              <h2 className="text-xl font-bold text-gray-900">{username}</h2>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500 mt-1">
                {userRole === 'admin' ? 'Администратор' : 'Арендатор полки'}
              </span>
            </div>

            {isLoadingProfile ? (
              <div className="py-8 text-center text-gray-500">Загрузка данных...</div>
            ) : profileData && (
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                  <div className="flex justify-between text-sm border-b border-gray-200 pb-2">
                    <span className="text-gray-500">ФИО / Реквизиты:</span>
                    <span className="font-medium text-gray-900 text-right">{profileData.full_name || 'Не указано'}</span>
                  </div>
                  <div className="flex justify-between text-sm border-b border-gray-200 pb-2">
                    <span className="text-gray-500">Телефон:</span>
                    <span className="font-medium text-gray-900">{profileData.phone || 'Не указано'}</span>
                  </div>
                  <div className="flex justify-between text-sm border-b border-gray-200 pb-2">
                    <span className="text-gray-500">Комиссия точки:</span>
                    <span className="font-bold text-indigo-600">{profileData.commission_percent}%</span>
                  </div>
                  <div className="flex justify-between text-sm pt-1">
                    <span className="text-gray-500">Текущий баланс:</span>
                    <span className="font-bold text-green-600 text-base">{profileData.balance.toLocaleString('ru-RU')} ₽</span>
                  </div>
                </div>

                <div className="flex items-start gap-2 text-xs text-gray-500 bg-blue-50/50 p-3 rounded-lg border border-blue-100">
                  <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
                  <p>Если в ваших данных есть ошибка или изменились реквизиты, пожалуйста, сообщите об этом Администратору для обновления профиля.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};