# APROVA — Guia do Projeto

Sistema de gestão de aprovações (workflow) e **inventário patrimonial** da Golplus.
Monorepo npm workspaces: `backend` (Express + Prisma + SQLite) e `frontend` (a definir).

## Estrutura

```
backend/
  prisma/
    schema.prisma          # fonte única da verdade do BD
    migrations/            # histórico versionado — NUNCA editar migrações já aplicadas
    seed.ts                # dados iniciais (admin, departamentos, almoxarifado, catálogo)
  src/
    index.ts               # entry point Express — registra todas as rotas
    lib/prisma.ts          # singleton do PrismaClient
    middleware/auth.ts      # authenticate + requireRole (RBAC)
    routes/
      auth.ts, users.ts, departments.ts
      inventory/           # módulo de inventário (ver docs/INVENTORY.md)
    services/workflow.ts   # motor de workflow do APROVA
```

## Comandos

| Ação | Comando (na raiz) |
|------|-------------------|
| Instalar | `npm install` |
| Migrar BD (dev) | `npm run db:migrate --workspace=backend` |
| Gerar client | `npm run db:generate --workspace=backend` |
| Popular dados | `npm run db:seed --workspace=backend` |
| Setup completo | `npm run setup` |
| Subir backend | `npm run dev:backend` |
| Type-check | `cd backend && npx tsc --noEmit` |

Deploy de produção aplica migrações com `prisma migrate deploy` (não usar `migrate dev`).

## ⚠️ Regra de ouro: o BD deve estar SEMPRE integrado ao APROVA

Qualquer alteração de modelo de dados precisa ser replicada de forma **atômica** por todas
as camadas. Ao mexer em `schema.prisma`, percorra TODAS as etapas abaixo na mesma entrega —
nunca commitar um schema sem a migração e o código correspondentes:

1. **Schema** — editar `backend/prisma/schema.prisma`. Manter relações inversas dos dois lados.
2. **Migração** — rodar `npm run db:migrate --workspace=backend -- --name <descricao>`.
   Isso gera a migração versionada E regenera o Prisma Client.
3. **Client** — confirmar que `node_modules/@prisma/client` foi regenerado (o passo 2 já faz).
4. **Rotas/Serviços** — atualizar `src/routes/**` e `src/services/**` que tocam o modelo.
5. **Seed** — se o modelo for essencial à inicialização, refletir em `prisma/seed.ts`.
6. **Homologação** — rodar a checklist abaixo. Só commitar com tudo verde.

### Checklist de homologação (deploy sem erros)

Antes de qualquer commit que toque o BD ou rotas:

- [ ] `cd backend && npx tsc --noEmit` → **exit 0** (zero erros de tipo)
- [ ] `npm run db:migrate --workspace=backend` aplica sem conflito
- [ ] `npm run db:seed --workspace=backend` roda sem erro (e é idempotente)
- [ ] Em BD limpo, `prisma migrate deploy` aplica todas as migrações sem falha
- [ ] Smoke test das rotas afetadas (login → operação → consulta) responde 2xx

### Invariantes que NÃO podem quebrar

- `JWT_SECRET` deve ter o MESMO default em `auth.ts` e `middleware/auth.ts`
  (atualmente `sga-secret-2024`). Divergência inutiliza toda autenticação.
- Toda rota de escrita passa por `authenticate`; operações sensíveis por `requireRole`.
- Papéis (roles): `ADMIN` > `GESTOR` > `USER`.
- Movimentações de ativo são **imutáveis**: nunca atualizar/deletar `AssetMovement`;
  o estado do `Asset` muda, mas cada transição vira um novo registro de log.
- Toda mudança de posse/local/status de um `Asset` deve gerar um `AssetMovement`
  (use `POST /assets/:id/movements`, nunca altere esses campos via `PUT`).

## Integração Inventário ↔ Workflow APROVA

`AssetMovement.requestId` (opcional) vincula uma movimentação a uma `Request` do workflow.
Assim, aprovações de compra, transferência ou baixa no APROVA podem registrar a movimentação
patrimonial correspondente, mantendo rastreabilidade ponta a ponta. Ao automatizar isso,
passe o `requestId` no corpo da movimentação.

Ver `docs/INVENTORY.md` para o modelo de dados e a referência completa de endpoints.
