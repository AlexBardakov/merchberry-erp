import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Inventory } from './pages/Inventory';
import { Users } from './pages/Users';
import { Finance } from './pages/Finance';
import { Sync } from './pages/Sync';
import { InventoryLogs } from './pages/InventoryLogs';
import { Payouts } from './pages/Payouts';
import { Profile } from './pages/Profile';
import { WebSocketProvider } from './api/websocket';

// Красивые заглушки для будущих страниц
const Placeholder = ({ title }: { title: string }) => (
  <div className="flex items-center justify-center h-64 bg-white rounded-2xl shadow-sm border border-gray-100 text-gray-500 font-medium">
    {title} (В разработке...)
  </div>
);

function App() {
  return (
  <WebSocketProvider>
    <BrowserRouter>
      <Routes>
        {/* Открытый маршрут для авторизации */}
        <Route path="/login" element={<Login />} />

        {/* Защищенные маршруты (нужен токен) */}
        <Route element={<ProtectedRoute />}>
          {/* Оболочка с боковым меню */}
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/inventory-logs" element={<InventoryLogs />} />
            <Route path="/finance" element={<Finance />} />
            <Route path="/payouts" element={<Payouts />} />
            <Route path="/profile" element={<Profile />} />

            {/* Строго защищенные маршруты (Только для admin) */}
            <Route element={<ProtectedRoute allowedRole="admin" />}>
              <Route path="/users" element={<Users />} />
              <Route path="/sync" element={<Sync />} />
            </Route>
          </Route>
        </Route>

        {/* Перехват неизвестных ссылок -> кидаем на главную */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </WebSocketProvider>
  );
}

export default App;