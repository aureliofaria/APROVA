import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { createRequestTasks } from '../src/services/workflow';
import { makeFlow, makeUser, resetDb, tokenFor } from './factory';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// ============================================================================
// Fix 4 (auditoria Lupa — ALTO): DEFER numa etapa de requiredRole SEM
// authLevels (ex.: 'MANAGER' difundido a TODOS os MANAGERs ativos) não
// cancelava as tarefas-irmãs — isStepComplete exige que TODAS as tarefas
// ATIVAS (não-CANCELLED) da etapa estejam COMPLETED, então a etapa exigia
// unanimidade em vez de bastar 1 decisão do papel. Correção: paridade com as
// bandas de alçada — 1 DEFER já cancela as irmãs PENDING/IN_PROGRESS restantes.
// ============================================================================
describe('Fix 4 — DEFER em etapa sem authLevels cancela as irmãs (paridade com alçada)', () => {
  beforeEach(resetDb);

  it('3 MANAGERs difundidos, sem authLevels: 1º DEFER avança a etapa e cancela os outros 2', async () => {
    const initiator = await makeUser('USER');
    const m1 = await makeUser('MANAGER');
    const m2 = await makeUser('MANAGER');
    const m3 = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [
      { order: 0, requiredRole: 'MANAGER' }, // SEM authLevels — papel único difundido
      { order: 1 },
    ]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });
    await createRequestTasks(req.id, flow.id, 0);

    const before = await prisma.requestTask.findMany({ where: { requestId: req.id } });
    expect(before).toHaveLength(3);
    expect(before.every((t) => t.status === 'PENDING')).toBe(true);

    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(m1.id))).send({ action: 'DEFER' });
    expect(res.status).toBe(200);

    // A etapa avançou — 1 decisão do papel já bastou.
    const fresh = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(fresh.currentStep).toBe(1);

    const after = await prisma.requestTask.findMany({ where: { requestId: req.id, stepId: before[0].stepId } });
    expect(after.find((t) => t.assigneeId === m1.id)?.status).toBe('COMPLETED');
    expect(after.filter((t) => t.assigneeId !== m1.id).every((t) => t.status === 'CANCELLED')).toBe(true);
    // As duas irmãs viraram CANCELLED — nenhuma unanimidade exigida.
    expect(after.filter((t) => t.status === 'CANCELLED')).toHaveLength(2);
    expect(after.some((t) => t.assigneeId === m2.id && t.status === 'CANCELLED')).toBe(true);
    expect(after.some((t) => t.assigneeId === m3.id && t.status === 'CANCELLED')).toBe(true);
  });

  it('etapa com único assignee (sem irmãs): DEFER continua funcionando normalmente', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [{ order: 0, requiredRole: 'MANAGER' }, { order: 1 }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });
    await createRequestTasks(req.id, flow.id, 0);

    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(manager.id))).send({ action: 'DEFER' });
    expect(res.status).toBe(200);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).currentStep).toBe(1);
  });
});
