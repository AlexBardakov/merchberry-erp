// src/pages/Inventory.tsx
import React, { useState, useEffect } from 'react';
import { UploadCloud, CheckCircle, AlertTriangle, UserPlus, Package } from 'lucide-react';
import apiClient from '../api/axios';

// Типизация (как в нашей БД)
interface Product {
  id: number;
  sku: string | null;
  name: string;
  base_price: number;
  stock: number;
  seller_id: number | null;
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
  
  // Состояния для импорта
  const [importFile, setImportFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  const [isImporting, setIsImporting] = useState(false);

  const userRole = localStorage.getItem('userRole');
  const isAdmin = userRole === 'admin';

  // Загрузка данных при открытии страницы
  useEffect(() => {
    fetchProducts();
    if (isAdmin) fetchSellers();
  }, []);

  const fetchProducts = async () => {
    try {
      setIsLoading(true);
      const res = await apiClient.get('/products/');
      setProducts(res.data);
    } catch (error) {
      console.error("Ошибка загрузки товаров:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSellers = async () => {
    try {
      const res = await apiClient.get('/users/');
      // Оставляем только продавцов для выпадающего списка
      setSellers(res.data.filter((u: any) => u.role === 'seller'));
    } catch (error) {
      console.error("Ошибка загрузки продавцов:", error);
    }
  };

  // --- ЛОГИКА ИМПОРТА CSV ---
  const handlePreviewImport = async () => {
    if (!importFile) return;
    setIsImporting(true);
    
    // Для отправки файлов нужен специальный формат FormData
    const formData = new FormData();
    formData.append('file', importFile);

    try {
      const res = await apiClient.post('/products/import/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setPreviewData(res.data);
    } catch (error) {
      console.error(error); // Добавим вывод в консоль для дебага
      alert("Ошибка при чтении файла. Проверьте формат CSV.");
    } finally {
      setIsImporting(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!previewData) return;
    setIsImporting(true);
    try {
      // Отправляем на сохранение новые и измененные товары
      await apiClient.post('/products/import/confirm', {
        new_products: previewData.new_products,
        changed_products: previewData.changed_products
      });
      alert("Товары успешно импортированы!");
      setPreviewData(null);
      setImportFile(null);
      fetchProducts(); // Обновляем таблицу
    } catch (error) {
      alert("Ошибка при сохранении товаров.");
    } finally {
      setIsImporting(false);
    }
  };

  // --- ЛОГИКА ПРИВЯЗКИ ТОВАРА К ПРОДАВЦУ ---
  const handleAssignSeller = async (productId: number, sellerId: string) => {
    if (!sellerId) return;
    try {
      await apiClient.patch(`/products/${productId}`, {
        seller_id: parseInt(sellerId)
      });
      // Обновляем локальный стейт, чтобы не делать лишний запрос к БД
      setProducts(products.map(p => p.id === productId ? { ...p, seller_id: parseInt(sellerId) } : p));
    } catch (error) {
      alert("Ошибка при привязке товара");
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

      {/* ПАНЕЛЬ ИМПОРТА (Только для Админа) */}
      {isAdmin && !previewData && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-indigo-100 flex items-center gap-4">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <UploadCloud size={24} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-800">Импорт из Бизнес.Ру (CSV)</h3>
            <p className="text-sm text-gray-500">Загрузите файл с колонками: Артикул, Наименование, Цена, Остаток</p>
          </div>
          <input 
            type="file" 
            accept=".csv"
            onChange={(e) => setImportFile(e.target.files ? e.target.files[0] : null)}
            className="text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
          />
          <button 
            onClick={handlePreviewImport}
            disabled={!importFile || isImporting}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium disabled:opacity-50"
          >
            {isImporting ? 'Обработка...' : 'Превью импорта'}
          </button>
        </div>
      )}

      {/* ПРЕВЬЮ ИМПОРТА (Показывается ДО сохранения) */}
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
            <button 
              onClick={handleConfirmImport} disabled={isImporting}
              className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold transition-colors"
            >
              Подтвердить и Загрузить в базу
            </button>
            <button 
              onClick={() => { setPreviewData(null); setImportFile(null); }}
              className="px-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-medium transition-colors"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* ТАБЛИЦА ТОВАРОВ */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Загрузка товаров...</div>
        ) : products.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center">
            <Package className="w-12 h-12 text-gray-300 mb-3" />
            <p className="text-gray-500 text-lg">Склад пуст</p>
            {isAdmin && <p className="text-sm text-gray-400 mt-1">Загрузите CSV файл выше, чтобы добавить товары</p>}
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="p-4 text-sm font-semibold text-gray-600">Артикул</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Наименование</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Справочная Цена</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Остаток</th>
                {isAdmin && <th className="p-4 text-sm font-semibold text-gray-600">Продавец (Владелец)</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {products.map((product) => (
                <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                  <td className="p-4 text-sm text-gray-500">{product.sku || '—'}</td>
                  <td className="p-4 text-sm font-medium text-gray-900">{product.name}</td>
                  <td className="p-4 text-sm text-gray-600">{product.base_price.toLocaleString('ru-RU')} ₽</td>
                  <td className="p-4">
                    <span className={`inline-flex px-2 py-1 rounded-md text-xs font-bold ${
                      product.stock > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {product.stock} шт.
                    </span>
                  </td>
                  
                  {/* КОЛОНКА АДМИНА: Управление принадлежностью */}
                  {isAdmin && (
                    <td className="p-4">
                      {product.seller_id ? (
                        <span className="text-sm text-indigo-600 font-medium flex items-center gap-1">
                          <CheckCircle size={14} />
                          {sellers.find(s => s.id === product.seller_id)?.username || `ID: ${product.seller_id}`}
                        </span>
                      ) : (
                        <div className="flex items-center gap-2 text-orange-600">
                          <AlertTriangle size={16} />
                          <select 
                            className="bg-orange-50 border border-orange-200 text-sm rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-orange-500"
                            onChange={(e) => handleAssignSeller(product.id, e.target.value)}
                            defaultValue=""
                          >
                            <option value="" disabled>Ничей (Привязать)</option>
                            {sellers.map(s => (
                              <option key={s.id} value={s.id}>{s.username} ({s.full_name || 'без имени'})</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};