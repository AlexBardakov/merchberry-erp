// src/pages/Finance.tsx
import React, { useState, useEffect } from 'react';
import { Wallet, ArrowUpRight, ArrowDownRight, Plus, Receipt } from 'lucide-react';
import apiClient from '../api/axios';

interface Transaction {
  id: number;
  type: string;
  amount: number;
  commission_amount: number;
  date: string;
  comment: string | null;
  seller_id: number;
  product_identifier: string | null;
}

interface Seller {
  id: number;
  username: string;
  balance: number;
}

export const Finance = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Состояния для модального окна Админа
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    seller_id: '',
    type: 'payout',
    amount: '',
    comment: ''
  });

  const userRole = localStorage.getItem('userRole');
  const isAdmin = userRole === 'admin';

  useEffect(() => {
    fetchTransactions();
    if (isAdmin) fetchSellers();
  }, []);

  const fetchTransactions = async () => {
    try {
      setIsLoading(true);
      // Бэкенд сам поймет по токену, чьи транзакции отдавать (все или только свои)
      const res = await apiClient.get('/transactions/');
      setTransactions(res.data);
    } catch (error) {
      console.error("Ошибка загрузки транзакций:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSellers = async () => {
    try {
      const res = await apiClient.get('/users/');
      setSellers(res.data.filter((u: any) => u.role === 'seller'));
    } catch (error) {
      console.error("Ошибка загрузки продавцов:", error);
    }
  };

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.seller_id || !formData.amount) return;

    try {
      await apiClient.post('/transactions/', {
        seller_id: parseInt(formData.seller_id),
        type: formData.type,
        // Для выплат и аренды отправляем отрицательное число (списываем с баланса)
        // Для корректировок оставляем как ввел пользователь
        amount: formData.type === 'correction' ? parseFloat(formData.amount) : -Math.abs(parseFloat(formData.amount)),
        comment: formData.comment
      });

      alert("Транзакция успешно проведена!");
      setIsModalOpen(false);
      setFormData({ seller_id: '', type: 'payout', amount: '', comment: '' });
      fetchTransactions(); // Обновляем таблицу
    } catch (error) {
      alert("Ошибка при создании транзакции.");
    }
  };

  // Вспомогательная функция для красивого отображения типа операции
  const getTransactionTypeInfo = (type: string) => {
    switch(type) {
      case 'sale': return { label: 'Продажа', color: 'text-green-600', bg: 'bg-green-100', icon: <ArrowUpRight size={16} /> };
      case 'payout': return { label: 'Выплата', color: 'text-blue-600', bg: 'bg-blue-100', icon: <ArrowDownRight size={16} /> };
      case 'rent': return { label: 'Аренда полки', color: 'text-orange-600', bg: 'bg-orange-100', icon: <ArrowDownRight size={16} /> };
      case 'correction': return { label: 'Корректировка', color: 'text-purple-600', bg: 'bg-purple-100', icon: <Wallet size={16} /> };
      default: return { label: 'Операция', color: 'text-gray-600', bg: 'bg-gray-100', icon: <Receipt size={16} /> };
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Финансовая история</h1>
          <p className="text-gray-500 mt-1">Все операции: продажи, выплаты, аренда</p>
        </div>

        {/* Кнопка доступна ТОЛЬКО Админу */}
        {isAdmin && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors"
          >
            <Plus size={18} />
            Создать операцию
          </button>
        )}
      </div>

      {/* ТАБЛИЦА ТРАНЗАКЦИЙ */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Загрузка данных...</div>
        ) : transactions.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center">
            <Receipt className="w-12 h-12 text-gray-300 mb-3" />
            <p className="text-gray-500 text-lg">История операций пуста</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="p-4 text-sm font-semibold text-gray-600">Дата и Время</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Тип</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Сумма</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Детали</th>
                {isAdmin && <th className="p-4 text-sm font-semibold text-gray-600">Продавец (ID)</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transactions.map((txn) => {
                const typeInfo = getTransactionTypeInfo(txn.type);
                return (
                  <tr key={txn.id} className="hover:bg-gray-50">
                    <td className="p-4 text-sm text-gray-600">
                      {new Date(txn.date).toLocaleString('ru-RU', {
                        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                      })}
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold ${typeInfo.bg} ${typeInfo.color}`}>
                        {typeInfo.icon} {typeInfo.label}
                      </span>
                    </td>
                    <td className={`p-4 text-sm font-bold ${txn.amount > 0 ? 'text-green-600' : 'text-gray-900'}`}>
                      {txn.amount > 0 ? '+' : ''}{txn.amount.toLocaleString('ru-RU')} ₽
                      {txn.commission_amount > 0 && (
                        <span className="block text-xs font-normal text-gray-400">
                          (Комиссия: {txn.commission_amount} ₽)
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-sm text-gray-700">
                      {txn.product_identifier && <span className="font-medium">{txn.product_identifier}</span>}
                      {txn.comment && <span className="block text-xs text-gray-500 italic">{txn.comment}</span>}
                      {!txn.product_identifier && !txn.comment && '—'}
                    </td>
                    {isAdmin && (
                      <td className="p-4 text-sm text-gray-600 font-medium">
                        ID: {txn.seller_id}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* МОДАЛЬНОЕ ОКНО СОЗДАНИЯ ТРАНЗАКЦИИ (Только для Админа) */}
      {isAdmin && isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl animate-in fade-in zoom-in-95">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Новая операция</h2>

            <form onSubmit={handleCreateTransaction} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Кому (Автор) *</label>
                <select
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500"
                  value={formData.seller_id}
                  onChange={(e) => setFormData({...formData, seller_id: e.target.value})}
                >
                  <option value="" disabled>Выберите продавца...</option>
                  {sellers.map(s => (
                    <option key={s.id} value={s.id}>{s.username} (Баланс: {s.balance} ₽)</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Тип операции *</label>
                <select
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500"
                  value={formData.type}
                  onChange={(e) => setFormData({...formData, type: e.target.value})}
                >
                  <option value="payout">Выплата продавцу на карту (Списание с баланса)</option>
                  <option value="rent">Оплата аренды полки (Списание с баланса)</option>
                  <option value="correction">Ручная корректировка (+ или -)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Сумма (₽) *</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500"
                  value={formData.amount}
                  onChange={(e) => setFormData({...formData, amount: e.target.value})}
                  placeholder="Например: 1500"
                />
                {formData.type !== 'correction' && (
                  <p className="text-xs text-orange-600 mt-1">Эта сумма будет вычтена из баланса продавца.</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Комментарий (Период или чек)</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500"
                  value={formData.comment}
                  onChange={(e) => setFormData({...formData, comment: e.target.value})}
                  placeholder="Аренда за Апрель / Перевод на Сбер"
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium transition-colors"
                >
                  Провести
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};