import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../src/lib/prisma';
import { createRequestTasks } from '../src/services/workflow';
import { makeFlow, makeUser, resetDb } from './factory';

describe('atribuição de tarefas (segregação de funções)', () => {
  beforeEach(resetDb);

  it('exclui o iniciador da atribuição por papel quando há outros do papel', async () => {
    const initiator = await makeUser('MANAGER', 'iniciador');
    const other = await makeUser('MANAGER', 'outro');
    const flow = await makeFlow('PAYMENT', [{ order: 0, requiredRole: 'MANAGER' }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });

    await createRequestTasks(req.id, flow.id, 0);

    const tasks = await prisma.requestTask.findMany({ where: { requestId: req.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].assigneeId).toBe(other.id);
    expect(tasks[0].assigneeId).not.toBe(initiator.id);
  });

  it('recai sobre o iniciador quando ele é o único usuário do papel', async () => {
    const initiator = await makeUser('MANAGER', 'único');
    const flow = await makeFlow('PAYMENT', [{ order: 0, requiredRole: 'MANAGER' }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });

    await createRequestTasks(req.id, flow.id, 0);

    const tasks = await prisma.requestTask.findMany({ where: { requestId: req.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].assigneeId).toBe(initiator.id);
  });

  it('cria uma tarefa para cada usuário do papel (exceto o iniciador)', async () => {
    const initiator = await makeUser('USER');
    await makeUser('FINANCE', 'fin-1');
    await makeUser('FINANCE', 'fin-2');
    const flow = await makeFlow('PAYMENT', [{ order: 0, requiredRole: 'FINANCE' }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });

    await createRequestTasks(req.id, flow.id, 0);

    const tasks = await prisma.requestTask.findMany({ where: { requestId: req.id } });
    expect(tasks).toHaveLength(2);
  });
});
