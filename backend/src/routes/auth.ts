import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { serializeUser } from '../lib/users';
import { config } from '../config';

const router = Router();

function signToken(userId: string): string {
  return jwt.sign({ userId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email e senha são obrigatórios' });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { email },
      include: { department: true },
    });
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Credenciais inválidas' });
      return;
    }
    // Conta criada pela sincronização M365/Entra ID: sem senha local
    // utilizável até um ADMIN definir uma (ver PUT /api/users/:id) — mensagem
    // explícita em vez do "Credenciais inválidas" genérico.
    if (user.needsPasswordSetup) {
      res.status(401).json({ error: 'Conta sincronizada do M365 sem senha definida. Peça a um administrador para configurar sua senha de acesso.' });
      return;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Credenciais inválidas' });
      return;
    }
    const token = signToken(user.id);
    res.json({ token, user: serializeUser(user) });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, email, password, departmentId } = req.body;
    if (!name || !email || !password) {
      res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
      return;
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'Email já cadastrado' });
      return;
    }
    // O `role` NUNCA é aceito do corpo no registro público (evita escalonamento de
    // privilégio). Apenas o primeiro usuário do sistema é promovido a ADMIN;
    // os demais são USER. A criação de usuários com papel específico é feita por
    // um ADMIN via POST /api/users (rota protegida).
    const count = await prisma.user.count();
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: count === 0 ? 'ADMIN' : 'USER',
        departmentId: departmentId || null,
      },
      include: { department: true },
    });
    const token = signToken(user.id);
    res.status(201).json({ token, user: serializeUser(user) });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  res.json(serializeUser(req.user));
});

export default router;
