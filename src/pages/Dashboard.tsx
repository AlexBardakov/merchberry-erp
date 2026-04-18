// src/pages/Dashboard.tsx
import React, { useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import apiClient from '../api/axios';
import { Package, TrendingUp, Wallet } from 'lucide-react';

// Тип данных, который возвращает наш Python-сервер
interface ChartDataPoint {
  label: string;
  total_amount: number;
  products: string[];
}

export const Dashboard = () => {
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Состояние для хранения выбранного столбца (периода)
  const [selectedPeriod, setSelectedPeriod] = useState<ChartDataPoint | null>(null);

  const userRole = localStorage.getItem('userRole');

  useEffect(() => {
    // Функция загрузки данных графика
    const fetchAnalytics = async () => {
      try {
        // Для примера берем даты за последние 30 дней
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        const response = await apiClient.get(`/analytics/chart?start_date=${startDate}&end_date=${endDate}`);
        setChartData(response.data);
      } catch (error) {
        console.error("Ошибка загрузки аналитики:", error);
        // Заглушка на случай, если база данных пока пустая или сервер не запущен
        setChartData([
          { label: "10.04", total_amount: 1500, products: ["Брелок Котик - 500 руб.", "Кейкап Жаба - 1000 руб."] },
          { label: "11.04", total_amount: 3200, products: ["Гача Курочка - 1200 руб.", "Тыква - 2000 руб."] },
          { label: "12.04", total_amount: 800, products: ["Ми-ми-тролль - 800 руб."] },
          { label: "13.04", total_amount: 4500, products: ["База + Кейкап - 2500 руб.", "Брелок Кувшин - 2000 руб."] },
          { label: "14.04", total_amount: 0, products: [] },
          { label: "15.04", total_amount: 2100, products: ["Курочка белая - 2100 руб."] },
        ]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAnalytics();
  }, []);

  // Кастомное всплывающее окно при наведении на столбец
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data: ChartDataPoint = payload[0].payload;
      return (
        <div className="bg-white p-4 rounded-lg shadow-lg border border-gray-100 outline-none">
          <p className="font-bold text-gray-800 mb-2">{label}</p>
          <p className="text-indigo-600 font-semibold text-lg mb-2">
            {data.total_amount.toLocaleString('ru-RU')} ₽
          </p>
          <div className="text-sm text-gray-600 space-y-1">
            {/* Показываем максимум 3 товара в тултипе, чтобы он не был огромным */}
            {data.products.slice(0, 3).map((prod, idx) => (
              <p key={idx}>• {prod}</p>
            ))}
            {data.products.length > 3 && (
              <p className="text-xs text-gray-400 italic mt-1">
                и ещё {data.products.length - 3} позиций... (кликните для деталей)
              </p>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      
      {/* 1. ВЕРХНИЕ ВИДЖЕТЫ (Статистика) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-green-100 text-green-600 rounded-xl"><Wallet size={24} /></div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Текущий баланс</p>
            <p className="text-2xl font-bold text-gray-900">12 450 ₽</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl"><TrendingUp size={24} /></div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Продажи за 30 дней</p>
            <p className="text-2xl font-bold text-gray-900">24 100 ₽</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-orange-100 text-orange-600 rounded-xl"><Package size={24} /></div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Товаров на полках</p>
            <p className="text-2xl font-bold text-gray-900">18 шт.</p>
          </div>
        </div>
      </div>

      {/* 2. ГРАФИК ПРОДАЖ */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <h2 className="text-lg font-bold text-gray-800 mb-6">Динамика продаж</h2>
        
        {isLoading ? (
          <div className="h-72 flex items-center justify-center text-gray-400">Загрузка данных...</div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart 
                data={chartData} 
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                // Обработчик клика по любой части графика передает данные в state
                onClick={(state) => {
                  if (state && state.activePayload) {
                    setSelectedPeriod(state.activePayload[0].payload);
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
                
                <Bar 
                  dataKey="total_amount" 
                  radius={[4, 4, 0, 0]} 
                  className="cursor-pointer transition-all hover:opacity-80"
                >
                  {/* Меняем цвет столбца, если он выбран */}
                  {chartData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={selectedPeriod?.label === entry.label ? '#4f46e5' : '#818cf8'} 
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* 3. ДЕТАЛИЗАЦИЯ (Появляется только при клике на столбец) */}
      {selectedPeriod && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-indigo-100 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-800">
              Детализация за: <span className="text-indigo-600">{selectedPeriod.label}</span>
            </h3>
            <button 
              onClick={() => setSelectedPeriod(null)}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              Скрыть ✕
            </button>
          </div>
          
          {selectedPeriod.products.length > 0 ? (
            <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
              {selectedPeriod.products.map((product, idx) => (
                <li key={idx} className="p-3 hover:bg-gray-50 flex justify-between items-center text-sm">
                  <span className="text-gray-700">{product.split(' - ')[0]}</span>
                  <span className="font-semibold text-gray-900">{product.split(' - ')[1]}</span>
                </li>
              ))}
              <li className="p-3 bg-gray-50 flex justify-between items-center text-sm font-bold border-t-2 border-gray-200">
                <span>Итого:</span>
                <span className="text-indigo-600">{selectedPeriod.total_amount.toLocaleString('ru-RU')} ₽</span>
              </li>
            </ul>
          ) : (
            <p className="text-gray-500 text-center py-4">В этот период продаж не было.</p>
          )}
        </div>
      )}

    </div>
  );
};