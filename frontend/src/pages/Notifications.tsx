import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { notificationsApi } from '../services/api';
import Header from '../components/Header';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const EVENTS: { key: string; label: string }[] = [
  { key: 'TASK_ASSIGNED', label: 'Tarefa atribuída a mim' },
  { key: 'REQUEST_REJECTED', label: 'Minha solicitação rejeitada' },
  { key: 'REQUEST_COMPLETED', label: 'Minha solicitação concluída' },
  { key: 'COMMENT_ADDED', label: 'Novo comentário' },
];

export default function Notifications() {
  const qc = useQueryClient();
  const [showPrefs, setShowPrefs] = useState(false);

  const { data: notifications = [], isLoading } = useQuery({ queryKey: ['notifications', 'ALL'], queryFn: () => notificationsApi.list('ALL') });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['notif-unread'] }); },
  });
  const readAll = useMutation({
    mutationFn: () => notificationsApi.readAll(),
    onSuccess: () => { toast.success('Tudo marcado como lido'); qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['notif-unread'] }); },
  });

  return (
    <div>
      <Header title="Notificações" subtitle="Avisos sobre suas tarefas e solicitações" />

      <div className="flex justify-between items-center mb-4">
        <button onClick={() => setShowPrefs((v) => !v)} className="text-sm text-golplus-blue-600 hover:text-golplus-blue-800 font-medium">
          {showPrefs ? '← Voltar às notificações' : '⚙ Preferências'}
        </button>
        {!showPrefs && (
          <button onClick={() => readAll.mutate()} className="text-sm text-gray-600 hover:text-gray-900">Marcar todas como lidas</button>
        )}
      </div>

      {showPrefs ? (
        <PreferencesPanel />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {isLoading && <div className="text-sm text-gray-400 text-center py-8">Carregando…</div>}
          {!isLoading && notifications.length === 0 && <div className="text-sm text-gray-500 text-center py-8">Nenhuma notificação.</div>}
          {notifications.map((n) => (
            <div key={n.id} className={`flex items-start gap-3 p-4 ${n.status === 'UNREAD' ? 'bg-golplus-blue-50/40' : ''}`}>
              <div className={`w-2 h-2 mt-2 rounded-full flex-shrink-0 ${n.status === 'UNREAD' ? 'bg-golplus-blue-500' : 'bg-transparent'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{n.title}</p>
                {n.body && <p className="text-sm text-gray-600 mt-0.5">{n.body}</p>}
                <p className="text-xs text-gray-400 mt-1">
                  {format(new Date(n.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  {n.requestId && <> · <Link to={`/requests/${n.requestId}`} className="text-golplus-blue-600 hover:underline">ver solicitação</Link></>}
                </p>
              </div>
              {n.status === 'UNREAD' && (
                <button onClick={() => markRead.mutate(n.id)} className="text-xs text-gray-400 hover:text-golplus-blue-600 flex-shrink-0">marcar lida</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PreferencesPanel() {
  const qc = useQueryClient();
  const { data: prefs = [] } = useQuery({ queryKey: ['notif-prefs'], queryFn: notificationsApi.getPreferences });

  // IN_APP é habilitado por padrão; só consideramos desabilitado quando há
  // preferência explícita com enabled=false.
  const isEnabled = (eventType: string) => {
    const p = prefs.find((x) => x.channel === 'IN_APP' && x.eventType === eventType);
    return p ? p.enabled : true;
  };

  const save = useMutation({
    mutationFn: (eventType: string) => notificationsApi.updatePreferences([{ channel: 'IN_APP', eventType, enabled: !isEnabled(eventType) }]),
    onSuccess: () => { toast.success('Preferência salva'); qc.invalidateQueries({ queryKey: ['notif-prefs'] }); },
    onError: () => toast.error('Erro ao salvar'),
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">Notificações no aplicativo (in-app)</h2>
      <p className="text-xs text-gray-500 mb-4">Escolha quais eventos geram um aviso para você. Canais externos (Teams/Outlook) serão habilitados futuramente.</p>
      <div className="space-y-2">
        {EVENTS.map((e) => (
          <label key={e.key} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
            <span className="text-sm text-gray-800">{e.label}</span>
            <input type="checkbox" checked={isEnabled(e.key)} onChange={() => save.mutate(e.key)} className="rounded border-gray-300 text-golplus-blue-600 focus:ring-golplus-blue-500" />
          </label>
        ))}
      </div>
    </div>
  );
}
