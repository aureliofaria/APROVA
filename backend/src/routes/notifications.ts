import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

const VALID_CHANNELS = ['IN_APP', 'TEAMS', 'OUTLOOK'];
const VALID_EVENTS = ['TASK_ASSIGNED', 'REQUEST_REJECTED', 'REQUEST_COMPLETED', 'COMMENT_ADDED'];

// Notificações in-app do usuário atual (apenas IN_APP é entregue hoje).
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'UNREAD';
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id, channel: 'IN_APP', ...(status === 'ALL' ? {} : { status }) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(notifications);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar notificações' });
  }
});

router.get('/unread-count', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.notification.count({ where: { userId: req.user.id, channel: 'IN_APP', status: 'UNREAD' } });
    res.json({ count });
  } catch {
    res.status(500).json({ error: 'Erro ao contar notificações' });
  }
});

router.post('/:id/read', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!notification || notification.userId !== req.user.id) { res.status(404).json({ error: 'Notificação não encontrada' }); return; }
    const updated = await prisma.notification.update({ where: { id: req.params.id }, data: { status: 'READ', readAt: new Date() } });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Erro ao marcar notificação' });
  }
});

router.post('/read-all', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, channel: 'IN_APP', status: 'UNREAD' },
      data: { status: 'READ', readAt: new Date() },
    });
    res.json({ message: 'Notificações marcadas como lidas' });
  } catch {
    res.status(500).json({ error: 'Erro ao marcar notificações' });
  }
});

// --- Preferências configuráveis ---
router.get('/preferences', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const prefs = await prisma.notificationPreference.findMany({ where: { userId: req.user.id } });
    res.json(prefs);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar preferências' });
  }
});

router.put('/preferences', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { preferences } = req.body as { preferences?: { channel: string; eventType: string; enabled: boolean }[] };
    if (!Array.isArray(preferences) || preferences.length === 0) {
      res.status(400).json({ error: 'preferences deve ser um array não vazio' }); return;
    }
    for (const p of preferences) {
      if (!VALID_CHANNELS.includes(p.channel) || !VALID_EVENTS.includes(p.eventType) || typeof p.enabled !== 'boolean') {
        res.status(400).json({ error: 'Preferência inválida' }); return;
      }
    }
    await prisma.$transaction(
      preferences.map((p) =>
        prisma.notificationPreference.upsert({
          where: { userId_channel_eventType: { userId: req.user.id, channel: p.channel, eventType: p.eventType } },
          update: { enabled: p.enabled },
          create: { userId: req.user.id, channel: p.channel, eventType: p.eventType, enabled: p.enabled },
        })
      )
    );
    const prefs = await prisma.notificationPreference.findMany({ where: { userId: req.user.id } });
    res.json(prefs);
  } catch {
    res.status(500).json({ error: 'Erro ao salvar preferências' });
  }
});

export default router;
