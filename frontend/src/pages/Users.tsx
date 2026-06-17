import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi, departmentsApi } from '../services/api';
import { roleLabel } from '../components/StatusBadge';
import Header from '../components/Header';
import toast from 'react-hot-toast';
import type { User } from '../types';

const roles = ['ADMIN', 'MANAGER', 'FINANCE', 'HR', 'USER'];

function UserModal({ user, onClose }: { user?: User; onClose: () => void }) {
  const isEdit = !!user;
  const qc = useQueryClient();
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: () => departmentsApi.getAll() });
  const [form, setForm] = useState<{
    name: string; email: string; password: string; role: string; departmentId: string; isActive: boolean;
  }>({
    name: user?.name || '',
    email: user?.email || '',
    password: '',
    role: user?.role || 'USER',
    departmentId: user?.departmentId || '',
    isActive: user?.isActive ?? true,
  });

  const mutation = useMutation({
    mutationFn: () => {
      if (isEdit) return usersApi.update(user!.id, { ...form as any, password: form.password || undefined });
      return usersApi.create({ ...form as any, password: form.password });
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Usuário atualizado!' : 'Usuário criado!');
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Erro ao salvar usuário'),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{isEdit ? 'Editar Usuário' : 'Novo Usuário'}</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{isEdit ? 'Nova Senha (deixe em branco para manter)' : 'Senha *'}</label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" placeholder={isEdit ? '••••••••' : ''} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Perfil</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500">
              {roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Departamento</label>
            <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500">
              <option value="">Sem departamento</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          {isEdit && (
            <div className="flex items-center gap-2">
              <input type="checkbox" id="isActive" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="rounded border-gray-300 text-golplus-blue-600" />
              <label htmlFor="isActive" className="text-sm text-gray-700">Usuário ativo</label>
            </div>
          )}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="flex-1 py-2 bg-golplus-blue-600 text-white rounded-lg text-sm font-medium hover:bg-golplus-blue-700 disabled:opacity-50">
            {mutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Users() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<User | undefined>();

  const { data: users = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.getAll() });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => usersApi.deactivate(id),
    onSuccess: () => { toast.success('Usuário desativado'); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: () => toast.error('Erro ao desativar usuário'),
  });

  const openCreate = () => { setEditUser(undefined); setShowModal(true); };
  const openEdit = (u: User) => { setEditUser(u); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditUser(undefined); };

  return (
    <div>
      {showModal && <UserModal user={editUser} onClose={closeModal} />}
      <Header
        title="Usuários"
        subtitle="Gerencie os usuários do sistema"
        actions={
          <button onClick={openCreate} className="px-4 py-2 bg-golplus-blue-600 text-white rounded-lg text-sm font-medium hover:bg-golplus-blue-700">
            + Novo Usuário
          </button>
        }
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Nome</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Perfil</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Departamento</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && <tr><td colSpan={6} className="text-center py-8 text-gray-500 text-sm">Carregando...</td></tr>}
              {!isLoading && users.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-gray-500 text-sm">Nenhum usuário encontrado</td></tr>}
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-golplus-blue-100 text-golplus-blue-700 rounded-full flex items-center justify-center text-sm font-bold">
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-gray-900">{u.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600">{u.email}</td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-golplus-blue-100 text-golplus-blue-800">{roleLabel(u.role)}</span>
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600">{u.department?.name || '-'}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${u.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                      {u.isActive ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(u)} className="px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50">Editar</button>
                      {u.isActive && (
                        <button onClick={() => { if (confirm('Desativar este usuário?')) deactivateMutation.mutate(u.id); }} className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs hover:bg-red-50">Desativar</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
