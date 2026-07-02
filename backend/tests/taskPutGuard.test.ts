import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { makeFlow, makeUser, resetDb, tokenFor } from './factory';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// ============================================================================
// Fix 3 (auditoria Lupa — ALTO): PUT /tasks/:id aceitava `status` arbitrário
// no corpo, deixando o chamador setar COMPLETED (ou qualquer status) sem
// passar pelas checagens de POST /:id/complete (anexo obrigatório, campos
// obrigatórios, checklist) nem pelas de /decision (SoD/alçada). Correção:
// fecha a porta — o PUT só aceita `notes`; qualquer `status` no corpo → 400.
// ============================================================================
describe('Fix 3 — PUT /tasks/:id não aceita status arbitrário', () => {
  beforeEach(resetDb);

  async function taskWithAttachmentRequirement() {
    const initiator = await makeUser('USER');
    const assignee = await makeUser('USER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    await prisma.flowStep.updateMany({ where: { flowTemplateId: flow.id, order: 0 }, data: { requiresAttachment: true } });
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });
    const task = await prisma.requestTask.create({
      data: { requestId: req.id, stepId: step.id, assigneeId: assignee.id, title: 'tarefa', status: 'PENDING' },
    });
    return { assignee, req, task };
  }

  it('PUT com status=COMPLETED → 400 e a tarefa continua PENDING (não burla o anexo obrigatório do /complete)', async () => {
    const { assignee, task } = await taskWithAttachmentRequirement();

    const put = await request(app).put(`/api/tasks/${task.id}`).set(auth(tokenFor(assignee.id))).send({ status: 'COMPLETED' });
    expect(put.status).toBe(400);
    expect(put.body.error).toMatch(/complete|decision/);

    const fresh = await prisma.requestTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(fresh.status).toBe('PENDING');

    // Confirma que /complete de fato exige o anexo (a porta fechada é a certa).
    const complete = await request(app).post(`/api/tasks/${task.id}/complete`).set(auth(tokenFor(assignee.id))).send({});
    expect(complete.status).toBe(400);
  });

  it('PUT só com notes → 200 e o status não muda', async () => {
    const { assignee, task } = await taskWithAttachmentRequirement();
    const res = await request(app).put(`/api/tasks/${task.id}`).set(auth(tokenFor(assignee.id))).send({ notes: 'observação legítima' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.notes).toBe('observação legítima');
  });

  it('quem não é o responsável (nem ADMIN) recebe 403 (regressão)', async () => {
    const intruso = await makeUser('USER');
    const { task } = await taskWithAttachmentRequirement();
    const res = await request(app).put(`/api/tasks/${task.id}`).set(auth(tokenFor(intruso.id))).send({ notes: 'x' });
    expect(res.status).toBe(403);
  });
});
