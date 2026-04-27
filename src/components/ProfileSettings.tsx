import React, { useState, useEffect } from 'react';
import { X, ExternalLink, CheckCircle, BellRing, Package, MessageCircle } from 'lucide-react';
import apiClient from '../api/axios';

interface ProfileSettingsProps {
  onClose: () => void;
  user: any;
}

export const ProfileSettings = ({ onClose, user }: ProfileSettingsProps) => {
  const [vkData, setVkData] = useState({ vk_link: '', is_bound: false });
  const [settings, setSettings] = useState({
    vk_notify_sales: user.vk_notify_sales || false,
    vk_notify_inventory: user.vk_notify_inventory || false
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiClient.get('/users/me/vk-link')
      .then(res => setVkData(res.data))
      .finally(() => setIsLoading(false));
  }, []);

  const toggleSetting = async (field: string, value: boolean) => {
    const newSettings = { ...settings, [field]: value };
    setSettings(newSettings);
    try {
      await apiClient.patch(`/users/${user.id}/vk`, newSettings);
    } catch (e) {
      alert("Ошибка при сохранении настроек");
      setSettings(settings); // откат при ошибке
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h2 className="text-lg font-bold text-gray-900">Настройки профиля</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-lg transition-colors"><X size={20} /></button>
        </div>

        <div className="p-6">
          <div className="mb-6">
            <p className="text-sm text-gray-500">Логин</p>
            <p className="text-lg font-bold text-gray-900">{user.username}</p>
          </div>

          <div className="bg-blue-50/50 p-5 rounded-xl border border-blue-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-100 text-blue-600 rounded-lg"><MessageCircle size={20} /></div>
              <h3 className="font-bold text-gray-800">Уведомления ВКонтакте</h3>
            </div>

            {isLoading ? (
              <div className="text-sm text-gray-500">Загрузка данных...</div>
            ) : !vkData.is_bound ? (
              <div className="space-y-3">
                <p className="text-sm text-blue-800">Привяжите аккаунт, чтобы получать чеки и отчеты в личные сообщения.</p>
                <a
                  href={vkData.vk_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full justify-center items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-bold transition-colors"
                >
                  Привязать ВКонтакте <ExternalLink size={16} />
                </a>
                <p className="text-[11px] text-blue-600 text-center opacity-80">
                  После перехода в ВК отправьте боту любое сообщение.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-green-700 bg-green-100/50 px-3 py-2 rounded-lg border border-green-200 w-fit">
                  <CheckCircle size={16} />
                  <span className="text-sm font-bold">Аккаунт успешно привязан</span>
                </div>

                <div className="space-y-2 pt-2">
                  <label className="flex items-center justify-between cursor-pointer p-3 bg-white hover:bg-gray-50 rounded-lg border border-gray-100 transition-colors shadow-sm">
                    <div className="flex items-center gap-3">
                      <BellRing size={18} className="text-blue-500" />
                      <div>
                        <div className="text-sm font-bold text-gray-800">Новые продажи</div>
                        <div className="text-[11px] text-gray-500">Моментальные чеки</div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                      checked={settings.vk_notify_sales}
                      onChange={(e) => toggleSetting('vk_notify_sales', e.target.checked)}
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer p-3 bg-white hover:bg-gray-50 rounded-lg border border-gray-100 transition-colors shadow-sm">
                    <div className="flex items-center gap-3">
                      <Package size={18} className="text-blue-500" />
                      <div>
                        <div className="text-sm font-bold text-gray-800">Отчет по складу</div>
                        <div className="text-[11px] text-gray-500">Сводка раз в сутки</div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                      checked={settings.vk_notify_inventory}
                      onChange={(e) => toggleSetting('vk_notify_inventory', e.target.checked)}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};