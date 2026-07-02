import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { makeFlow, makeUser, resetDb, tokenFor } from './factory';
import { validateFieldValue, parseSelectOptions } from '../src/lib/fieldValidation';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// Cria fluxo PAYMENT com 1 etapa e devolve { flow, step }.
async function flowWithStep() {
  const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
  const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id } });
  return { flow, step };
}

// Cria solicitação IN_PROGRESS na etapa 0 com uma tarefa aberta para o assignee.
async function requestWithTask(flowId: string, stepId: string, initiatorId: string, assigneeId: string) {
  const req = await prisma.request.create({
    data: { flowId, initiatorId, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
  });
  await prisma.requestTask.create({
    data: { requestId: req.id, stepId, assigneeId, title: 'tarefa', status: 'PENDING' },
  });
  return req;
}

describe('Passo 7 — campos dinâmicos por etapa', () => {
  beforeEach(resetDb);

  // ---- CRUD de definição (ADMIN) -------------------------------------------
  describe('CRUD de FormField', () => {
    it('cria campo TEXT válido', async () => {
      const admin = await makeUser('ADMIN');
      const { flow, step } = await flowWithStep();
      const r = await request(app)
        .post(`/api/flows/${flow.id}/steps/${step.id}/fields`)
        .set(auth(tokenFor(admin.id)))
        .send({ key: 'observacao', label: 'Observação', type: 'TEXT' });
      expect(r.status).toBe(201);
      expect(r.body.key).toBe('observacao');
    });

    it('rejeita key fora de snake_case (400)', async () => {
      const admin = await makeUser('ADMIN');
      const { flow, step } = await flowWithStep();
      const r = await request(app)
        .post(`/api/flows/${flow.id}/steps/${step.id}/fields`)
        .set(auth(tokenFor(admin.id)))
        .send({ key: 'Observacao Errada', label: 'X', type: 'TEXT' });
      expect(r.status).toBe(400);
    });

    it('rejeita type inválido (400)', async () => {
      const admin = await makeUser('ADMIN');
      const { flow, step } = await flowWithStep();
      const r = await request(app)
        .post(`/api/flows/${flow.id}/steps/${step.id}/fields`)
        .set(auth(tokenFor(admin.id)))
        .send({ key: 'campo', label: 'X', type: 'FOO' });
      expect(r.status).toBe(400);
    });

    it('rejeita sensitiveType inválido (400)', async () => {
      const admin = await makeUser('ADMIN');
      const { flow, step } = await flowWithStep();
      const r = await request(app)
        .post(`/api/flows/${flow.id}/steps/${step.id}/fields`)
        .set(auth(tokenFor(admin.id)))
        .send({ key: 'campo', label: 'X', type: 'TEXT', sensitiveType: 'BANANA' });
      expect(r.status).toBe(400);
    });

    it('key duplicada na mesma etapa retorna 409', async () => {
      const admin = await makeUser('ADMIN');
      const { flow, step } = await flowWithStep();
      const base = { key: 'cpf_titular', label: 'CPF', type: 'CPF' };
      const a = await request(app).post(`/api/flows/${flow.id}/steps/${step.id}/fields`).set(auth(tokenFor(admin.id))).send(base);
      expect(a.status).toBe(201);
      const b = await request(app).post(`/api/flows/${flow.id}/steps/${step.id}/fields`).set(auth(tokenFor(admin.id))).send(base);
      expect(b.status).toBe(409);
    });

    it('SELECT exige options JSON array; lixo é rejeitado e array é aceito', async () => {
      const admin = await makeUser('ADMIN');
      const { flow, step } = await flowWithStep();
      const sem = await request(app).post(`/api/flows/${flow.id}/steps/${step.id}/fields`).set(auth(tokenFor(admin.id)))
        .send({ key: 'opt', label: 'Opção', type: 'SELECT' });
      expect(sem.status).toBe(400);
      const lixo = await request(app).post(`/api/flows/${flow.id}/steps/${step.id}/fields`).set(auth(tokenFor(admin.id)))
        .send({ key: 'opt', label: 'Opção', type: 'SELECT', options: 'nao-e-json' });
      expect(lixo.status).toBe(400);
      const ok = await request(app).post(`/api/flows/${flow.id}/steps/${step.id}/fields`).set(auth(tokenFor(admin.id)))
        .send({ key: 'opt', label: 'Opção', type: 'SELECT', options: ['A', 'B'] });
      expect(ok.status).toBe(201);
    });

    it('não-ADMIN não cria campo (403)', async () => {
      const user = await makeUser('USER');
      const { flow, step } = await flowWithStep();
      const r = await request(app).post(`/api/flows/${flow.id}/steps/${step.id}/fields`).set(auth(tokenFor(user.id)))
        .send({ key: 'campo', label: 'X', type: 'TEXT' });
      expect(r.status).toBe(403);
    });

    // REF.1 — auto-sensibilidade só p/ CPF/RG
    it('REF.1: CPF/RG auto-setam sensitiveType; MONEY não', async () => {
      const admin = await makeUser('ADMIN');
      const { flow, step } = await flowWithStep();
      const cpf = await request(app).post(`/api/flows/${flow.id}/steps/${step.id}/fields`).set(auth(tokenFor(admin.id)))
        .send({ key: 'cpf', label: 'CPF', type: 'CPF' });
      expect(cpf.body.sensitiveType).toBe('CPF');
      const rg = await request(app).post(`/api/flows/${flow.id}/steps/${step.id}/fields`).set(auth(tokenFor(admin.id)))
        .send({ key: 'rg', label: 'RG', type: 'RG' });
      expect(rg.body.sensitiveType).toBe('RG');
      const money = await request(app).post(`/api/flows/${flow.id}/steps/${step.id}/fields`).set(auth(tokenFor(admin.id)))
        .send({ key: 'valor', label: 'Valor', type: 'MONEY' });
      expect(money.body.sensitiveType).toBeNull();
    });

    it('GET /:id do fluxo inclui formFields ordenados', async () => {
      const admin = await makeUser('ADMIN');
      const { flow, step } = await flowWithStep();
      await request(app).post(`/api/flows/${flow.id}/steps/${step.id}/fields`).set(auth(tokenFor(admin.id)))
        .send({ key: 'b', label: 'B', type: 'TEXT', order: 2 });
      await request(app).post(`/api/flows/${flow.id}/steps/${step.id}/fields`).set(auth(tokenFor(admin.id)))
        .send({ key: 'a', label: 'A', type: 'TEXT', order: 1 });
      const r = await request(app).get(`/api/flows/${flow.id}`).set(auth(tokenFor(admin.id)));
      expect(r.status).toBe(200);
      const keys = r.body.steps[0].formFields.map((f: any) => f.key);
      expect(keys).toEqual(['a', 'b']);
    });
  });

  // ---- Validação de valores (REF.2 tolerante) ------------------------------
  describe('validateFieldValue (REF.2 — tolerante)', () => {
    it('CPF aceita com e sem máscara; inválido reprova', () => {
      expect(validateFieldValue('CPF', '529.982.247-25').ok).toBe(true);
      expect(validateFieldValue('CPF', '52998224725').ok).toBe(true);
      expect(validateFieldValue('CPF', '111.111.111-11').ok).toBe(false);
      expect(validateFieldValue('CPF', '123').ok).toBe(false);
    });
    it('PHONE aceita com e sem máscara', () => {
      expect(validateFieldValue('PHONE', '(11) 98888-7777').ok).toBe(true);
      expect(validateFieldValue('PHONE', '11988887777').ok).toBe(true);
      expect(validateFieldValue('PHONE', '+55 11 98888-7777').ok).toBe(true);
      expect(validateFieldValue('PHONE', '123').ok).toBe(false);
    });
    it('RG aceita com e sem máscara', () => {
      expect(validateFieldValue('RG', '12.345.678-9').ok).toBe(true);
      expect(validateFieldValue('RG', '123456789').ok).toBe(true);
    });
    it('EMAIL/NUMBER/DATE/MONEY sensatos', () => {
      expect(validateFieldValue('EMAIL', 'a@b.com').ok).toBe(true);
      expect(validateFieldValue('EMAIL', 'sem-arroba').ok).toBe(false);
      expect(validateFieldValue('NUMBER', '42').ok).toBe(true);
      expect(validateFieldValue('NUMBER', 'abc').ok).toBe(false);
      expect(validateFieldValue('DATE', '2026-06-28').ok).toBe(true);
      expect(validateFieldValue('DATE', 'ontem').ok).toBe(false);
      expect(validateFieldValue('MONEY', '150000').ok).toBe(true);
      expect(validateFieldValue('MONEY', 'xpto').ok).toBe(false);
    });

    // Fix 5 (auditoria Lupa — MÉDIO): SELECT aceitava QUALQUER valor, mesmo
    // fora das options cadastradas. Correção: parseSelectOptions tolerante
    // (JSON array ou lista separada por vírgula/linha); com options definidas,
    // valor fora da lista é rejeitado. Sem options (compat), aceita qualquer valor.
    it('Fix 5: SELECT com options JSON array rejeita valor fora da lista e aceita valor válido', () => {
      const options = JSON.stringify(['aprovado', 'reprovado']);
      expect(validateFieldValue('SELECT', 'foo-fora-da-lista', options).ok).toBe(false);
      expect(validateFieldValue('SELECT', 'aprovado', options).ok).toBe(true);
      expect(validateFieldValue('SELECT', 'reprovado', options).ok).toBe(true);
    });

    it('Fix 5: SELECT sem options definidas aceita qualquer valor (compat)', () => {
      expect(validateFieldValue('SELECT', 'qualquer-coisa', null).ok).toBe(true);
      expect(validateFieldValue('SELECT', 'qualquer-coisa', undefined).ok).toBe(true);
      expect(validateFieldValue('SELECT', 'qualquer-coisa', '').ok).toBe(true);
    });

    it('parseSelectOptions: aceita JSON array de strings, de objetos {value,label} e lista por vírgula/linha', () => {
      expect(parseSelectOptions(JSON.stringify(['sim', 'nao']))).toEqual(['sim', 'nao']);
      expect(parseSelectOptions(JSON.stringify([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]))).toEqual(['a', 'b']);
      expect(parseSelectOptions('sim,nao')).toEqual(['sim', 'nao']);
      expect(parseSelectOptions('sim\nnao')).toEqual(['sim', 'nao']);
      expect(parseSelectOptions(null)).toEqual([]);
      expect(parseSelectOptions('')).toEqual([]);
    });
  });

  // ---- Gravação de valores + autorização -----------------------------------
  describe('POST /requests/:id/fields', () => {
    it('assignee grava valores; CPF inválido bloqueia com 400', async () => {
      const admin = await makeUser('ADMIN');
      const initiator = await makeUser('USER');
      const assignee = await makeUser('USER');
      const { flow, step } = await flowWithStep();
      const cpf = await prisma.formField.create({ data: { flowStepId: step.id, key: 'cpf', label: 'CPF', type: 'CPF', sensitiveType: 'CPF' } });
      const reqRow = await requestWithTask(flow.id, step.id, initiator.id, assignee.id);

      const bad = await request(app).post(`/api/requests/${reqRow.id}/fields`).set(auth(tokenFor(assignee.id)))
        .send({ stepOrder: 0, values: [{ fieldId: cpf.id, value: '111.111.111-11' }] });
      expect(bad.status).toBe(400);

      const good = await request(app).post(`/api/requests/${reqRow.id}/fields`).set(auth(tokenFor(assignee.id)))
        .send({ stepOrder: 0, values: [{ fieldId: cpf.id, value: '529.982.247-25' }] });
      expect(good.status).toBe(200);
      // A resposta de gravação NÃO ecoa o valor cru (PII só sai pelo mascaramento).
      expect(good.body).toEqual({ ok: true, count: 1, savedFieldIds: [cpf.id] });
      expect(JSON.stringify(good.body)).not.toContain('529.982.247-25');
      const stored = await prisma.requestFieldValue.findFirstOrThrow({ where: { requestId: reqRow.id, fieldId: cpf.id } });
      expect(stored.value).toBe('529.982.247-25'); // armazenado como enviado
    });

    it('MONEY validado via parseCents e gravado', async () => {
      const initiator = await makeUser('USER');
      const assignee = await makeUser('USER');
      const { flow, step } = await flowWithStep();
      const money = await prisma.formField.create({ data: { flowStepId: step.id, key: 'valor', label: 'Valor', type: 'MONEY' } });
      const reqRow = await requestWithTask(flow.id, step.id, initiator.id, assignee.id);
      const r = await request(app).post(`/api/requests/${reqRow.id}/fields`).set(auth(tokenFor(assignee.id)))
        .send({ stepOrder: 0, values: [{ fieldId: money.id, value: '150000' }] });
      expect(r.status).toBe(200);
    });

    it('Fix 5: SELECT com options — valor fora da lista → 400; valor válido → 200', async () => {
      const initiator = await makeUser('USER');
      const assignee = await makeUser('USER');
      const { flow, step } = await flowWithStep();
      const select = await prisma.formField.create({
        data: { flowStepId: step.id, key: 'decisao', label: 'Decisão', type: 'SELECT', options: JSON.stringify(['aprovado', 'reprovado']) },
      });
      const reqRow = await requestWithTask(flow.id, step.id, initiator.id, assignee.id);

      const bad = await request(app).post(`/api/requests/${reqRow.id}/fields`).set(auth(tokenFor(assignee.id)))
        .send({ stepOrder: 0, values: [{ fieldId: select.id, value: 'talvez' }] });
      expect(bad.status).toBe(400);

      const good = await request(app).post(`/api/requests/${reqRow.id}/fields`).set(auth(tokenFor(assignee.id)))
        .send({ stepOrder: 0, values: [{ fieldId: select.id, value: 'aprovado' }] });
      expect(good.status).toBe(200);
      const stored = await prisma.requestFieldValue.findFirstOrThrow({ where: { requestId: reqRow.id, fieldId: select.id } });
      expect(stored.value).toBe('aprovado');
    });

    it('quem não tem tarefa aberta na etapa recebe 403', async () => {
      const initiator = await makeUser('USER');
      const assignee = await makeUser('USER');
      const intruso = await makeUser('USER');
      const { flow, step } = await flowWithStep();
      const f = await prisma.formField.create({ data: { flowStepId: step.id, key: 'campo', label: 'X', type: 'TEXT' } });
      const reqRow = await requestWithTask(flow.id, step.id, initiator.id, assignee.id);
      const r = await request(app).post(`/api/requests/${reqRow.id}/fields`).set(auth(tokenFor(intruso.id)))
        .send({ stepOrder: 0, values: [{ fieldId: f.id, value: 'oi' }] });
      expect(r.status).toBe(403);
    });

    it('gravar campo sensível gera AuditLog SENSITIVE_FIELD_WRITTEN', async () => {
      const initiator = await makeUser('USER');
      const assignee = await makeUser('USER');
      const { flow, step } = await flowWithStep();
      const cpf = await prisma.formField.create({ data: { flowStepId: step.id, key: 'cpf', label: 'CPF', type: 'CPF', sensitiveType: 'CPF' } });
      const reqRow = await requestWithTask(flow.id, step.id, initiator.id, assignee.id);
      await request(app).post(`/api/requests/${reqRow.id}/fields`).set(auth(tokenFor(assignee.id)))
        .send({ stepOrder: 0, values: [{ fieldId: cpf.id, value: '529.982.247-25' }] });
      const logs = await prisma.auditLog.findMany({ where: { requestId: reqRow.id, action: 'SENSITIVE_FIELD_WRITTEN' } });
      expect(logs.length).toBe(1);
      expect(JSON.parse(logs[0].details!)).toEqual({ field: 'cpf', type: 'CPF' });
    });
  });

  // ---- Guarda pré-conclusão -------------------------------------------------
  describe('requiredFieldsUnmet (guarda de conclusão)', () => {
    it('campo obrigatório vazio bloqueia conclusão com 400 + missing', async () => {
      const initiator = await makeUser('USER');
      const assignee = await makeUser('USER');
      const { flow, step } = await flowWithStep();
      await prisma.formField.create({ data: { flowStepId: step.id, key: 'motivo', label: 'Motivo', type: 'TEXT', required: true } });
      const reqRow = await requestWithTask(flow.id, step.id, initiator.id, assignee.id);
      const task = await prisma.requestTask.findFirstOrThrow({ where: { requestId: reqRow.id } });
      const r = await request(app).post(`/api/tasks/${task.id}/complete`).set(auth(tokenFor(assignee.id))).send({});
      expect(r.status).toBe(400);
      expect(r.body.missing).toContain('motivo');
    });

    it('preenchido o obrigatório, a conclusão passa', async () => {
      const initiator = await makeUser('USER');
      const assignee = await makeUser('USER');
      const { flow, step } = await flowWithStep();
      const f = await prisma.formField.create({ data: { flowStepId: step.id, key: 'motivo', label: 'Motivo', type: 'TEXT', required: true } });
      const reqRow = await requestWithTask(flow.id, step.id, initiator.id, assignee.id);
      await request(app).post(`/api/requests/${reqRow.id}/fields`).set(auth(tokenFor(assignee.id)))
        .send({ stepOrder: 0, values: [{ fieldId: f.id, value: 'porque sim' }] });
      const task = await prisma.requestTask.findFirstOrThrow({ where: { requestId: reqRow.id } });
      const r = await request(app).post(`/api/tasks/${task.id}/complete`).set(auth(tokenFor(assignee.id))).send({});
      expect(r.status).toBe(200);
    });
  });

  // ---- ATIVAÇÃO DO MASCARAMENTO (LGPD) — prova de que não é no-op ----------
  describe('mascaramento efetivo no GET /requests/:id (LGPD)', () => {
    // Monta uma request com um valor de CPF dinâmico e um espectador com setor.
    async function seedWithCpf(viewerSector: string) {
      const initiator = await makeUser('USER');
      const { flow, step } = await flowWithStep();
      const cpf = await prisma.formField.create({ data: { flowStepId: step.id, key: 'cpf_colaborador', label: 'CPF', type: 'CPF', sensitiveType: 'CPF' } });
      const reqRow = await prisma.request.create({ data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 } });
      await prisma.requestFieldValue.create({ data: { requestId: reqRow.id, fieldId: cpf.id, value: '529.982.247-25' } });

      const sector = await prisma.sector.create({ data: { name: viewerSector } });
      const viewer = await makeUser('USER');
      await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: viewer.id, role: 'PROTETOR', level: 'MEMBRO' } });
      // Garante visibilidade: dá ao viewer uma tarefa na request (envolvido).
      await prisma.requestTask.create({ data: { requestId: reqRow.id, stepId: step.id, assigneeId: viewer.id, title: 'x', status: 'PENDING' } });
      return { reqRow, viewer };
    }

    it('viewer RH vê CPF intacto e gera SENSITIVE_VIEW', async () => {
      const { reqRow, viewer } = await seedWithCpf('RH');
      const r = await request(app).get(`/api/requests/${reqRow.id}`).set(auth(tokenFor(viewer.id)));
      expect(r.status).toBe(200);
      const fv = r.body.fieldValues.find((v: any) => v.field.key === 'cpf_colaborador');
      expect(fv.value).toBe('529.982.247-25'); // intacto
      const logs = await prisma.auditLog.findMany({ where: { requestId: reqRow.id, action: 'SENSITIVE_VIEW' } });
      expect(logs.length).toBe(1);
      expect(JSON.parse(logs[0].details!)).toEqual({ fields: [{ field: 'cpf_colaborador', type: 'CPF' }] });
    });

    it('viewer TI vê CPF mascarado e NÃO gera SENSITIVE_VIEW', async () => {
      const { reqRow, viewer } = await seedWithCpf('TI, Dados e Infra');
      const r = await request(app).get(`/api/requests/${reqRow.id}`).set(auth(tokenFor(viewer.id)));
      expect(r.status).toBe(200);
      const fv = r.body.fieldValues.find((v: any) => v.field.key === 'cpf_colaborador');
      expect(fv.value).toBe('***.***.***-**');
      const logs = await prisma.auditLog.findMany({ where: { requestId: reqRow.id, action: 'SENSITIVE_VIEW' } });
      expect(logs.length).toBe(0);
    });

    it('campo SEM sensitiveType nunca é mascarado (mesmo p/ TI)', async () => {
      const initiator = await makeUser('USER');
      const { flow, step } = await flowWithStep();
      const plain = await prisma.formField.create({ data: { flowStepId: step.id, key: 'observacao', label: 'Obs', type: 'TEXT' } });
      const reqRow = await prisma.request.create({ data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 } });
      await prisma.requestFieldValue.create({ data: { requestId: reqRow.id, fieldId: plain.id, value: 'texto livre' } });
      const sector = await prisma.sector.create({ data: { name: 'TI, Dados e Infra' } });
      const viewer = await makeUser('USER');
      await prisma.sectorMember.create({ data: { sectorId: sector.id, userId: viewer.id, role: 'PROTETOR', level: 'MEMBRO' } });
      await prisma.requestTask.create({ data: { requestId: reqRow.id, stepId: step.id, assigneeId: viewer.id, title: 'x', status: 'PENDING' } });

      const r = await request(app).get(`/api/requests/${reqRow.id}`).set(auth(tokenFor(viewer.id)));
      const fv = r.body.fieldValues.find((v: any) => v.field.key === 'observacao');
      expect(fv.value).toBe('texto livre');
      const logs = await prisma.auditLog.findMany({ where: { requestId: reqRow.id, action: 'SENSITIVE_VIEW' } });
      expect(logs.length).toBe(0);
    });

    it('GET / (lista) NÃO inclui fieldValues (evita PII em massa)', async () => {
      const admin = await makeUser('ADMIN');
      const { flow, step } = await flowWithStep();
      const cpf = await prisma.formField.create({ data: { flowStepId: step.id, key: 'cpf', label: 'CPF', type: 'CPF', sensitiveType: 'CPF' } });
      const reqRow = await prisma.request.create({ data: { flowId: flow.id, initiatorId: admin.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 } });
      await prisma.requestFieldValue.create({ data: { requestId: reqRow.id, fieldId: cpf.id, value: '529.982.247-25' } });
      const r = await request(app).get('/api/requests').set(auth(tokenFor(admin.id)));
      expect(r.status).toBe(200);
      const row = r.body.find((x: any) => x.id === reqRow.id);
      expect(row.fieldValues).toBeUndefined();
    });
  });
});

// ============================================================================
// FIX (achado BLOQUEADOR da Sonda): GET /requests/:id não incluía `formFields`
// no include das etapas do fluxo (só authLevels/checklistItems) — o painel
// "Preencher dados desta etapa" do RequestDetail (canFillFields) nunca
// renderizava para etapas > 0, travando QUALQUER fluxo com FormField
// obrigatório fora da etapa 0 (ex.: Admissão · RH — expected_start_date):
// /complete falhava com 400 e a UI não oferecia onde preencher o campo.
// ============================================================================
describe('Fix — GET /requests/:id inclui formFields das etapas (não só a 0)', () => {
  beforeEach(resetDb);

  async function flowComDuasEtapas() {
    const flow = await makeFlow('ONBOARDING', [{ order: 0 }, { order: 1, requiredRole: 'RH' }]);
    const step1 = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 1 } });
    const field = await prisma.formField.create({
      data: { flowStepId: step1.id, key: 'expected_start_date', label: 'Data prevista de início', type: 'DATE', required: true },
    });
    return { flow, step1, field };
  }

  it('formFields de uma etapa > 0 vêm no GET /requests/:id', async () => {
    const admin = await makeUser('ADMIN');
    const initiator = await makeUser('USER');
    const { flow, field } = await flowComDuasEtapas();
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 1 },
    });

    const res = await request(app).get(`/api/requests/${req.id}`).set(auth(tokenFor(admin.id)));
    expect(res.status).toBe(200);
    const stepBody = res.body.flow.steps.find((s: any) => s.order === 1);
    expect(stepBody.formFields).toBeDefined();
    expect(stepBody.formFields.map((f: any) => f.id)).toContain(field.id);
    expect(stepBody.formFields.find((f: any) => f.id === field.id).key).toBe('expected_start_date');
  });

  it('formFields não vazam RequestFieldValue (só a DEFINIÇÃO do campo, sem valor)', async () => {
    const admin = await makeUser('ADMIN');
    const initiator = await makeUser('USER');
    const { flow, field } = await flowComDuasEtapas();
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 1 },
    });
    await prisma.requestFieldValue.create({ data: { requestId: req.id, fieldId: field.id, value: '2026-08-01' } });

    const res = await request(app).get(`/api/requests/${req.id}`).set(auth(tokenFor(admin.id)));
    const stepBody = res.body.flow.steps.find((s: any) => s.order === 1);
    const fieldBody = stepBody.formFields.find((f: any) => f.id === field.id);
    // A DEFINIÇÃO não carrega `value`/`values` — o valor preenchido só existe
    // (mascarado quando sensível) em request.fieldValues, canal já auditado.
    expect(fieldBody.value).toBeUndefined();
    expect(fieldBody.values).toBeUndefined();
  });

  it('ciclo completo: campo obrigatório na etapa 1 trava /complete até ser preenchido via /fields', async () => {
    const rh = await makeUser('RH');
    const initiator = await makeUser('USER');
    const { flow, step1, field } = await flowComDuasEtapas();
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 1 },
    });
    const task = await prisma.requestTask.create({
      data: { requestId: req.id, stepId: step1.id, assigneeId: rh.id, title: 'Avaliação RH', status: 'PENDING' },
    });

    // GET /requests/:id expõe o campo — é o que o painel do RequestDetail usa.
    const getRes = await request(app).get(`/api/requests/${req.id}`).set(auth(tokenFor(rh.id)));
    expect(getRes.status).toBe(200);
    const stepBody = getRes.body.flow.steps.find((s: any) => s.order === 1);
    expect(stepBody.formFields).toHaveLength(1);

    // Sem preencher: /complete falha 400 com o campo faltante.
    const failComplete = await request(app).post(`/api/tasks/${task.id}/complete`).set(auth(tokenFor(rh.id))).send({});
    expect(failComplete.status).toBe(400);
    expect(failComplete.body.missing).toContain('expected_start_date');

    // Preenche via POST /requests/:id/fields (o mesmo endpoint que o painel usa).
    const fill = await request(app).post(`/api/requests/${req.id}/fields`).set(auth(tokenFor(rh.id)))
      .send({ stepOrder: 1, values: [{ fieldId: field.id, value: '2026-08-01' }] });
    expect(fill.status).toBe(200);

    // Agora /complete passa.
    const okComplete = await request(app).post(`/api/tasks/${task.id}/complete`).set(auth(tokenFor(rh.id))).send({});
    expect(okComplete.status).toBe(200);
  });
});
