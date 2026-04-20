import React, { useState } from 'react';
import { RefreshCw, Server, AlertTriangle, CheckCircle, ArrowRight } from 'lucide-react';
import apiClient from '../api/axios';

export const Sync = () => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [error, setError] = useState('');

  const handleSync = async () => {
    setIsSyncing(true);
    setError('');
    setSyncResult(null);

    try {
      const res = await apiClient.post('/transactions/sync/sales');
      setSyncResult(res.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Ошибка при синхронизации. Проверьте консоль сервера.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col items-center text-center space-y-4 mb-8">
        <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center">
          <Server size={32} />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Синхронизация Бизнес.Ру</h1>
          <p className="text-gray-500 mt-2 max-w-lg mx-auto">
            Обновление данных о продажах. Система загрузит новые чеки, найдет товары по артикулам и автоматически распределит прибыль по балансам авторов.
          </p>
        </div>
      </div>

      <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center">

        <button
          onClick={handleSync}
          disabled={isSyncing}
          className={`flex items-center gap-3 px-8 py-4 rounded-xl text-lg font-bold text-white transition-all shadow-md
            ${isSyncing ? 'bg-indigo-400 cursor-not-allowed scale-95' : 'bg-indigo-600 hover:bg-indigo-700 hover:scale-105'}
          `}
        >
          <RefreshCw size={24} className={isSyncing ? 'animate-spin' : ''} />
          {isSyncing ? 'Связь с API...' : 'Запустить синхронизацию'}
        </button>

        <p className="text-sm text-gray-400 mt-4">
          Последняя автоматическая синхронизация: <strong>Вчера в 23:59</strong>
        </p>

        {/* БЛОК С ОШИБКОЙ */}
        {error && (
          <div className="mt-8 p-4 bg-red-50 text-red-700 rounded-xl border border-red-100 flex items-start gap-3 w-full animate-in fade-in">
            <AlertTriangle className="shrink-0 mt-0.5" />
            <p className="font-medium">{error}</p>
          </div>
        )}

        {/* БЛОК С РЕЗУЛЬТАТАМИ */}
        {syncResult && (
          <div className="mt-8 w-full animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-green-50 border border-green-100 rounded-2xl p-6">
              <div className="flex items-center gap-2 text-green-800 mb-4">
                <CheckCircle size={24} />
                <h3 className="text-lg font-bold">Успешно обработано!</h3>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-xl border border-green-100 shadow-sm text-center">
                  <p className="text-3xl font-bold text-gray-900">{syncResult.processed_items}</p>
                  <p className="text-xs text-gray-500 uppercase tracking-wider font-bold mt-1">Новых позиций</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-green-100 shadow-sm text-center">
                  <p className="text-3xl font-bold text-gray-900">{syncResult.skipped_checks}</p>
                  <p className="text-xs text-gray-500 uppercase tracking-wider font-bold mt-1">Пропущено (Дубли)</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-green-100 shadow-sm text-center">
                  <p className="text-3xl font-bold text-indigo-600">{syncResult.total_revenue.toLocaleString('ru-RU')} ₽</p>
                  <p className="text-xs text-indigo-400 uppercase tracking-wider font-bold mt-1">Оборот</p>
                </div>
              </div>

              <div className="mt-6 flex justify-center">
                <a href="/finance" className="flex items-center gap-1 text-sm font-bold text-green-700 hover:text-green-800 transition-colors">
                  Посмотреть новые операции в Финансах <ArrowRight size={16} />
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};