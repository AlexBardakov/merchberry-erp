// src/components/Layout.tsx
import React from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Package, Wallet, Users, RefreshCw, LogOut } from 'lucide-react';

export const Layout = () => {
  const location = useLocation(); // Чтобы знать, на какой мы странице
  const navigate = useNavigate();
  
  const userRole = localStorage.getItem('userRole');
  const username = localStorage.getItem('username') || 'Пользователь';

  const handleLogout = () => {
    localStorage.clear(); // Удаляем токены и роли
    navigate('/login');   // Перекидываем на вход
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
          
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">{username}</p>
              <p className="text-xs text-gray-500 uppercase font-semibold">
                {userRole === 'admin' ? 'Администратор' : 'Продавец'}
              </p>
            </div>
            {/* Круглая аватарка с первой буквой логина */}
            <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold text-lg">
              {username.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        {/* КОНТЕНТ СТРАНИЦЫ */}
        <div className="flex-1 overflow-auto p-8">
          {/* Сюда будут подгружаться Dashboard, Inventory и т.д. */}
          <Outlet /> 
        </div>
      </main>
    </div>
  );
};