// Lembretes SEM servidor, usando o calendário do próprio celular.
//
// Sem servidor não há quem envie uma notificação às 9h com a app fechada.
// Mas o calendário do celular (Google Agenda, Calendário do iPhone, Samsung…)
// faz isso de graça e com fiabilidade. A app gera:
//
//  1. Um arquivo .ics com UM evento por dia útil até ao fim do semestre, já
//     SEM feriados (do escritório de cada dia), férias e ausências registradas,
//     com alertas às 9h, 9h30 e 10h (conforme os Ajustes).
//  2. Um link para o Google Agenda que cria um evento recorrente seg–sex
//     (mais simples, mas não sabe dos feriados).
//
// Limitação honesta: o calendário não sabe se você já respondeu, por isso os
// alertas repetidos tocam mesmo que já tenha registrado o dia.

import { addDays, isWeekend, minutesFromHHMM, zonedTimeToUtc } from './dates.js';
import { expectedOffice } from './offices.js';

const pad = (n) => String(n).padStart(2, '0');
const icsDate = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/** Linhas de .ics com mais de 75 octetos têm de ser "dobradas" (RFC 5545). */
function fold(line) {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > 74) {
      out.push(cur);
      cur = ' ' + ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

/**
 * @param {object} p
 * @param {object} p.settings
 * @param {Map} p.days          registros (para saltar dias já respondidos/ausências)
 * @param {Map} p.holidays      feriados por dia (buildHolidayMap)
 * @param {string} p.from       primeira data (ISO), normalmente hoje
 * @param {string} p.to         última data (ISO), normalmente fim do semestre
 * @param {string} p.appUrl     endereço da app (vai no evento, para abrir com um toque)
 * @param {Date} [p.stamp]
 * @returns {{ics: string, count: number}}
 */
export function buildReminderIcs({ settings, days, holidays, from, to, appUrl, stamp = new Date() }) {
  const r = settings.reminder;
  const repeat = Math.max(5, r.repeatMinutes || 30);
  const lastAlarm = minutesFromHHMM(r.until) - minutesFromHHMM(r.time);
  // Até 3 alertas: na hora, +repeat, +2×repeat (sem passar da hora "parar às")
  const alarms = [0, repeat, 2 * repeat].filter((m) => m === 0 || m < lastAlarm);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Presenca//Lembretes//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Presença — lembretes',
  ];
  let count = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = new Date(d + 'T12:00:00Z').getUTCDay();
    if (isWeekend(d) || holidays.has(d) || !r.weekdays.includes(wd)) continue;
    const rec = days.get(d);
    if (rec?.status || rec?.plan === 'absence') continue; // já respondido / férias
    const office = expectedOffice(settings, d);
    const start = zonedTimeToUtc(d, r.time, office.timezone);
    const end = new Date(start.getTime() + 15 * 60_000);
    const where = settings.offices.length > 1 ? ` (${office.name})` : '';
    lines.push(
      'BEGIN:VEVENT',
      `UID:presenca-${d}@presenca.app`,
      `DTSTAMP:${icsDate(stamp)}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      fold(`SUMMARY:${esc(`📍 Presença: escritório ou casa?${where}`)}`),
      fold(`DESCRIPTION:${esc(`Abra a app e registre onde está trabalhando hoje.\n${appUrl}`)}`),
      fold(`URL:${appUrl}`),
      'TRANSP:TRANSPARENT',
    );
    for (const m of alarms) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', fold(`DESCRIPTION:${esc('Registrar presença: escritório ou casa?')}`), `TRIGGER:PT${m}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
    count++;
  }
  lines.push('END:VCALENDAR');
  return { ics: lines.join('\r\n') + '\r\n', count };
}

/**
 * Link do Google Agenda para um evento recorrente seg–sex à hora do lembrete.
 * Abre no navegador/app do Google Agenda com tudo preenchido; basta "Guardar".
 */
export function googleCalendarLink({ settings, appUrl, firstDate }) {
  const r = settings.reminder;
  const office = expectedOffice(settings, firstDate);
  const start = zonedTimeToUtc(firstDate, r.time, office.timezone);
  const end = new Date(start.getTime() + 15 * 60_000);
  const byday = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].filter((_, i) => r.weekdays.includes(i)).join(',');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: '📍 Presença: escritório ou casa?',
    dates: `${icsDate(start)}/${icsDate(end)}`,
    details: `Abra a app e registre onde está trabalhando hoje.\n${appUrl}`,
    recur: `RRULE:FREQ=WEEKLY;BYDAY=${byday}`,
    ctz: office.timezone,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
