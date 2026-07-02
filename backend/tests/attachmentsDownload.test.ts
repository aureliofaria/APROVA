// FIX 1 (auditoria da Lupa — visibilidade): os anexos eram servidos por
// `app.use('/uploads', express.static(...))`, um mount PÚBLICO — qualquer
// pessoa com a URL (nem precisava estar logada) baixava o arquivo, mesmo sem
// nenhum vínculo com a solicitação. Este arquivo prova que:
//  (a) a rota estática pública não existe mais;
//  (b) o novo download (GET /api/attachments/:id/download) exige token válido;
//  (c) só quem tem vínculo com a solicitação (mesmo predicado de
//      lib/visibility::canViewRequest usado no GET /requests/:id) baixa o
//      arquivo — forasteiro e anexo inexistente devolvem o MESMO 404 (Fix 3:
//      oráculo de existência uniforme).
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { makeFlow, makeUser, resetDb, tokenFor } from './factory';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// Cria uma solicitação com um anexo real (grava no disco via multer) e
// devolve reqId + attachmentId + o conteúdo esperado.
async function requestWithAttachment(initiatorId: string, flowId: string) {
  const created = await request(app)
    .post('/api/requests')
    .set(auth(tokenFor(initiatorId)))
    .send({ flowId, title: 'Solicitação com anexo' });
  const reqId = created.body.id as string;
  const upload = await request(app)
    .post(`/api/requests/${reqId}/attachments`)
    .set(auth(tokenFor(initiatorId)))
    .attach('files', Buffer.from('conteudo-secreto-do-anexo'), { filename: 'doc.txt', contentType: 'text/plain' });
  return { reqId, attachmentId: upload.body[0].id as string };
}

describe('FIX 1 — download de anexos autenticado (fecha o /uploads público)', () => {
  beforeEach(resetDb);

  it('GET /uploads/<file> não existe mais (mount estático público removido)', async () => {
    const res = await request(app).get('/uploads/qualquer-nome-de-arquivo.pdf');
    // Sem rota registrada para /uploads, o Express devolve 404 do handler padrão.
    expect(res.status).toBe(404);
  });

  it('sem token: 401', async () => {
    const user = await makeUser('USER');
    const flow = await makeFlow('ONBOARDING', [{ order: 0 }]);
    const { attachmentId } = await requestWithAttachment(user.id, flow.id);

    const res = await request(app).get(`/api/attachments/${attachmentId}/download`);
    expect(res.status).toBe(401);
  });

  it('iniciador baixa o próprio anexo: 200 + bytes corretos + nome original', async () => {
    const user = await makeUser('USER');
    const flow = await makeFlow('ONBOARDING', [{ order: 0 }]);
    const { attachmentId } = await requestWithAttachment(user.id, flow.id);

    const res = await request(app).get(`/api/attachments/${attachmentId}/download`).set(auth(tokenFor(user.id)));
    expect(res.status).toBe(200);
    expect(res.text).toBe('conteudo-secreto-do-anexo');
    expect(res.headers['content-disposition']).toContain('doc.txt');
  });

  it('forasteiro sem vínculo: 404 (não revela que o anexo/solicitação existe)', async () => {
    const user = await makeUser('USER');
    const forasteiro = await makeUser('USER');
    const flow = await makeFlow('ONBOARDING', [{ order: 0 }]);
    const { attachmentId } = await requestWithAttachment(user.id, flow.id);

    const res = await request(app).get(`/api/attachments/${attachmentId}/download`).set(auth(tokenFor(forasteiro.id)));
    expect(res.status).toBe(404);
  });

  it('anexo inexistente: MESMO 404 do caso sem vínculo (oráculo de existência uniforme)', async () => {
    const user = await makeUser('USER');
    const res = await request(app).get('/api/attachments/id-que-nao-existe/download').set(auth(tokenFor(user.id)));
    expect(res.status).toBe(404);
  });

  it('ADMIN baixa qualquer anexo (visão global)', async () => {
    const user = await makeUser('USER');
    const admin = await makeUser('ADMIN');
    const flow = await makeFlow('ONBOARDING', [{ order: 0 }]);
    const { attachmentId } = await requestWithAttachment(user.id, flow.id);

    const res = await request(app).get(`/api/attachments/${attachmentId}/download`).set(auth(tokenFor(admin.id)));
    expect(res.status).toBe(200);
  });

  it('responsável por uma tarefa da solicitação baixa o anexo mesmo sem ser o iniciador', async () => {
    const user = await makeUser('USER');
    const responsavel = await makeUser('MANAGER');
    const flow = await makeFlow('ONBOARDING', [{ order: 0 }]);
    const { reqId, attachmentId } = await requestWithAttachment(user.id, flow.id);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id } });
    await prisma.requestTask.create({
      data: { requestId: reqId, stepId: step.id, assigneeId: responsavel.id, title: 't', status: 'PENDING' },
    });

    const res = await request(app).get(`/api/attachments/${attachmentId}/download`).set(auth(tokenFor(responsavel.id)));
    expect(res.status).toBe(200);
  });
});
