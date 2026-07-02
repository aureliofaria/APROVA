// ============================================================================
// Rotas de administração da sincronização de usuários com o M365/Entra ID.
// ADMIN only. Disparo manual (POST) + consulta do resultado da última
// execução (GET /status), incluindo se o recurso está habilitado no ambiente.
// ============================================================================
import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { runM365UserSync } from '../services/m365UserSync';
import { m365SyncEnabled, config } from '../config';

const router = Router();

router.post('/', authenticate, requireRole('ADMIN'), async (_req: AuthRequest, res: Response) => {
  try {
    if (!m365SyncEnabled()) {
      res.status(400).json({
        error: 'Sincronização M365 desabilitada. Defina M365_USER_SYNC_ENABLED=true e configure GRAPH_TENANT_ID/GRAPH_CLIENT_ID/GRAPH_CLIENT_SECRET.',
      });
      return;
    }
    const result = await runM365UserSync({ triggeredBy: 'MANUAL' });
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Erro ao sincronizar usuários com o M365' });
  }
});

router.get('/status', authenticate, requireRole('ADMIN'), async (_req: AuthRequest, res: Response) => {
  try {
    const lastRun = await prisma.m365SyncRun.findFirst({ orderBy: { startedAt: 'desc' } });
    res.json({
      enabled: m365SyncEnabled(),
      dryRun: config.m365Sync.dryRun,
      intervalMs: config.m365Sync.intervalMs,
      lastRun,
    });
  } catch {
    res.status(500).json({ error: 'Erro ao consultar status da sincronização M365' });
  }
});

export default router;
