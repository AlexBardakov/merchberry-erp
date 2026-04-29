// src/components/Layout.tsx
import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, Wallet, Users, RefreshCw, ClipboardList,
  LogOut, X, Info, Bell, MessageCircle, ExternalLink, CheckCircle, CreditCard, User
} from 'lucide-react';
import apiClient from '../api/axios';

export const Layout = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const userRole = localStorage.getItem('userRole');
  const username = localStorage.getItem('username') || 'Пользователь';

  // ДОБАВЛЕНО: Состояние для индикатора ожидающих выплат
  const [pendingPayoutsCount, setPendingPayoutsCount] = useState(0);

  // Загрузка уведомлений при входе
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        // Уведомления об ожидающих выплатах (Админ видит все, Автор - свои)
        if (userRole) {
          const payoutsEndpoint = userRole === 'admin' ? '/payouts/all' : '/payouts/me';
          const payoutsRes = await apiClient.get(payoutsEndpoint);
          const pendingCount = payoutsRes.data.filter((p: any) => p.status === 'pending').length;
          setPendingPayoutsCount(pendingCount);
        }
      } catch (error) {
        console.error("Ошибка загрузки уведомлений:", error);
      }
    };
    fetchNotifications();
  }, [userRole]);

  const handleLogout = () => {
    localStorage.clear();
    navigate('/login');
  };

  const menuItems = [
    { path: '/', label: 'Дашборд', icon: <LayoutDashboard size={20} />, roles: ['admin', 'seller'] },
    { path: '/inventory', label: 'Склад', icon: <Package size={20} />, roles: ['admin', 'seller'] },
    { path: '/inventory-logs', label: 'Инвентаризация', icon: <ClipboardList size={20} />, roles: ['admin', 'seller'] },
    { path: '/finance', label: 'Финансы', icon: <Wallet size={20} />, roles: ['admin', 'seller'] },
    { path: '/payouts', label: 'Выплаты', icon: <CreditCard size={20} />, roles: ['admin', 'seller'] }, // ДОБАВЛЕНО
    { path: '/users', label: 'Авторы', icon: <Users size={20} />, roles: ['admin'] },
    { path: '/sync', label: 'Синхронизация', icon: <RefreshCw size={20} />, roles: ['admin'] },
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* SIDEBAR */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shrink-0">
              M
            </div>
            <span className="font-bold text-xl tracking-tight text-gray-900">Merchberry</span>
          </div>

          <nav className="space-y-1">
            {menuItems.map((item) => (
              item.roles.includes(userRole || '') && (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                    location.pathname === item.path
                      ? 'bg-indigo-50 text-indigo-600'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {item.icon}
                    {item.label}
                  </div>
                  {/* Индикатор выплат */}
                  {item.path === '/payouts' && pendingPayoutsCount > 0 && (
                    <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
                      {pendingPayoutsCount}
                    </span>
                  )}
                </Link>
              )
            ))}

            {/* КНОПКА ПРОФИЛЯ (Вынесена за пределы map!) */}
            <Link
              to="/profile"
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all mt-2 border-t border-gray-100 ${
                location.pathname === '/profile'
                  ? 'bg-indigo-50 text-indigo-600'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <User size={20} />
              <span className="font-medium">Мой профиль</span>
            </Link>
          </nav>
        </div>

        {/* НИЖНЯЯ ЧАСТЬ САЙДБАРА */}
        <div className="mt-auto p-6 border-t border-gray-100 space-y-4">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 transition-all"
          >
            <LogOut size={20} />
            Выйти
          </button>
        </div>
      </aside>

      {/* ОСНОВНОЙ КОНТЕНТ */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* HEADER */}
        <header className="bg-white border-b border-gray-100 px-8 py-4 flex items-center justify-between shadow-sm shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold text-gray-800">
              {menuItems.find(i => i.path === location.pathname)?.label || 'Система'}
            </h2>
          </div>
        </header>

        {/* ВНУТРЕННИЕ СТРАНИЦЫ */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};