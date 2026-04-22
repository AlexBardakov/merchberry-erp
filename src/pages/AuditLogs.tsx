import React, { useEffect, useState } from 'react';
import apiClient from '../api/axios';
import { Clock, User, Package, FileText } from 'lucide-react';

interface AuditLog {
  id: number;
  timestamp: string;
  actor: string;
  entity_name: string;
  entity_id: number;
  action: string;
  changes: any;
}

export const AuditLogs = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiClient.get('/audit/')
      .then(res => setLogs(res.data))
      .catch(err => console.error("Ошибка загрузки логов:", err))
      .finally(() => setIsLoading(false));
  }, []);

  const renderChanges = (changes: any) => {
    return Object.entries(changes).map(([key, val]: [string, any]) => (
      <div key={key} className="text-xs bg-gray-50 p-2 rounded mt-1 border border-gray-100">
        <span className="font-semibold text-gray-600">{key}:</span> {val.old} → <span className="text-indigo-600 font-bold">{val.new}</span>
      </div>
    ));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">История изменений</h1>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center text-gray-400">Загрузка истории...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="p-4 text-sm font-semibold text-gray-600">Дата и время</th>
                  <th className="p-4 text-sm font-semibold text-gray-600">Кто изменил</th>
                  <th className="p-4 text-sm font-semibold text-gray-600">Сущность</th>
                  <th className="p-4 text-sm font-semibold text-gray-600">Изменения</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="p-4 text-sm text-gray-500 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString('ru-RU')}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg"><User size={14}/></div>
                        <span className="text-sm font-medium text-gray-900">{log.actor}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                        {log.entity_name} #{log.entity_id}
                      </span>
                    </td>
                    <td className="p-4">
                      {renderChanges(log.changes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};