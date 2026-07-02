// FIX 2 (auditoria da Lupa — visibilidade): GET /api/tasks/:id tinha um bypass
// por papel (WIDE_VIEW_ROLES = ADMIN/MANAGER/FINANCE/HR) que deixava esses
// papéis lerem QUALQUER tarefa — e o pedido embutido (título, valor,
// iniciador, anexos) — sem nenhum vínculo com a solicitação. Isso era
// inconsistente com GET /requests/:id, que corretamente nega acesso fora do
// escopo. Este arquivo prova que o gate agora usa o MESMO predicado
// (lib/visibility::canViewRequest) das demais rotas de leitura.
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { makeFlow, makeUser, resetDb, tokenFor } from './factory';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makeRequestWithTask(initiatorId: string, flowId: string, assigneeId: string) {
  const req = await prisma.request.create({
    data: { flowId, initiatorId, title: 'Pedido', status: 'IN_PROGRESS', currentStep: 0 },
  });
  const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flowId } });
  const task = await prisma.requestTask.create({
    data: { requestId: req.id, stepId: step.id, assigneeId, title: 'Tarefa', status: 'PENDING' },
  });
  return { req, task };
}

describe('FIX 2 — GET /api/tasks/:id respeita o vínculo (sem bypass por papel)', () => {
  beforeEach(resetDb);

  it('MANAGER sem vínculo com a solicitação: 403 (mesmo sendo papel de "visão ampla" antigo)', async () => {
    const initiator = await makeUser('USER');
    const assignee = await makeUser('USER', 'assignee');
    const manager = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const { task } = await makeRequestWithTask(initiator.id, flow.id, assignee.id);

    const res = await request(app).get(`/api/tasks/${task.id}`).set(auth(tokenFor(manager.id)));
    expect(res.status).toBe(403);
  });

  it('FINANCE sem vínculo: 403', async () => {
    const initiator = await makeUser('USER');
    const assignee = await makeUser('USER', 'assignee2');
    const finance = await makeUser('FINANCE');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const { task } = await makeRequestWithTask(initiator.id, flow.id, assignee.id);

    const res = await request(app).get(`/api/tasks/${task.id}`).set(auth(tokenFor(finance.id)));
    expect(res.status).toBe(403);
  });

  it('HR sem vínculo: 403', async () => {
    const initiator = await makeUser('USER');
    const assignee = await makeUser('USER', 'assignee3');
    const hr = await makeUser('HR');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const { task } = await makeRequestWithTask(initiator.id, flow.id, assignee.id);

    const res = await request(app).get(`/api/tasks/${task.id}`).set(auth(tokenFor(hr.id)));
    expect(res.status).toBe(403);
  });

  it('tarefa inexistente: 404 (comportamento inalterado)', async () => {
    const manager = await makeUser('MANAGER');
    const res = await request(app).get('/api/tasks/id-que-nao-existe').set(auth(tokenFor(manager.id)));
    expect(res.status).toBe(404);
  });

  it('controle: o responsável pela própria tarefa continua vendo (200)', async () => {
    const initiator = await makeUser('USER');
    const assignee = await makeUser('MANAGER', 'responsavel');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const { task } = await makeRequestWithTask(initiator.id, flow.id, assignee.id);

    const res = await request(app).get(`/api/tasks/${task.id}`).set(auth(tokenFor(assignee.id)));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(task.id);
  });

  it('controle: o iniciador da solicitação continua vendo a tarefa', async () => {
    const initiator = await makeUser('USER');
    const assignee = await makeUser('USER', 'assignee4');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const { task } = await makeRequestWithTask(initiator.id, flow.id, assignee.id);

    const res = await request(app).get(`/api/tasks/${task.id}`).set(auth(tokenFor(initiator.id)));
    expect(res.status).toBe(200);
  });

  it('controle: ADMIN continua vendo qualquer tarefa (visão global)', async () => {
    const initiator = await makeUser('USER');
    const assignee = await makeUser('USER', 'assignee5');
    const admin = await makeUser('ADMIN');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const { task } = await makeRequestWithTask(initiator.id, flow.id, assignee.id);

    const res = await request(app).get(`/api/tasks/${task.id}`).set(auth(tokenFor(admin.id)));
    expect(res.status).toBe(200);
  });

  it('controle: um aprovador registrado na solicitação continua vendo a tarefa', async () => {
    const initiator = await makeUser('USER');
    const assignee = await makeUser('USER', 'assignee6');
    const aprovador = await makeUser('MANAGER', 'aprovador');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const { req, task } = await makeRequestWithTask(initiator.id, flow.id, assignee.id);
    await prisma.approval.create({
      data: { requestId: req.id, approverId: aprovador.id, stepOrder: 0, decision: 'APPROVED' },
    });

    const res = await request(app).get(`/api/tasks/${task.id}`).set(auth(tokenFor(aprovador.id)));
    expect(res.status).toBe(200);
  });
});
