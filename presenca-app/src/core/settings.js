// Configurações padrão e fusão de configurações. Partilhado entre o servidor
// (SQLite) e o modo local (dados guardados no próprio celular).

export const DEFAULT_SETTINGS = {
  // Escritórios (cada um com país, região, fuso, feriados e localização).
  // Vazio aqui → normalizeSettings() cria o "Escritório principal".
  offices: [],
  primaryOfficeId: null,
  // Viagens de trabalho: [{ id, officeId, start, end, note }]
  trips: [],
  // Regra mãe: officePct dos dias trabalháveis. O teto absoluto de dias em casa
  // é opcional (enforceHomeCap) — ver src/core/compliance.js.
  rules: { officePct: 50, maxHomeDays: 60, enforceHomeCap: false },
  reminder: {
    enabled: true,
    time: '09:00',
    repeatMinutes: 30, // repete a cada 30 min até você responder…
    until: '18:00', //    …ou até esta hora
    weekdays: [1, 2, 3, 4, 5],
  },
  location: {
    enabled: false,
    windowStart: '09:00',
    windowEnd: '10:30',
  },
  // Perguntar quando o fuso do aparelho não bate com o do escritório previsto
  askOnTimezoneChange: true,
  summaries: { weekly: true, monthly: true },
};

/** Fusão profunda: objetos fundem-se; arrays e valores simples substituem. */
export function deepMerge(base, patch) {
  if (patch === undefined) return base;
  if (Array.isArray(base) || Array.isArray(patch) || typeof base !== 'object' || base === null || patch === null) return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}
