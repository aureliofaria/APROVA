import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

// Segredo JWT: fonte única para assinatura e verificação.
// Em produção é obrigatório vir do ambiente; em desenvolvimento há um
// fallback explícito apenas para facilitar o setup local.
const DEV_JWT_FALLBACK = 'aprova-dev-only-secret-change-me';

function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (isProduction) {
    throw new Error(
      'JWT_SECRET é obrigatório em produção. Defina a variável de ambiente antes de iniciar a aplicação.'
    );
  }
  // eslint-disable-next-line no-console
  console.warn('[config] JWT_SECRET não definido — usando fallback de desenvolvimento. NÃO use em produção.');
  return DEV_JWT_FALLBACK;
}

// Origens permitidas para CORS. Aceita lista separada por vírgula em CORS_ORIGIN.
function resolveCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN;
  if (raw && raw.trim().length > 0) {
    return raw.split(',').map((o) => o.trim()).filter(Boolean);
  }
  return ['http://localhost:5173'];
}

export const config = {
  isProduction,
  port: Number(process.env.PORT) || 3001,
  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: '7d' as const,
  corsOrigins: resolveCorsOrigins(),
};

// Papéis que podem atuar como aprovadores quando uma etapa não define alçada explícita.
export const APPROVER_ROLES = ['ADMIN', 'MANAGER', 'FINANCE', 'HR'] as const;
