import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { createRequestTasks } from '../src/services/workflow';
import { makeFlow, makeUser, resetDb, tokenFor } from './factory';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function newReq(flowId: string, initiatorId: string) {
  return prisma.request.create({ data: { flowId, initiatorId, title: 't', status: 'IN_PROGRESS', currentStep: 0 } });
}

describe('Fila de SETOR (chamado genérico — Fase 2)', () => {
  beforeEach(resetDb);

  it('roteia a etapa SETOR aos membros do setor de tratamento (exclui o iniciador)', async () => {
    const initiator = await makeUser('USER');
    const membro = await makeUser('USER');
    const sector = await prisma.sector.create({ data: { name: 'Marketing-test' } });
    await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: membro.id, role: 'LIDER', level: 'LIDER_1' } });
    const flow = await makeFlow('CHAMADO', [{ order: 0, requiredRole: 'SETOR', handlingSectorId: sector.id }]);
    const req = await newReq(flow.id, initiator.id);

    const created = await createRequestTasks(req.id, flow.id, 0);
    expect(created).toBe(1);
    const tasks = await prisma.requestTask.findMany({ where: { requestId: req.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].assigneeId).toBe(membro.id);

    // Concluir a tarefa do setor encerra o chamado (sem próxima etapa).
    const res = await request(app).post(`/api/tasks/${tasks[0].id}/complete`).set(auth(tokenFor(membro.id))).send({});
    expect(res.status).toBe(200);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('COMPLETED');
  });

  it('advanceRequest PULA uma ordem sem tarefas (activateOnSectorId sem recurso) e segue', async () => {
    const initiator = await makeUser('USER');
    const membro = await makeUser('USER');
    const mkt = await prisma.sector.create({ data: { name: 'Marketing-skip' } });
    await prisma.sectorMember.create({ data: { sectorId: mkt.id, userId: membro.id, role: 'LIDER', level: 'LIDER_1' } });
    const vazio = await prisma.sector.create({ data: { name: 'Setor-sem-recurso' } });
    const flow = await makeFlow('ONBOARDING', [
      { order: 0 }, // submissão (iniciador)
      { order: 10, activateOnSectorId: vazio.id }, // pulada: nenhum RequestResource do setor
      { order: 20, requiredRole: 'SETOR', handlingSectorId: mkt.id },
    ]);
    const req = await newReq(flow.id, initiator.id);
    await createRequestTasks(req.id, flow.id, 0);
    const t0 = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id, step: { order: 0 } } });

    const res = await request(app).post(`/api/tasks/${t0.id}/complete`).set(auth(tokenFor(initiator.id))).send({});
    expect(res.status).toBe(200);
    // Deve ter pulado a ordem 10 (vazia) e parado na 20 (com tarefa p/ o setor).
    const fresh = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(fresh.currentStep).toBe(20);
    const t20 = await prisma.requestTask.findMany({ where: { requestId: req.id, step: { order: 20 } } });
    expect(t20).toHaveLength(1);
    expect(t20[0].assigneeId).toBe(membro.id);
  });
});
