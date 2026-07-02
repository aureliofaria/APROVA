import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { makeFlow, makeUser, resetDb, tokenFor } from './factory';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// ============================================================================
// Fix 2 (auditoria Lupa — ALTO): PUT /requests/:id não tinha guarda de status —
// dava para editar (inclusive amountCents) uma solicitação já COMPLETED, sem
// abrir novo ciclo de aprovação. Correção: só edita quando AWAITING_CORRECTION
// (fluxo de correção/resubmit — preservado) ou IN_PROGRESS na etapa 0 SEM
// nenhuma decisão registrada. Fora disso, 409. Toda edição efetiva grava
// AuditLog REQUEST_EDITED com antes→depois (campos "PII-like" só o fato de
// terem mudado).
// ============================================================================
describe('Fix 2 — PUT /requests/:id respeita o status', () => {
  beforeEach(resetDb);

  async function newRequest(status: string, extra: Record<string, unknown> = {}) {
    const initiator = await makeUser('USER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }, { order: 1 }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 'original', status, currentStep: 0, amountCents: 10000, ...extra },
    });
    return { initiator, flow, req };
  }

  it('COMPLETED → 409 e o valor NÃO muda', async () => {
    const { initiator, req } = await newRequest('COMPLETED');
    const res = await request(app).put(`/api/requests/${req.id}`).set(auth(tokenFor(initiator.id)))
      .send({ amountCents: 999999, title: 'tentativa pós-conclusão' });
    expect(res.status).toBe(409);
    const fresh = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(fresh.amountCents).toBe(10000);
    expect(fresh.title).toBe('original');
  });

  it('REJECTED → 409', async () => {
    const { initiator, req } = await newRequest('REJECTED');
    const res = await request(app).put(`/api/requests/${req.id}`).set(auth(tokenFor(initiator.id))).send({ title: 'x' });
    expect(res.status).toBe(409);
  });

  it('CANCELLED → 409', async () => {
    const { initiator, req } = await newRequest('CANCELLED');
    const res = await request(app).put(`/api/requests/${req.id}`).set(auth(tokenFor(initiator.id))).send({ title: 'x' });
    expect(res.status).toBe(409);
  });

  it('IN_PROGRESS na etapa 0 já com decisão registrada → 409 (não permite trocar o valor sob o aprovador)', async () => {
    const manager = await makeUser('MANAGER');
    const { initiator, req } = await newRequest('IN_PROGRESS');
    await prisma.approval.create({ data: { requestId: req.id, approverId: manager.id, stepOrder: 0, decision: 'APPROVED', round: 0 } });
    const res = await request(app).put(`/api/requests/${req.id}`).set(auth(tokenFor(initiator.id))).send({ amountCents: 999999 });
    expect(res.status).toBe(409);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).amountCents).toBe(10000);
  });

  it('IN_PROGRESS na etapa 0 SEM decisão ainda → edita normalmente e grava AuditLog REQUEST_EDITED', async () => {
    const { initiator, req } = await newRequest('IN_PROGRESS');
    const res = await request(app).put(`/api/requests/${req.id}`).set(auth(tokenFor(initiator.id)))
      .send({ amountCents: 20000, title: 'novo título', justification: 'ajuste inicial' });
    expect(res.status).toBe(200);
    const fresh = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(fresh.amountCents).toBe(20000);
    expect(fresh.title).toBe('novo título');

    const audit = await prisma.auditLog.findFirst({ where: { requestId: req.id, action: 'REQUEST_EDITED' } });
    expect(audit).not.toBeNull();
    const details = JSON.parse(audit!.details!);
    expect(details.amountCents).toEqual({ before: 10000, after: 20000 });
    expect(details.title).toEqual({ before: 'original', after: 'novo título' });
  });

  it('AWAITING_CORRECTION continua editável (não regride o fluxo de correção)', async () => {
    const { initiator, req } = await newRequest('AWAITING_CORRECTION', { correctionReturnStep: 0 });
    const res = await request(app).put(`/api/requests/${req.id}`).set(auth(tokenFor(initiator.id)))
      .send({ amountCents: 15000, justification: 'corrigido conforme solicitado' });
    expect(res.status).toBe(200);
    const fresh = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(fresh.amountCents).toBe(15000);
    expect(fresh.status).toBe('AWAITING_CORRECTION'); // PUT não altera o status/ciclo de correção
  });

  it('AuditLog de edição não ecoa o valor de campo PII-like (targetEmployee) em claro', async () => {
    const { initiator, req } = await newRequest('IN_PROGRESS', { targetEmployee: 'Fulano da Silva' });
    const res = await request(app).put(`/api/requests/${req.id}`).set(auth(tokenFor(initiator.id)))
      .send({ targetEmployee: 'Novo Nome' });
    expect(res.status).toBe(200);
    const audit = await prisma.auditLog.findFirst({ where: { requestId: req.id, action: 'REQUEST_EDITED' } });
    expect(audit).not.toBeNull();
    expect(audit!.details).not.toContain('Novo Nome');
    expect(audit!.details).not.toContain('Fulano da Silva');
    const details = JSON.parse(audit!.details!);
    expect(details.targetEmployee).toEqual({ changed: true });
  });

  it('quem não é iniciador nem ADMIN recebe 403 (regressão)', async () => {
    const outro = await makeUser('USER');
    const { req } = await newRequest('IN_PROGRESS');
    const res = await request(app).put(`/api/requests/${req.id}`).set(auth(tokenFor(outro.id))).send({ title: 'x' });
    expect(res.status).toBe(403);
  });

  it('ADMIN pode editar mesmo fora da janela do iniciador (mas ainda sob a guarda de status)', async () => {
    const admin = await makeUser('ADMIN');
    const { req } = await newRequest('COMPLETED');
    const res = await request(app).put(`/api/requests/${req.id}`).set(auth(tokenFor(admin.id))).send({ title: 'x' });
    expect(res.status).toBe(409); // ADMIN passa a autorização, mas a guarda de status vale igual
  });
});
