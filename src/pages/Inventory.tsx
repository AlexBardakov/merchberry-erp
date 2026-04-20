// src/pages/Inventory.tsx
import React, { useState, useEffect } from 'react';
import { UploadCloud, CheckCircle, AlertTriangle, Package, Search, Edit2, Save, X, Archive, RefreshCw } from 'lucide-react';
import apiClient from '../api/axios';

// Типизация
interface Product {
  id: number;
  sku: string | null;
  name: string;
  base_price: number;
  stock: number;
  seller_id: number | null;
  is_obsolete?: boolean; // Добавлено для архива
}

interface Seller {
  id: number;
  username: string;
  full_name: string | null;
}

export const Inventory = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Пагинация
  const [page, setPage] = useState(1);
  const limit = 50;
  const [hasMore, setHasMore] = useState(true);

  // Фильтры и Поиск
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('name_asc');
  const [sellerFilter, setSellerFilter] = useState('all'); // 'all', 'unassigned', или ID
  const [includeObsolete, setIncludeObsolete] = useState(false);

  // Состояния для импорта (Оригинальные)
  const [importFile, setImportFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Инлайн-редактирование
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: '', base_price: 0, stock: 0 });

  // Массовые действия
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkAssignSellerId, setBulkAssignSellerId] = useState('');

  const userRole = localStorage.getItem('userRole');
  const isAdmin = userRole === 'admin';

  // Загрузка данных
  useEffect(() => {
    // Сбрасываем выделение при смене страницы или фильтров
    setSelectedIds([]);
    fetchProducts();
    if (isAdmin && sellers.length === 0) fetchSellers();
  }, [page, sortBy, includeObsolete, sellerFilter]);
  // Примечание: searchQuery обрабатываем по кнопке или с задержкой (пока сделаем обновление по Enter/Blur)

  const fetchProducts = async () => {
    try {
      setIsLoading(true);
      const offset = (page - 1) * limit;
      // Отправляем все параметры на бэкенд
      const res = await apiClient.get('/products/', {
        params: {
          limit, offset, sort_by: sortBy, include_obsolete: includeObsolete,
          search: searchQuery, seller_filter: sellerFilter
        }
      });
      setProducts(res.data);
      setHasMore(res.data.length === limit);
    } catch (error) {
      console.error("Ошибка загрузки товаров:", error);
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

  // --- ЛОГИКА ИМПОРТА CSV (БЕЗ ИЗМЕНЕНИЙ) ---
  const handlePreviewImport = async () => {
    if (!importFile) return;
    setIsImporting(true);
    const formData = new FormData();
    formData.append('file', importFile);
    try {
      const res = await apiClient.post('/products/import/preview', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      setPreviewData(res.data);
    } catch (error) {
      console.error(error);
      alert("Ошибка при чтении файла. Проверьте формат CSV.");
    } finally {
      setIsImporting(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!previewData) return;
    setIsImporting(true);
    try {
      await apiClient.post('/products/import/confirm', {
        new_products: previewData.new_products,
        changed_products: previewData.changed_products
      });
      alert("Товары успешно импортированы!");
      setPreviewData(null);
      setImportFile(null);
      fetchProducts();
    } catch (error) {
      alert("Ошибка при сохранении товаров.");
    } finally {
      setIsImporting(false);
    }
  };

  // --- ЛОГИКА ТОВАРОВ И МАССОВЫХ ДЕЙСТВИЙ ---
  const handleAssignSeller = async (productId: number, sellerId: string) => {
    if (!sellerId) return;
    try {
      await apiClient.patch(`/products/${productId}`, { seller_id: parseInt(sellerId) });
      setProducts(products.map(p => p.id === productId ? { ...p, seller_id: parseInt(sellerId) } : p));
    } catch (error) {
      alert("Ошибка при привязке товара");
    }
  };

  const startEditing = (product: Product) => {
    setEditingId(product.id);
    setEditForm({ name: product.name, base_price: product.base_price, stock: product.stock });
  };

  const saveEditing = async (productId: number) => {
    try {
      await apiClient.patch(`/products/${productId}`, editForm);
      setProducts(products.map(p => p.id === productId ? { ...p, ...editForm } : p));
      setEditingId(null);
    } catch (error) {
      alert("Ошибка при сохранении");
    }
  };

  const toggleArchive = async (product: Product) => {
    const action = product.is_obsolete ? "восстановить" : "переместить в архив";
    if (!window.confirm(`Вы уверены, что хотите ${action} товар "${product.name}"?`)) return;

    try {
      await apiClient.patch(`/products/${product.id}`, { is_obsolete: !product.is_obsolete });
      fetchProducts();
    } catch (error) {
      alert("Ошибка при изменении статуса");
    }
  };

  // Массовое выделение
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(products.map(p => p.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id: number, checked: boolean) => {
    if (checked) {
      setSelectedIds([...selectedIds, id]);
    } else {
      setSelectedIds(selectedIds.filter(itemId => itemId !== id));
    }
  };

  const handleBulkArchive = async () => {
    if (!window.confirm(`Отправить в архив ${selectedIds.length} товаров?`)) return;
    try {
      await Promise.all(selectedIds.map(id => apiClient.patch(`/products/${id}`, { is_obsolete: true })));
      setSelectedIds([]);
      fetchProducts();
    } catch (error) {
      alert("Произошла ошибка при массовой архивации");
    }
  };

  const handleBulkAssign = async () => {
    if (!bulkAssignSellerId) return alert("Выберите продавца для привязки");
    try {
      const sellerId = parseInt(bulkAssignSellerId);
      await Promise.all(selectedIds.map(id => apiClient.patch(`/products/${id}`, { seller_id: sellerId })));
      setSelectedIds([]);
      setBulkAssignSellerId('');
      fetchProducts();
    } catch (error) {
      alert("Произошла ошибка при массовой привязке");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Склад и Товары</h1>
          <p className="text-gray-500 mt-1">Управление остатками и ценами</p>
        </div>
      </div>

      {/* ОРИГИНАЛЬНАЯ ПАНЕЛЬ ИМПОРТА */}
      {isAdmin && !previewData && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-indigo-100 flex items-center gap-4">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl"><UploadCloud size={24} /></div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-800">Импорт из Бизнес.Ру (CSV)</h3>
            <p className="text-sm text-gray-500">Загрузите файл с колонками: Артикул, Наименование, Цена, Остаток</p>
          </div>
          <input
            type="file" accept=".csv"
            onChange={(e) => setImportFile(e.target.files ? e.target.files[0] : null)}
            className="text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
          />
          <button
            onClick={handlePreviewImport} disabled={!importFile || isImporting}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium disabled:opacity-50"
          >
            {isImporting ? 'Обработка...' : 'Превью импорта'}
          </button>
        </div>
      )}

      {/* ОРИГИНАЛЬНОЕ ПРЕВЬЮ ИМПОРТА */}
      {previewData && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-orange-200 animate-in fade-in">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Результаты сканирования файла</h2>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-green-50 p-4 rounded-xl border border-green-100">
              <p className="text-green-800 font-bold text-lg">{previewData.new_products.length}</p>
              <p className="text-sm text-green-600">Новых товаров</p>
            </div>
            <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-100">
              <p className="text-yellow-800 font-bold text-lg">{previewData.changed_products.length}</p>
              <p className="text-sm text-yellow-600">Обновятся (цена/остаток)</p>
            </div>
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
              <p className="text-gray-800 font-bold text-lg">{previewData.unchanged_products.length}</p>
              <p className="text-sm text-gray-500">Без изменений</p>
            </div>
          </div>
          <div className="flex gap-4">
            <button onClick={handleConfirmImport} disabled={isImporting} className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold">
              Подтвердить и Загрузить в базу
            </button>
            <button onClick={() => { setPreviewData(null); setImportFile(null); }} className="px-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-medium">
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* ПАНЕЛЬ ФИЛЬТРОВ И ПОИСКА */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-wrap gap-4 items-center justify-between">
        <div className="flex flex-1 max-w-md relative">
          <input
            type="text"
            placeholder="Поиск по артикулу или названию..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchProducts()}
            onBlur={fetchProducts}
          />
          <Search size={18} className="absolute left-3 top-2.5 text-gray-400" />
        </div>

        <div className="flex gap-4 items-center">
          {isAdmin && (
            <select
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
              value={sellerFilter} onChange={(e) => setSellerFilter(e.target.value)}
            >
              <option value="all">Все продавцы</option>
              <option value="unassigned">⚠️ Нераспределенные (Ничейные)</option>
              {sellers.map(s => <option key={s.id} value={s.id}>{s.username} ({s.full_name || 'без имени'})</option>)}
            </select>
          )}

          <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
            value={sortBy} onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="name_asc">А-Я</option>
            <option value="price_desc">Сначала дорогие</option>
            <option value="price_asc">Сначала дешевые</option>
          </select>

          <label className="flex items-center gap-2 cursor-pointer border border-gray-300 px-3 py-2 rounded-lg hover:bg-gray-50">
            <input
              type="checkbox" className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              checked={includeObsolete} onChange={(e) => setIncludeObsolete(e.target.checked)}
            />
            <span className="text-sm font-medium text-gray-700">Архив</span>
          </label>
        </div>
      </div>

      {/* ПАНЕЛЬ МАССОВЫХ ДЕЙСТВИЙ */}
      {selectedIds.length > 0 && isAdmin && (
        <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-200 flex items-center justify-between animate-in fade-in slide-in-from-top-2">
          <span className="font-bold text-indigo-800">Выбрано товаров: {selectedIds.length}</span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-indigo-700">Привязать к:</span>
              <select
                className="border border-indigo-200 rounded text-sm px-2 py-1 outline-none"
                value={bulkAssignSellerId} onChange={(e) => setBulkAssignSellerId(e.target.value)}
              >
                <option value="" disabled>Выберите продавца...</option>
                {sellers.map(s => <option key={s.id} value={s.id}>{s.username}</option>)}
              </select>
              <button onClick={handleBulkAssign} className="px-3 py-1 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700">
                Применить
              </button>
            </div>
            <div className="w-px h-6 bg-indigo-200 mx-2"></div>
            <button onClick={handleBulkArchive} className="px-3 py-1 bg-white text-red-600 border border-red-200 text-sm rounded hover:bg-red-50 flex items-center gap-1">
              <Archive size={14} /> Архивировать
            </button>
          </div>
        </div>
      )}

      {/* ТАБЛИЦА ТОВАРОВ */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
        {isLoading && <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div></div>}

        {products.length === 0 && !isLoading ? (
          <div className="p-12 text-center flex flex-col items-center">
            <Package className="w-12 h-12 text-gray-300 mb-3" />
            <p className="text-gray-500 text-lg">Товары не найдены</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {isAdmin && (
                  <th className="p-4 w-12">
                    <input
                      type="checkbox"
                      className="rounded text-indigo-600 focus:ring-indigo-500"
                      onChange={handleSelectAll}
                      checked={products.length > 0 && selectedIds.length === products.length}
                    />
                  </th>
                )}
                <th className="p-4 text-sm font-semibold text-gray-600">Артикул</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Наименование</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Цена (₽)</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Остаток</th>
                {isAdmin && <th className="p-4 text-sm font-semibold text-gray-600">Продавец (Владелец)</th>}
                {isAdmin && <th className="p-4 text-sm font-semibold text-gray-600 text-right">Управление</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {products.map((product) => {
                const isEditing = editingId === product.id;
                const isSelected = selectedIds.includes(product.id);

                return (
                <tr key={product.id} className={`transition-colors ${product.is_obsolete ? 'bg-gray-50/70' : 'hover:bg-gray-50'} ${isSelected ? 'bg-indigo-50/30' : ''}`}>
                  {isAdmin && (
                    <td className="p-4">
                      <input
                        type="checkbox"
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                        checked={isSelected}
                        onChange={(e) => handleSelectOne(product.id, e.target.checked)}
                      />
                    </td>
                  )}
                  <td className="p-4 text-sm text-gray-500">{product.sku || '—'}</td>

                  {/* ИНЛАЙН РЕДАКТИРОВАНИЕ */}
                  {isEditing ? (
                    <>
                      <td className="p-4">
                        <input type="text" className="w-full border border-indigo-300 rounded px-2 py-1 text-sm outline-none" value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} />
                      </td>
                      <td className="p-4">
                        <input type="number" className="w-24 border border-indigo-300 rounded px-2 py-1 text-sm outline-none" value={editForm.base_price} onChange={e => setEditForm({...editForm, base_price: parseFloat(e.target.value)})} />
                      </td>
                      <td className="p-4">
                        <input type="number" className="w-16 border border-indigo-300 rounded px-2 py-1 text-sm outline-none" value={editForm.stock} onChange={e => setEditForm({...editForm, stock: parseInt(e.target.value)})} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="p-4 text-sm font-medium text-gray-900">
                        {product.name}
                        {product.is_obsolete && <span className="ml-2 text-[10px] bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full uppercase">Устаревшее</span>}
                      </td>
                      <td className="p-4 text-sm text-gray-600">{product.base_price.toLocaleString('ru-RU')}</td>
                      <td className="p-4">
                        <span className={`inline-flex px-2 py-1 rounded-md text-xs font-bold ${product.stock > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {product.stock} шт.
                        </span>
                      </td>
                    </>
                  )}

                  {isAdmin && (
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {!product.seller_id && <AlertTriangle size={14} className="text-orange-500" />}
                        <select
                          className={`text-sm rounded-lg px-2 py-1 outline-none ${product.seller_id ? 'bg-transparent hover:bg-gray-100' : 'bg-orange-50 border border-orange-200 text-orange-700'}`}
                          value={product.seller_id || ""}
                          onChange={(e) => handleAssignSeller(product.id, e.target.value)}
                        >
                          <option value="" disabled>Ничей (Привязать)</option>
                          {sellers.map(s => (
                            <option key={s.id} value={s.id}>{s.username}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                  )}

                  {isAdmin && (
                    <td className="p-4 text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-1">
                          <button onClick={() => saveEditing(product.id)} className="p-1.5 text-white bg-green-500 hover:bg-green-600 rounded shadow-sm"><Save size={16} /></button>
                          <button onClick={() => setEditingId(null)} className="p-1.5 text-gray-600 bg-gray-200 hover:bg-gray-300 rounded shadow-sm"><X size={16} /></button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity" style={{ opacity: 1 }}>
                          <button onClick={() => startEditing(product)} className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded transition-colors" title="Редактировать">
                            <Edit2 size={16} />
                          </button>
                          <button onClick={() => toggleArchive(product)} className={`p-1.5 rounded transition-colors ${product.is_obsolete ? 'text-green-600 hover:bg-green-100' : 'text-red-500 hover:bg-red-100'}`} title={product.is_obsolete ? "Восстановить" : "В архив"}>
                            {product.is_obsolete ? <RefreshCw size={16} /> : <Archive size={16} />}
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              )})}
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
    </div>
  );
};