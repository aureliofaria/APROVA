-- Integração Pagador→main: re-adiciona as colunas de pagamento ao Request
-- DEPOIS dos rebuilds da Fase 0 (add_parent_request, add_escalation_fields), que
-- recriam a tabela Request sem conhecê-las. Aditivo (ALTER TABLE ADD COLUMN), o
-- que é seguro tanto em deploy novo (colunas ausentes após os rebuilds) quanto
-- sobre um banco já com a Fase 0. A relação Request.recurrence ↔ PaymentRecurrence
-- é resolvida pelo Prisma Client (não exige FK no nível do SQLite).
ALTER TABLE "Request" ADD COLUMN "paymentCategory" TEXT;
ALTER TABLE "Request" ADD COLUMN "recurrenceId" TEXT;
