// src/pages/Finance.tsx
import React, { useState, useEffect } from 'react';
import { Wallet, ArrowUpRight, ArrowDownRight, Plus, Receipt, Filter, X } from 'lucide-react';
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

  // Пагинация
  const [page, setPage] = useState(1);
  const limit = 50;
  const [hasMore, setHasMore] = useState(true);

  // Фильтры
  const [sellerFilter, setSellerFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date_desc');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

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

  // Загружаем данные при изменении страницы или любых фильтров
  useEffect(() => {
    fetchTransactions();
    if (isAdmin && sellers.length === 0) fetchSellers();
  }, [page, sellerFilter, typeFilter, sortBy, startDate, endDate]);
  // Примечание: minAmount и maxAmount будем применять по кнопке или onBlur, чтобы не спамить запросы при вводе цифр

  const fetchTransactions = async () => {
    try {
      setIsLoading(true);
      const offset = (page - 1) * limit;

      // Формируем объект параметров, отбрасывая пустые значения
      const params: any = { limit, offset, sort_by: sortBy };
      if (sellerFilter && sellerFilter !== 'all') params.seller_id = sellerFilter;
      if (typeFilter !== 'all') params.type_filter = typeFilter;
      if (startDate) params.start_date = `${startDate}T00:00:00`;
      if (endDate) params.end_date = `${endDate}T23:59:59`;
      if (minAmount) params.min_amount = parseFloat(minAmount);
      if (maxAmount) params.max_amount = parseFloat(maxAmount);

      const res = await apiClient.get('/transactions/', { params });
      setTransactions(res.data);
      setHasMore(res.data.length === limit);
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

  const clearFilters = () => {
    setSellerFilter('');
    setTypeFilter('all');
    setSortBy('date_desc');
    setStartDate('');
    setEndDate('');
    setMinAmount('');
    setMaxAmount('');
    setPage(1);
    // fetchTransactions вызовется автоматически из-за изменения state в useEffect
  };

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.seller_id || !formData.amount) return;

    try {
      await apiClient.post('/transactions/', {
        seller_id: parseInt(formData.seller_id),
        type: formData.type,
        amount: formData.type === 'correction' ? parseFloat(formData.amount) : -Math.abs(parseFloat(formData.amount)),
        comment: formData.comment
      });

      alert("Транзакция успешно проведена!");
      setIsModalOpen(false);
      setFormData({ seller_id: '', type: 'payout', amount: '', comment: '' });
      fetchTransactions();
    } catch (error) {
      alert("Ошибка при создании транзакции.");
    }
  };

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
          <p className="text-gray-500 mt-1">Отслеживание продаж, выплат и аренды</p>
        </div>

        {isAdmin && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors shadow-sm"
          >
            <Plus size={18} />
            Создать операцию
          </button>
        )}
      </div>

      {/* ПАНЕЛЬ ФИЛЬТРОВ */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Filter size={18} className="text-indigo-600" />
          <h3 className="font-semibold text-gray-800">Фильтры и сортировка</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {isAdmin && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Продавец</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
                value={sellerFilter} onChange={(e) => { setSellerFilter(e.target.value); setPage(1); }}
              >
                <option value="">Все авторы</option>
                {sellers.map(s => <option key={s.id} value={s.id}>{s.username}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Тип операции</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
              value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            >
              <option value="all">Все типы</option>
              <option value="sale">Только Продажи</option>
              <option value="payout">Выплаты авторам</option>
              <option value="rent">Оплата аренды</option>
              <option value="correction">Корректировки</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Сортировка</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
              value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
            >
              <option value="date_desc">Сначала новые</option>
              <option value="date_asc">Сначала старые</option>
              <option value="amount_desc">Сначала крупные суммы</option>
              <option value="amount_asc">Сначала мелкие суммы</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-red-600 transition-colors px-2 py-2"
            >
              <X size={16} /> Сбросить всё
            </button>
          </div>
        </div>

        {/* Дополнительные фильтры: Период и Сумма */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600 w-16">Период:</span>
            <input
              type="date"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
              value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            />
            <span className="text-gray-400">—</span>
            <input
              type="date"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
              value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600 w-16">Сумма:</span>
            <input
              type="number" placeholder="От (₽)"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
              value={minAmount} onChange={(e) => setMinAmount(e.target.value)} onBlur={() => fetchTransactions()}
            />
            <span className="text-gray-400">—</span>
            <input
              type="number" placeholder="До (₽)"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
              value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} onBlur={() => fetchTransactions()}
            />
          </div>
        </div>
      </div>

      {/* ТАБЛИЦА ТРАНЗАКЦИЙ */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
        {isLoading && <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div></div>}

        {transactions.length === 0 && !isLoading ? (
          <div className="p-12 text-center flex flex-col items-center">
            <Receipt className="w-12 h-12 text-gray-300 mb-3" />
            <p className="text-gray-500 text-lg">По вашему запросу операций не найдено</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="p-4 text-sm font-semibold text-gray-600">Дата и Время</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Тип</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Сумма</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Детали</th>
                {isAdmin && <th className="p-4 text-sm font-semibold text-gray-600">Продавец</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transactions.map((txn) => {
                const typeInfo = getTransactionTypeInfo(txn.type);
                return (
                  <tr key={txn.id} className="hover:bg-gray-50 transition-colors">
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
                        <span className="block text-[11px] font-normal text-gray-400 mt-0.5">
                          Комиссия: {txn.commission_amount} ₽
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-sm text-gray-700">
                      {txn.product_identifier && <span className="font-medium text-gray-900">{txn.product_identifier}</span>}
                      {txn.comment && <span className="block text-xs text-gray-500 italic mt-0.5">{txn.comment}</span>}
                      {!txn.product_identifier && !txn.comment && <span className="text-gray-400">—</span>}
                    </td>
                    {isAdmin && (
                      <td className="p-4 text-sm text-indigo-600 font-medium">
                        {sellers.find(s => s.id === txn.seller_id)?.username || `ID: ${txn.seller_id}`}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* ПАГИНАЦИЯ */}
        <div className="p-4 border-t border-gray-100 flex items-center justify-between bg-white">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
            ← Назад
          </button>
          <span className="text-sm text-gray-500">Страница {page}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={!hasMore} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
            Вперед →
          </button>
        </div>
      </div>

      {/* МОДАЛЬНОЕ ОКНО СОЗДАНИЯ ТРАНЗАКЦИИ */}
      {isAdmin && isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Новая операция</h2>
            <form onSubmit={handleCreateTransaction} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Кому (Автор) *</label>
                <select
                  required className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500"
                  value={formData.seller_id} onChange={(e) => setFormData({...formData, seller_id: e.target.value})}
                >
                  <option value="" disabled>Выберите продавца...</option>
                  {sellers.map(s => <option key={s.id} value={s.id}>{s.username} (Баланс: {s.balance} ₽)</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Тип операции *</label>
                <select
                  required className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500"
                  value={formData.type} onChange={(e) => setFormData({...formData, type: e.target.value})}
                >
                  <option value="payout">Выплата продавцу на карту (Списание с баланса)</option>
                  <option value="rent">Оплата аренды полки (Списание с баланса)</option>
                  <option value="correction">Ручная корректировка (+ или -)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Сумма (₽) *</label>
                <input
                  required type="number" step="0.01" placeholder="Например: 1500"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500"
                  value={formData.amount} onChange={(e) => setFormData({...formData, amount: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Комментарий</label>
                <input
                  type="text" placeholder="Аренда за Апрель / Перевод на Сбер"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500"
                  value={formData.comment} onChange={(e) => setFormData({...formData, comment: e.target.value})}
                />
              </div>
              <div className="flex gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium">Отмена</button>
                <button type="submit" className="flex-1 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium">Провести</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};