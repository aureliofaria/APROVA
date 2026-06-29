import { generateDueRecurrences } from './recurrences';

// Agendador in-process de recorrências de pagamento.
//
// Liga/desliga e cadência via ambiente:
//   PAYMENTS_SCHEDULER_ENABLED = 'true'  -> liga o agendador (default: desligado)
//   PAYMENTS_SCHEDULER_INTERVAL_MS = número em ms (default: 3600000 = 1h)
//
// A geração em si é IDEMPOTENTE (guarda otimista por nextRunAt em
// generateDueRecurrences), então sobreposição de execuções ou múltiplos ticks
// no mesmo período NÃO duplicam pedidos. O agendador apenas dispara a geração
// periodicamente; nunca cria pedidos diretamente.
//
// Importante: só deve ser iniciado quando o servidor roda como processo
// principal (não em testes/supertest), para não criar timers em background nos
// testes. O index.ts chama startPaymentsScheduler() somente em require.main.

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hora
const MIN_INTERVAL_MS = 60 * 1000; // piso de 1 min (evita loop apertado por erro de config)

let timer: NodeJS.Timeout | null = null;
let running = false; // evita reentrância se um tick demorar mais que o intervalo

function resolveIntervalMs(): number {
  const raw = Number(process.env.PAYMENTS_SCHEDULER_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.round(raw));
}

async function tick(): Promise<void> {
  if (running) return; // já há um tick em andamento
  running = true;
  try {
    const created = await generateDueRecurrences();
    if (created > 0) {
      // eslint-disable-next-line no-console
      console.log(`[scheduler] recorrências: ${created} solicitação(ões) de pagamento gerada(s)`);
    }
  } catch (err) {
    // Nunca derruba o processo por falha de uma rodada; loga e tenta de novo no
    // próximo intervalo.
    // eslint-disable-next-line no-console
    console.error('[scheduler] falha ao gerar recorrências:', err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

// Inicia o agendador se habilitado por ambiente. Retorna true se ligou.
export function startPaymentsScheduler(): boolean {
  if (process.env.PAYMENTS_SCHEDULER_ENABLED !== 'true') {
    // eslint-disable-next-line no-console
    console.log('[scheduler] recorrências de pagamento DESLIGADO (defina PAYMENTS_SCHEDULER_ENABLED=true para ligar).');
    return false;
  }
  if (timer) return true; // já iniciado

  const intervalMs = resolveIntervalMs();
  // eslint-disable-next-line no-console
  console.log(`[scheduler] recorrências de pagamento LIGADO (intervalo ${intervalMs} ms).`);

  // Primeira rodada logo após subir (não bloqueante), depois periódica.
  void tick();
  timer = setInterval(() => { void tick(); }, intervalMs);
  // Não impede o processo de encerrar caso seja o único timer ativo.
  if (typeof timer.unref === 'function') timer.unref();
  return true;
}

// Para o agendador (útil para testes/encerramento gracioso).
export function stopPaymentsScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Exposto para testes: executa uma rodada única de geração.
export { tick as runSchedulerTickOnce };
