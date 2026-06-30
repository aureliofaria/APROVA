// Sincronização de CONFIGURAÇÃO idempotente — roda em TODA subida (Railway),
// independentemente do banco estar vazio. NÃO mexe em dados de pedidos/usuários;
// apenas garante que a configuração (trilha de admissão, catálogo de tipos de
// ativo, nomes de fluxo) esteja atualizada após cada deploy.
import { PrismaClient } from '@prisma/client';
import { seedOnboardingFlow } from './seedOnboarding';

const prisma = new PrismaClient();

// Garante os tipos de ativo solicitáveis (idempotente por nome). Só cria os que
// faltam — não sobrescreve ajustes feitos pelo ADMIN em itens já existentes.
async function ensureAssetCatalog() {
  const ti = (await prisma.sector.findFirst({ where: { name: 'TI, Dados e Infra' } }))?.id ?? null;
  const adm = (await prisma.sector.findFirst({ where: { name: 'Administrativo' } }))?.id ?? null;
  const base = [
    { name: 'Computador', sectorId: ti, sortOrder: 1, selectionGroup: 'ESTACAO' },
    { name: 'Notebook', sectorId: ti, sortOrder: 2, selectionGroup: 'ESTACAO' },
    { name: 'Monitor adicional', sectorId: ti, sortOrder: 3 },
    { name: 'Headset', sectorId: ti, sortOrder: 4 },
    { name: 'Mouse', sectorId: ti, sortOrder: 5 },
    { name: 'Teclado', sectorId: ti, sortOrder: 6 },
  ];
  for (const it of base) {
    const ex = await prisma.resourceItem.findFirst({ where: { name: it.name } });
    if (!ex) await prisma.resourceItem.create({ data: { type: 'EQUIPMENT', isActive: true, ...it } });
  }
  const nb = await prisma.resourceItem.findFirst({ where: { name: 'Notebook' } });
  if (!(await prisma.resourceItem.findFirst({ where: { name: 'Suporte para notebook' } }))) {
    await prisma.resourceItem.create({ data: { name: 'Suporte para notebook', type: 'EQUIPMENT', isActive: true, sectorId: adm, sortOrder: 7, dependsOnId: nb?.id ?? null } });
  }
}

async function main() {
  await seedOnboardingFlow(prisma); // trilha "Admissão de Protetor" + campos da vaga + desativa legado
  await ensureAssetCatalog();
  // Terminologia: "Colaborador" → "Protetor" nos nomes de fluxo.
  await prisma.flowTemplate.updateMany({ where: { type: 'OFFBOARDING', name: 'Desligamento de Colaborador' }, data: { name: 'Desligamento de Protetor' } });
  console.log('[sync-config] configuração sincronizada (trilha + catálogo + nomes).');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error('[sync-config] erro:', e); return prisma.$disconnect().then(() => process.exit(1)); });
