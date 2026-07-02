import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { makeUser, resetDb, tokenFor } from './factory';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('rotas /api/admin/m365-sync', () => {
  beforeEach(resetDb);

  it('POST exige ADMIN (403 para USER comum)', async () => {
    const user = await makeUser('USER');
    const res = await request(app).post('/api/admin/m365-sync').set(auth(tokenFor(user.id)));
    expect(res.status).toBe(403);
  });

  it('POST retorna 400 quando a feature está desabilitada no ambiente (sem GRAPH_* configurado)', async () => {
    const admin = await makeUser('ADMIN');
    const res = await request(app).post('/api/admin/m365-sync').set(auth(tokenFor(admin.id)));
    // Ambiente de teste não define M365_USER_SYNC_ENABLED/GRAPH_* — gated.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/desabilitada/i);
  });

  it('GET /status exige ADMIN e retorna enabled:false quando não configurado', async () => {
    const user = await makeUser('USER');
    const forbidden = await request(app).get('/api/admin/m365-sync/status').set(auth(tokenFor(user.id)));
    expect(forbidden.status).toBe(403);

    const admin = await makeUser('ADMIN');
    const res = await request(app).get('/api/admin/m365-sync/status').set(auth(tokenFor(admin.id)));
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.lastRun).toBeNull();
  });

  it('GET /status reflete a última execução registrada', async () => {
    await prisma.m365SyncRun.create({
      data: { status: 'SUCCESS', created: 2, reactivated: 1, deactivated: 0, skipped: 3, errors: 0, finishedAt: new Date(), triggeredBy: 'MANUAL' },
    });
    const admin = await makeUser('ADMIN');
    const res = await request(app).get('/api/admin/m365-sync/status').set(auth(tokenFor(admin.id)));
    expect(res.status).toBe(200);
    expect(res.body.lastRun.created).toBe(2);
    expect(res.body.lastRun.skipped).toBe(3);
  });
});

describe('login: contas M365 sem senha definida (needsPasswordSetup)', () => {
  beforeEach(resetDb);

  it('bloqueia login por senha com mensagem explícita enquanto needsPasswordSetup=true', async () => {
    const u = await makeUser('USER', 'Recém-sincronizado', {
      email: 'recemsync@golplus.com.br',
      origin: 'M365',
      needsPasswordSetup: true,
    });
    const res = await request(app).post('/api/auth/login').send({ email: u.email, password: 'qualquer-coisa' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/M365/i);
  });

  it('ADMIN definir senha via PUT /api/users/:id libera o login (limpa needsPasswordSetup)', async () => {
    const admin = await makeUser('ADMIN');
    const u = await makeUser('USER', 'Recém-sincronizado 2', {
      email: 'recemsync2@golplus.com.br',
      origin: 'M365',
      needsPasswordSetup: true,
    });

    const upd = await request(app)
      .put(`/api/users/${u.id}`)
      .set(auth(tokenFor(admin.id)))
      .send({ password: 'NovaSenhaForte123' });
    expect(upd.status).toBe(200);
    expect(upd.body.needsPasswordSetup).toBe(false);

    const login = await request(app).post('/api/auth/login').send({ email: u.email, password: 'NovaSenhaForte123' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
  });
});
