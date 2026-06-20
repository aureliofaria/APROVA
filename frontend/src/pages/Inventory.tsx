import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, departmentsApi } from '../services/api';
import Header from '../components/Header';
import toast from 'react-hot-toast';
import type { Asset, AssetStatus } from '../types';

const fmtMoney = (cents?: number | null) =>
  cents != null ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100) : '-';

const ASSET_STATUS: Record<AssetStatus, { label: string; cls: string }> = {
  DISPONIVEL: { label: 'Disponível', cls: 'bg-green-100 text-green-700' },
  ATIVO: { label: 'Em uso', cls: 'bg-golplus-blue-100 text-golplus-blue-800' },
  RESERVADO: { label: 'Reservado', cls: 'bg-amber-100 text-amber-800' },
  MANUTENCAO: { label: 'Manutenção', cls: 'bg-orange-100 text-orange-700' },
  EMPRESTADO: { label: 'Emprestado', cls: 'bg-purple-100 text-purple-700' },
  DESCARTADO: { label: 'Descartado', cls: 'bg-gray-100 text-gray-500' },
};
const statusBadge = (s: string) => ASSET_STATUS[s as AssetStatus] ?? { label: s, cls: 'bg-gray-100 text-gray-600' };

const CATEGORIES = ['HARDWARE', 'PERIFERICO', 'SMARTPHONE', 'CHIP', 'MOBILIARIO', 'OUTROS'];
const MOVEMENT_TYPES = ['ALOCACAO', 'DEVOLUCAO', 'TRANSFERENCIA', 'MANUTENCAO', 'RETORNO_MANUTENCAO', 'EMPRESTIMO', 'DESCARTE', 'AJUSTE_STATUS'];

const assetLocation = (a: Asset) =>
  a.user?.name ? `👤 ${a.user.name}` : a.department?.name ? `🏢 ${a.department.name}` : a.warehouse?.name ? `📦 ${a.warehouse.name}` : '—';

export default function Inventory() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'assets' | 'catalog' | 'movements'>('assets');

  return (
    <div>
      <Header title="Inventário" subtitle="Patrimônio de TI e Administrativo — ativos, catálogo e movimentações" />

      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {([['assets', 'Ativos'], ['catalog', 'Catálogo'], ['movements', 'Movimentações']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === k ? 'border-golplus-blue-600 text-golplus-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'assets' && <AssetsTab qc={qc} />}
      {tab === 'catalog' && <CatalogTab qc={qc} />}
      {tab === 'movements' && <MovementsTab />}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AssetsTab({ qc }: { qc: any }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [moving, setMoving] = useState<Asset | null>(null);

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['assets', statusFilter],
    queryFn: () => inventoryApi.getAssets({ status: statusFilter || undefined }),
  });

  const filtered = assets.filter((a) =>
    !search || [a.tag, a.serialNumber, a.item?.name].some((v) => v?.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por etiqueta, série ou item…"
          className="flex-1 min-w-[220px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500">
          <option value="">Todos os status</option>
          {Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-golplus-blue-600 text-white rounded-lg text-sm font-medium hover:bg-golplus-blue-700">+ Novo ativo</button>
      </div>

      {isLoading && <div className="text-sm text-gray-400 text-center py-8">Carregando…</div>}
      {!isLoading && filtered.length === 0 && (
        <div className="bg-gray-50 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">Nenhum ativo encontrado.</div>
      )}

      {filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Etiqueta</th>
                <th className="px-4 py-2 text-left">Item</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Localização</th>
                <th className="px-4 py-2 text-left">Valor NF</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900">{a.tag || '—'}</td>
                  <td className="px-4 py-2 text-gray-700">{a.item?.name}{a.serialNumber ? <span className="text-gray-400"> · {a.serialNumber}</span> : null}</td>
                  <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(a.status).cls}`}>{statusBadge(a.status).label}</span></td>
                  <td className="px-4 py-2 text-gray-600">{assetLocation(a)}</td>
                  <td className="px-4 py-2 text-gray-600">{fmtMoney(a.invoiceValueCents)}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => setMoving(a)} className="text-xs text-golplus-blue-600 hover:text-golplus-blue-800 font-medium">Movimentar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateAssetModal qc={qc} onClose={() => setShowCreate(false)} />}
      {moving && <MovementModal qc={qc} asset={moving} onClose={() => setMoving(null)} />}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CreateAssetModal({ qc, onClose }: { qc: any; onClose: () => void }) {
  const { data: items = [] } = useQuery({ queryKey: ['inv-items'], queryFn: () => inventoryApi.getItems({ isActive: 'true' }) });
  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses'], queryFn: inventoryApi.getWarehouses });
  const [form, setForm] = useState({ itemId: '', tag: '', serialNumber: '', supplier: '', invoiceValue: '', warehouseId: '', condition: 'NOVO' });

  const create = useMutation({
    mutationFn: () => inventoryApi.createAsset({
      itemId: form.itemId,
      tag: form.tag || undefined,
      serialNumber: form.serialNumber || undefined,
      supplier: form.supplier || undefined,
      invoiceValueCents: form.invoiceValue ? Math.round(parseFloat(form.invoiceValue) * 100) : undefined,
      warehouseId: form.warehouseId || undefined,
      condition: form.condition as Asset['condition'],
    }),
    onSuccess: () => { toast.success('Ativo cadastrado!'); qc.invalidateQueries({ queryKey: ['assets'] }); onClose(); },
    onError: () => toast.error('Erro ao cadastrar ativo'),
  });

  return (
    <Modal title="Novo ativo" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Item do catálogo *">
          <select value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })} className={inputCls}>
            <option value="">Selecione…</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Etiqueta / Patrimônio"><input value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} className={inputCls} placeholder="PAT-0001" /></Field>
          <Field label="Nº de série"><input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} className={inputCls} /></Field>
          <Field label="Fornecedor"><input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className={inputCls} /></Field>
          <Field label="Valor NF (R$)"><input type="number" step="0.01" value={form.invoiceValue} onChange={(e) => setForm({ ...form, invoiceValue: e.target.value })} className={inputCls} placeholder="0,00" /></Field>
          <Field label="Almoxarifado">
            <select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} className={inputCls}>
              <option value="">—</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
          <Field label="Condição">
            <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} className={inputCls}>
              {['NOVO', 'BOM', 'REGULAR', 'RUIM'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
          <button onClick={() => form.itemId ? create.mutate() : toast.error('Selecione o item')} disabled={create.isPending} className="px-4 py-2 bg-golplus-blue-600 text-white rounded-lg text-sm font-medium hover:bg-golplus-blue-700 disabled:opacity-50">
            {create.isPending ? 'Salvando…' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MovementModal({ qc, asset, onClose }: { qc: any; asset: Asset; onClose: () => void }) {
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: departmentsApi.getAll });
  const [type, setType] = useState('ALOCACAO');
  const [toDepartmentId, setToDepartmentId] = useState('');
  const [reason, setReason] = useState('');

  const move = useMutation({
    mutationFn: () => inventoryApi.registerMovement(asset.id, { type, toDepartmentId: toDepartmentId || undefined, reason: reason || undefined }),
    onSuccess: () => { toast.success('Movimentação registrada!'); qc.invalidateQueries({ queryKey: ['assets'] }); qc.invalidateQueries({ queryKey: ['movements'] }); onClose(); },
    onError: () => toast.error('Erro ao registrar movimentação'),
  });

  return (
    <Modal title={`Movimentar — ${asset.tag || asset.item?.name}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Tipo">
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
            {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Departamento de destino (opcional)">
          <select value={toDepartmentId} onChange={(e) => setToDepartmentId(e.target.value)} className={inputCls}>
            <option value="">—</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Motivo / observação"><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
          <button onClick={() => move.mutate()} disabled={move.isPending} className="px-4 py-2 bg-golplus-blue-600 text-white rounded-lg text-sm font-medium hover:bg-golplus-blue-700 disabled:opacity-50">
            {move.isPending ? 'Registrando…' : 'Registrar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CatalogTab({ qc }: { qc: any }) {
  const { data: items = [], isLoading } = useQuery({ queryKey: ['inv-items'], queryFn: () => inventoryApi.getItems() });
  const [form, setForm] = useState({ code: '', name: '', type: 'TI', category: 'HARDWARE', brand: '', model: '' });

  const create = useMutation({
    mutationFn: () => inventoryApi.createItem({
      code: form.code.trim(), name: form.name.trim(), type: form.type as 'TI' | 'ADMINISTRATIVO',
      category: form.category as never, brand: form.brand || undefined, model: form.model || undefined,
    }),
    onSuccess: () => { toast.success('Item adicionado!'); qc.invalidateQueries({ queryKey: ['inv-items'] }); setForm({ code: '', name: '', type: 'TI', category: 'HARDWARE', brand: '', model: '' }); },
    onError: () => toast.error('Erro ao criar item (código duplicado?)'),
  });

  return (
    <div>
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Adicionar item ao catálogo</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="Código *"><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={inputCls} placeholder="NB-DELL-5430" /></Field>
          <Field label="Nome *"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></Field>
          <Field label="Tipo">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inputCls}>
              <option value="TI">TI</option><option value="ADMINISTRATIVO">Administrativo</option>
            </select>
          </Field>
          <Field label="Categoria">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Marca"><input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className={inputCls} /></Field>
          <Field label="Modelo"><input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className={inputCls} /></Field>
        </div>
        <div className="flex justify-end mt-3">
          <button onClick={() => form.code.trim() && form.name.trim() ? create.mutate() : toast.error('Código e nome são obrigatórios')} disabled={create.isPending} className="px-4 py-2 bg-golplus-blue-600 text-white rounded-lg text-sm font-medium hover:bg-golplus-blue-700 disabled:opacity-50">
            {create.isPending ? 'Salvando…' : '+ Adicionar'}
          </button>
        </div>
      </div>

      {isLoading && <div className="text-sm text-gray-400 text-center py-8">Carregando…</div>}
      {!isLoading && items.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr><th className="px-4 py-2 text-left">Código</th><th className="px-4 py-2 text-left">Nome</th><th className="px-4 py-2 text-left">Tipo</th><th className="px-4 py-2 text-left">Categoria</th><th className="px-4 py-2 text-left">Marca/Modelo</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((i) => (
                <tr key={i.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900">{i.code}</td>
                  <td className="px-4 py-2 text-gray-700">{i.name}</td>
                  <td className="px-4 py-2 text-gray-600">{i.type}</td>
                  <td className="px-4 py-2 text-gray-600">{i.category}</td>
                  <td className="px-4 py-2 text-gray-500">{[i.brand, i.model].filter(Boolean).join(' ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MovementsTab() {
  const { data: movements = [], isLoading } = useQuery({ queryKey: ['movements'], queryFn: () => inventoryApi.getMovements() });
  return (
    <div>
      {isLoading && <div className="text-sm text-gray-400 text-center py-8">Carregando…</div>}
      {!isLoading && movements.length === 0 && (
        <div className="bg-gray-50 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">Nenhuma movimentação registrada.</div>
      )}
      {movements.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr><th className="px-4 py-2 text-left">Data</th><th className="px-4 py-2 text-left">Ativo</th><th className="px-4 py-2 text-left">Tipo</th><th className="px-4 py-2 text-left">Status</th><th className="px-4 py-2 text-left">Motivo</th><th className="px-4 py-2 text-left">Solicitação</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {movements.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-500">{new Date(m.movementDate).toLocaleDateString('pt-BR')}</td>
                  <td className="px-4 py-2 text-gray-700">{m.asset?.tag || m.asset?.item?.name || m.assetId.slice(0, 8)}</td>
                  <td className="px-4 py-2"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{m.type}</span></td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{m.previousStatus || '—'} → {m.newStatus || '—'}</td>
                  <td className="px-4 py-2 text-gray-500">{m.reason || '—'}</td>
                  <td className="px-4 py-2 text-gray-500">{m.requestId ? <a href={`/requests/${m.requestId}`} className="text-golplus-blue-600 hover:underline">ver</a> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ----- UI helpers -----
const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-gray-900 mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}
