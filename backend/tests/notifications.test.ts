import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../src/lib/prisma';
import { advanceRequest, createRequestTasks } from '../src/services/workflow';
import { completeCurrentStepTasks, makeFlow, makeUser, resetDb } from './factory';

describe('notificações (eventos do workflow)', () => {
  beforeEach(resetDb);

  it('notifica o responsável (não-iniciador) ao atribuir tarefa', async () => {
    const initiator = await makeUser('USER');
    await makeUser('MANAGER', 'gestor');
    const flow = await makeFlow('PAYMENT', [{ order: 0, requiredRole: 'MANAGER' }]);
    const req = await prisma.request.create({ data: { flowId: flow.id, initiatorId: initiator.id, title: 'Pgto X', status: 'IN_PROGRESS', currentStep: 0 } });

    await createRequestTasks(req.id, flow.id, 0);

    const notes = await prisma.notification.findMany({ where: { type: 'TASK_ASSIGNED' } });
    expect(notes.length).toBe(1);
    expect(notes[0].channel).toBe('IN_APP');
    expect(notes[0].status).toBe('UNREAD');
  });

  it('notifica o iniciador ao concluir a solicitação', async () => {
    const initiator = await makeUser('USER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const req = await prisma.request.create({ data: { flowId: flow.id, initiatorId: initiator.id, title: 'Pgto Y', status: 'IN_PROGRESS', currentStep: 0 } });
    await createRequestTasks(req.id, flow.id, 0);
    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);

    const note = await prisma.notification.findFirst({ where: { userId: initiator.id, type: 'REQUEST_COMPLETED' } });
    expect(note).not.toBeNull();
    expect(note?.requestId).toBe(req.id);
  });

  it('respeita a preferência: IN_APP desligado não gera notificação', async () => {
    const initiator = await makeUser('USER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const req = await prisma.request.create({ data: { flowId: flow.id, initiatorId: initiator.id, title: 'Pgto Z', status: 'IN_PROGRESS', currentStep: 0 } });
    await prisma.notificationPreference.create({ data: { userId: initiator.id, channel: 'IN_APP', eventType: 'REQUEST_COMPLETED', enabled: false } });
    await createRequestTasks(req.id, flow.id, 0);
    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);

    const note = await prisma.notification.findFirst({ where: { userId: initiator.id, type: 'REQUEST_COMPLETED' } });
    expect(note).toBeNull();
  });
});
