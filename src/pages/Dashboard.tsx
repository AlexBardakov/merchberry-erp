import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer
} from 'recharts';
import apiClient from '../api/axios';
import { Package, TrendingUp, Wallet, ChevronDown, ChevronUp, Calendar, Download, Users } from 'lucide-react';

// --- ИНТЕРФЕЙСЫ БЭКЕНДА ---
interface TopProduct {
  rank: number;
  name: string;
  quantity: number;
}

interface ChartDataPoint {
  label: string;
  full_amount: number;
  profit: number;
  commission: number;
  products_info: string[];
}

interface DashboardSummary {
  total_full_amount: number;
  total_profit: number;
  total_commission: number;
  chart_data: ChartDataPoint[];
  top_products: TopProduct[];
}

interface WidgetStats {
  current_balance: number;
  products_on_shelves: number;
  unique_names: number;
  total_value: number;
  sales_30_days: number;
  sales_prev_30_days: number;
  sales_trend_percent: number;
}

// Вспомогательные функции дат
const formatDate = (date: Date) => date.toISOString().split('T')[0];
const getPastDate = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

export const Dashboard = () => {
  const userRole = localStorage.getItem('userRole');

  // --- СОСТОЯНИЯ ФИЛЬТРОВ ---
  const [selectedSeller, setSelectedSeller] = useState<string>('all');
  const [sellers, setSellers] = useState<any[]>([]);
  const [datePreset, setDatePreset] = useState<number | 'custom'>(30);
  const [startDate, setStartDate] = useState(formatDate(getPastDate(30)));
  const [endDate, setEndDate] = useState(formatDate(new Date()));

  // --- СОСТОЯНИЯ ДАННЫХ ---
  const [widgets, setWidgets] = useState<WidgetStats | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // --- СРАВНЕНИЕ ПРОДАЖ ---
  const [showComparison, setShowComparison] = useState(false);
  const [compSummary1, setCompSummary1] = useState<DashboardSummary | null>(null);
  const [compSummary2, setCompSummary2] = useState<DashboardSummary | null>(null);
  const [compDates1, setCompDates1] = useState({ start: formatDate(getPastDate(60)), end: formatDate(getPastDate(31)) });
  const [compDates2, setCompDates2] = useState({ start: formatDate(getPastDate(30)), end: formatDate(new Date()) });
  const [isCompLoading, setIsCompLoading] = useState(false);

  // 1. Загрузка списка авторов (только для Админа)
  useEffect(() => {
    if (userRole === 'admin') {
      apiClient.get('/users').then(res => setSellers(res.data)).catch(console.error);
    }
  }, [userRole]);

  // 2. Загрузка виджетов и основного графика
  useEffect(() => {
    const fetchMainData = async () => {
      setIsLoading(true);

      const sellerQuery = selectedSeller !== 'all' ? `seller_id=${selectedSeller}` : '';
      const widgetUrl = `/analytics/widgets${sellerQuery ? '?' + sellerQuery : ''}`;
      const summaryUrl = `/analytics/summary?start_date=${startDate}&end_date=${endDate}${sellerQuery ? '&' + sellerQuery : ''}`;

      try {
        const [widgetsRes, summaryRes] = await Promise.all([
          apiClient.get(widgetUrl),
          apiClient.get(summaryUrl)
        ]);
        setWidgets(widgetsRes.data);
        setSummary(summaryRes.data);
      } catch (error) {
        console.error("Ошибка загрузки аналитики:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchMainData();
  }, [startDate, endDate, selectedSeller]);

  // 3. Загрузка блока сравнения
  useEffect(() => {
    if (showComparison) {
      const fetchComparison = async () => {
        setIsCompLoading(true);
        const sellerQuery = selectedSeller !== 'all' ? `&seller_id=${selectedSeller}` : '';
        try {
          const [res1, res2] = await Promise.all([
            apiClient.get(`/analytics/summary?start_date=${compDates1.start}&end_date=${compDates1.end}${sellerQuery}`),
            apiClient.get(`/analytics/summary?start_date=${compDates2.start}&end_date=${compDates2.end}${sellerQuery}`)
          ]);
          setCompSummary1(res1.data);
          setCompSummary2(res2.data);
        } catch (error) {
          console.error("Ошибка загрузки сравнения:", error);
        } finally {
          setIsCompLoading(false);
        }
      };
      fetchComparison();
    }
  }, [showComparison, compDates1, compDates2, selectedSeller]);

  // --- ОБРАБОТЧИКИ ---
  const handlePresetChange = (days: number) => {
    setDatePreset(days);
    setStartDate(formatDate(getPastDate(days)));
    setEndDate(formatDate(new Date()));
  };

  const handleExport = async () => {
    setIsExporting(true);
    const sellerQuery = selectedSeller !== 'all' ? `&seller_id=${selectedSeller}` : '';
    const exportUrl = `/analytics/export?start_date=${startDate}&end_date=${endDate}${sellerQuery}`;

    try {
      const response = await apiClient.get(exportUrl, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `analytics_${startDate}_${endDate}.csv`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
    } catch (error) {
      console.error("Ошибка при выгрузке:", error);
    } finally {
      setIsExporting(false);
    }
  };

  // --- КАСТОМНЫЙ ТУЛТИП ГРАФИКА ---
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data: ChartDataPoint = payload[0].payload;
      return (
        <div className="bg-white p-4 rounded-lg shadow-lg border border-gray-100 outline-none min-w-[200px]">
          <p className="font-bold text-gray-800 mb-2">{label}</p>
          <div className="mb-3">
            <p className="text-sm text-gray-500">Полная сумма: <span className="font-bold text-gray-800">{data.full_amount.toLocaleString('ru-RU')} ₽</span></p>
            <p className="text-sm text-indigo-600">Прибыль: <span className="font-bold">{data.profit.toLocaleString('ru-RU')} ₽</span></p>
            <p className="text-sm text-orange-500">Комиссия: <span>{data.commission.toLocaleString('ru-RU')} ₽</span></p>
          </div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Продано:</p>
          <div className="text-sm text-gray-600 space-y-1 max-h-32 overflow-y-auto">
            {data.products_info.length > 0 ? (
              data.products_info.map((prod, idx) => <p key={idx}>• {prod}</p>)
            ) : (
              <p className="italic text-gray-400">Нет данных о товарах</p>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  const TopProductsList = ({ products }: { products: TopProduct[] }) => (
    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
      <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
        <Package size={16} /> Лидеры продаж (Топ-5)
      </h3>
      {products.length > 0 ? (
        <ul className="space-y-2">
          {products.map((p) => (
            <li key={p.rank} className="flex justify-between items-center text-sm">
              <span className="text-gray-800 truncate pr-4"><span className="text-gray-400 w-4 inline-block">{p.rank}.</span> {p.name}</span>
              <span className="font-bold text-indigo-600 whitespace-nowrap">{p.quantity} шт.</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-400 text-center py-2">Нет продаж за период</p>
      )}
    </div>
  );

  return (
    <div className="space-y-6">

      {/* ФИЛЬТР АВТОРОВ ДЛЯ АДМИНА */}
      {userRole === 'admin' && (
        <div className="flex items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <Users className="text-gray-400" size={24} />
          <div className="flex flex-col">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Отображаемая статистика</label>
            <select
              value={selectedSeller}
              onChange={(e) => setSelectedSeller(e.target.value)}
              className="bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-64 p-2 cursor-pointer outline-none transition-colors"
            >
              <option value="all">Совокупная по всем авторам</option>
              {sellers.map(s => (
                <option key={s.id} value={s.id}>{s.username} (Симуляция автора)</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* 1. ВИДЖЕТЫ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-green-100 text-green-600 rounded-xl"><Wallet size={24} /></div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Текущий баланс</p>
            <p className="text-2xl font-bold text-gray-900">{widgets?.current_balance.toLocaleString('ru-RU') || 0} ₽</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl"><TrendingUp size={24} /></div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Продажи (30 дней)</p>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold text-gray-900">{widgets?.sales_30_days.toLocaleString('ru-RU') || 0} ₽</p>
              {widgets && widgets.sales_trend_percent !== 0 && (
                <span className={`text-xs font-bold ${widgets.sales_trend_percent > 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {widgets.sales_trend_percent > 0 ? '↑' : '↓'} {Math.abs(widgets.sales_trend_percent)}%
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ОБНОВЛЕННЫЙ ВИДЖЕТ "ТОВАРОВ НА ПОЛКАХ" */}
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-4 mb-3">
            <div className="p-3 bg-orange-100 text-orange-600 rounded-xl"><Package size={24} /></div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Товаров на полках</p>
              <p className="text-2xl font-bold text-gray-900">{widgets?.products_on_shelves || 0} <span className="text-sm font-normal text-gray-500">шт.</span></p>
            </div>
          </div>
          <div className="flex justify-between items-center text-[11px] bg-gray-50 p-2 rounded-lg border border-gray-100">
            <div className="text-center w-1/2 border-r border-gray-200">
              <span className="block text-gray-400">Наименований</span>
              <span className="font-bold text-gray-700">{widgets?.unique_names || 0}</span>
            </div>
            <div className="text-center w-1/2">
              <span className="block text-gray-400">Общая стоимость</span>
              <span className="font-bold text-indigo-600">{(widgets?.total_value || 0).toLocaleString('ru-RU')} ₽</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. ОСНОВНОЙ ГРАФИК И АНАЛИТИКА */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">

        {/* Заголовок, Фильтры дат и Выгрузка */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 border-b border-gray-100 pb-4">
          <h2 className="text-lg font-bold text-gray-800">Аналитика продаж</h2>

          <div className="flex flex-wrap gap-3 items-center">
            {/* Пресеты */}
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
              {[3, 7, 14, 30].map(days => (
                <button
                  key={days}
                  onClick={() => handlePresetChange(days)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${datePreset === days ? 'bg-white text-indigo-600 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-900'}`}
                >
                  {days} дн.
                </button>
              ))}
            </div>

            {/* Выбор дат */}
            <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-lg border border-gray-200">
              <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setDatePreset('custom'); }} className="text-sm bg-transparent outline-none cursor-pointer"/>
              <span className="text-gray-400">-</span>
              <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setDatePreset('custom'); }} className="text-sm bg-transparent outline-none cursor-pointer"/>
            </div>

            {/* КНОПКА ВЫГРУЗКИ */}
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:bg-indigo-400"
            >
              <Download size={16} />
              {isExporting ? 'Загрузка...' : 'Выгрузить CSV'}
            </button>
          </div>
        </div>

        {isLoading || !summary ? (
          <div className="h-72 flex items-center justify-center text-gray-400">Загрузка данных...</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* График */}
            <div className="lg:col-span-2 space-y-4">
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={summary.chart_data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} />
                    <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
                    <Bar dataKey="full_amount" radius={[4, 4, 0, 0]} fill="#818cf8" className="transition-all hover:opacity-80" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Итоги под графиком */}
              <div className="flex flex-wrap justify-around bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                <div className="text-center">
                  <p className="text-xs text-indigo-400 uppercase font-bold tracking-wider mb-1">Полная сумма</p>
                  <p className="text-xl font-bold text-indigo-900">{summary.total_full_amount.toLocaleString('ru-RU')} ₽</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-green-500 uppercase font-bold tracking-wider mb-1">Чистый доход</p>
                  <p className="text-xl font-bold text-green-700">{summary.total_profit.toLocaleString('ru-RU')} ₽</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-orange-400 uppercase font-bold tracking-wider mb-1">Комиссия</p>
                  <p className="text-xl font-bold text-orange-700">{summary.total_commission.toLocaleString('ru-RU')} ₽</p>
                </div>
              </div>
            </div>

            {/* Топ продуктов */}
            <div className="lg:col-span-1">
              <TopProductsList products={summary.top_products} />
            </div>

          </div>
        )}
      </div>

      {/* 3. СРАВНЕНИЕ ПРОДАЖ */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <button
          onClick={() => setShowComparison(!showComparison)}
          className="w-full flex items-center justify-between p-6 bg-gray-50 hover:bg-gray-100 transition-colors outline-none"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white rounded-lg shadow-sm text-gray-500"><Calendar size={20}/></div>
            <h2 className="text-lg font-bold text-gray-800">Сравнение продаж</h2>
          </div>
          {showComparison ? <ChevronUp className="text-gray-400"/> : <ChevronDown className="text-gray-400"/>}
        </button>

        {showComparison && (
          <div className="p-6 border-t border-gray-100">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

              {/* Левый период */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg inline-flex">
                  <input type="date" value={compDates1.start} onChange={e => setCompDates1({...compDates1, start: e.target.value})} className="text-sm bg-transparent outline-none"/>
                  <span className="text-gray-400">-</span>
                  <input type="date" value={compDates1.end} onChange={e => setCompDates1({...compDates1, end: e.target.value})} className="text-sm bg-transparent outline-none"/>
                </div>

                {isCompLoading || !compSummary1 ? <div className="text-sm text-gray-400 py-4">Загрузка...</div> : (
                  <>
                    <div className="grid grid-cols-3 gap-2 bg-white p-4 rounded-xl border border-gray-100 shadow-sm text-center">
                      <div><p className="text-xs text-gray-400 mb-1">Сумма</p><p className="font-bold text-gray-800">{compSummary1.total_full_amount.toLocaleString('ru-RU')} ₽</p></div>
                      <div><p className="text-xs text-gray-400 mb-1">Доход</p><p className="font-bold text-green-600">{compSummary1.total_profit.toLocaleString('ru-RU')} ₽</p></div>
                      <div><p className="text-xs text-gray-400 mb-1">Комиссия</p><p className="font-bold text-orange-500">{compSummary1.total_commission.toLocaleString('ru-RU')} ₽</p></div>
                    </div>
                    <TopProductsList products={compSummary1.top_products} />
                  </>
                )}
              </div>

              {/* Правый период */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 bg-indigo-50 p-2 rounded-lg inline-flex">
                  <input type="date" value={compDates2.start} onChange={e => setCompDates2({...compDates2, start: e.target.value})} className="text-sm bg-transparent outline-none text-indigo-900"/>
                  <span className="text-indigo-300">-</span>
                  <input type="date" value={compDates2.end} onChange={e => setCompDates2({...compDates2, end: e.target.value})} className="text-sm bg-transparent outline-none text-indigo-900"/>
                </div>

                {isCompLoading || !compSummary2 ? <div className="text-sm text-gray-400 py-4">Загрузка...</div> : (
                  <>
                    <div className="grid grid-cols-3 gap-2 bg-white p-4 rounded-xl border border-indigo-100 shadow-sm text-center">
                      <div><p className="text-xs text-gray-400 mb-1">Сумма</p><p className="font-bold text-gray-800">{compSummary2.total_full_amount.toLocaleString('ru-RU')} ₽</p></div>
                      <div><p className="text-xs text-gray-400 mb-1">Доход</p><p className="font-bold text-green-600">{compSummary2.total_profit.toLocaleString('ru-RU')} ₽</p></div>
                      <div><p className="text-xs text-gray-400 mb-1">Комиссия</p><p className="font-bold text-orange-500">{compSummary2.total_commission.toLocaleString('ru-RU')} ₽</p></div>
                    </div>
                    <TopProductsList products={compSummary2.top_products} />
                  </>
                )}
              </div>

            </div>
          </div>
        )}
      </div>

    </div>
  );
};