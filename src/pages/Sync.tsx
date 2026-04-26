// src/pages/Sync.tsx
import React, { useState } from 'react';
import { RefreshCw, CheckCircle, AlertTriangle, Receipt, Info, CloudDownload } from 'lucide-react';
import apiClient from '../api/axios';

interface SyncConflict {
  check_id: string;
  products: string;
}

interface SyncResult {
  status: string;
  message: string;
  processed_items: number;
  skipped_checks: number;
  total_revenue: number;
  conflicts: SyncConflict[];
}

export const Sync = () => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const userRole = localStorage.getItem('userRole');
  const isAdmin = userRole === 'admin';

  const handleSync = async () => {
    setIsSyncing(true);
    setError(null);
    setResult(null);

    try {
      // Эндпоинт теперь не требует параметров, он все делает автоматически
      const res = await apiClient.post('/transactions/sync/sales');
      setResult(res.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Произошла ошибка при обращении к серверу синхронизации.");
    } finally {
      setIsSyncing(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500 font-medium">Доступ к этому разделу есть только у администратора.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Синхронизация продаж</h1>
          <p className="text-gray-500 mt-1">Загрузка новых чеков из системы Бизнес.Ру</p>
        </div>
      </div>

      {/* Информационный блок о логике синхронизации */}
      <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 flex gap-4 items-start">
        <div className="text-blue-600 mt-1">
          <Info size={24} />
        </div>
        <div>
          <h3 className="font-bold text-blue-900 mb-2">Как работает синхронизация?</h3>
          <ul className="text-sm text-blue-800 space-y-2 list-disc list-inside">
            <li>
              <strong>Первая выгрузка:</strong> Система загрузит все исторические чеки, чтобы сформировать финансовую статистику, <strong>без изменения складских остатков</strong> (остатки берутся из загруженного CSV).
            </li>
            <li>
              <strong>Последующие выгрузки:</strong> Система будет проверять только последние транзакции, зачислять деньги на балансы авторов и <strong>автоматически списывать проданные остатки</strong> со склада.
            </li>
            <li>
              <strong>Защита от дублей:</strong> Повторные нажатия кнопки безопасны. Загруженные ранее чеки игнорируются.
            </li>
          </ul>
        </div>
      </div>

      {/* Панель управления */}
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 text-center">
        <CloudDownload size={48} className="mx-auto text-indigo-300 mb-4" />
        <h2 className="text-xl font-bold text-gray-800 mb-2">Готовность к загрузке</h2>
        <p className="text-gray-500 mb-6 max-w-md mx-auto">
          Нажмите на кнопку ниже, чтобы подключиться к Бизнес.Ру и получить новые данные о продажах.
        </p>
        
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="inline-flex items-center gap-2 px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-lg transition-all disabled:opacity-70 shadow-md hover:shadow-lg disabled:cursor-not-allowed"
        >
          {isSyncing ? (
            <>
              <RefreshCw className="animate-spin" size={24} />
              Обработка данных...
            </>
          ) : (
            <>
              <RefreshCw size={24} />
              Запустить синхронизацию
            </>
          )}
        </button>
      </div>

      {/* Блок ошибок */}
      {error && (
        <div className="bg-red-50 p-6 rounded-2xl border border-red-200 flex items-center gap-4 animate-in fade-in">
          <AlertTriangle className="text-red-500" size={32} />
          <div>
            <h3 className="font-bold text-red-900">Ошибка синхронизации</h3>
            <p className="text-red-700">{error}</p>
          </div>
        </div>
      )}

      {/* Результаты синхронизации */}
      {result && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
          
          <div className={`p-6 rounded-2xl border flex items-center gap-4 ${result.status === 'success' ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
            {result.status === 'success' ? (
              <CheckCircle className="text-green-600" size={32} />
            ) : (
              <AlertTriangle className="text-yellow-600" size={32} />
            )}
            <div>
              <h3 className={`font-bold text-lg ${result.status === 'success' ? 'text-green-900' : 'text-yellow-900'}`}>
                {result.message}
              </h3>
            </div>
          </div>

          {/* Статистика */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 text-center">
              <p className="text-sm font-medium text-gray-500 mb-1">Загружено новых чеков</p>
              <p className="text-3xl font-bold text-indigo-600">{result.processed_items}</p>
            </div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 text-center">
              <p className="text-sm font-medium text-gray-500 mb-1">Пропущено (уже в базе)</p>
              <p className="text-3xl font-bold text-gray-700">{result.skipped_checks}</p>
            </div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 text-center">
              <p className="text-sm font-medium text-gray-500 mb-1">Сумма новых продаж</p>
              <p className="text-3xl font-bold text-green-600">{result.total_revenue.toLocaleString('ru-RU')} ₽</p>
            </div>
          </div>

          {/* Мягкие уведомления о конфликтах (Задача 2 из раздела Финансы) */}
          {result.conflicts && result.conflicts.length > 0 && (
            <div className="bg-orange-50 p-6 rounded-2xl border border-orange-200">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="text-orange-600" size={24} />
                <h3 className="font-bold text-orange-900 text-lg">Обратите внимание: Конфликты перепривязки</h3>
              </div>
              <p className="text-orange-800 text-sm mb-4">
                Система обнаружила чеки, которые присутствуют в текущей выгрузке Бизнес.Ру, но ранее вы вручную изменили автора (владельца) для этих транзакций. Чтобы не сломать ваши ручные корректировки балансов, <strong>система не стала возвращать этих авторов к значениям по умолчанию</strong> из Бизнес.Ру.
              </p>
              <div className="bg-white rounded-lg border border-orange-100 overflow-hidden">
                <ul className="divide-y divide-orange-100 max-h-60 overflow-y-auto">
                  {result.conflicts.map((conflict, idx) => (
                    <li key={idx} className="p-3 text-sm flex gap-4">
                      <span className="font-mono text-gray-500 w-24 flex-shrink-0">Чек #{conflict.check_id}</span>
                      <span className="text-gray-800">{conflict.products}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

        </div>
      )}

    </div>
  );
};