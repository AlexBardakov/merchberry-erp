import React, { useState, useEffect } from 'react';
import { User, Bell, Package, MessageCircle, ExternalLink, Unlink, CheckCircle, Shield, Phone, MapPin, CreditCard, Percent, DollarSign } from 'lucide-react';
import apiClient from '../api/axios';
import { useNavigate } from 'react-router-dom';

export const Profile = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [vkData, setVkData] = useState({ vk_link: '', is_bound: false, token: '' });
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfileData = async () => {
    try {
      const userRes = await apiClient.get('/users/me');
      setUser(userRes.data);

      const vkRes = await apiClient.get('/users/me/vk-link');
      setVkData(vkRes.data);
    } catch (error) {
      console.error("Ошибка загрузки профиля", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProfileData();
  }, []);

  const toggleVkSetting = async (field: string, value: boolean) => {
    if (!user) return;
    const newSettings = { [field]: value };
    setUser({ ...user, ...newSettings });
    try {
      await apiClient.patch(`/users/${user.id}/vk`, newSettings);
    } catch (e) {
      alert("Ошибка при сохранении настроек");
      fetchProfileData();
    }
  };

  const handleUnbindVk = async () => {
    if (!window.confirm("Вы уверены, что хотите отвязать аккаунт ВКонтакте?")) return;
    try {
      await apiClient.post(`/users/${user.id}/vk-unbind`);
      alert("ВК успешно отвязан");
      fetchProfileData();
    } catch (error) {
      alert("Ошибка при отвязке ВК");
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    navigate('/login');
  };

  if (isLoading) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div></div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 pb-10">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Личный кабинет</h1>
          <p className="text-gray-500 mt-1">Просмотр данных профиля и настройка уведомлений</p>
        </div>
        <button onClick={handleLogout} className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors flex items-center gap-2">
           Выйти
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* КАРТОЧКА ПРОФИЛЯ */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 text-center">
            <div className="w-24 h-24 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-3xl font-bold mx-auto mb-4">
              {user.username.charAt(0).toUpperCase()}
            </div>
            <h2 className="text-xl font-bold text-gray-900">{user.username}</h2>
            <div className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-bold mt-2">
              <Shield size={12} />
              {user.role === 'admin' ? 'Администратор' : 'Автор'}
            </div>

            <div className="mt-8 space-y-3 text-left">
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                <div className="p-2 bg-white rounded-lg shadow-sm text-indigo-600"><DollarSign size={18}/></div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Баланс</div>
                  <div className={`text-lg font-bold ${user.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {user.balance.toLocaleString('ru-RU')} ₽
                  </div>
                </div>
              </div>

              {user.role === 'seller' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <div className="text-[10px] text-gray-400 uppercase font-bold mb-1">Комиссия</div>
                    <div className="text-sm font-bold text-gray-700 flex items-center gap-1"><Percent size={14}/> {user.commission_percent}%</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <div className="text-[10px] text-gray-400 uppercase font-bold mb-1">Аренда</div>
                    <div className="text-sm font-bold text-gray-700">{user.rent_rate} ₽/мес</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ОСНОВНЫЕ ДАННЫЕ И НАСТРОЙКИ */}
        <div className="lg:col-span-2 space-y-6">
          {/* БЛОК ПЕРСОНАЛЬНЫХ ДАННЫХ */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 mb-5 flex items-center gap-2">
              <User size={20} className="text-indigo-600" />
              Личные данные
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-400 uppercase">ФИО</label>
                <div className="text-gray-900 font-medium flex items-center gap-2">
                  {user.full_name || <span className="text-gray-300 italic">Не указано</span>}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-400 uppercase">Телефон</label>
                <div className="text-gray-900 font-medium flex items-center gap-2">
                  <Phone size={14} className="text-gray-400" />
                  {user.phone || <span className="text-gray-300 italic">Не указано</span>}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-400 uppercase">Место на полке</label>
                <div className="text-gray-900 font-medium flex items-center gap-2">
                  <MapPin size={14} className="text-gray-400" />
                  {user.shelf_location || <span className="text-gray-300 italic">Не распределено</span>}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-400 uppercase">Реквизиты для выплат</label>
                <div className="text-gray-900 font-medium flex items-center gap-2">
                  <CreditCard size={14} className="text-gray-400" />
                  {user.payment_details || <span className="text-gray-300 italic">Не указаны</span>}
                </div>
              </div>
            </div>
            {user.notes && (
              <div className="mt-6 pt-6 border-t border-gray-100">
                <label className="text-xs font-medium text-gray-400 uppercase">Заметки администратора</label>
                <p className="mt-1 text-sm text-gray-600 italic">{user.notes}</p>
              </div>
            )}
          </div>

          {/* БЛОК ВК (Оставляем без изменений) */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <MessageCircle size={20} className="text-blue-500" />
              Интеграция с ВКонтакте
            </h3>
            {vkData.is_bound ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-green-50 rounded-xl border border-green-100">
                  <div className="flex items-center gap-3 text-green-700"><CheckCircle size={20} /><span className="font-medium">Аккаунт привязан</span></div>
                  <button onClick={handleUnbindVk} className="px-3 py-1.5 text-xs font-bold text-red-600 bg-white border border-red-100 rounded-lg hover:bg-red-50 transition-colors">ОТВЯЗАТЬ</button>
                </div>
                <div className="space-y-3 pt-2">
                   <label className="flex items-center justify-between cursor-pointer p-4 bg-gray-50 hover:bg-gray-100 rounded-xl border border-gray-200 transition-colors">
                      <div className="flex items-center gap-3"><Bell size={18} className="text-blue-600" /><div><div className="text-sm font-bold text-gray-900">Продажи и выплаты</div><div className="text-xs text-gray-500">Уведомления в ЛС о новых чеках</div></div></div>
                      <input type="checkbox" className="w-4 h-4 text-blue-600 rounded cursor-pointer" checked={user.vk_notify_sales} onChange={(e) => toggleVkSetting('vk_notify_sales', e.target.checked)} />
                    </label>
                    <label className="flex items-center justify-between cursor-pointer p-4 bg-gray-50 hover:bg-gray-100 rounded-xl border border-gray-200 transition-colors">
                      <div className="flex items-center gap-3"><Package size={18} className="text-orange-500" /><div><div className="text-sm font-bold text-gray-900">Сводка по складу</div><div className="text-xs text-gray-500">Ежедневный отчет об остатках</div></div></div>
                      <input type="checkbox" className="w-4 h-4 text-blue-600 rounded cursor-pointer" checked={user.vk_notify_inventory} onChange={(e) => toggleVkSetting('vk_notify_inventory', e.target.checked)} />
                    </label>
                </div>
              </div>
            ) : (
              <div className="p-6 bg-gray-50 rounded-xl border border-dashed border-gray-300 text-center">
                <p className="text-sm text-gray-500 mb-5">Привяжите ВКонтакте для мгновенных уведомлений о продажах.</p>
                {vkData.vk_link && <a href={vkData.vk_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-6 py-3 bg-[#0077FF] text-white font-bold rounded-xl hover:bg-[#0066CC] transition-all shadow-md"><MessageCircle size={18} /> ПРИВЯЗАТЬ АККАУНТ</a>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};