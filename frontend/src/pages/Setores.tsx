import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sectorsApi, usersApi } from '../services/api';
import Header from '../components/Header';
import toast from 'react-hot-toast';
import type { Sector, SectorMember } from '../types';

const roleLabel: Record<string, string> = { LIDER: 'Líder', PROTETOR: 'Protetor' };
const roleBadge: Record<string, string> = {
  LIDER: 'bg-golplus-blue-100 text-golplus-blue-700',
  PROTETOR: 'bg-golplus-orange-100 text-golplus-orange-700',
};

function MemberBadge({ member, onRemove, onChangeRole }: {
  member: SectorMember;
  onRemove: () => void;
  onChangeRole: (role: 'LIDER' | 'PROTETOR') => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="w-8 h-8 rounded-full bg-golplus-blue-100 flex items-center justify-center text-golplus-blue-700 font-bold text-sm">
        {member.user.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">{member.user.name}</div>
        <div className="text-xs text-gray-400 truncate">{member.user.email}</div>
      </div>
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className={`px-2 py-1 rounded-lg text-xs font-medium ${roleBadge[member.role]} cursor-pointer`}
        >
          {roleLabel[member.role]} ▾
        </button>
        {open && (
          <div className="absolute right-0 top-7 z-10 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-32">
            {(['LIDER', 'PROTETOR'] as const).map((r) => (
              <button
                key={r}
                onClick={() => { onChangeRole(r); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${member.role === r ? 'font-bold' : ''}`}
              >
                {roleLabel[r]}
              </button>
            ))}
            <hr className="my-1" />
            <button
              onClick={() => { onRemove(); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
            >
              Remover
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SectorCard({ sector }: { sector: Sector }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sector.name);
  const [description, setDescription] = useState(sector.description || '');
  const [addingRole, setAddingRole] = useState<'LIDER' | 'PROTETOR' | null>(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const qc = useQueryClient();

  const { data: available } = useQuery({
    queryKey: ['sector-available', sector.id],
    queryFn: () => sectorsApi.availableUsers(sector.id),
    enabled: !!addingRole,
  });

  const updateMut = useMutation({
    mutationFn: () => sectorsApi.update(sector.id, { name, description }),
    onSuccess: () => { toast.success('Setor atualizado'); setEditing(false); qc.invalidateQueries({ queryKey: ['sectors'] }); },
    onError: () => toast.error('Erro ao atualizar setor'),
  });

  const toggleMut = useMutation({
    mutationFn: () => sectorsApi.update(sector.id, { isActive: !sector.isActive }),
    onSuccess: () => { toast.success(sector.isActive ? 'Setor desativado' : 'Setor ativado'); qc.invalidateQueries({ queryKey: ['sectors'] }); },
  });

  const deleteMut = useMutation({
    mutationFn: () => sectorsApi.delete(sector.id),
    onSuccess: () => { toast.success('Setor removido'); qc.invalidateQueries({ queryKey: ['sectors'] }); },
    onError: () => toast.error('Erro ao remover setor'),
  });

  const addMemberMut = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'LIDER' | 'PROTETOR' }) =>
      sectorsApi.addMember(sector.id, userId, role),
    onSuccess: () => {
      toast.success('Membro adicionado');
      setAddingRole(null);
      setSelectedUserId('');
      qc.invalidateQueries({ queryKey: ['sectors'] });
      qc.invalidateQueries({ queryKey: ['sector-available', sector.id] });
    },
    onError: () => toast.error('Erro ao adicionar membro'),
  });

  const removeMemberMut = useMutation({
    mutationFn: (memberId: string) => sectorsApi.removeMember(sector.id, memberId),
    onSuccess: () => {
      toast.success('Membro removido');
      qc.invalidateQueries({ queryKey: ['sectors'] });
      qc.invalidateQueries({ queryKey: ['sector-available', sector.id] });
    },
  });

  const changeRoleMut = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: 'LIDER' | 'PROTETOR' }) =>
      sectorsApi.updateMember(sector.id, memberId, role),
    onSuccess: () => { toast.success('Papel atualizado'); qc.invalidateQueries({ queryKey: ['sectors'] }); },
  });

  const lideres = sector.members.filter((m) => m.role === 'LIDER');
  const protetores = sector.members.filter((m) => m.role === 'PROTETOR');

  return (
    <div className={`bg-white rounded-2xl border shadow-sm transition-all ${sector.isActive ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-70'}`}>
      {/* Header */}
      <div className="flex items-center gap-4 p-5">
        <div className="w-10 h-10 rounded-xl bg-golplus-blue-100 flex items-center justify-center text-golplus-blue-700 font-bold text-lg">
          {sector.name.charAt(0).toUpperCase()}
        </div>

        {editing ? (
          <div className="flex-1 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 px-3 py-1.5 border border-golplus-blue rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-300"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrição..."
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none"
            />
            <button onClick={() => updateMut.mutate()} className="px-3 py-1.5 bg-golplus-blue text-white rounded-lg text-sm">Salvar</button>
            <button onClick={() => { setEditing(false); setName(sector.name); setDescription(sector.description || ''); }} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm">✕</button>
          </div>
        ) : (
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900">{sector.name}</span>
              {!sector.isActive && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inativo</span>}
            </div>
            {sector.description && <div className="text-xs text-gray-400 mt-0.5">{sector.description}</div>}
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-golplus-blue rounded-full" />
            {lideres.length} líder{lideres.length !== 1 ? 'es' : ''}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-golplus-orange rounded-full" />
            {protetores.length} protetor{protetores.length !== 1 ? 'es' : ''}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {!editing && (
            <button onClick={() => setEditing(true)} className="p-1.5 text-gray-400 hover:text-golplus-blue rounded-lg hover:bg-golplus-blue-50" title="Editar">
              ✏️
            </button>
          )}
          <button onClick={() => toggleMut.mutate()} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50" title={sector.isActive ? 'Desativar' : 'Ativar'}>
            {sector.isActive ? '🔒' : '🔓'}
          </button>
          <button
            onClick={() => { if (window.confirm(`Remover setor "${sector.name}"?`)) deleteMut.mutate(); }}
            className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50"
            title="Excluir"
          >
            🗑️
          </button>
          <button onClick={() => setExpanded(!expanded)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-50">
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-gray-100 p-5 space-y-5">
          {/* Líderes */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-golplus-blue flex items-center gap-2">
                <span className="w-2 h-2 bg-golplus-blue rounded-full" />
                Líderes de Setor
              </h3>
              <button
                onClick={() => setAddingRole(addingRole === 'LIDER' ? null : 'LIDER')}
                className="text-xs text-golplus-blue hover:text-golplus-blue-700 font-medium"
              >
                + Adicionar Líder
              </button>
            </div>
            {lideres.length === 0 && <p className="text-xs text-gray-400 italic">Nenhum líder atribuído.</p>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {lideres.map((m) => (
                <MemberBadge
                  key={m.id}
                  member={m}
                  onRemove={() => removeMemberMut.mutate(m.id)}
                  onChangeRole={(role) => changeRoleMut.mutate({ memberId: m.id, role })}
                />
              ))}
            </div>
            {addingRole === 'LIDER' && (
              <div className="mt-3 flex gap-2">
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-300"
                >
                  <option value="">Selecionar usuário...</option>
                  {(available || []).map((u) => (
                    <option key={u.id} value={u.id}>{u.name} — {u.email}</option>
                  ))}
                </select>
                <button
                  onClick={() => { if (selectedUserId) addMemberMut.mutate({ userId: selectedUserId, role: 'LIDER' }); }}
                  disabled={!selectedUserId}
                  className="px-4 py-2 bg-golplus-blue text-white rounded-xl text-sm disabled:opacity-40"
                >
                  Adicionar
                </button>
                <button onClick={() => { setAddingRole(null); setSelectedUserId(''); }} className="px-3 py-2 border border-gray-200 rounded-xl text-sm">✕</button>
              </div>
            )}
          </div>

          {/* Protetores */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-golplus-orange flex items-center gap-2">
                <span className="w-2 h-2 bg-golplus-orange rounded-full" />
                Protetores
              </h3>
              <button
                onClick={() => setAddingRole(addingRole === 'PROTETOR' ? null : 'PROTETOR')}
                className="text-xs text-golplus-orange hover:text-golplus-orange-700 font-medium"
              >
                + Adicionar Protetor
              </button>
            </div>
            {protetores.length === 0 && <p className="text-xs text-gray-400 italic">Nenhum protetor atribuído.</p>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {protetores.map((m) => (
                <MemberBadge
                  key={m.id}
                  member={m}
                  onRemove={() => removeMemberMut.mutate(m.id)}
                  onChangeRole={(role) => changeRoleMut.mutate({ memberId: m.id, role })}
                />
              ))}
            </div>
            {addingRole === 'PROTETOR' && (
              <div className="mt-3 flex gap-2">
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-golplus-orange-300"
                >
                  <option value="">Selecionar usuário...</option>
                  {(available || []).map((u) => (
                    <option key={u.id} value={u.id}>{u.name} — {u.email}</option>
                  ))}
                </select>
                <button
                  onClick={() => { if (selectedUserId) addMemberMut.mutate({ userId: selectedUserId, role: 'PROTETOR' }); }}
                  disabled={!selectedUserId}
                  className="px-4 py-2 bg-golplus-orange text-white rounded-xl text-sm disabled:opacity-40"
                >
                  Adicionar
                </button>
                <button onClick={() => { setAddingRole(null); setSelectedUserId(''); }} className="px-3 py-2 border border-gray-200 rounded-xl text-sm">✕</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Setores() {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [search, setSearch] = useState('');
  const qc = useQueryClient();

  const { data: sectors = [], isLoading } = useQuery({
    queryKey: ['sectors'],
    queryFn: sectorsApi.getAll,
  });

  const createMut = useMutation({
    mutationFn: () => sectorsApi.create({ name: newName.trim(), description: newDescription }),
    onSuccess: () => {
      toast.success('Setor criado com sucesso!');
      setShowCreate(false);
      setNewName('');
      setNewDescription('');
      qc.invalidateQueries({ queryKey: ['sectors'] });
    },
    onError: () => toast.error('Erro ao criar setor'),
  });

  const filtered = sectors.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.description || '').toLowerCase().includes(search.toLowerCase())
  );
  const active = filtered.filter((s) => s.isActive);
  const inactive = filtered.filter((s) => !s.isActive);

  return (
    <div>
      <Header
        title="Setores"
        subtitle="Gerencie os setores, líderes e protetores da Gol Plus"
      />

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-6">
        <input
          type="text"
          placeholder="Buscar setor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-300"
        />
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-golplus-blue text-white rounded-xl text-sm font-medium hover:bg-golplus-blue-700 transition-colors"
        >
          {showCreate ? '✕ Cancelar' : '+ Novo Setor'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-white rounded-2xl border border-golplus-blue-200 p-5 mb-6 shadow-sm">
          <h3 className="text-sm font-semibold text-golplus-blue mb-4">Novo Setor</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nome *</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex: Comercial, Financeiro, Sinistros..."
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-300"
                onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) createMut.mutate(); }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Descrição</label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Descrição opcional..."
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-300"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowCreate(false); setNewName(''); setNewDescription(''); }} className="px-4 py-2 border border-gray-200 rounded-xl text-sm">Cancelar</button>
            <button
              onClick={() => createMut.mutate()}
              disabled={!newName.trim() || createMut.isPending}
              className="px-5 py-2 bg-golplus-blue text-white rounded-xl text-sm font-medium disabled:opacity-40"
            >
              {createMut.isPending ? 'Criando...' : 'Criar Setor'}
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total de Setores', value: sectors.length, color: 'bg-golplus-blue-50 text-golplus-blue-700' },
          { label: 'Ativos', value: sectors.filter((s) => s.isActive).length, color: 'bg-green-50 text-green-700' },
          { label: 'Total de Membros', value: sectors.reduce((acc, s) => acc + s.members.length, 0), color: 'bg-golplus-orange-50 text-golplus-orange-700' },
        ].map((stat) => (
          <div key={stat.label} className={`rounded-2xl p-4 ${stat.color}`}>
            <div className="text-2xl font-bold">{stat.value}</div>
            <div className="text-xs font-medium mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {isLoading && (
        <div className="text-center py-12 text-gray-400">Carregando setores...</div>
      )}

      {!isLoading && sectors.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-300">
          <div className="text-4xl mb-3">🏢</div>
          <div className="text-gray-500 font-medium mb-1">Nenhum setor criado</div>
          <div className="text-gray-400 text-sm">Clique em "Novo Setor" para começar.</div>
        </div>
      )}

      {active.length > 0 && (
        <div className="space-y-3 mb-6">
          {active.map((sector) => <SectorCard key={sector.id} sector={sector} />)}
        </div>
      )}

      {inactive.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3">Setores inativos</h3>
          <div className="space-y-3">
            {inactive.map((sector) => <SectorCard key={sector.id} sector={sector} />)}
          </div>
        </div>
      )}
    </div>
  );
}
