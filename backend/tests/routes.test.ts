import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { makeFlow, makeUser, resetDb, tokenFor } from './factory';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('correções da revisão (rotas)', () => {
  beforeEach(resetDb);

  // #1 — PUT de alçada não pode zerar a faixa em atualização parcial
  it('PUT auth-level com só {name} preserva min/maxValueCents', async () => {
    const admin = await makeUser('ADMIN');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id } });

    const created = await request(app)
      .post(`/api/flows/${flow.id}/steps/${step.id}/auth-levels`)
      .set(auth(tokenFor(admin.id)))
      .send({ name: 'Faixa A', minValueCents: 0, maxValueCents: 500000, requiredApprovers: 1, approverRole: 'MANAGER' });
    expect(created.status).toBe(201);

    const upd = await request(app)
      .put(`/api/flows/${flow.id}/steps/${step.id}/auth-levels/${created.body.id}`)
      .set(auth(tokenFor(admin.id)))
      .send({ name: 'Faixa A (renomeada)' });
    expect(upd.status).toBe(200);

    const lvl = await prisma.authorizationLevel.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(lvl.minValueCents).toBe(0);
    expect(lvl.maxValueCents).toBe(500000);
    expect(lvl.name).toBe('Faixa A (renomeada)');
  });

  // #4 — valores monetários não-numéricos são rejeitados (400), não viram NaN
  it('rejeita amountCents não-numérico ao criar solicitação', async () => {
    const user = await makeUser('USER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const res = await request(app)
      .post('/api/requests')
      .set(auth(tokenFor(user.id)))
      .send({ flowId: flow.id, title: 'X', amountCents: 'abc' });
    expect(res.status).toBe(400);
  });

  it('rejeita minValueCents não-numérico ao criar alçada', async () => {
    const admin = await makeUser('ADMIN');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id } });
    const res = await request(app)
      .post(`/api/flows/${flow.id}/steps/${step.id}/auth-levels`)
      .set(auth(tokenFor(admin.id)))
      .send({ name: 'X', minValueCents: 'abc', approverRole: 'MANAGER' });
    expect(res.status).toBe(400);
  });

  // #2 / #6 — trocar a unidade vinculada libera a anterior; reserva é atômica
  it('trocar o ativo vinculado libera o anterior (não fica preso em RESERVADO)', async () => {
    const admin = await makeUser('ADMIN');
    const flow = await makeFlow('ONBOARDING', [{ order: 0 }]);
    const item = await prisma.resourceItem.create({ data: { name: 'Notebook', type: 'EQUIPMENT' } });
    const inv = await prisma.inventoryItem.create({ data: { code: `C-${Date.now()}`, name: 'NB', type: 'TI', category: 'HARDWARE' } });
    const a = await prisma.asset.create({ data: { itemId: inv.id, status: 'DISPONIVEL' } });
    const b = await prisma.asset.create({ data: { itemId: inv.id, status: 'DISPONIVEL' } });
    const req = await prisma.request.create({ data: { flowId: flow.id, initiatorId: admin.id, title: 'Adm', status: 'IN_PROGRESS', currentStep: 0 } });
    const rr = await prisma.requestResource.create({ data: { requestId: req.id, resourceItemId: item.id, status: 'PENDING' } });

    const link1 = await request(app).post(`/api/requests/${req.id}/resources/${rr.id}/asset`).set(auth(tokenFor(admin.id))).send({ assetId: a.id });
    expect(link1.status).toBe(200);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('RESERVADO');

    const link2 = await request(app).post(`/api/requests/${req.id}/resources/${rr.id}/asset`).set(auth(tokenFor(admin.id))).send({ assetId: b.id });
    expect(link2.status).toBe(200);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('RESERVADO');
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('DISPONIVEL'); // liberado
  });

  it('rejeita (409) reservar um ativo que não está disponível', async () => {
    const admin = await makeUser('ADMIN');
    const flow = await makeFlow('ONBOARDING', [{ order: 0 }]);
    const item = await prisma.resourceItem.create({ data: { name: 'Notebook', type: 'EQUIPMENT' } });
    const inv = await prisma.inventoryItem.create({ data: { code: `C2-${Date.now()}`, name: 'NB', type: 'TI', category: 'HARDWARE' } });
    const a = await prisma.asset.create({ data: { itemId: inv.id, status: 'ATIVO' } });
    const req = await prisma.request.create({ data: { flowId: flow.id, initiatorId: admin.id, title: 'Adm', status: 'IN_PROGRESS', currentStep: 0 } });
    const rr = await prisma.requestResource.create({ data: { requestId: req.id, resourceItemId: item.id, status: 'PENDING' } });

    const res = await request(app).post(`/api/requests/${req.id}/resources/${rr.id}/asset`).set(auth(tokenFor(admin.id))).send({ assetId: a.id });
    expect(res.status).toBe(409);
  });

  // #5 — máquina de estados da contagem física respeita as transições
  it('contagem: complete só após start; não reabre concluída', async () => {
    const admin = await makeUser('ADMIN');
    const count = await prisma.inventoryCount.create({ data: { status: 'RASCUNHO', createdById: admin.id } });
    const t = tokenFor(admin.id);

    expect((await request(app).post(`/api/inventory/counts/${count.id}/complete`).set(auth(t))).status).toBe(409); // RASCUNHO não conclui
    expect((await request(app).post(`/api/inventory/counts/${count.id}/start`).set(auth(t))).status).toBe(200);
    expect((await request(app).post(`/api/inventory/counts/${count.id}/complete`).set(auth(t))).status).toBe(200);
    expect((await request(app).post(`/api/inventory/counts/${count.id}/start`).set(auth(t))).status).toBe(409); // não reabre
  });

  // #9 — filtro `to` (data sem hora) inclui o próprio dia
  it('audit-logs: filtro to=hoje inclui registros do dia', async () => {
    const admin = await makeUser('ADMIN');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const req = await prisma.request.create({ data: { flowId: flow.id, initiatorId: admin.id, title: 'A', status: 'PENDING', currentStep: 0 } });
    await prisma.auditLog.create({ data: { requestId: req.id, userId: admin.id, userName: 'Admin', action: 'TESTLOG' } });
    const today = new Date().toISOString().slice(0, 10);

    const res = await request(app).get(`/api/audit-logs?action=TESTLOG&to=${today}`).set(auth(tokenFor(admin.id)));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });
});
