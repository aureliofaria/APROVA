import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { advanceRequest, createRequestTasks } from '../src/services/workflow';
import { completeCurrentStepTasks, makeFlow, makeUser, resetDb, tokenFor } from './factory';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// ============================================================================
// Fix 1 (auditoria Lupa — CRÍTICO): uma etapa APLICÁVEL cujos papéis não têm
// nenhum usuário ativo (ex.: alçada com approverRole='MANAGER' sem nenhum
// MANAGER ativo cadastrado) resolvia 0 elegíveis → 0 tarefas criadas →
// advanceRequest tratava "0 tarefas" como "ordem pulável" e o pedido
// CONCLUÍA sem nenhuma aprovação. Correção: createRequestTasks reporta
// starvedStepId; advanceRequest trava a solicitação (BLOCKED) em vez de
// pular/concluir. Só ADMIN destrava via POST /:id/retry-step.
// ============================================================================
describe('Fix 1 — etapa aplicável sem elegível trava a solicitação (BLOCKED)', () => {
  beforeEach(resetDb);

  async function starvedRequest() {
    const initiator = await makeUser('USER');
    const admin = await makeUser('ADMIN');
    // Etapa 0: submissão do iniciador. Etapa 1: alçada MANAGER — mas NENHUM
    // MANAGER ativo existe no sistema (o cenário provado pela auditoria).
    const flow = await makeFlow('PAYMENT', [
      { order: 0 },
      { order: 1, authLevels: [{ name: 'A', minValueCents: 0, maxValueCents: null, requiredApprovers: 1, approverRole: 'MANAGER' }] },
    ]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 'pedido sem aprovador', status: 'IN_PROGRESS', currentStep: 0, amountCents: 1000 },
    });
    await createRequestTasks(req.id, flow.id, 0);
    return { initiator, admin, flow, req };
  }

  it('trava em BLOCKED (nunca COMPLETED) quando a etapa de alçada não resolve nenhum elegível', async () => {
    const { admin, req } = await starvedRequest();

    await completeCurrentStepTasks(req.id); // conclui a submissão do iniciador
    await advanceRequest(req.id); // tenta avançar para a etapa 1 (MANAGER) — starved

    const fresh = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(fresh.status).toBe('BLOCKED');
    expect(fresh.status).not.toBe('COMPLETED');
    // Nenhuma tarefa PENDING/IN_PROGRESS foi criada para a etapa 1 (elegíveis vazios).
    const openTasks = await prisma.requestTask.count({
      where: { requestId: req.id, step: { order: 1 }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    });
    expect(openTasks).toBe(0);

    const audit = await prisma.auditLog.findFirst({ where: { requestId: req.id, action: 'REQUEST_BLOCKED' } });
    expect(audit).not.toBeNull();
    expect(audit!.details).toContain('MANAGER');

    // ADMIN ativo foi notificado.
    const notif = await prisma.notification.findFirst({ where: { userId: admin.id, requestId: req.id, type: 'REQUEST_BLOCKED' } });
    expect(notif).not.toBeNull();
  });

  it('advanceRequest não avança/conclui uma solicitação BLOCKED em chamadas repetidas', async () => {
    const { req } = await starvedRequest();
    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('BLOCKED');

    await advanceRequest(req.id); // idempotente — permanece travada
    const fresh = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(fresh.status).toBe('BLOCKED');
    expect(fresh.currentStep).toBe(1);
  });

  describe('POST /:id/retry-step', () => {
    it('não-ADMIN recebe 403', async () => {
      const { initiator, req } = await starvedRequest();
      await completeCurrentStepTasks(req.id);
      await advanceRequest(req.id);

      const res = await request(app).post(`/api/requests/${req.id}/retry-step`).set(auth(tokenFor(initiator.id))).send({});
      expect(res.status).toBe(403);
    });

    it('solicitação não travada → 409', async () => {
      const admin = await makeUser('ADMIN');
      const initiator = await makeUser('USER');
      const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
      const req = await prisma.request.create({
        data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
      });
      const res = await request(app).post(`/api/requests/${req.id}/retry-step`).set(auth(tokenFor(admin.id))).send({});
      expect(res.status).toBe(409);
    });

    it('ainda sem elegível → 409 explicando o papel vazio; solicitação permanece BLOCKED', async () => {
      const { admin, req } = await starvedRequest();
      await completeCurrentStepTasks(req.id);
      await advanceRequest(req.id);

      const res = await request(app).post(`/api/requests/${req.id}/retry-step`).set(auth(tokenFor(admin.id))).send({});
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('MANAGER');

      const fresh = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
      expect(fresh.status).toBe('BLOCKED');
      const failLog = await prisma.auditLog.findFirst({ where: { requestId: req.id, action: 'RETRY_STEP_FAILED' } });
      expect(failLog).not.toBeNull();
    });

    it('após ativar um MANAGER, reprocessa com sucesso e volta a IN_PROGRESS', async () => {
      const { admin, req } = await starvedRequest();
      await completeCurrentStepTasks(req.id);
      await advanceRequest(req.id);
      expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('BLOCKED');

      // Corrige o cadastro: agora existe um MANAGER ativo.
      const manager = await makeUser('MANAGER');

      const res = await request(app).post(`/api/requests/${req.id}/retry-step`).set(auth(tokenFor(admin.id))).send({});
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('IN_PROGRESS');

      const task = await prisma.requestTask.findFirst({ where: { requestId: req.id, step: { order: 1 }, assigneeId: manager.id } });
      expect(task).not.toBeNull();
      expect(task!.status).toBe('PENDING');

      const okLog = await prisma.auditLog.findFirst({ where: { requestId: req.id, action: 'REQUEST_UNBLOCKED' } });
      expect(okLog).not.toBeNull();
    });
  });
});
