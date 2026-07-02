// ============================================================================
// Sincronização de usuários com o Microsoft 365 / Entra ID (tenant Gol Plus).
//
// Fonte da verdade: o tenant M365. Usuário com licença elegível (Business
// Basic ou Business Standard/Premium — ver lib/m365Licenses.ts) E conta
// habilitada (accountEnabled=true) entra/permanece no APROVA; senão é
// DESATIVADO (soft — nunca deletado, por causa de histórico/auditoria).
//
// Match por e-mail (case-insensitive). Usuário sem correspondência e
// elegível → criado com papel USER, setor/departamento nulos, sem senha
// local utilizável (needsPasswordSetup=true — só um ADMIN define depois).
// Usuário já existente NUNCA tem papel/setor alterados por esta rotina —
// apenas ativação/desativação + metadados de sync (externalId/syncedAt).
//
// Proteções:
//  • NUNCA desativa o último ADMIN ativo (protegido mesmo no meio da mesma
//    execução, à medida que outras desativações vão sendo decididas).
//  • NUNCA desativa usuário origin=LOCAL que não tenha correspondência no
//    tenant (contas demo/locais ficam intactas — só é tocado se um e-mail
//    igual aparecer nos resultados do Graph).
//  • dry-run (config.m365Sync.dryRun ou deps.dryRun): calcula e loga os
//    contadores sem gravar nada no banco.
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

// Senha local inutilizável (hash de um valor aleatório que ninguém conhece) —
// bloqueia login por senha até um ADMIN definir uma senha real (o que também
// limpa needsPasswordSetup — ver PUT /api/users/:id em routes/users.ts).
async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(crypto.randomUUID(), 10);
}

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

  // Estado local completo: necessário tanto para o match por e-mail quanto
  // para a proteção do último ADMIN (considera TODOS os admins ativos, não
  // só os que aparecem no tenant).
  const localUsers = await db.user.findMany();
  const byEmail = new Map(localUsers.map((u) => [u.email.toLowerCase(), u] as const));
  const matchedIds = new Set<string>();

  // Contador mutável — decrementado assim que uma desativação é DECIDIDA
  // nesta execução, para que a proteção valha mesmo entre itens do mesmo run.
  let activeAdminCount = localUsers.filter((u) => u.isActive && u.role === 'ADMIN').length;
  const isLastActiveAdmin = (u: { role: string; isActive: boolean }): boolean =>
    u.isActive && u.role === 'ADMIN' && activeAdminCount <= 1;

  for (const gu of graphUsers) {
    try {
      const email = graphEmail(gu);
      if (!email) {
        result.skipped++;
        continue;
      }
      const eligible = isEligible(gu);
      const existing = byEmail.get(email);

      if (!existing) {
        // Sem correspondência local: só cria se elegível (nunca cria conta
        // desabilitada/sem licença).
        if (!eligible) {
          result.skipped++;
          continue;
        }
        if (!dryRun) {
          const passwordHash = await unusablePasswordHash();
          await db.user.create({
            data: {
              name: gu.displayName || email,
              email,
              passwordHash,
              role: 'USER',
              sectorId: null,
              departmentId: null,
              origin: 'M365',
              externalId: gu.id,
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

      if (eligible) {
        if (!existing.isActive) {
          if (!dryRun) {
            await db.user.update({
              where: { id: existing.id },
              data: { isActive: true, externalId: gu.id, syncedAt: new Date() },
            });
          }
          result.reactivated++;
        } else {
          // Já ativo e elegível: só refresca metadados de correlação/sync.
          if (!dryRun) {
            await db.user.update({ where: { id: existing.id }, data: { externalId: gu.id, syncedAt: new Date() } });
          }
          result.skipped++;
        }
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
      if (!dryRun) {
        await db.user.update({
          where: { id: existing.id },
          data: { isActive: false, externalId: gu.id, syncedAt: new Date() },
        });
      }
      result.deactivated++;
    } catch (e) {
      result.errors++;
      result.errorMessages.push(e instanceof Error ? e.message : String(e));
    }
  }

  // Segunda passada: usuários origin=M365 ativos que ANTES existiam mas não
  // apareceram nesta execução do Graph (ex.: conta removida do tenant) — são
  // tratados como "sem licença elegível". Usuários origin=LOCAL sem
  // correspondência ficam SEMPRE intactos (nunca entram nesta passada).
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
      result.deactivated++;
    } catch (e) {
      result.errors++;
      result.errorMessages.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (result.errors > 0) result.status = 'ERROR'; // execução parcial: alguns itens falharam

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
