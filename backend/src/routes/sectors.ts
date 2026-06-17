import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// Lista setores — ADMIN vê todos; demais veem apenas onde são membros
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const isAdmin = req.user?.role === 'ADMIN';
    const where = isAdmin
      ? {}
      : { members: { some: { userId: req.user!.id } } };

    const sectors = await prisma.sector.findMany({
      where,
      include: {
        _count: { select: { members: true, users: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
          orderBy: { role: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
    res.json(sectors);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar setores' });
  }
});

// Detalhe de um setor — valida acesso do usuário
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const isAdmin = req.user?.role === 'ADMIN';
    if (!isAdmin) {
      const membership = await prisma.sectorMember.findFirst({
        where: { sectorId: req.params.id, userId: req.user!.id },
      });
      if (!membership) { res.status(403).json({ error: 'Acesso negado a este setor' }); return; }
    }

    const sector = await prisma.sector.findUnique({
      where: { id: req.params.id },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true, role: true, isActive: true } } },
          orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        },
        users: { select: { id: true, name: true, email: true, role: true, isActive: true } },
        flowTemplates: { select: { id: true, name: true, type: true, scope: true, isActive: true } },
        _count: { select: { members: true, users: true, flowTemplates: true } },
      },
    });
    if (!sector) { res.status(404).json({ error: 'Setor não encontrado' }); return; }
    res.json(sector);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar setor' });
  }
});

// Criar setor
router.post('/', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: 'Nome é obrigatório' }); return; }
    const sector = await prisma.sector.create({ data: { name: name.trim(), description } });
    res.status(201).json(sector);
  } catch {
    res.status(500).json({ error: 'Erro ao criar setor' });
  }
});

// Atualizar setor
router.put('/:id', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, isActive } = req.body;
    const sector = await prisma.sector.update({
      where: { id: req.params.id },
      data: { name, description, isActive },
    });
    res.json(sector);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar setor' });
  }
});

// Excluir setor
router.delete('/:id', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.sector.delete({ where: { id: req.params.id } });
    res.json({ message: 'Setor removido com sucesso' });
  } catch {
    res.status(500).json({ error: 'Erro ao remover setor' });
  }
});

// Adicionar membro (LIDER ou PROTETOR)
router.post('/:id/members', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, role } = req.body;
    if (!userId || !role) { res.status(400).json({ error: 'userId e role são obrigatórios' }); return; }
    if (!['LIDER', 'PROTETOR'].includes(role)) { res.status(400).json({ error: 'role deve ser LIDER ou PROTETOR' }); return; }

    const member = await prisma.sectorMember.upsert({
      where: { sectorId_userId_role: { sectorId: req.params.id, userId, role } },
      update: {},
      create: { sectorId: req.params.id, userId, role },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
    res.status(201).json(member);
  } catch {
    res.status(500).json({ error: 'Erro ao adicionar membro' });
  }
});

// Remover membro
router.delete('/:id/members/:memberId', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.sectorMember.delete({ where: { id: req.params.memberId } });
    res.json({ message: 'Membro removido com sucesso' });
  } catch {
    res.status(500).json({ error: 'Erro ao remover membro' });
  }
});

// Alterar papel do membro
router.put('/:id/members/:memberId', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.body;
    if (!['LIDER', 'PROTETOR'].includes(role)) { res.status(400).json({ error: 'role deve ser LIDER ou PROTETOR' }); return; }
    const member = await prisma.sectorMember.update({
      where: { id: req.params.memberId },
      data: { role },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
    res.json(member);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar papel do membro' });
  }
});

// Usuários disponíveis para adicionar ao setor
router.get('/:id/available-users', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.sectorMember.findMany({
      where: { sectorId: req.params.id },
      select: { userId: true },
    });
    const existingIds = existing.map((m) => m.userId);
    const users = await prisma.user.findMany({
      where: { isActive: true, id: { notIn: existingIds } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
    res.json(users);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar usuários disponíveis' });
  }
});

export default router;
