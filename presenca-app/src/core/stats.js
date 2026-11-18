// Estatísticas anónimas de uso (opcionais, só com consentimento).
//
// Para o dono da app saber quantas pessoas a instalaram e com que frequência a
// usam, sem servidor pago: no máximo UMA vez por dia, a app envia um pequeno
// "sinal de vida" para uma planilha Google do dono (Google Apps Script — ver
// integrations/google-stats.md). Sem consentimento, nada é enviado.
//
// O que vai (e só isto): um código aleatório do aparelho (não é nome nem e-mail),
// o dia, versão, idioma, país do escritório, tipo de regra, tipo de aparelho e
// se a app está instalada e se já concluiu o assistente. Nunca vão presenças,
// ausências, localização, empresa, endereço nem o IP (o Google Apps Script não
// o entrega ao script).

export const STATS_URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

/** Deve perguntar? Só quando há destino configurado e a pessoa ainda não respondeu. */
export const shouldAsk = (statsUrl, stats) => Boolean(statsUrl) && (stats?.consent ?? null) === null;

/** Deve enviar o sinal de hoje? (uma vez por dia, com consentimento). */
export function shouldPing(statsUrl, stats, today) {
  return Boolean(statsUrl) && STATS_URL_RE.test(statsUrl) && stats?.consent === true && Boolean(stats.id) && stats.lastPing !== today;
}

/** Tipo de aparelho, grosseiro de propósito (nada de modelo/versão). */
export function platformOf(userAgent = '') {
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  if (/windows|macintosh|linux|cros/i.test(userAgent)) return 'desktop';
  return 'other';
}

/** O pacote enviado. Lista fechada de campos (a planilha ignora qualquer outro). */
export function buildPing({ settings, today, version, ruleId, platform, installed }) {
  const primary = settings.offices.find((o) => o.id === settings.primaryOfficeId);
  return {
    type: 'ping',
    v: 1,
    id: settings.stats.id,
    day: today,
    firstSeen: settings.stats.firstSeen || today,
    version: String(version),
    lang: settings.locale || '',
    country: primary?.country || '',
    rule: ruleId,
    period: settings.rules.period,
    platform,
    installed: Boolean(installed),
    onboarded: Boolean(settings.onboarded),
  };
}

/** Pedido para apagar tudo o que foi enviado por este aparelho (ao desligar). */
export const buildForget = (id) => ({ type: 'forget', v: 1, id });

/** Código aleatório do aparelho (UUID v4). */
export function newDeviceId(rand = globalThis.crypto) {
  if (rand?.randomUUID) return rand.randomUUID();
  const b = rand.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
