import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../src/lib/prisma';
import { advanceRequest, createRequestTasks } from '../src/services/workflow';
import { completeCurrentStepTasks, makeFlow, makeUser, resetDb } from './factory';

describe('advanceRequest', () => {
  beforeEach(resetDb);

  it('avança sequencialmente pelas etapas e conclui ao final', async () => {
    const initiator = await makeUser('USER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }, { order: 1 }, { order: 2 }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });
    await createRequestTasks(req.id, flow.id, 0);

    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).currentStep).toBe(1);

    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).currentStep).toBe(2);

    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('COMPLETED');
  });

  it('não avança enquanto a etapa atual não está completa', async () => {
    const initiator = await makeUser('USER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }, { order: 1 }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });
    await createRequestTasks(req.id, flow.id, 0);

    await advanceRequest(req.id); // tarefa ainda PENDING
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).currentStep).toBe(0);
  });

  it('chamadas duplicadas avançam apenas uma vez (guarda de concorrência)', async () => {
    const initiator = await makeUser('USER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }, { order: 1 }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });
    await createRequestTasks(req.id, flow.id, 0);
    await completeCurrentStepTasks(req.id);

    await advanceRequest(req.id);
    await advanceRequest(req.id); // segunda chamada não deve duplicar

    const fresh = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(fresh.currentStep).toBe(1);
    const step1Tasks = await prisma.requestTask.count({ where: { requestId: req.id, step: { order: 1 } } });
    expect(step1Tasks).toBe(1); // exatamente uma tarefa criada para a etapa 1
  });

  it('branching por valor: salta para a etapa-alvo quando a condição é satisfeita', async () => {
    const initiator = await makeUser('USER');
    // Condição na etapa 0: amount >= R$ 1.000,00 → pular para a etapa 2.
    const flow = await makeFlow('PURCHASE', [
      { order: 0, conditions: [{ field: 'amount', op: 'GTE', value: '1000', targetOrder: 2 }] },
      { order: 1 },
      { order: 2 },
    ]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0, amountCents: 200000 },
    });
    await createRequestTasks(req.id, flow.id, 0);
    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);

    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).currentStep).toBe(2);
  });

  it('branching por valor: segue sequencial quando a condição não é satisfeita', async () => {
    const initiator = await makeUser('USER');
    const flow = await makeFlow('PURCHASE', [
      { order: 0, conditions: [{ field: 'amount', op: 'GTE', value: '1000', targetOrder: 2 }] },
      { order: 1 },
      { order: 2 },
    ]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0, amountCents: 50000 },
    });
    await createRequestTasks(req.id, flow.id, 0);
    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);

    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).currentStep).toBe(1);
  });
});
