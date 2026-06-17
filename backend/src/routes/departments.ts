import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const departments = await prisma.department.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(departments);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar departamentos' });
  }
});

router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const dept = await prisma.department.findUnique({
      where: { id: req.params.id },
      include: { users: { select: { id: true, name: true, email: true, role: true, isActive: true } } },
    });
    if (!dept) { res.status(404).json({ error: 'Departamento não encontrado' }); return; }
    res.json(dept);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar departamento' });
  }
});

router.post('/', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) { res.status(400).json({ error: 'Nome é obrigatório' }); return; }
    const dept = await prisma.department.create({ data: { name } });
    res.status(201).json(dept);
  } catch {
    res.status(500).json({ error: 'Erro ao criar departamento' });
  }
});

router.put('/:id', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body;
    const dept = await prisma.department.update({ where: { id: req.params.id }, data: { name } });
    res.json(dept);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar departamento' });
  }
});

router.delete('/:id', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.department.delete({ where: { id: req.params.id } });
    res.json({ message: 'Departamento removido com sucesso' });
  } catch {
    res.status(500).json({ error: 'Erro ao remover departamento' });
  }
});

export default router;
