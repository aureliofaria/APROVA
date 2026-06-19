import { PrismaClient } from '@prisma/client';

// Por padrão usa a URL fixada no schema (file:./dev.db). Quando DATABASE_URL
// está definida (ex.: ambiente de testes apontando para um banco isolado),
// ela tem precedência — mantendo o comportamento existente quando ausente.
const prisma = process.env.DATABASE_URL
  ? new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } })
  : new PrismaClient();

export default prisma;
