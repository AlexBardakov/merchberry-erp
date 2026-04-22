// src/components/Layout.tsx
import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, Wallet, Users, RefreshCw,
  LogOut, User as UserIcon, X, Info, Bell
} from 'lucide-react';
import apiClient from '../api/axios';

export const Layout = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const userRole = localStorage.getItem('userRole');
  const username = localStorage.getItem('username') || 'Пользователь';

  // Состояния профиля
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileData, setProfileData] = useState<any>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);

  // --- НОВОЕ: Состояния уведомлений ---
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  // Загрузка уведомлений при входе
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const res = await apiClient.get('/products/low-stock');
        setLowStockItems(res.data);
      } catch (error) {
        console.error("Ошибка уведомлений:", error);
      }
    };
    fetchNotifications();
  }, []);

  const handleLogout = () => {
    localStorage.clear();
    navigate('/login');
  };

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

  const menuItems = [
    { path: '/', label: 'Дашборд', icon: <LayoutDashboard size={20} />, roles: ['admin', 'seller'] },
    { path: '/inventory', label: 'Склад', icon: <Package size={20} />, roles: ['admin', 'seller'] },
    { path: '/finance', label: 'Финансы', icon: <Wallet size={20} />, roles: ['admin', 'seller'] },
    { path: '/users', label: 'Авторы', icon: <Users size={20} />, roles: ['admin'] },
    { path: '/sync', label: 'Синхронизация', icon: <RefreshCw size={20} />, roles: ['admin'] },
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar остается прежним */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-xl">
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
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                    location.pathname === item.path
                      ? 'bg-indigo-50 text-indigo-600'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              )
            ))}
          </nav>
        </div>

        <div className="mt-auto p-6 border-t border-gray-100">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 transition-all"
          >
            <LogOut size={20} />
            Выйти
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* HEADER с интегрированным колокольчиком */}
        <header className="bg-white border-b border-gray-100 px-8 py-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold text-gray-800">
              {menuItems.find(i => i.path === location.pathname)?.label || 'Система'}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {/* БЛОК УВЕДОМЛЕНИЙ */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className={`p-2 rounded-full transition-all relative ${
                  showNotifications ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400 hover:bg-gray-100'
                }`}
              >
                <Bell size={22} />
                {lowStockItems.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full border-2 border-white flex items-center justify-center">
                    {lowStockItems.length}
                  </span>
                )}
              </button>

              {showNotifications && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowNotifications(false)}></div>
                  <div className="absolute right-0 mt-3 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-20 animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-4 border-b border-gray-50 bg-gray-50/50 flex justify-between items-center">
                      <h3 className="text-sm font-bold text-gray-800">Заканчивается на полке</h3>
                      <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Остатки</span>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {lowStockItems.length > 0 ? (
                        <ul className="divide-y divide-gray-50">
                          {lowStockItems.map(item => (
                            <li key={item.id} className="p-4 hover:bg-gray-50 transition-colors flex justify-between items-center">
                              <div className="flex flex-col">
                                <span className="text-sm font-medium text-gray-700 truncate max-w-[180px]">{item.name}</span>
                                <span className="text-[10px] text-gray-400">SKU: {item.sku || '—'}</span>
                              </div>
                              <span className="px-2.5 py-1 bg-red-100 text-red-600 text-xs font-bold rounded-lg">
                                {item.stock} шт.
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="p-8 text-center">
                          <div className="w-12 h-12 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-3">
                            <Package size={20} />
                          </div>
                          <p className="text-sm text-gray-500">Все товары в наличии!</p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="h-8 w-px bg-gray-100 mx-1"></div>

            <button
              onClick={openProfile}
              className="flex items-center gap-3 pl-2 pr-4 py-1.5 hover:bg-gray-50 rounded-full transition-all border border-transparent hover:border-gray-100"
            >
              <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center font-bold text-sm">
                {username[0].toUpperCase()}
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-xs font-bold text-gray-900 leading-tight">{username}</p>
                <p className="text-[10px] text-gray-400 font-medium uppercase tracking-tighter">{userRole === 'admin' ? 'Администратор' : 'Автор'}</p>
              </div>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-x-hidden overflow-y-auto p-8">
          <Outlet />
        </main>
      </div>

      {/* Модальное окно профиля остается прежним */}
      {isProfileOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* ... содержимое профиля из твоего файла ... */}
            <div className="p-6 flex justify-between items-center border-b border-gray-50">
              <h3 className="text-xl font-bold text-gray-900">Ваш профиль</h3>
              <button onClick={() => setIsProfileOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                <X size={20} className="text-gray-400" />
              </button>
            </div>

            <div className="p-8">
              {isLoadingProfile ? (
                <div className="py-10 text-center text-gray-400">Загрузка данных...</div>
              ) : profileData && (
                <>
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

                  {/* ЛИНИЯ-РАЗДЕЛИТЕЛЬ */}
                  <div className="h-px bg-gray-100 my-6"></div>

                  {/* НОВЫЙ БЛОК НАСТРОЕК */}
                  <div className="space-y-5">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Настройки уведомлений</h4>

                    <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-gray-800">Умные уведомления</span>
                          <span className="text-[10px] text-gray-500">Сообщать о низком остатке</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={profileData.notifications_enabled}
                            onChange={async (e) => {
                              const val = e.target.checked;
                              setProfileData({...profileData, notifications_enabled: val});
                              await apiClient.patch('/users/me/settings', { notifications_enabled: val });
                            }}
                          />
                          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                      </div>

                      {/* СЛАЙДЕР (показывается только если уведомления включены) */}
                      {profileData.notifications_enabled && (
                        <div className="space-y-3 pt-3 border-t border-gray-200/50">
                          <div className="flex justify-between">
                            <span className="text-[11px] font-medium text-gray-600">Порог срабатывания:</span>
                            <span className="text-xs font-bold text-indigo-600">{profileData.low_stock_threshold} шт.</span>
                          </div>
                          <input
                            type="range"
                            min="0" max="20"
                            value={profileData.low_stock_threshold}
                            className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                            onChange={(e) => setProfileData({...profileData, low_stock_threshold: parseInt(e.target.value)})}
                            onMouseUp={async (e: any) => {
                              await apiClient.patch('/users/me/settings', { low_stock_threshold: parseInt(e.target.value) });
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};