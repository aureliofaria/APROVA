import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../src/lib/prisma';
import { advanceRequest, createRequestTasks } from '../src/services/workflow';
import { completeCurrentStepTasks, makeFlow, makeUser, resetDb } from './factory';

async function buildSingleStep(type: string) {
  const initiator = await makeUser('USER');
  const flow = await makeFlow(type, [{ order: 0 }]);
  const item = await prisma.resourceItem.create({ data: { name: `item-${type}`, type: 'EQUIPMENT' } });
  const req = await prisma.request.create({
    data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
  });
  await prisma.requestResource.create({ data: { requestId: req.id, resourceItemId: item.id, status: 'PENDING' } });
  await createRequestTasks(req.id, flow.id, 0);
  return req;
}

async function resourceStatus(requestId: string) {
  return (await prisma.requestResource.findFirstOrThrow({ where: { requestId } })).status;
}

describe('ciclo de vida do inventário', () => {
  beforeEach(resetDb);

  it('admissão (ONBOARDING) aloca o recurso na conclusão', async () => {
    const req = await buildSingleStep('ONBOARDING');
    expect(await resourceStatus(req.id)).toBe('PENDING');
    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('COMPLETED');
    expect(await resourceStatus(req.id)).toBe('ALLOCATED');
  });

  it('desligamento (OFFBOARDING) devolve o recurso na conclusão', async () => {
    const req = await buildSingleStep('OFFBOARDING');
    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);
    expect(await resourceStatus(req.id)).toBe('RETURNED');
  });

  it('compra (PURCHASE) aloca o recurso', async () => {
    const req = await buildSingleStep('PURCHASE');
    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);
    expect(await resourceStatus(req.id)).toBe('ALLOCATED');
  });

  it('pagamento (PAYMENT) não transiciona o inventário', async () => {
    const req = await buildSingleStep('PAYMENT');
    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);
    expect(await resourceStatus(req.id)).toBe('PENDING');
  });

  it('gera log de auditoria da alocação', async () => {
    const req = await buildSingleStep('ONBOARDING');
    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);
    const logs = await prisma.auditLog.findMany({ where: { requestId: req.id, action: 'RESOURCES_ALLOCATED' } });
    expect(logs.length).toBe(1);
  });
});
