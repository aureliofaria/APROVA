import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../src/lib/prisma';
import { isStepComplete } from '../src/services/workflow';
import { makeFlow, makeUser, resetDb } from './factory';

// Etapa com duas faixas de alçada:
//  - Faixa A: R$ 0,00 a R$ 5.000,00 → 1 aprovador
//  - Faixa B: acima de R$ 5.000,00  → 2 aprovadores
async function buildScenario(amountCents: number) {
  const initiator = await makeUser('USER');
  const flow = await makeFlow('PAYMENT', [
    {
      order: 0,
      requiredRole: null,
      authLevels: [
        { name: 'A', minValueCents: 0, maxValueCents: 500000, requiredApprovers: 1, approverRole: 'MANAGER' },
        { name: 'B', minValueCents: 500001, maxValueCents: null, requiredApprovers: 2, approverRole: 'FINANCE' },
      ],
    },
  ]);
  const request = await prisma.request.create({
    data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0, amountCents },
  });
  const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
  // A etapa precisa ter ao menos uma tarefa concluída.
  await prisma.requestTask.create({
    data: { requestId: request.id, stepId: step.id, assigneeId: initiator.id, title: 't', status: 'COMPLETED', completedAt: new Date() },
  });
  return { request };
}

async function approve(requestId: string, decision = 'APPROVED') {
  const approver = await makeUser('MANAGER');
  await prisma.approval.create({ data: { requestId, approverId: approver.id, stepOrder: 0, decision } });
}

describe('alçadas (authorization levels)', () => {
  beforeEach(resetDb);

  it('faixa A (R$ 5.000,00) exige 1 aprovador', async () => {
    const { request } = await buildScenario(500000);
    expect(await isStepComplete(request.id, 0)).toBe(false);
    await approve(request.id);
    expect(await isStepComplete(request.id, 0)).toBe(true);
  });

  it('faixa B (R$ 5.000,01) exige 2 aprovadores distintos', async () => {
    const { request } = await buildScenario(500001);
    await approve(request.id);
    expect(await isStepComplete(request.id, 0)).toBe(false); // só 1 aprovação
    await approve(request.id);
    expect(await isStepComplete(request.id, 0)).toBe(true); // 2 aprovações
  });

  it('o mesmo aprovador não conta duas vezes para a alçada', async () => {
    const { request } = await buildScenario(500001);
    const approver = await makeUser('FINANCE');
    await prisma.approval.create({ data: { requestId: request.id, approverId: approver.id, stepOrder: 0, decision: 'APPROVED' } });
    // Segunda decisão do mesmo aprovador é barrada pela unique constraint.
    await expect(
      prisma.approval.create({ data: { requestId: request.id, approverId: approver.id, stepOrder: 0, decision: 'APPROVED' } }),
    ).rejects.toThrow();
    expect(await isStepComplete(request.id, 0)).toBe(false);
  });

  it('o limite de centavos seleciona a faixa correta (sem erro de float)', async () => {
    // R$ 5.000,00 cai na faixa A (1 aprovador); R$ 5.000,01 cai na faixa B (2).
    const a = await buildScenario(500000);
    await approve(a.request.id);
    expect(await isStepComplete(a.request.id, 0)).toBe(true);

    const b = await buildScenario(500001);
    await approve(b.request.id);
    expect(await isStepComplete(b.request.id, 0)).toBe(false);
  });
});
