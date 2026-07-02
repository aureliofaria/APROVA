// ============================================================================
// Sincronização de usuários com o Microsoft 365 / Entra ID (tenant Gol Plus).
//
// Fonte da verdade: o tenant M365. Usuário com licença elegível (Business
// Basic ou Business Standard/Premium — ver lib/m365Licenses.ts) E conta
// habilitada (accountEnabled=true) entra/permanece no APROVA; senão é
// DESATIVADO (soft — nunca deletado, por causa de histórico/auditoria).
//
// Reconciliação (nesta ordem):
//  1. As linhas do Graph são DEDUPLICADAS pelo e-mail resolvido (lowercase)
//     com UNIÃO de elegibilidade: se QUALQUER linha do mesmo e-mail for
//     elegível+habilitada, o e-mail é elegível. Elimina dependência da ordem
//     de retorno do tenant (ex.: shared mailbox sem licença ao lado da conta
//     licenciada da mesma pessoa).
//  2. Match PRIMEIRO por externalId (id do objeto no Entra — sobrevive a
//     troca de e-mail), DEPOIS por e-mail (case-insensitive). Quando o match
//     é por externalId e o e-mail local diverge, o e-mail local é ATUALIZADO;
//     se o novo e-mail colidir com OUTRO usuário local, a entrada gera erro
//     explícito no run e NINGUÉM é desativado.
//  3. Sem correspondência e elegível → cria com papel USER, setor/depto
//     nulos, sem senha local utilizável (needsPasswordSetup=true — só um
//     ADMIN define depois). Usuário já existente NUNCA tem papel/setor
//     alterados — apenas ativação/desativação + metadados (externalId/
//     syncedAt/e-mail renomeado).
//
// Proteções:
//  • Contas origin=LOCAL são INTOCÁVEIS: o sync só gerencia quem ele criou
//    (origin=M365). LOCAL que casa por e-mail com o tenant é apenas contado
//    como skipped — sem desativar, sem estampar externalId, sem reescrever
//    origin (vínculo LOCAL→M365 é decisão manual futura).
//  • NUNCA desativa o último ADMIN ativo (protegido mesmo no meio da mesma
//    execução, à medida que outras desativações vão sendo decididas).
//  • O estado local em memória é atualizado a cada mutação decidida, então o
//    resultado independe da ordem de processamento das entradas; ambiguidade
//    de identidade (match por e-mail com externalId local apontando para
//    OUTRO objeto Entra — reciclagem de e-mail) NUNCA vira mutação: gera erro
//    explícito no run e se resolve no próximo ciclo, após o rename.
//
// Pressuposto (aceito por design): objeto HABILITADO+LICENCIADO com um
// e-mail no tenant = acesso àquele e-mail — o Entra é a fonte da verdade
// também para a posse do endereço.
//  • dry-run (config.m365Sync.dryRun ou deps.dryRun): calcula os contadores
//    SEM gravar alterações de USUÁRIO. O registro da execução (M365SyncRun)
//    É gravado mesmo em dry-run — intencional, para observabilidade (o
//    ADMIN valida os números em GET /status antes de ligar de fato).
//
// DI: `deps.fetchUsers`/`deps.db` permitem testar sem rede e sem afetar o
// banco de produção (ver tests/m365UserSync.test.ts).
// ============================================================================
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { fetchAllGraphUsers, GraphUserRaw } from '../lib/graphClient';
import { hasEligibleLicense } from '../lib/m365Licenses';
import { config, m365SyncEnabled } from '../config';

export interface M365SyncDeps {
  fetchUsers?: () => Promise<GraphUserRaw[]>;
  dryRun?: boolean;
  db?: typeof prisma;
  triggeredBy?: 'MANUAL' | 'SCHEDULER';
}

export interface M365SyncResult {
  id: string;
  dryRun: boolean;
  created: number;
  reactivated: number;
  deactivated: number;
  skipped: number;
  errors: number;
  errorMessages: string[];
  status: 'SUCCESS' | 'ERROR';
}

function isEligible(gu: GraphUserRaw): boolean {
  return gu.accountEnabled === true && hasEligibleLicense(gu.assignedLicenses);
}

function graphEmail(gu: GraphUserRaw): string {
  return (gu.mail || gu.userPrincipalName || '').trim().toLowerCase();
}

// Uma entrada por e-mail após a deduplicação (união de elegibilidade).
interface MergedEntry {
  email: string;
  // TODOS os ids de objeto Entra vistos com este e-mail (para o match por
  // externalId funcionar independentemente de qual linha foi mantida).
  ids: string[];
  eligible: boolean;
  // Linha representativa (preferindo uma elegível): fornece displayName e o
  // externalId a estampar.
  representative: GraphUserRaw;
}

// Deduplica as linhas do Graph pelo e-mail resolvido, com UNIÃO de
// elegibilidade — elimina a dependência da ordem de retorno do tenant.
function mergeGraphUsersByEmail(graphUsers: GraphUserRaw[]): { entries: MergedEntry[]; noEmail: number } {
  const map = new Map<string, MergedEntry>();
  let noEmail = 0;
  for (const gu of graphUsers) {
    const email = graphEmail(gu);
    if (!email) {
      noEmail++;
      continue;
    }
    const rowEligible = isEligible(gu);
    const entry = map.get(email);
    if (!entry) {
      map.set(email, { email, ids: [gu.id], eligible: rowEligible, representative: gu });
    } else {
      entry.ids.push(gu.id);
      if (rowEligible && !entry.eligible) {
        entry.eligible = true;
        entry.representative = gu; // preferir a linha elegível como representativa
      }
    }
  }
  return { entries: Array.from(map.values()), noEmail };
}

// Senha local inutilizável (hash de um valor aleatório que ninguém conhece) —
// bloqueia login por senha até um ADMIN definir uma senha real (o que também
// limpa needsPasswordSetup — ver PUT /api/users/:id em routes/users.ts).
async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(crypto.randomUUID(), 10);
}

type LocalUser = Awaited<ReturnType<typeof prisma.user.findMany>>[number];

export async function runM365UserSync(deps: M365SyncDeps = {}): Promise<M365SyncResult> {
  const db = deps.db ?? prisma;
  const dryRun = deps.dryRun ?? config.m365Sync.dryRun;
  const fetchUsers = deps.fetchUsers ?? (() => fetchAllGraphUsers());
  const triggeredBy = deps.triggeredBy ?? 'MANUAL';

  const result: M365SyncResult = {
    id: '',
    dryRun,
    created: 0,
    reactivated: 0,
    deactivated: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
    status: 'SUCCESS',
  };

  let graphUsers: GraphUserRaw[];
  try {
    graphUsers = await fetchUsers();
  } catch (e) {
    result.status = 'ERROR';
    result.errors = 1;
    result.errorMessages.push(e instanceof Error ? e.message : String(e));
    const run = await db.m365SyncRun.create({
      data: {
        status: 'ERROR',
        dryRun,
        errors: 1,
        errorMessage: result.errorMessages[0]?.slice(0, 500),
        finishedAt: new Date(),
        triggeredBy,
      },
    });
    result.id = run.id;
    return result;
  }

  const { entries, noEmail } = mergeGraphUsersByEmail(graphUsers);
  result.skipped += noEmail; // linhas do Graph sem e-mail resolvível

  // Estado local completo: necessário para o match (externalId/e-mail) e para
  // a proteção do último ADMIN (considera TODOS os admins ativos, não só os
  // que aparecem no tenant). Os índices em memória são ATUALIZADOS a cada
  // mutação decidida — o resultado não depende da ordem das entradas.
  const localUsers = await db.user.findMany();
  const byEmail = new Map<string, LocalUser>(localUsers.map((u) => [u.email.toLowerCase(), u]));
  const byExternalId = new Map<string, LocalUser>(
    localUsers.filter((u) => u.externalId).map((u) => [u.externalId as string, u])
  );
  const matchedIds = new Set<string>();

  // Contador mutável — decrementado assim que uma desativação é DECIDIDA
  // nesta execução, para que a proteção valha mesmo entre itens do mesmo run.
  let activeAdminCount = localUsers.filter((u) => u.isActive && u.role === 'ADMIN').length;
  const isLastActiveAdmin = (u: { role: string; isActive: boolean }): boolean =>
    u.isActive && u.role === 'ADMIN' && activeAdminCount <= 1;

  // Aplica a mutação decidida ao objeto em memória e reindexa os mapas —
  // mesmo em dry-run, para que os contadores simulem a execução real.
  const applyLocal = (
    u: LocalUser,
    data: { isActive?: boolean; externalId?: string; email?: string }
  ): void => {
    if (data.email && data.email !== u.email) {
      byEmail.delete(u.email.toLowerCase());
      u.email = data.email;
      byEmail.set(data.email.toLowerCase(), u);
    }
    if (data.externalId && data.externalId !== u.externalId) {
      if (u.externalId) byExternalId.delete(u.externalId);
      u.externalId = data.externalId;
      byExternalId.set(data.externalId, u);
    }
    if (data.isActive !== undefined) u.isActive = data.isActive;
  };

  for (const entry of entries) {
    try {
      // Match PRIMEIRO por externalId (troca de e-mail no Entra não tranca o
      // usuário para fora), DEPOIS por e-mail.
      let existing: LocalUser | undefined;
      let matchedByExternalId = false;
      for (const id of entry.ids) {
        existing = byExternalId.get(id);
        if (existing) {
          matchedByExternalId = true;
          break;
        }
      }
      if (!existing) existing = byEmail.get(entry.email);

      if (!existing) {
        // Sem correspondência local: só cria se elegível (nunca cria conta
        // desabilitada/sem licença).
        if (!entry.eligible) {
          result.skipped++;
          continue;
        }
        if (!dryRun) {
          const passwordHash = await unusablePasswordHash();
          await db.user.create({
            data: {
              name: entry.representative.displayName || entry.email,
              email: entry.email,
              passwordHash,
              role: 'USER',
              sectorId: null,
              departmentId: null,
              origin: 'M365',
              externalId: entry.representative.id,
              syncedAt: new Date(),
              needsPasswordSetup: true,
              isActive: true,
            },
          });
        }
        result.created++;
        continue;
      }

      matchedIds.add(existing.id);

      // Contas origin=LOCAL são INTOCÁVEIS pelo sync: nem desativação, nem
      // estampa de externalId, nem reescrita de origin. Vínculo LOCAL→M365
      // fica para decisão manual futura.
      if (existing.origin !== 'M365') {
        result.skipped++;
        continue;
      }

      // Conflito de identidade no match por E-MAIL: o usuário local já está
      // correlacionado a OUTRO objeto Entra (externalId fora de entry.ids) —
      // típico de reciclagem de e-mail. NUNCA re-estampar silenciosamente:
      // erro explícito, nenhuma mutação (matchedIds já protege da 2ª passada;
      // o rename do objeto original resolve o e-mail e o próximo run cria a
      // conta nova sem ambiguidade).
      if (!matchedByExternalId && existing.externalId && !entry.ids.includes(existing.externalId)) {
        result.errors++;
        result.errorMessages.push(
          `conflito de identidade: e-mail "${entry.email}" pertence ao usuário local ${existing.id} (externalId ${existing.externalId}), mas o tenant apresenta ids [${entry.ids.join(', ')}] — nenhuma alteração aplicada`
        );
        continue;
      }

      // Troca de e-mail no Entra (match por externalId com e-mail divergente):
      // atualiza o e-mail local — salvo colisão com OUTRO usuário, que gera
      // erro explícito e NÃO desativa ninguém (matchedIds já protege este
      // usuário da segunda passada).
      let emailUpdate: string | undefined;
      if (existing.email.toLowerCase() !== entry.email) {
        const conflict = byEmail.get(entry.email);
        if (conflict && conflict.id !== existing.id) {
          result.errors++;
          result.errorMessages.push(
            `colisão de e-mail no rename: Entra ${entry.representative.id} quer "${entry.email}", já usado pelo usuário local ${conflict.id} — nenhuma alteração aplicada`
          );
          // "NÃO desative ninguém": o dono atual do e-mail também fica
          // protegido da segunda passada até a colisão ser resolvida à mão.
          matchedIds.add(conflict.id);
          continue;
        }
        emailUpdate = entry.email;
      }

      if (entry.eligible) {
        const data = {
          isActive: true,
          externalId: entry.representative.id,
          syncedAt: new Date(),
          ...(emailUpdate ? { email: emailUpdate } : {}),
        };
        if (!dryRun) await db.user.update({ where: { id: existing.id }, data });
        if (!existing.isActive) result.reactivated++;
        else result.skipped++; // já ativo e elegível: só refresca metadados
        applyLocal(existing, data);
        continue;
      }

      // Desabilitado no Entra OU sem licença elegível → desativar (soft).
      if (!existing.isActive) {
        result.skipped++; // já estava inativo, nada a fazer
        continue;
      }
      if (isLastActiveAdmin(existing)) {
        result.skipped++; // protegido: último ADMIN ativo nunca é desativado
        continue;
      }
      if (existing.role === 'ADMIN') activeAdminCount--;
      const data = {
        isActive: false,
        externalId: entry.representative.id,
        syncedAt: new Date(),
        ...(emailUpdate ? { email: emailUpdate } : {}),
      };
      if (!dryRun) await db.user.update({ where: { id: existing.id }, data });
      applyLocal(existing, data);
      result.deactivated++;
    } catch (e) {
      result.errors++;
      result.errorMessages.push(e instanceof Error ? e.message : String(e));
    }
  }

  // Segunda passada: usuários origin=M365 ativos que ANTES existiam mas não
  // apareceram nesta execução do Graph (ex.: conta removida do tenant) — são
  // tratados como "sem licença elegível". Usuários origin=LOCAL nunca entram
  // nesta passada (intocáveis).
  for (const u of localUsers) {
    if (u.origin !== 'M365') continue;
    if (matchedIds.has(u.id)) continue;
    if (!u.isActive) continue;
    try {
      if (isLastActiveAdmin(u)) {
        result.skipped++;
        continue;
      }
      if (u.role === 'ADMIN') activeAdminCount--;
      if (!dryRun) {
        await db.user.update({ where: { id: u.id }, data: { isActive: false, syncedAt: new Date() } });
      }
      applyLocal(u, { isActive: false });
      result.deactivated++;
    } catch (e) {
      result.errors++;
      result.errorMessages.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (result.errors > 0) result.status = 'ERROR'; // execução parcial: alguns itens falharam

  // O registro da execução é gravado SEMPRE — inclusive em dry-run (com a
  // flag dryRun=true), para o ADMIN validar os números antes de ligar de fato.
  const run = await db.m365SyncRun.create({
    data: {
      status: result.status,
      dryRun,
      created: result.created,
      reactivated: result.reactivated,
      deactivated: result.deactivated,
      skipped: result.skipped,
      errors: result.errors,
      errorMessage: result.errorMessages.length ? result.errorMessages.slice(0, 5).join(' | ').slice(0, 500) : null,
      finishedAt: new Date(),
      triggeredBy,
    },
  });
  result.id = run.id;
  return result;
}

// Agendador in-process (gated por env — mesmo padrão do dispatcher de
// notificações em services/notificationDispatcher.ts). Só liga quando
// M365_USER_SYNC_ENABLED=true E as credenciais Graph estão configuradas.
export function startM365UserSyncScheduler(): void {
  if (!m365SyncEnabled()) {
    console.log('[m365-sync] DESLIGADO (defina M365_USER_SYNC_ENABLED=true + GRAPH_*).');
    return;
  }
  const intervalMs = config.m365Sync.intervalMs;
  console.log(`[m365-sync] LIGADO (intervalo ${intervalMs} ms; dryRun=${config.m365Sync.dryRun}).`);
  setInterval(() => {
    runM365UserSync({ triggeredBy: 'SCHEDULER' }).catch((e) => console.error('[m365-sync]', e));
  }, intervalMs);
}
