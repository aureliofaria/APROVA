-- CreateTable
CREATE TABLE "PaymentRecurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "flowId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "paymentCategory" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "supplier" TEXT,
    "costCenter" TEXT,
    "justification" TEXT,
    "intervalUnit" TEXT NOT NULL DEFAULT 'MONTH',
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "nextRunAt" DATETIME NOT NULL,
    "lastRunAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentRecurrence_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "FlowTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentRecurrence_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PaymentRecurrence_isActive_nextRunAt_idx" ON "PaymentRecurrence"("isActive", "nextRunAt");

-- NOTA (integração Pagador→main): as colunas paymentCategory/recurrenceId do
-- Request foram MOVIDAS para uma migration final aditiva (após os rebuilds da
-- Fase 0 que reconstroem a tabela Request), evitando que aquelas reconstruções
-- dropassem as colunas e que esta migration, aplicada tardiamente sobre um banco
-- já com a Fase 0, destruísse as colunas novas. Esta migration nunca foi aplicada
-- em main/produção, então a edição é segura.
