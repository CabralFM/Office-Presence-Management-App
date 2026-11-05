// Utilitários de datas.
//
// Decisão: todas as datas de calendário são strings ISO "YYYY-MM-DD".
// Assim evitamos o clássico bug de fuso horário do objeto Date (ex.: um dia
// "2026-11-05" virar "2026-11-04" no Brasil por causa do UTC-3). A aritmética
// é feita em UTC puro, onde não existem horários de verão nem deslocamentos.

const DAY_MS = 86_400_000;

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function toISO(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isoFromParts(y, m, d) {
  return toISO(Date.UTC(y, m - 1, d));
}

export function addDays(iso, n) {
  return toISO(parseISO(iso) + n * DAY_MS);
}

/** 0 = domingo ... 6 = sábado */
export function weekday(iso) {
  return new Date(parseISO(iso)).getUTCDay();
}

export function isWeekend(iso) {
  const w = weekday(iso);
  return w === 0 || w === 6;
}

/** Segunda-feira da semana que contém a data. */
export function mondayOf(iso) {
  const w = weekday(iso);
  return addDays(iso, w === 0 ? -6 : 1 - w);
}

export function* eachDay(startIso, endIso) {
  for (let t = parseISO(startIso), end = parseISO(endIso); t <= end; t += DAY_MS) {
    yield toISO(t);
  }
}

export function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Semestre que contém a data: 1º = jan–jun, 2º = jul–dez. */
export function semesterOf(iso) {
  const [y, m] = iso.split('-').map(Number);
  return semester(y, m <= 6 ? 1 : 2);
}

export function semester(year, half) {
  const start = isoFromParts(year, half === 1 ? 1 : 7, 1);
  const end = half === 1 ? isoFromParts(year, 6, 30) : isoFromParts(year, 12, 31);
  return { id: `${year}-${half}`, year, half, start, end, label: `${half}º semestre de ${year}` };
}

export function parseSemesterId(id) {
  const m = /^(\d{4})-([12])$/.exec(id || '');
  return m ? semester(Number(m[1]), Number(m[2])) : null;
}

export function minutesFromHHMM(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * "Agora" num fuso horário IANA (ex.: America/Sao_Paulo, Europe/Lisbon).
 * O servidor pode estar em UTC (é o normal em cloud); os lembretes têm de
 * disparar às 9h do *seu* fuso, por isso convertemos explicitamente.
 */
export function nowInTimeZone(timeZone, date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const iso = `${parts.year}-${parts.month}-${parts.day}`;
  return { date: iso, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: weekday(iso) };
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoFromParts(year, month, day);
}

/**
 * Converte "data + hora local num fuso" para o instante UTC.
 * Ex.: ("2026-11-10", "09:00", "Europe/Lisbon") → 2026-11-10T09:00Z (inverno, UTC+0)
 *      ("2026-07-10", "09:00", "Europe/Lisbon") → 2026-07-10T08:00Z (verão, UTC+1)
 * Usado para pôr os lembretes no calendário à hora certa, inclusive em viagens.
 */
export function zonedTimeToUtc(iso, hhmm, timeZone) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d) + minutesFromHHMM(hhmm) * 60_000;
  let guess = target;
  // Duas iterações chegam (a segunda corrige mudanças de horário de verão).
  for (let i = 0; i < 2; i++) {
    const local = nowInTimeZone(timeZone, new Date(guess));
    const [ly, lm, ld] = local.date.split('-').map(Number);
    const localMs = Date.UTC(ly, lm - 1, ld) + local.minutes * 60_000;
    guess += target - localMs;
  }
  return new Date(guess);
}
