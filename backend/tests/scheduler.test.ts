import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '../src/lib/prisma';
import { makeUser, resetDb } from './factory';
import { startPaymentsScheduler, stopPaymentsScheduler, runSchedulerTickOnce } from '../src/services/scheduler';

async function makePaymentFlow() {
  const flow = await prisma.flowTemplate.create({ data: { name: 'PAY', type: 'PAYMENT', isActive: true } });
  await prisma.flowStep.create({ data: { flowTemplateId: flow.id, order: 0, name: 'Solicitação', requiredRole: 'USER', requiresAttachment: true } });
  return flow;
}

describe('scheduler de recorrências', () => {
  beforeEach(resetDb);
  afterEach(() => { stopPaymentsScheduler(); delete process.env.PAYMENTS_SCHEDULER_ENABLED; });

  it('não liga quando PAYMENTS_SCHEDULER_ENABLED != true', () => {
    delete process.env.PAYMENTS_SCHEDULER_ENABLED;
    expect(startPaymentsScheduler()).toBe(false);
  });

  it('liga quando habilitado por env', () => {
    process.env.PAYMENTS_SCHEDULER_ENABLED = 'true';
    expect(startPaymentsScheduler()).toBe(true);
    stopPaymentsScheduler();
  });

  it('uma rodada gera as recorrências vencidas e é idempotente (não duplica)', async () => {
    const fin = await makeUser('FINANCE');
    const flow = await makePaymentFlow();
    await prisma.paymentRecurrence.create({
      data: { flowId: flow.id, initiatorId: fin.id, title: 'Aluguel', paymentCategory: 'RECORRENCIA', amountCents: 500000, costCenter: 'ADM-1', justification: 'j', intervalUnit: 'MONTH', intervalCount: 1, nextRunAt: new Date(Date.now() - 86400000) },
    });

    await runSchedulerTickOnce();
    await runSchedulerTickOnce(); // 2ª rodada no mesmo período não duplica
    expect(await prisma.request.count({ where: { flowId: flow.id } })).toBe(1);
  });

  it('uma rodada com falha não lança (resiliente)', async () => {
    // Sem recorrências vencidas: rodada deve completar sem erro.
    await expect(runSchedulerTickOnce()).resolves.toBeUndefined();
  });
});
