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

  // ==========================================================================
  // Achados da revisão (Lupa) — cenários adversariais
  // ==========================================================================

  it('ALTO 1 · e-mail duplicado no tenant: linha inelegível NÃO desativa usuário elegível (independe da ordem)', async () => {
    const u = await makeUser('USER', 'Duplicada', { email: 'dup@golplus.com.br', origin: 'M365' });
    const eligibleRow = graphUser({ mail: 'dup@golplus.com.br', id: 'entra-dup-licenciada' });
    const ineligibleRow = graphUser({ mail: 'dup@golplus.com.br', id: 'entra-dup-shared', assignedLicenses: [] });

    // Ordem adversarial original da Lupa: a inelegível processada DEPOIS da elegível.
    let res = await runM365UserSync({ fetchUsers: async () => [eligibleRow, ineligibleRow] });
    expect(res.deactivated).toBe(0);
    expect((await fresh(u.id)).isActive).toBe(true);

    // Ordem inversa — mesmo resultado (união de elegibilidade elimina a ordem).
    res = await runM365UserSync({ fetchUsers: async () => [ineligibleRow, eligibleRow] });
    expect(res.deactivated).toBe(0);
    const after = await fresh(u.id);
    expect(after.isActive).toBe(true);
    // A estampa usa a linha ELEGÍVEL como representativa.
    expect(after.externalId).toBe('entra-dup-licenciada');
  });

  it('ALTO 1 · e-mail duplicado na criação: cria UMA conta quando qualquer linha é elegível', async () => {
    const eligibleRow = graphUser({ mail: 'nova-dup@golplus.com.br', id: 'entra-nd-lic' });
    const ineligibleRow = graphUser({ mail: 'nova-dup@golplus.com.br', id: 'entra-nd-shared', assignedLicenses: [] });

    const res = await runM365UserSync({ fetchUsers: async () => [ineligibleRow, eligibleRow] });
    expect(res.created).toBe(1);

    const all = await prisma.user.findMany({ where: { email: 'nova-dup@golplus.com.br' } });
    expect(all).toHaveLength(1);
    expect(all[0].isActive).toBe(true);
    expect(all[0].externalId).toBe('entra-nd-lic');
  });

  it('ALTO 2 · troca de e-mail no Entra: match por externalId atualiza o e-mail local (não cria conta nem tranca o usuário)', async () => {
    const u = await makeUser('USER', 'Renomeada', {
      email: 'antigo@golplus.com.br',
      origin: 'M365',
      externalId: 'entra-fixo-123',
    });
    const gu = graphUser({ mail: 'novo@golplus.com.br', id: 'entra-fixo-123' });

    const res = await runM365UserSync({ fetchUsers: async () => [gu] });
    expect(res.created).toBe(0); // NÃO cria duplicata com o e-mail novo
    expect(res.deactivated).toBe(0); // NÃO desativa o "antigo@" como órfão na 2ª passada

    const after = await fresh(u.id);
    expect(after.email).toBe('novo@golplus.com.br');
    expect(after.isActive).toBe(true);
    expect(after.externalId).toBe('entra-fixo-123');
    expect(await prisma.user.count()).toBe(1);
  });

  it('ALTO 2 · colisão de e-mail no rename: registra erro claro e NÃO desativa ninguém', async () => {
    const a = await makeUser('USER', 'A', { email: 'a@golplus.com.br', origin: 'M365', externalId: 'entra-a' });
    const b = await makeUser('USER', 'B', { email: 'b@golplus.com.br', origin: 'M365', externalId: 'entra-b' });
    // No Entra, o objeto de A passou a usar o e-mail de B.
    const gu = graphUser({ mail: 'b@golplus.com.br', id: 'entra-a' });

    const res = await runM365UserSync({ fetchUsers: async () => [gu] });
    expect(res.errors).toBe(1);
    expect(res.status).toBe('ERROR');
    expect(res.errorMessages[0]).toMatch(/colisão de e-mail/i);
    expect(res.deactivated).toBe(0); // ninguém desativado — nem A, nem B (2ª passada)

    const freshA = await fresh(a.id);
    const freshB = await fresh(b.id);
    expect(freshA.isActive).toBe(true);
    expect(freshA.email).toBe('a@golplus.com.br'); // rename NÃO aplicado
    expect(freshB.isActive).toBe(true);

    const run = await prisma.m365SyncRun.findUniqueOrThrow({ where: { id: res.id } });
    expect(run.errorMessage).toMatch(/colisão de e-mail/i);
  });

  it('MÉDIO · conta LOCAL que casa por e-mail com linha INELEGÍVEL fica intocada (não desativa, não estampa)', async () => {
    const local = await makeUser('USER', 'Local Coincidente', { email: 'coincide@golplus.com.br', origin: 'LOCAL' });
    const gu = graphUser({ mail: 'coincide@golplus.com.br', assignedLicenses: [] });

    const res = await runM365UserSync({ fetchUsers: async () => [gu] });
    expect(res.deactivated).toBe(0);
    expect(res.skipped).toBe(1);

    const after = await fresh(local.id);
    expect(after.isActive).toBe(true);
    expect(after.externalId).toBeNull();
    expect(after.origin).toBe('LOCAL');
    expect(after.syncedAt).toBeNull();
  });

  it('MÉDIO · conta LOCAL que casa com linha ELEGÍVEL também fica intocada (sem estampa; vínculo é decisão manual)', async () => {
    const local = await makeUser('USER', 'Local Elegível', { email: 'local-eleg@golplus.com.br', origin: 'LOCAL' });
    const gu = graphUser({ mail: 'local-eleg@golplus.com.br' });

    const res = await runM365UserSync({ fetchUsers: async () => [gu] });
    expect(res.created).toBe(0);
    expect(res.skipped).toBe(1);

    const after = await fresh(local.id);
    expect(after.externalId).toBeNull();
    expect(after.origin).toBe('LOCAL');
    expect(after.syncedAt).toBeNull();
  });

  it('BAIXO · dry-run: nenhuma alteração de USUÁRIO é gravada, mas o M365SyncRun é registrado com dryRun=true', async () => {
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

    // Nenhuma alteração de USUÁRIO foi persistida.
    expect((await fresh(existingInactive.id)).isActive).toBe(false);
    expect((await fresh(existingActive.id)).isActive).toBe(true);
    const created = await prisma.user.findUnique({ where: { email: 'novo-dry@golplus.com.br' } });
    expect(created).toBeNull();

    // O registro da execução É gravado (intencional — observabilidade), com a
    // flag dryRun=true e os contadores simulados.
    const run = await prisma.m365SyncRun.findUniqueOrThrow({ where: { id: res.id } });
    expect(run.dryRun).toBe(true);
    expect(run.created).toBe(1);
    expect(run.reactivated).toBe(1);
    expect(run.deactivated).toBe(1);
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
