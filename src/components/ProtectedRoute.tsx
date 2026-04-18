// src/components/ProtectedRoute.tsx
import { Navigate, Outlet } from 'react-router-dom';

export const ProtectedRoute = ({ allowedRole }: { allowedRole?: 'admin' | 'seller' }) => {
  const token = localStorage.getItem('token');
  const userRole = localStorage.getItem('userRole');

  // Если нет токена - отправляем на логин
  if (!token) {
    return <Navigate to="/login" replace />;
  }

  // Если маршрут требует роли Админа, а зашел Продавец - не пускаем
  if (allowedRole && userRole !== allowedRole) {
    // Можно перенаправить на страницу "Доступ запрещен" или на Главную
    return <Navigate to="/" replace />;
  }

  // Если проверки пройдены, рендерим дочерние компоненты (Outlet)
  return <Outlet />;
};