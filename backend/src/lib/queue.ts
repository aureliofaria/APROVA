// ============================================================================
// Filas de função (Fase 0 — Passo 6)
//
// Uma etapa cuja FUNÇÃO requerida pertence a FUNCTION_ROLES é uma "fila":
// qualquer MEMBRO daquela função pode assumir e executar. A resolução abaixo
// converte a função do fluxo na lista de pessoas elegíveis, aplicando o
// fallback hierárquico MEMBRO → LÍDER II → LÍDER I quando não há membro, e
// regras especiais para a DIRETORIA.
//
// Modelo de execução (fan-out + claim): cada elegível recebe a SUA própria
// RequestTask PENDING; ao assumir/concluir, as irmãs PENDING da mesma
// (requestId, stepId) são canceladas. Esta função apenas resolve QUEM é
// elegível — a criação das tarefas vive em workflow.createRequestTasks.
// ============================================================================
import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { FUNCTION_ROLES, FunctionRole, SECTOR_FUNCTIONS, SectorName } from './org';

type Db = Prisma.TransactionClient | typeof prisma;

export function isFunctionRole(role: string | null | undefined): role is FunctionRole {
  return !!role && (FUNCTION_ROLES as readonly string[]).includes(role);
}

// Setores (por nome) cujo array de funções inclui a função pedida.
function sectorsForFunction(functionRole: FunctionRole): SectorName[] {
  const names: SectorName[] = [];
  for (const [name, fns] of Object.entries(SECTOR_FUNCTIONS) as [SectorName, FunctionRole[]][]) {
    if (fns.includes(functionRole)) names.push(name);
  }
  return names;
}

// Resolve os usuários elegíveis a assumir uma etapa de FUNÇÃO. Função pura
// (sem efeitos colaterais): apenas consulta. O iniciador é sempre excluído
// (SoD) exceto no fallback final, que garante que a etapa nunca fique sem
// responsável (mesmo contrato do caminho legado em workflow.ts).
export async function resolveQueueEligibles(
  db: Db,
  step: { requiredRole: string | null },
  initiatorId: string,
): Promise<{ id: string; name: string }[]> {
  const functionRole = step.requiredRole;
  if (!isFunctionRole(functionRole)) return [];

  const fallbackToInitiator = async (): Promise<{ id: string; name: string }[]> => {
    const initiator = await db.user.findUnique({ where: { id: initiatorId }, select: { id: true, name: true } });
    return initiator ? [initiator] : [];
  };

  // DIRETORIA: qualquer membro do setor 'Diretoria' (qualquer nível); se o
  // setor não existir, recorre aos usuários com papel global 'DIRETORIA'.
  if (functionRole === 'DIRETORIA') {
    const directorate = await collectFromSectors(db, ['Diretoria'], initiatorId, { anyLevel: true, preferRole: 'DIRETORIA' });
    if (directorate.length > 0) return directorate;
    const byRole = await db.user.findMany({
      where: { role: 'DIRETORIA', isActive: true, id: { not: initiatorId } },
      select: { id: true, name: true },
    });
    if (byRole.length > 0) return byRole;
    return fallbackToInitiator();
  }

  const sectorNames = sectorsForFunction(functionRole);
  if (sectorNames.length === 0) return fallbackToInitiator();

  // Fallback hierárquico por nível, acumulando sobre TODOS os setores da função.
  // `preferRole` torna a fila PRECISA POR FUNÇÃO: quando um setor hospeda várias
  // funções (ex.: TI/DADOS/SISTEMAS compartilham 'TI, Dados e Infra'), a fila da
  // função X vai a quem de fato exerce X (user.role === X). Se ninguém no nível
  // exerce a função, recai sobre TODOS daquele nível (comportamento do Passo 6,
  // ex.: setor com função 1:1 cujos membros têm papel genérico).
  for (const level of ['MEMBRO', 'LIDER_2', 'LIDER_1'] as const) {
    const found = await collectFromSectors(db, sectorNames, initiatorId, { level, preferRole: functionRole });
    if (found.length > 0) return found;
  }

  return fallbackToInitiator();
}

// Coleta usuários ativos (≠ iniciador) que são SectorMember dos setores dados.
// Filtra por nível, exceto quando `anyLevel` (Diretoria). União deduplicada
// quando a função se espalha por múltiplos setores.
async function collectFromSectors(
  db: Db,
  sectorNames: string[],
  initiatorId: string,
  opts: { level?: string; anyLevel?: boolean; preferRole?: string },
): Promise<{ id: string; name: string }[]> {
  const sectors = await db.sector.findMany({ where: { name: { in: sectorNames } }, select: { id: true } });
  const sectorIds = sectors.map(s => s.id);
  if (sectorIds.length === 0) return [];

  const members = await db.sectorMember.findMany({
    where: {
      sectorId: { in: sectorIds },
      ...(opts.anyLevel ? {} : { level: opts.level }),
      userId: { not: initiatorId },
      user: { is: { isActive: true } },
    },
    select: { userId: true, user: { select: { id: true, name: true, role: true } } },
  });

  // Precisão por função: se algum membro EXERCE a função (user.role === preferRole),
  // restringe a fila a esses; senão, mantém todos (fallback do Passo 6).
  const all = members.filter((m) => m.user);
  const pool = opts.preferRole
    ? (all.some((m) => m.user!.role === opts.preferRole) ? all.filter((m) => m.user!.role === opts.preferRole) : all)
    : all;

  const byId = new Map<string, { id: string; name: string }>();
  for (const m of pool) {
    byId.set(m.user!.id, { id: m.user!.id, name: m.user!.name });
  }
  return [...byId.values()];
}
