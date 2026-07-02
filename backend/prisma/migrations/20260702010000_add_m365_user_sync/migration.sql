-- Sincronização de usuários com o Microsoft 365 / Entra ID.
-- Aditiva: novas colunas em "User" (todas com default seguro para linhas
-- existentes) + nova tabela de histórico de execuções ("M365SyncRun").

ALTER TABLE "User" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'LOCAL';
ALTER TABLE "User" ADD COLUMN "externalId" TEXT;
ALTER TABLE "User" ADD COLUMN "syncedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "needsPasswordSetup" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

CREATE TABLE "M365SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "created" INTEGER NOT NULL DEFAULT 0,
    "reactivated" INTEGER NOT NULL DEFAULT 0,
    "deactivated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "triggeredBy" TEXT
);

CREATE INDEX "M365SyncRun_startedAt_idx" ON "M365SyncRun"("startedAt");
