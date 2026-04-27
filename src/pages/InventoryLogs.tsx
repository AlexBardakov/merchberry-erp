import React, { useState, useEffect } from 'react';
import { ClipboardList, ArrowRight, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
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
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  useEffect(() => {
    fetchLogs();
  }, [page]);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const response = await apiClient.get(`/audit/inventory?page=${page}&limit=50`);
      setLogs(response.data.items || []);
      setTotalPages(response.data.pages || 1);
      setTotalItems(response.data.total || 0);
    } catch (error) {
      console.error("Ошибка загрузки логов:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatAction = (action: string) => {
    switch (action) {
      case 'import_update': return 'Обновление со склада';
      case 'manual_edit': return 'Ручное изменение';
      case 'create': return 'Создание товара';
      case 'manual_reassign': return 'Смена владельца';
      default: return action;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <ClipboardList className="text-indigo-600" size={32} />
            Инвентаризация
          </h1>
          <p className="text-gray-500 mt-2">История изменений цен и остатков. Всего записей: {totalItems}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-full">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-sm border-b border-gray-100">
                <th className="p-4 font-medium">Дата и время</th>
                <th className="p-4 font-medium">Товар (Артикул)</th>
                <th className="p-4 font-medium">Событие</th>
                <th className="p-4 font-medium">Изменения</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr><td colSpan={4} className="p-8 text-center text-gray-500">Загрузка данных...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={4} className="p-8 text-center text-gray-500">История изменений пуста</td></tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="p-4 text-sm text-gray-500">
                      <div className="flex items-center gap-2">
                        <Clock size={14} />
                        {formatDate(log.timestamp)}
                      </div>
                      <div className="text-[10px] mt-1 text-gray-400">Автор: {log.actor}</div>
                    </td>
                    <td className="p-4">
                      <div className="text-sm font-medium text-gray-900">{log.product_name}</div>
                      <div className="text-xs text-gray-500">ID: {log.product_sku}</div>
                    </td>
                    <td className="p-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                        {formatAction(log.action)}
                      </span>
                    </td>
                    <td className="p-4 text-sm">
                      <div className="space-y-1">

                        {/* Админ: Смена владельца */}
                        {log.changes?.admin_seller_change && (
                          <div className="inline-flex items-center px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider bg-orange-50 text-orange-700 mb-1">
                            {log.changes.admin_seller_change}
                          </div>
                        )}

                        {/* Продавец: Смена статуса */}
                        {log.changes?.account_status && (
                          <div className="inline-flex items-center px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 mb-1">
                            {log.changes.account_status}
                          </div>
                        )}

                        {log.changes?.stock && log.changes.stock.old !== undefined && (
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400 line-through text-xs">{log.changes.stock.old}</span>
                            <ArrowRight size={12} className="text-gray-300" />
                            <span className="font-bold text-gray-900">{log.changes.stock.new} шт.</span>
                          </div>
                        )}

                        {log.changes?.price && log.changes.price.old !== undefined && (
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400 line-through text-xs">{log.changes.price.old}₽</span>
                            <ArrowRight size={12} className="text-gray-300" />
                            <span className="font-bold text-indigo-600">{log.changes.price.new}₽</span>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ПАГИНАЦИЯ */}
        {!isLoading && totalPages > 1 && (
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