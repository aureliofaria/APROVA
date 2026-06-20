// Converte um valor recebido da API para centavos (Int), validando finitude.
// - null/'' (vazio) → { ok: true, value: null }
// - número válido → { ok: true, value: arredondado }
// - lixo não-numérico (NaN) → { ok: false } (o chamador deve responder 400)
export function parseCents(raw: unknown): { ok: boolean; value: number | null } {
  if (raw == null || raw === '') return { ok: true, value: null };
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return { ok: false, value: null };
  return { ok: true, value: n };
}
