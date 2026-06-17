import prisma from '../lib/prisma';

export async function createRequestTasks(requestId: string, flowId: string, stepOrder: number = 0) {
  const flow = await prisma.flowTemplate.findUnique({
    where: { id: flowId },
    include: { steps: { orderBy: { order: 'asc' }, include: { authLevels: true } } },
  });
  if (!flow) throw new Error('Fluxo não encontrado');

  const step = flow.steps.find((s) => s.order === stepOrder);
  if (!step) return;

  const request = await prisma.request.findUnique({ where: { id: requestId } });
  if (!request) throw new Error('Solicitação não encontrada');

  // Find users with the required role for this step
  let assignees: { id: string; name: string }[] = [];
  if (step.requiredRole) {
    assignees = await prisma.user.findMany({
      where: { role: step.requiredRole, isActive: true },
      select: { id: true, name: true },
    });
  }

  // Fallback: assign to the initiator if no role-based assignees
  if (assignees.length === 0) {
    const initiator = await prisma.user.findUnique({ where: { id: request.initiatorId }, select: { id: true, name: true } });
    if (initiator) assignees = [initiator];
  }

  const dueDate = step.deadlineHours
    ? new Date(Date.now() + step.deadlineHours * 60 * 60 * 1000)
    : null;

  for (const assignee of assignees) {
    await prisma.requestTask.create({
      data: {
        requestId,
        stepId: step.id,
        assigneeId: assignee.id,
        title: step.name,
        description: step.description,
        status: 'PENDING',
        dueDate,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      requestId,
      userId: request.initiatorId,
      userName: 'Sistema',
      action: 'STEP_STARTED',
      details: `Etapa iniciada: ${step.name}`,
    },
  });
}

export async function advanceRequest(requestId: string) {
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: { flow: { include: { steps: { orderBy: { order: 'asc' } } } } },
  });
  if (!request) throw new Error('Solicitação não encontrada');

  const complete = await isStepComplete(requestId, request.currentStep);
  if (!complete) return;

  const nextStepOrder = request.currentStep + 1;
  const nextStep = request.flow.steps.find((s) => s.order === nextStepOrder);

  if (nextStep) {
    await prisma.request.update({
      where: { id: requestId },
      data: { currentStep: nextStepOrder, status: 'IN_PROGRESS' },
    });
    await createRequestTasks(requestId, request.flowId, nextStepOrder);
  } else {
    await prisma.request.update({
      where: { id: requestId },
      data: { status: 'COMPLETED' },
    });
    await prisma.auditLog.create({
      data: {
        requestId,
        userId: request.initiatorId,
        userName: 'Sistema',
        action: 'COMPLETED',
        details: 'Solicitação concluída com sucesso',
      },
    });
  }
}

export async function checkAuthorizationLevel(requestId: string) {
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: {
      flow: {
        include: {
          steps: { orderBy: { order: 'asc' }, include: { authLevels: true } },
        },
      },
    },
  });
  if (!request) return null;

  const currentStep = request.flow.steps.find((s) => s.order === request.currentStep);
  if (!currentStep || currentStep.authLevels.length === 0) return null;

  const amount = request.amount || 0;
  for (const level of currentStep.authLevels) {
    const min = level.minValue ?? 0;
    const max = level.maxValue ?? Infinity;
    if (amount >= min && amount <= max) {
      return level;
    }
  }
  return currentStep.authLevels[currentStep.authLevels.length - 1];
}

export async function isStepComplete(requestId: string, stepOrder: number): Promise<boolean> {
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: {
      flow: {
        include: {
          steps: { where: { order: stepOrder }, include: { authLevels: true } },
        },
      },
      tasks: { where: { step: { order: stepOrder } } },
      approvals: { where: { stepOrder } },
    },
  });
  if (!request) return false;

  const step = request.flow.steps[0];
  if (!step) return false;

  // All tasks must be completed
  const allTasksDone = request.tasks.every((t) => t.status === 'COMPLETED');
  if (!allTasksDone) return false;

  // Check auth levels if any
  if (step.authLevels.length > 0) {
    const amount = request.amount || 0;
    let requiredApprovers = 1;
    for (const level of step.authLevels) {
      const min = level.minValue ?? 0;
      const max = level.maxValue ?? Infinity;
      if (amount >= min && amount <= max) {
        requiredApprovers = level.requiredApprovers;
        break;
      }
    }
    const approvedCount = request.approvals.filter((a) => a.decision === 'APPROVED').length;
    if (approvedCount < requiredApprovers) return false;
  }

  return true;
}
