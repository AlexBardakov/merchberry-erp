// src/pages/Payouts.tsx
import React, { useState, useEffect } from 'react';
import {
  CreditCard, Clock, CheckCircle, XCircle, Upload, FileText,
  Search, Shield, AlertCircle, Download
} from 'lucide-react';
import apiClient from '../api/axios';

interface PayoutRequest {
  id: number;
  seller_id: number;
  amount: number;
  comment: string | null;
  status: 'pending' | 'approved' | 'rejected';
  admin_comment: string | null;
  proof_file_url: string | null;
  created_at: string;
  updated_at: string;

  seller_username?: string;
  seller_full_name?: string;
  seller_balance?: number;
  seller_notes?: string;
}

export const Payouts = () => {
  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const userRole = localStorage.getItem('userRole');
  const [currentBalance, setCurrentBalance] = useState<number>(0);

  // Модальные окна
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isApproveOpen, setIsApproveOpen] = useState(false);
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const [isDragActive, setIsDragActive] = useState(false);

  // Данные форм
  const [createData, setCreateData] = useState({ amount: 0, comment: '' });
  const [selectedRequest, setSelectedRequest] = useState<PayoutRequest | null>(null);
  const [approveComment, setApproveComment] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    fetchData();
  }, [userRole]);

  useEffect(() => {
    const handlePaste = (e: any) => {
      if (isUploadOpen && e.clipboardData && e.clipboardData.files.length > 0) {
        setSelectedFile(e.clipboardData.files[0]);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isUploadOpen]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      if (userRole === 'seller') {
        const userRes = await apiClient.get('/users/me');
        setCurrentBalance(userRes.data.balance);
      }

      const endpoint = userRole === 'admin' ? '/payouts/all' : '/payouts/me';
      const res = await apiClient.get(endpoint);
      setRequests(res.data);
    } catch (error) {
      console.error("Ошибка загрузки выплат:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // --- ДЕЙСТВИЯ ---
  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createData.amount <= 0) return alert("Сумма должна быть больше нуля");
    if (createData.amount > currentBalance) return alert("Сумма превышает ваш текущий баланс!");

    try {
      setIsSaving(true);
      await apiClient.post('/payouts/', createData);
      setIsCreateOpen(false);
      setCreateData({ amount: 0, comment: '' });
      await fetchData();
    } catch (error: any) {
      alert(error.response?.data?.detail || "Ошибка при создании запроса");
    } finally {
      setIsSaving(false);
    }
  };

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRequest) return;
    try {
      setIsSaving(true);
      await apiClient.post(`/payouts/${selectedRequest.id}/process`, {
        action: 'approve',
        admin_comment: approveComment
      });
      setIsApproveOpen(false);
      setApproveComment('');
      await fetchData();
    } catch (error: any) {
      alert(error.response?.data?.detail || "Ошибка подтверждения");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRequest || !rejectReason.trim()) return alert("Укажите причину отказа");
    try {
      setIsSaving(true);
      await apiClient.post(`/payouts/${selectedRequest.id}/process`, {
        action: 'reject',
        admin_comment: rejectReason
      });
      setIsRejectOpen(false);
      setRejectReason('');
      await fetchData();
    } catch (error: any) {
      alert(error.response?.data?.detail || "Ошибка отклонения");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUploadProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRequest || !selectedFile) return alert("Выберите файл");

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      setIsSaving(true);
      await apiClient.post(`/payouts/${selectedRequest.id}/upload-proof`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setIsUploadOpen(false);
      setSelectedFile(null);
      await fetchData();
    } catch (error: any) {
      alert(error.response?.data?.detail || "Ошибка загрузки файла");
    } finally {
      setIsSaving(false);
    }
  };

  // --- УТИЛИТЫ ---
  const openApproveModal = (req: PayoutRequest) => {
    setSelectedRequest(req);
    setApproveComment('');
    setIsApproveOpen(true);
  };

  const openRejectModal = (req: PayoutRequest) => {
    setSelectedRequest(req);
    setRejectReason('');
    setIsRejectOpen(true);
  };

  const openUploadModal = (req: PayoutRequest) => {
    setSelectedRequest(req);
    setSelectedFile(null);
    setIsDragActive(false);
    setIsUploadOpen(true);
  };

  const getFileUrl = (url: string | null) => {
    if (!url) return '#';
    return url.startsWith('/api') ? url : `/api${url}`;
  };

  const filteredRequests = requests.filter(r =>
    userRole === 'admin'
      ? r.seller_username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.seller_full_name?.toLowerCase().includes(searchQuery.toLowerCase())
      : true
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-100 text-amber-700 text-xs font-bold rounded-lg"><Clock size={14} /> Ожидание</span>;
      case 'approved': return <span className="flex items-center gap-1.5 px-2.5 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-lg"><CheckCircle size={14} /> Выплачено</span>;
      case 'rejected': return <span className="flex items-center gap-1.5 px-2.5 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-lg"><XCircle size={14} /> Отклонено</span>;
      default: return null;
    }
  };

  const hasPendingRequest = requests.some(r => r.status === 'pending');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Запросы на выплаты</h1>
          <p className="text-gray-500 mt-1">Управление выводом средств и чеками</p>
        </div>

        {userRole === 'seller' && (
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-gray-500 font-medium uppercase">Доступно к выводу</p>
              <p className="text-xl font-bold text-gray-900">{currentBalance.toLocaleString('ru-RU')} ₽</p>
            </div>
            <button
              onClick={() => { setCreateData({ amount: currentBalance, comment: '' }); setIsCreateOpen(true); }}
              disabled={hasPendingRequest || currentBalance <= 0}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              <CreditCard size={18} />
              Запросить выплату
            </button>
          </div>
        )}
      </div>

      {userRole === 'seller' && hasPendingRequest && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle className="shrink-0 mt-0.5 text-amber-600" size={20} />
          <div>
            <h3 className="font-bold">У вас есть необработанный запрос</h3>
            <p className="text-sm mt-1 opacity-90">Вы не можете создать новый запрос, пока администратор не примет решение по текущему. Пожалуйста, ожидайте.</p>
          </div>
        </div>
      )}

      {userRole === 'admin' && (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
          <div className="flex flex-1 max-w-md relative">
            <input
              type="text" placeholder="Поиск по логину или ФИО..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Search size={18} className="absolute left-3 top-2.5 text-gray-400" />
          </div>
        </div>
      )}

      {/* ТАБЛИЦА */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
        {isLoading && <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div></div>}

        {filteredRequests.length === 0 && !isLoading ? (
          <div className="p-12 text-center flex flex-col items-center">
            <Shield className="w-12 h-12 text-gray-300 mb-3" />
            <p className="text-gray-500 text-lg">Запросов на выплату пока нет</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="p-4 text-sm font-semibold text-gray-600">Дата</th>
                {userRole === 'admin' && <th className="p-4 text-sm font-semibold text-gray-600">Автор</th>}
                <th className="p-4 text-sm font-semibold text-gray-600">Сумма</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Детали</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Статус</th>
                <th className="p-4 text-sm font-semibold text-gray-600 text-right">Документ / Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRequests.map((req) => (
                <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                  <td className="p-4 text-sm text-gray-600 whitespace-nowrap">
                    {new Date(req.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>

                  {userRole === 'admin' && (
                    <td className="p-4">
                      <p className="font-bold text-gray-900">{req.seller_username}</p>
                      <p className="text-xs text-gray-500">{req.seller_full_name || '—'}</p>
                      {req.status === 'pending' && <p className="text-[10px] text-indigo-600 font-bold mt-1">На счету: {req.seller_balance} ₽</p>}
                    </td>
                  )}

                  <td className="p-4 font-bold text-gray-900 text-lg">
                    {req.amount.toLocaleString('ru-RU')} ₽
                  </td>

                  <td className="p-4 max-w-xs">
                    {userRole === 'admin' && req.seller_notes && (
                      <div className="mb-2 p-2 bg-blue-50 text-blue-800 text-xs rounded border border-blue-100">
                        <span className="font-bold block mb-0.5">Реквизиты из профиля:</span>
                        {req.seller_notes}
                      </div>
                    )}
                    {req.comment && (
                      <div className="text-sm text-gray-600">
                        <span className="font-medium text-gray-800">Комментарий:</span> {req.comment}
                      </div>
                    )}
                    {req.admin_comment && (
                      <div className="mt-1 text-sm text-blue-600 bg-blue-50 p-1.5 rounded">
                        <span className="font-bold">Админ:</span> {req.admin_comment}
                      </div>
                    )}
                  </td>

                  <td className="p-4">
                    {getStatusBadge(req.status)}
                  </td>

                  <td className="p-4 text-right align-middle">
                    <div className="flex justify-end items-center gap-2">
                      {req.proof_file_url && (
                        <a
                          href={getFileUrl(req.proof_file_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                        >
                          <Download size={16} /> Чек
                        </a>
                      )}

                      {userRole === 'admin' && (
                        <>
                          {!req.proof_file_url && req.status !== 'rejected' && (
                            <button onClick={() => openUploadModal(req)} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded transition-colors" title="Прикрепить чек">
                              <Upload size={18} />
                            </button>
                          )}

                          {req.status === 'pending' && (
                            <>
                              <button onClick={() => openApproveModal(req)} className="p-1.5 text-green-600 hover:bg-green-100 rounded transition-colors" title="Подтвердить выплату">
                                <CheckCircle size={20} />
                              </button>
                              <button onClick={() => openRejectModal(req)} className="p-1.5 text-red-500 hover:bg-red-100 rounded transition-colors" title="Отклонить">
                                <XCircle size={20} />
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* МОДАЛКА: СОЗДАТЬ ЗАПРОС (АВТОР) */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Запрос на выплату</h2>
            <form onSubmit={handleCreateRequest} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Сумма к выводу (₽) *</label>
                <input
                  required type="number" min="1" max={currentBalance} step="1"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 font-bold text-lg"
                  value={createData.amount || ''}
                  onChange={(e) => setCreateData({...createData, amount: parseFloat(e.target.value) || 0})}
                />
                <p className="text-xs text-gray-500 mt-1">Доступно: {currentBalance} ₽</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Комментарий / Новые реквизиты (необязательно)</label>
                <textarea
                  rows={3} placeholder="Например: Переведите, пожалуйста, по номеру телефона на Сбер..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 resize-none"
                  value={createData.comment} onChange={(e) => setCreateData({...createData, comment: e.target.value})}
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-100">
                <button type="button" disabled={isSaving} onClick={() => setIsCreateOpen(false)} className="flex-1 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium disabled:opacity-50">Отмена</button>
                <button type="submit" disabled={isSaving} className="flex-1 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium flex items-center justify-center gap-2 disabled:bg-indigo-400">
                  {isSaving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>Отправка...</> : 'Запросить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* МОДАЛКА: ПОДТВЕРДИТЬ ВЫПЛАТУ (С КОММЕНТАРИЕМ) (АДМИН) */}
      {isApproveOpen && selectedRequest && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-green-100 text-green-600 rounded-full"><CheckCircle size={24} /></div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Подтвердить выплату</h2>
                <p className="text-sm text-gray-500">{selectedRequest.seller_username} • {selectedRequest.amount} ₽</p>
              </div>
            </div>
            <form onSubmit={handleApprove} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Комментарий к выплате (опционально)</label>
                <textarea
                  rows={3} placeholder="Например: Переведено по номеру карты..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-green-500 resize-none"
                  value={approveComment} onChange={(e) => setApproveComment(e.target.value)}
                />
              </div>
              <div className="flex gap-3 pt-4 border-t border-gray-100">
                <button type="button" disabled={isSaving} onClick={() => setIsApproveOpen(false)} className="flex-1 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium disabled:opacity-50">Отмена</button>
                <button type="submit" disabled={isSaving} className="flex-1 py-2 text-white bg-green-600 hover:bg-green-700 rounded-lg font-medium flex items-center justify-center gap-2 disabled:bg-green-400">
                  {isSaving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>Обработка...</> : 'Подтвердить выплату'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* МОДАЛКА: ОТКЛОНЕНИЕ ЗАПРОСА (АДМИН) */}
      {isRejectOpen && selectedRequest && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-red-100 text-red-600 rounded-full"><XCircle size={24} /></div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Отклонить выплату</h2>
                <p className="text-sm text-gray-500">{selectedRequest.seller_username} • {selectedRequest.amount} ₽</p>
              </div>
            </div>
            <form onSubmit={handleReject} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Укажите причину отказа *</label>
                <textarea
                  required rows={3} placeholder="Причина будет отправлена автору в ВК..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-red-500 resize-none"
                  value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                />
              </div>
              <div className="flex gap-3 pt-4 border-t border-gray-100">
                <button type="button" disabled={isSaving} onClick={() => setIsRejectOpen(false)} className="flex-1 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium disabled:opacity-50">Отмена</button>
                <button type="submit" disabled={isSaving} className="flex-1 py-2 text-white bg-red-500 hover:bg-red-600 rounded-lg font-medium flex items-center justify-center gap-2 disabled:bg-red-300">
                  {isSaving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>Отклонение...</> : 'Отклонить запрос'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* МОДАЛКА: ЗАГРУЗКА ЧЕКА С DRAG & DROP (АДМИН) */}
      {isUploadOpen && selectedRequest && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Прикрепить чек</h2>
            <p className="text-sm text-gray-500 mb-4">Для выплаты {selectedRequest.seller_username} на {selectedRequest.amount} ₽</p>

            <form onSubmit={handleUploadProof} className="space-y-4">
              <div className="flex items-center justify-center w-full">
                <label
                  className={`flex flex-col items-center justify-center w-full h-36 border-2 border-dashed rounded-xl cursor-pointer transition-all ${
                    isDragActive
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setIsDragActive(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setIsDragActive(false); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragActive(false);
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      setSelectedFile(e.dataTransfer.files[0]);
                    }
                  }}
                >
                  <div className="flex flex-col items-center justify-center pt-5 pb-6 pointer-events-none">
                    <FileText className={`w-10 h-10 mb-3 transition-colors ${isDragActive ? 'text-indigo-500' : 'text-gray-400'}`} />
                    <p className="text-sm text-gray-500 font-medium text-center px-4 leading-relaxed">
                      {selectedFile
                        ? <span className="text-indigo-600 font-bold">{selectedFile.name}</span>
                        : "Нажмите, перетащите файл сюда или вставьте из буфера (Ctrl+V)"
                      }
                    </p>
                  </div>
                  <input type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
                </label>
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-100">
                <button type="button" disabled={isSaving} onClick={() => setIsUploadOpen(false)} className="flex-1 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium disabled:opacity-50">Отмена</button>
                <button type="submit" disabled={isSaving || !selectedFile} className="flex-1 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium flex items-center justify-center gap-2 disabled:bg-indigo-300">
                  {isSaving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>Загрузка...</> : 'Загрузить чек'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};