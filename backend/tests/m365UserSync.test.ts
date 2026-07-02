import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../src/lib/prisma';
import { runM365UserSync } from '../src/services/m365UserSync';
import { GraphUserRaw } from '../src/lib/graphClient';
import { makeUser, resetDb } from './factory';

const ELIGIBLE_SKU = '3b555118-da6a-4418-894f-7df1e2096870'; // Business Basic

function graphUser(overrides: Partial<GraphUserRaw> & { mail: string }): GraphUserRaw {
  return {
    id: overrides.id ?? `entra-${overrides.mail}`,
    displayName: overrides.displayName ?? 'Fulano da Silva',
    mail: overrides.mail,
    userPrincipalName: overrides.userPrincipalName ?? overrides.mail,
    accountEnabled: overrides.accountEnabled ?? true,
    assignedLicenses: overrides.assignedLicenses ?? [{ skuId: ELIGIBLE_SKU }],
    department: overrides.department ?? null,
    jobTitle: overrides.jobTitle ?? null,
  };
}

async function fresh(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id } });
}

describe('m365UserSync · runM365UserSync', () => {
  beforeEach(resetDb);

  it('cria usuário elegível sem correspondência local (papel USER, sem senha utilizável)', async () => {
    const gu = graphUser({ mail: 'nova@golplus.com.br' });
    const res = await runM365UserSync({ fetchUsers: async () => [gu] });

    expect(res.created).toBe(1);
    expect(res.status).toBe('SUCCESS');

    const created = await prisma.user.findUniqueOrThrow({ where: { email: 'nova@golplus.com.br' } });
    expect(created.role).toBe('USER');
    expect(created.sectorId).toBeNull();
    expect(created.departmentId).toBeNull();
    expect(created.origin).toBe('M365');
    expect(created.externalId).toBe(gu.id);
    expect(created.isActive).toBe(true);
    expect(created.needsPasswordSetup).toBe(true);
    expect(created.syncedAt).not.toBeNull();
  });

  it('NÃO cria conta para usuário do Graph sem licença elegível', async () => {
    const gu = graphUser({ mail: 'semlicenca@golplus.com.br', assignedLicenses: [] });
    const res = await runM365UserSync({ fetchUsers: async () => [gu] });
    expect(res.created).toBe(0);
    expect(res.skipped).toBe(1);
    const found = await prisma.user.findUnique({ where: { email: 'semlicenca@golplus.com.br' } });
    expect(found).toBeNull();
  });

  it('reativa usuário existente inativo que voltou a ser elegível (match por e-mail case-insensitive)', async () => {
    const u = await makeUser('USER', 'Ana', { email: 'ANA@golplus.com.br', isActive: false, origin: 'M365' });
    const gu = graphUser({ mail: 'ana@golplus.com.br' });

    const res = await runM365UserSync({ fetchUsers: async () => [gu] });
    expect(res.reactivated).toBe(1);

    const updated = await fresh(u.id);
    expect(updated.isActive).toBe(true);
    expect(updated.externalId).toBe(gu.id);
  });

  it('desativa usuário existente sem licença elegível (soft — nunca deleta)', async () => {
    const u = await makeUser('USER', 'Bruno', { email: 'bruno@golplus.com.br', origin: 'M365' });
    const gu = graphUser({ mail: 'bruno@golplus.com.br', assignedLicenses: [] });

    const res = await runM365UserSync({ fetchUsers: async () => [gu] });
    expect(res.deactivated).toBe(1);

    const updated = await fresh(u.id);
    expect(updated.isActive).toBe(false);
    // soft: registro continua existindo (auditoria/histórico preservados)
    expect(updated.id).toBe(u.id);
  });

  it('desativa usuário existente com accountEnabled=false no Entra (mesmo com licença)', async () => {
    const u = await makeUser('USER', 'Carla', { email: 'carla@golplus.com.br', origin: 'M365' });
    const gu = graphUser({ mail: 'carla@golplus.com.br', accountEnabled: false });

    const res = await runM365UserSync({ fetchUsers: async () => [gu] });
    expect(res.deactivated).toBe(1);
    expect((await fresh(u.id)).isActive).toBe(false);
  });

  it('NUNCA rebaixa ou altera o papel de um usuário existente', async () => {
    const admin = await makeUser('ADMIN', 'Diretor', { email: 'diretor@golplus.com.br', origin: 'M365' });
    const gu = graphUser({ mail: 'diretor@golplus.com.br' }); // elegível — só deveria refrescar metadados

    await runM365UserSync({ fetchUsers: async () => [gu] });
    expect((await fresh(admin.id)).role).toBe('ADMIN');
  });

  it('protege o último ADMIN ativo — nunca é desativado mesmo sem licença/conta desabilitada', async () => {
    const admin = await makeUser('ADMIN', 'Único Admin', { email: 'admin@golplus.com.br', origin: 'M365' });
    const gu = graphUser({ mail: 'admin@golplus.com.br', accountEnabled: false });

    const res = await runM365UserSync({ fetchUsers: async () => [gu] });
    expect(res.deactivated).toBe(0);
    expect(res.skipped).toBe(1);
    expect((await fresh(admin.id)).isActive).toBe(true);
  });

  it('com dois admins ativos ineligíveis no mesmo run, desativa um e protege o último', async () => {
    const admin1 = await makeUser('ADMIN', 'Admin 1', { email: 'admin1@golplus.com.br', origin: 'M365' });
    const admin2 = await makeUser('ADMIN', 'Admin 2', { email: 'admin2@golplus.com.br', origin: 'M365' });
    const gu1 = graphUser({ mail: 'admin1@golplus.com.br', assignedLicenses: [] });
    const gu2 = graphUser({ mail: 'admin2@golplus.com.br', assignedLicenses: [] });

    const res = await runM365UserSync({ fetchUsers: async () => [gu1, gu2] });
    expect(res.deactivated).toBe(1);
    expect(res.skipped).toBe(1);

    const active = [await fresh(admin1.id), await fresh(admin2.id)].filter((u) => u.isActive);
    expect(active).toHaveLength(1); // exatamente um admin permanece ativo
  });

  it('NUNCA desativa usuário origin=LOCAL sem correspondência no tenant (conta demo/local intacta)', async () => {
    const local = await makeUser('USER', 'Conta Demo', { email: 'demo@local.test', origin: 'LOCAL' });
    // Tenant não retorna ninguém com esse e-mail.
    const gu = graphUser({ mail: 'outra-pessoa@golplus.com.br' });

    const res = await runM365UserSync({ fetchUsers: async () => [gu] });
    expect(res.created).toBe(1); // a outra pessoa é criada normalmente
    expect((await fresh(local.id)).isActive).toBe(true); // demo local intacta
  });

  it('desativa usuário origin=M365 que desapareceu do resultado do tenant (conta removida)', async () => {
    const removed = await makeUser('USER', 'Removido', { email: 'removido@golplus.com.br', origin: 'M365' });
    // Nenhum usuário do Graph corresponde a este e-mail nesta execução.
    const res = await runM365UserSync({ fetchUsers: async () => [] });
    expect(res.deactivated).toBe(1);
    expect((await fresh(removed.id)).isActive).toBe(false);
  });

  it('dry-run calcula os contadores sem gravar nada no banco', async () => {
    const existingInactive = await makeUser('USER', 'Inativo', { email: 'inativo@golplus.com.br', isActive: false, origin: 'M365' });
    const existingActive = await makeUser('USER', 'Ativo', { email: 'ativo@golplus.com.br', origin: 'M365' });
    const guReactivate = graphUser({ mail: 'inativo@golplus.com.br' });
    const guDeactivate = graphUser({ mail: 'ativo@golplus.com.br', assignedLicenses: [] });
    const guCreate = graphUser({ mail: 'novo-dry@golplus.com.br' });

    const res = await runM365UserSync({ fetchUsers: async () => [guReactivate, guDeactivate, guCreate], dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.created).toBe(1);
    expect(res.reactivated).toBe(1);
    expect(res.deactivated).toBe(1);

    // Nada foi persistido.
    expect((await fresh(existingInactive.id)).isActive).toBe(false);
    expect((await fresh(existingActive.id)).isActive).toBe(true);
    const created = await prisma.user.findUnique({ where: { email: 'novo-dry@golplus.com.br' } });
    expect(created).toBeNull();
  });

  it('grava um M365SyncRun com os contadores da execução', async () => {
    const gu = graphUser({ mail: 'run@golplus.com.br' });
    const res = await runM365UserSync({ fetchUsers: async () => [gu] });
    const run = await prisma.m365SyncRun.findUniqueOrThrow({ where: { id: res.id } });
    expect(run.created).toBe(1);
    expect(run.status).toBe('SUCCESS');
    expect(run.finishedAt).not.toBeNull();
  });

  it('registra ERROR no M365SyncRun quando a busca no Graph falha (sem quebrar o processo)', async () => {
    const res = await runM365UserSync({ fetchUsers: async () => { throw new Error('Graph token HTTP 401'); } });
    expect(res.status).toBe('ERROR');
    expect(res.errors).toBe(1);
    const run = await prisma.m365SyncRun.findUniqueOrThrow({ where: { id: res.id } });
    expect(run.status).toBe('ERROR');
    expect(run.errorMessage).toContain('401');
  });

  it('match por e-mail é case-insensitive na criação (não duplica conta existente)', async () => {
    await makeUser('USER', 'Existente', { email: 'existente@golplus.com.br', origin: 'LOCAL' });
    const gu = graphUser({ mail: 'EXISTENTE@GOLPLUS.COM.BR' });

    const res = await runM365UserSync({ fetchUsers: async () => [gu] });
    expect(res.created).toBe(0);
    // Garantia simples: continua existindo só 1 registro com esse e-mail.
    const all = await prisma.user.findMany();
    expect(all.filter((u) => u.email.toLowerCase() === 'existente@golplus.com.br')).toHaveLength(1);
  });
});
