// Domínio de Pagamentos: categorias, campos obrigatórios por categoria e
// validação de valor. Centraliza as regras para que rotas, serviço de
// recorrência e testes compartilhem a MESMA fonte de verdade.

export const PAYMENT_CATEGORIES = [
  'COMPRA',
  'SERVICO',
  'ASSINATURA',
  'RECORRENCIA',
  'SALARIO',
  'REEMBOLSO',
] as const;

export type PaymentCategory = (typeof PAYMENT_CATEGORIES)[number];

// Teto sanitário para barrar overflow / valores absurdos: R$ 100.000.000,00.
export const MAX_PAYMENT_CENTS = 10_000_000_000;

// Campos extras obrigatórios por categoria (além dos comuns: title,
// amountCents>0, costCenter, justification).
const EXTRA_REQUIRED_FIELDS: Record<PaymentCategory, string[]> = {
  COMPRA: ['supplier'],
  SERVICO: ['supplier'],
  ASSINATURA: ['supplier'],
  RECORRENCIA: ['supplier'],
  SALARIO: [],
  REEMBOLSO: [],
};

// Categorias que exigem ao menos um anexo já na etapa de solicitação.
export const CATEGORIES_REQUIRING_ATTACHMENT: ReadonlySet<PaymentCategory> = new Set<PaymentCategory>([
  'COMPRA',
  'SERVICO',
  'ASSINATURA',
  'RECORRENCIA',
  'SALARIO',
  'REEMBOLSO',
]);

export function isPaymentCategory(value: unknown): value is PaymentCategory {
  return typeof value === 'string' && (PAYMENT_CATEGORIES as readonly string[]).includes(value);
}

// Valida o valor de um pagamento (em centavos inteiros). Retorna mensagem de
// erro (string) ou null se válido. Pressupõe que o valor já passou por
// parseCents (inteiro/finito); aqui aplicamos a regra de NEGÓCIO: > 0 e teto.
export function validatePaymentAmount(amountCents: number | null | undefined): string | null {
  if (amountCents == null) return 'O valor do pagamento é obrigatório';
  if (!Number.isInteger(amountCents)) return 'O valor deve estar em centavos inteiros';
  if (amountCents <= 0) return 'O valor do pagamento deve ser maior que zero';
  if (amountCents > MAX_PAYMENT_CENTS) return 'O valor do pagamento excede o limite permitido';
  return null;
}

// ===========================================================================
// GANCHO FinanceParams (NÃO implementado aqui — propriedade da Fase 0).
//
// Regra de negócio confirmada para wiring futuro (deixada como contrato/seam):
//  - TETO mensal por setor: cadastro manual (ADMIN/Diretoria/Líder I do Financeiro).
//  - CONSUMIDO/SALDO: calculado automaticamente (teto − soma de pagamentos
//    DEFERIDOS do setor no mês), COM override manual auditado.
//  - Roteamento: dentro do teto+previsão+saldo → Membro do Financeiro;
//    senão → Líder I → Diretoria.
//
// Este módulo NÃO define o modelo de setores/hierarquia/parâmetros (Fase 0).
// O roteamento de aprovação deve apenas CHAMAR este gancho quando ele existir.
// A implementação default é nula (sem efeito), preservando o comportamento
// atual (alçada por valor).
export interface FinanceRoutingContext {
  sectorId?: string | null;
  amountCents: number;
  at?: Date; // referência temporal para o cálculo mensal (default: agora)
}

export interface FinanceRoutingDecision {
  withinBudget: boolean; // true → rota "Membro do Financeiro"
  escalation: string[];  // ex.: ['LIDER_I','DIRETORIA'] quando estoura o teto
}

// Default: sem FinanceParams configurado → não interfere (retorna null).
// A Fase 0 substitui/injeta uma implementação que consulte teto/saldo do setor.
export function resolveFinanceRouting(_ctx: FinanceRoutingContext): FinanceRoutingDecision | null {
  return null;
}

interface PaymentFields {
  paymentCategory?: unknown;
  amountCents?: number | null;
  costCenter?: unknown;
  justification?: unknown;
  supplier?: unknown;
}

function isNonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

// Validação completa de um pedido de PAGAMENTO na criação. Retorna a primeira
// mensagem de erro encontrada (para resposta 400) ou null se tudo OK.
// NÃO valida anexo aqui (criação e upload são chamadas HTTP distintas) — a
// exigência de anexo é cobrada ao concluir a etapa 0 (requiresAttachment).
export function validatePaymentRequest(fields: PaymentFields): string | null {
  if (!isPaymentCategory(fields.paymentCategory)) {
    return 'Categoria de pagamento inválida ou ausente';
  }
  const amountError = validatePaymentAmount(fields.amountCents);
  if (amountError) return amountError;

  if (!isNonEmpty(fields.costCenter)) return 'O centro de custo é obrigatório';
  if (!isNonEmpty(fields.justification)) return 'A justificativa é obrigatória';

  for (const field of EXTRA_REQUIRED_FIELDS[fields.paymentCategory]) {
    if (!isNonEmpty((fields as any)[field])) {
      return `O campo "${field}" é obrigatório para esta categoria de pagamento`;
    }
  }
  return null;
}
