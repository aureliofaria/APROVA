-- Impede decisões duplicadas do mesmo aprovador na mesma etapa de uma solicitação.
CREATE UNIQUE INDEX "Approval_requestId_stepOrder_approverId_key" ON "Approval"("requestId", "stepOrder", "approverId");
