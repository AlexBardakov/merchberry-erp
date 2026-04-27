// Файл: src/pages/InventoryLogs.tsx
import React, { useState, useEffect } from 'react';
import { ClipboardList, ArrowRight, Clock, ChevronLeft, ChevronRight, ChevronDown, Calendar, AlertCircle } from 'lucide-react';
import apiClient from '../api/axios';

interface InventoryLog {
  id: number;
  timestamp: string;
  action: string;
  product_name: string;
  product_sku: string;
  changes: any;
  actor: string;
}

export const InventoryLogs = () => {
  const [logs, setLogs] = useState<InventoryLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchLogs();
  }, [page]);

  // БЕЗОПАСНЫЙ ПАРСИНГ ДАТЫ (Защита от краша React)
  const safeDate = (ts: string | null | undefined): Date | null => {
    if (!ts) return null;
    try {
      const d = new Date(ts);
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  };

  const fetchLogs = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/audit/inventory?page=${page}&limit=50`);
      const items = response.data?.items || [];
      setLogs(items);
      setTotalPages(response.data?.pages || 1);
      setTotalItems(response.data?.total || 0);

      if (items.length > 0) {
        const d = safeDate(items[0].timestamp);
        if (d) {
          const firstDate = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
          setExpandedDates({ [firstDate]: true });
        }
      }
    } catch (err: any) {
      console.error("Ошибка загрузки логов:", err);
      setError("Не удалось загрузить историю. Проверьте соединение или логи сервера.");
    } finally {
      setIsLoading(false);
    }
  };

  const formatAction = (action: string) => {
    switch (action) {
      case 'import_update': return 'Обновление (Импорт)';
      case 'import_create': return 'Создание (Импорт)';
      case 'product_update': return 'Ручное изменение';
      default: return action;
    }
  };

  const formatTime = (dateString: string) => {
    const d = safeDate(dateString);
    return d ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '--:--';
  };

  // БЕЗОПАСНАЯ ГРУППИРОВКА
  const groupedLogs = (logs || []).reduce((acc, log) => {
    const d = safeDate(log.timestamp);
    if (!d) return acc;
    const dateKey = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(log);
    return acc;
  }, {} as Record<string, InventoryLog[]>);

  const toggleDate = (date: string) => {
    setExpandedDates(prev => ({ ...prev, [date]: !prev[date] }));
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <ClipboardList className="text-indigo-600" size={32} />
          Инвентаризация
        </h1>
        <p className="text-gray-500 mt-2">История изменений цен, остатков и привязок по дням. Всего записей: {totalItems}</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-full">
        {error ? (
          <div className="p-8 flex flex-col items-center justify-center text-red-500">
            <AlertCircle size={40} className="mb-2" />
            <p>{error}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            {isLoading ? (
               <div className="p-8 text-center text-gray-500">Загрузка данных...</div>
            ) : Object.keys(groupedLogs).length === 0 ? (
               <div className="p-8 text-center text-gray-500">История изменений пуста</div>
            ) : (
              <div className="flex flex-col">
                {Object.entries(groupedLogs).map(([date, dateLogs]) => (
                  <div key={date} className="border-b border-gray-100 last:border-0">
                    <div
                      className="p-4 bg-gray-50 flex items-center justify-between cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => toggleDate(date)}
                    >
                      <div className="flex items-center gap-3">
                        {expandedDates[date] ? <ChevronDown size={20} className="text-gray-500" /> : <ChevronRight size={20} className="text-gray-500" />}
                        <div className="flex items-center gap-2 font-medium text-gray-800">
                          <Calendar size={18} className="text-indigo-600" />
                          {date}
                        </div>
                      </div>
                      <span className="text-sm font-medium bg-white px-3 py-1 rounded-full border border-gray-200 text-gray-600 shadow-sm">
                        Изменений: {dateLogs.length}
                      </span>
                    </div>

                    {expandedDates[date] && (
                      <div className="bg-white px-2">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="text-gray-400 text-xs uppercase tracking-wider border-b border-gray-50">
                              <th className="p-3 font-medium w-[15%]">Время</th>
                              <th className="p-3 font-medium w-[35%]">Товар (Артикул)</th>
                              <th className="p-3 font-medium w-[20%]">Событие</th>
                              <th className="p-3 font-medium w-[30%]">Изменения</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {dateLogs.map((log) => (
                              <tr key={log.id} className="hover:bg-indigo-50/30 transition-colors">
                                <td className="p-3 text-sm text-gray-500 align-top">
                                  <div className="flex items-center gap-1.5 font-medium">
                                    <Clock size={14} className="text-gray-400" />
                                    {formatTime(log.timestamp)}
                                  </div>
                                  <div className="text-[10px] mt-1 text-gray-400">Автор: {log.actor || 'Система'}</div>
                                </td>
                                <td className="p-3 align-top">
                                  <div className="text-sm font-medium text-gray-900">{log.product_name || 'Удаленный товар'}</div>
                                  <div className="text-xs text-gray-400 mt-0.5">ID: {log.product_sku || 'N/A'}</div>
                                </td>
                                <td className="p-3 align-top">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                                    {formatAction(log.action)}
                                  </span>
                                </td>
                                <td className="p-3 text-sm align-top">
                                  <div className="space-y-1.5">
                                    {log.changes?.comment && (
                                      <div className="text-xs italic text-gray-500 mb-1 border-l-2 border-indigo-200 pl-2">
                                        "{String(log.changes.comment)}"
                                      </div>
                                    )}

                                    {log.changes?.admin_seller_change && (
                                      <div className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-orange-50 text-orange-700">
                                        {String(log.changes.admin_seller_change)}
                                      </div>
                                    )}

                                    {log.changes?.account_status && (
                                      <div className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700">
                                        {String(log.changes.account_status)}
                                      </div>
                                    )}

                                    {log.changes?.name && log.changes.name.old !== undefined && (
                                      <div className="flex flex-col gap-0.5 text-xs">
                                        <span className="text-gray-400 line-through">Из: {String(log.changes.name.old)}</span>
                                        <span className="font-bold text-gray-900">В: {String(log.changes.name.new)}</span>
                                      </div>
                                    )}

                                    {log.changes?.status === 'created' && (
                                      <div className="text-xs text-green-600 font-medium">✨ Товар впервые добавлен в систему</div>
                                    )}

                                    {log.changes?.initial_stock !== undefined && (
                                      <div className="text-xs text-gray-600">Начальный остаток: <span className="font-bold text-gray-900">{Number(log.changes.initial_stock)} шт.</span></div>
                                    )}

                                    {log.changes?.initial_price !== undefined && (
                                      <div className="text-xs text-gray-600">Начальная цена: <span className="font-bold text-indigo-600">{Number(log.changes.initial_price)}₽</span></div>
                                    )}

                                    {log.changes?.stock && log.changes.stock.old !== undefined && (
                                      <div className="flex items-center gap-2">
                                        <span className="text-gray-400 line-through text-xs">{Number(log.changes.stock.old)}</span>
                                        <ArrowRight size={12} className="text-gray-300" />
                                        <span className="font-bold text-gray-900">{Number(log.changes.stock.new)} шт.</span>
                                      </div>
                                    )}

                                    {((log.changes?.base_price && log.changes.base_price.old !== undefined) || (log.changes?.price && log.changes.price.old !== undefined)) && (
                                      <div className="flex items-center gap-2">
                                        <span className="text-gray-400 line-through text-xs">
                                          {Number(log.changes?.base_price?.old ?? log.changes?.price?.old)}₽
                                        </span>
                                        <ArrowRight size={12} className="text-gray-300" />
                                        <span className="font-bold text-indigo-600">
                                          {Number(log.changes?.base_price?.new ?? log.changes?.price?.new)}₽
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ПАГИНАЦИЯ */}
        {!isLoading && !error && totalPages > 1 && (
          <div className="p-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
            <p className="text-sm text-gray-500">
              Страница <span className="font-medium text-gray-900">{page}</span> из <span className="font-medium text-gray-900">{totalPages}</span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={20} className="text-gray-600" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={20} className="text-gray-600" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};