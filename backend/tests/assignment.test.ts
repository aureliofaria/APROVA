import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../src/lib/prisma';
import { createRequestTasks } from '../src/services/workflow';
import { makeFlow, makeUser, resetDb } from './factory';

describe('atribuição de tarefas (segregação de funções)', () => {
  beforeEach(resetDb);

  // Etapa operacional cujo papel difere do iniciador: distribui aos usuários
  // do papel, exceto o iniciador (segregação).
  it('exclui o iniciador da atribuição por papel quando há outros do papel', async () => {
    const initiator = await makeUser('USER', 'iniciador');
    const other = await makeUser('FINANCE', 'outro');
    const flow = await makeFlow('PAYMENT', [{ order: 0, requiredRole: 'FINANCE' }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });

    await createRequestTasks(req.id, flow.id, 0);

    const tasks = await prisma.requestTask.findMany({ where: { requestId: req.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].assigneeId).toBe(other.id);
    expect(tasks[0].assigneeId).not.toBe(initiator.id);
  });

  // A "tarefa do solicitante" (papel exigido = papel do iniciador) é atribuída
  // SOMENTE a ele, sem broadcast a peers do mesmo papel (evita vazar
  // envolvimento/visibilidade a terceiros — IDOR).
  it('etapa do próprio papel do iniciador é atribuída apenas a ele', async () => {
    const initiator = await makeUser('USER', 'autor');
    await makeUser('USER', 'outro-user');
    const flow = await makeFlow('PAYMENT', [{ order: 0, requiredRole: 'USER' }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });

    await createRequestTasks(req.id, flow.id, 0);

    const tasks = await prisma.requestTask.findMany({ where: { requestId: req.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].assigneeId).toBe(initiator.id);
  });

  it('recai sobre o iniciador quando não há outro usuário do papel exigido', async () => {
    const initiator = await makeUser('MANAGER', 'único');
    const flow = await makeFlow('PAYMENT', [{ order: 0, requiredRole: 'FINANCE' }]);
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
