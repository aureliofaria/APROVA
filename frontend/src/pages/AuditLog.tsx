import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditApi } from '../services/api';
import Header from '../components/Header';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { auditActionLabel } from '../lib/auditActions';

export default function AuditLog() {
  const [filters, setFilters] = useState({ action: '', from: '', to: '' });
  const [exporting, setExporting] = useState(false);

  const params = {
    action: filters.action || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
  };

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['audit-logs', params],
    queryFn: () => auditApi.list(params),
  });
  const { data: actions = [] } = useQuery({ queryKey: ['audit-actions'], queryFn: auditApi.actions });

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await auditApi.export(params);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `auditoria-aprova-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Erro ao exportar');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <Header title="Trilha de Auditoria" subtitle="Registro de ações do sistema — acesso restrito (LGPD)" />

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Ação</label>
          <select value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500">
            <option value="">Todas</option>
            {actions.map((a) => <option key={a} value={a}>{auditActionLabel(a)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">De</label>
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Até</label>
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" />
        </div>
        <div className="ml-auto">
          <button onClick={handleExport} disabled={exporting} className="px-4 py-2 bg-golplus-blue-600 text-white rounded-lg text-sm font-medium hover:bg-golplus-blue-700 disabled:opacity-50">
            {exporting ? 'Exportando…' : '⬇ Exportar Excel'}
          </button>
        </div>
      </div>

      {isLoading && <div className="text-sm text-gray-400 text-center py-8">Carregando…</div>}
      {!isLoading && logs.length === 0 && (
        <div className="bg-gray-50 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">Nenhum registro encontrado.</div>
      )}

      {logs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Data/Hora</th>
                  <th className="px-4 py-2 text-left">Solicitação</th>
                  <th className="px-4 py-2 text-left">Usuário</th>
                  <th className="px-4 py-2 text-left">Ação</th>
                  <th className="px-4 py-2 text-left">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{format(new Date(l.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}</td>
                    <td className="px-4 py-2 text-gray-700">{l.request?.title ? <a href={`/requests/${l.requestId}`} className="text-golplus-blue-600 hover:underline">{l.request.title}</a> : '—'}</td>
                    <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{l.userName}</td>
                    <td className="px-4 py-2"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 whitespace-nowrap" title={l.action}>{auditActionLabel(l.action)}</span></td>
                    <td className="px-4 py-2 text-gray-500">{l.details || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
