// Rótulos pt-BR para as ações registradas na trilha de auditoria (enum vindo
// do backend — ver `action: '...'` em backend/src/routes|services/*.ts).
// Usado pela tela de Auditoria global e pela aba "Histórico" da solicitação.
// O valor do enum é mantido no title/tooltip para quem precisa do nome técnico
// (ex.: suporte, integração), a UI mostra sempre o rótulo traduzido.
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATED: 'Criada',
  SUBFLOW_OPENED: 'Subfluxo aberto',
  CANCELLED: 'Cancelada',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  CORRECTION_REQUESTED: 'Correção solicitada',
  INFO_REQUESTED: 'Informação solicitada',
  FORWARDED: 'Encaminhada',
  RESUBMITTED: 'Reenviada',
  SENSITIVE_FIELD_WRITTEN: 'Campo sensível gravado',
  SENSITIVE_VIEW: 'Campo sensível visualizado',
  ATTACHMENT_UPLOADED: 'Anexo enviado',
  COMMENT_ADDED: 'Comentário adicionado',
  FINANCE_PARAM_UPSERTED: 'Parâmetro financeiro salvo',
  FINANCE_PARAM_DELETED: 'Parâmetro financeiro removido',
  TASK_COMPLETED: 'Tarefa concluída',
  TASK_CLAIMED: 'Tarefa assumida',
  TASK_REJECTED: 'Tarefa rejeitada',
  DELAY_JUSTIFIED: 'Atraso justificado',
  PAYMENT_ROUTED: 'Pagamento roteado',
  STEP_STARTED: 'Etapa iniciada',
  SLA_RETURNED: 'SLA — devolvida ao solicitante',
  SLA_ESCALATED: 'SLA — escalada',
  SLA_EXPIRED: 'SLA vencido',
  COMPLETED: 'Concluída',
  DELEGATION_SET: 'Delegação definida',
  DELEGATION_CLEARED: 'Delegação removida',
};

/** Rótulo pt-BR de uma ação de auditoria; cai para o próprio enum se desconhecida. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
