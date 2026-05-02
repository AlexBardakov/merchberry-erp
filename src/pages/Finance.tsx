// src/pages/Finance.tsx
import React, { useState, useEffect } from 'react';
import { Wallet, ArrowUpRight, ArrowDownRight, Plus, Receipt, Filter, X, AlertTriangle, Edit2 } from 'lucide-react';
import apiClient from '../api/axios';

interface Transaction {
  id: number;
  type: string;
  full_amount: number;
  amount: number;
  commission_amount: number;
  date: string;
  comment: string | null;
  seller_id: number | null;
  product_identifier: string | null;
  is_manual_assigned: boolean;
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
  const [sellerFilter, setSellerFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date_desc');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  // Массовые действия
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkAssignSellerId, setBulkAssignSellerId] = useState('');

  // Модальное окно Админа
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ seller_id: '', type: 'payout', amount: '', comment: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Стейты для окна редактирования
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editFormData, setEditFormData] = useState({ id: 0, seller_id: '', product_identifier: '', comment: '' });

  const openEditModal = (txn: Transaction) => {
    setEditFormData({
      id: txn.id,
      seller_id: txn.seller_id ? txn.seller_id.toString() : 'unassigned',
      product_identifier: txn.product_identifier || '',
      comment: txn.comment || ''
    });
    setIsEditModalOpen(true);
  };

  const handleUpdateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.patch(`/transactions/${editFormData.id}`, {
        seller_id: editFormData.seller_id === 'unassigned' ? null : parseInt(editFormData.seller_id),
        product_identifier: editFormData.product_identifier,
        comment: editFormData.comment
      });
      alert("Чек успешно обновлен!");
      setIsEditModalOpen(false);
      fetchTransactions();
    } catch (error) {
      alert("Ошибка при обновлении транзакции.");
    }
  };

  const userRole = localStorage.getItem('userRole');
  const isAdmin = userRole === 'admin';

  useEffect(() => {
    setSelectedIds([]); // Сбрасываем выбор при смене страницы/фильтров
    fetchTransactions();
    if (isAdmin && sellers.length === 0) fetchSellers();
  }, [page, sellerFilter, typeFilter, sortBy, startDate, endDate]);

  const fetchTransactions = async () => {
    try {
      setIsLoading(true);
      const offset = (page - 1) * limit;
      const params: any = { limit, offset, sort_by: sortBy };
      if (sellerFilter && sellerFilter !== 'all') params.seller_filter = sellerFilter;
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
      const filteredAndSorted = res.data
        .filter((u: any) => u.role === 'seller')
        .sort((a: any, b: any) => a.username.localeCompare(b.username)); // Сортировка А-Я
      setSellers(filteredAndSorted);
    } catch (error) {
      console.error("Ошибка загрузки продавцов:", error);
    }
  };

  const clearFilters = () => {
    setSellerFilter('all'); setTypeFilter('all'); setSortBy('date_desc');
    setStartDate(''); setEndDate(''); setMinAmount(''); setMaxAmount(''); setPage(1);
  };

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.seller_id || !formData.amount) return;
    if (isSubmitting) return; // Защита от двойного клика

    setIsSubmitting(true);
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
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- МАССОВЫЕ ДЕЙСТВИЯ (Перепривязка чеков) ---
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) setSelectedIds(transactions.filter(t => t.type === 'sale').map(t => t.id));
    else setSelectedIds([]);
  };

  const handleSelectOne = (id: number, checked: boolean) => {
    if (checked) setSelectedIds([...selectedIds, id]);
    else setSelectedIds(selectedIds.filter(itemId => itemId !== id));
  };

  const handleBulkAssign = async () => {
    const isUnassigned = bulkAssignSellerId === 'unassigned';
    if (!bulkAssignSellerId && !isUnassigned) return alert("Выберите продавца для привязки");

    if (!window.confirm(`Перепривязать ${selectedIds.length} транзакций? Балансы авторов будут пересчитаны автоматически.`)) return;

    try {
      await apiClient.post('/transactions/bulk-reassign', {
        transaction_ids: selectedIds,
        new_seller_id: isUnassigned ? null : parseInt(bulkAssignSellerId)
      });
      setSelectedIds([]);
      setBulkAssignSellerId('');
      fetchTransactions();
    } catch (error) {
      alert("Произошла ошибка при массовой привязке");
    }
  };

const getTransactionTypeInfo = (type: string) => {
    switch(type) {
      case 'sale': return { label: 'Продажа', color: 'text-green-600', bg: 'bg-green-100', icon: <ArrowUpRight size={16} /> };
      case 'return': return { label: 'Возврат товара', color: 'text-red-600', bg: 'bg-red-100', icon: <ArrowDownRight size={16} /> }; // <--- НОВАЯ СТРОКА
      case 'payout': return { label: 'Выплата', color: 'text-blue-600', bg: 'bg-blue-100', icon: <ArrowDownRight size={16} /> };
      case 'rent':
      case 'rent_balance':
        return { label: 'Аренда (Баланс)', color: 'text-orange-600', bg: 'bg-orange-100', icon: <ArrowDownRight size={16} /> };
      case 'rent_own':
        return { label: 'Аренда (Личные)', color: 'text-orange-600', bg: 'bg-orange-100', icon: <ArrowDownRight size={16} /> };
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
          <button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors shadow-sm">
            <Plus size={18} /> Создать операцию
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
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500" value={sellerFilter} onChange={(e) => { setSellerFilter(e.target.value); setPage(1); }}>
                <option value="all">Все авторы</option>
                <option value="unassigned">⚠️ Нераспределенные (Ничейные)</option>
                {sellers.map(s => <option key={s.id} value={s.id}>{s.username}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Тип операции</label>
            <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
              <option value="all">Все типы</option>
              <option value="sale">Только Продажи</option>
              <option value="payout">Выплаты авторам</option>
              <option value="rent_all">Оплата аренды (Все)</option>
              <option value="correction">Корректировки</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Сортировка</label>
            <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500" value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPage(1); }}>
              <option value="date_desc">Сначала новые</option>
              <option value="date_asc">Сначала старые</option>
              <option value="amount_desc">Сначала крупные суммы</option>
              <option value="amount_asc">Сначала мелкие суммы</option>
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={clearFilters} className="flex items-center gap-1 text-sm text-gray-500 hover:text-red-600 transition-colors px-2 py-2">
              <X size={16} /> Сбросить всё
            </button>
          </div>
        </div>
      </div>

      {/* ПАНЕЛЬ ПЕРЕПРИВЯЗКИ ЧЕКОВ */}
      {selectedIds.length > 0 && isAdmin && (
        <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-200 flex items-center justify-between animate-in fade-in slide-in-from-top-2">
          <span className="font-bold text-indigo-800">Выбрано продаж: {selectedIds.length}</span>
          <div className="flex items-center gap-3">
            <span className="text-sm text-indigo-700">Перепривязать к:</span>
            <select
              className="border border-indigo-200 rounded text-sm px-2 py-1 outline-none"
              value={bulkAssignSellerId} onChange={(e) => setBulkAssignSellerId(e.target.value)}
            >
              <option value="" disabled>Выберите продавца...</option>
              <option value="unassigned">Отвязать (Сделать ничейным)</option>
              {sellers.map(s => <option key={s.id} value={s.id}>{s.username}</option>)}
            </select>
            <button onClick={handleBulkAssign} className="px-3 py-1 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700">Применить</button>
          </div>
        </div>
      )}

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
                {isAdmin && (
                  <th className="p-4 w-12">
                    <input type="checkbox" className="rounded text-indigo-600 focus:ring-indigo-500" onChange={handleSelectAll} checked={transactions.filter(t => t.type === 'sale').length > 0 && selectedIds.length === transactions.filter(t => t.type === 'sale').length} />
                  </th>
                )}
                <th className="p-4 text-sm font-semibold text-gray-600">Дата</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Тип</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Сумма (Доход)</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Детали</th>
                {isAdmin && <th className="p-4 text-sm font-semibold text-gray-600">Владелец чека</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transactions.map((txn, index) => { // ДОБАВИЛИ index
                const typeInfo = getTransactionTypeInfo(txn.type);
                const isSelected = selectedIds.includes(txn.id);

                // Настраиваем зебру через index
                const rowBg = index % 2 === 0 ? 'bg-white hover:bg-gray-50' : 'bg-gray-50/40 hover:bg-gray-100';

                return (
                  <tr key={txn.id} className={`transition-colors ${isSelected ? 'bg-indigo-50/30' : rowBg}`}>
                    {isAdmin && (
                      <td className="p-4">
                        {txn.type === 'sale' && (
                          <input type="checkbox" className="rounded text-indigo-600 focus:ring-indigo-500" checked={isSelected} onChange={(e) => handleSelectOne(txn.id, e.target.checked)} />
                        )}
                      </td>
                    )}
                    <td className="p-4 text-sm text-gray-600">
                      {new Date(txn.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold ${typeInfo.bg} ${typeInfo.color}`}>
                        {typeInfo.icon} {typeInfo.label}
                      </span>
                      {txn.is_manual_assigned && <span className="block text-[10px] text-gray-400 mt-1" title="Ручная корректировка автора">✍️ Перепривязано</span>}
                    </td>
                    <td className="p-4">
                      <div className={`text-sm font-bold ${txn.amount > 0 ? 'text-green-600' : 'text-gray-900'}`}>
                        {txn.amount > 0 ? '+' : ''}{txn.amount.toLocaleString('ru-RU')} ₽
                      </div>
                      {txn.type === 'sale' && (
                        <div className="text-[11px] text-gray-500 mt-0.5">
                          Полная: {txn.full_amount} ₽ | Ком: {txn.commission_amount} ₽
                        </div>
                      )}
                    </td>
                    <td className="p-4 text-sm text-gray-700">
                      {txn.product_identifier && <span className="font-medium text-gray-900">{txn.product_identifier}</span>}
                      {txn.comment && <span className="block text-xs text-gray-500 italic mt-0.5">{txn.comment}</span>}
                    </td>
                    {isAdmin && (
                      <td className="p-4 relative group">
                        <div className="flex items-center justify-between">
                          <div>
                            {txn.seller_id ? (
                              <span className="text-sm text-indigo-600 font-medium">{sellers.find(s => s.id === txn.seller_id)?.username}</span>
                            ) : (
                              <span className="text-sm font-bold text-orange-600 flex items-center gap-1"><AlertTriangle size={14}/> Ничейный</span>
                            )}
                          </div>

                          {/* Кнопка редактирования (появляется при наведении) */}
                          <button
                            onClick={() => openEditModal(txn)}
                            className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                            title="Изменить чек"
                          >
                            <Edit2 size={16} />
                          </button>
                        </div>
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
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            ← Назад
          </button>
          <span className="text-sm text-gray-500">Страница {page}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={!hasMore}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
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
                  <option value="rent_balance">Оплата аренды полки (Списание с баланса)</option>
                  <option value="rent_own">Оплата аренды полки (Аренда со своих средств)</option>
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
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium disabled:opacity-50">
                  {isSubmitting ? 'Обработка...' : 'Провести'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ТРАНЗАКЦИИ */}
      {isAdmin && isEditModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Редактирование чека #{editFormData.id}</h2>
            <form onSubmit={handleUpdateTransaction} className="space-y-4">

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Привязка к автору</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500"
                  value={editFormData.seller_id} onChange={(e) => setEditFormData({...editFormData, seller_id: e.target.value})}
                >
                  <option value="unassigned" className="text-orange-600 font-bold">⚠️ Ничейный (Отвязать)</option>
                  {sellers.map(s => <option key={s.id} value={s.id}>{s.username}</option>)}
                </select>
                <p className="text-[11px] text-gray-500 mt-1">При изменении автора балансы будут пересчитаны автоматически.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Состав чека (Товары)</label>
                <textarea
                  rows={3}
                  placeholder="Например: Значок (1 шт.), Кружка (2 шт.)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 resize-none text-sm"
                  value={editFormData.product_identifier} onChange={(e) => setEditFormData({...editFormData, product_identifier: e.target.value})}
                />
                <p className="text-[11px] text-gray-500 mt-1">Здесь можно переписать "Неизвестный товар" на реальные названия.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Комментарий</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 text-sm"
                  value={editFormData.comment} onChange={(e) => setEditFormData({...editFormData, comment: e.target.value})}
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="flex-1 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium">Отмена</button>
                <button type="submit" className="flex-1 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium">Сохранить изменения</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};