// Regras de gravação de um dia e agrupamento de ausências — independentes do
// armazenamento (SQLite no servidor, localStorage no celular).

const VALID_STATUS = new Set(['office', 'home', 'absence']);
const FIELDS = ['status', 'plan', 'source', 'note', 'distance', 'officeId', 'absenceType', 'justification', 'absenceId'];

/**
 * Calcula o novo registro de um dia a partir do anterior e das alterações.
 * Campos ausentes (undefined) mantêm o valor anterior; null apaga.
 * Devolve null quando o dia fica vazio (deve ser removido).
 */
export function mergeDay(prev, patch) {
  if (patch.status != null && !VALID_STATUS.has(patch.status)) throw new Error('status inválido');
  if (patch.plan != null && !VALID_STATUS.has(patch.plan)) throw new Error('plan inválido');
  const p = prev || {};
  const next = {};
  for (const f of FIELDS) next[f] = patch[f] === undefined ? p[f] ?? null : patch[f];
  // O escritório só faz sentido em dias de escritório; tipo/justificação só em ausências.
  if (next.status !== 'office') next.officeId = null;
  if (next.status !== 'absence' && next.plan !== 'absence') {
    next.absenceType = next.justification = next.absenceId = null;
  }
  if (!next.status && !next.plan && !next.note) return null;
  return next;
}

/**
 * Agrupa dias de ausência em períodos (mesmo absenceId). Registros antigos sem
 * id viram períodos de 1 dia (id "dia-AAAA-MM-DD").
 * @param {Array<[string, object]>} entries pares [data, registro] por ordem de data
 */
export function groupAbsences(entries) {
  const groups = new Map();
  for (const [date, r] of entries) {
    const isAbsence = r.status === 'absence' || (!r.status && r.plan === 'absence');
    if (!isAbsence) continue;
    const id = r.absenceId || `dia-${date}`;
    if (!groups.has(id)) {
      groups.set(id, { id, type: r.absenceType || 'nao_especificado', justification: r.justification || '', start: date, end: date, days: 0 });
    }
    const g = groups.get(id);
    g.end = date;
    g.days++;
  }
  return [...groups.values()];
}

/** Datas que pertencem a um período de ausência (para o remover). */
export function absenceDates(entries, id) {
  if (id.startsWith('dia-')) {
    const date = id.slice(4);
    return entries.filter(([d, r]) => d === date && !r.absenceId).map(([d]) => d);
  }
  return entries.filter(([, r]) => r.absenceId === id).map(([d]) => d);
}
