// Textos das notificações push (só no modo servidor).

import { monthName } from './core/compliance.js';
import { expectedOffice, tripForDay, officeById } from './core/offices.js';
import { mondayOf, semesterOf } from './core/dates.js';

// Relatório, feriados do dia e "agora" vivem em core/report.js (também usados
// no modo local, no celular). Reexportados aqui para o agendador de lembretes.
export { holidaysFor, isWorkingDay, semesterReport, localNow, firstWorkingDay } from './core/report.js';

const fmtPct = (x) => `${Math.round(x * 100)}%`;
const weekdayName = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function dailyMessage(report, today, count, useLocation, settings) {
  const dm = `${weekdayName[new Date(today + 'T12:00:00Z').getUTCDay()]}, ${today.slice(8, 10)}/${today.slice(5, 7)}`;
  const office = expectedOffice(settings, today);
  const trip = tripForDay(settings, today);
  const multi = settings.offices.length > 1;
  const tail = `Semestre: ${report.totals.office}/${report.requiredOffice} no escritório · ${Math.max(0, report.homeLeft)} dias de casa disponíveis.`;
  const where = trip ? `✈️ Viagem: escritório de ${office.name}. ` : '';
  return {
    title: count > 1 ? `Ainda sem resposta — onde você está hoje? (${dm})` : `Bom dia! Onde você trabalha hoje? (${dm})`,
    body: where + (useLocation ? `Toque para confirmar pela localização. ${tail}` : multi ? `Em outro escritório? Toque para escolher. ${tail}` : tail),
    tag: `daily-${today}`,
    url: useLocation ? '/?checkin=location' : '/?checkin=1',
    actions: [
      { action: 'office', title: multi ? `🏢 ${office.name}` : '🏢 Escritório' },
      { action: 'home', title: '🏠 Casa' },
    ],
    date: today,
    officeId: office.id,
    requireInteraction: true,
  };
}

export function weeklyMessage(report, today, settings) {
  const week = report.weeks.find((w) => w.start === mondayOf(today));
  if (!week) return null;
  const hol = week.holidayList.length ? ` (feriado: ${week.holidayList.map((h) => h.name).join(', ')})` : '';
  const trips = settings.trips
    .filter((t) => t.start <= week.end && t.end >= week.start)
    .map((t) => `✈️ ${officeById(settings, t.officeId)?.name} ${t.start.slice(8)}/${t.start.slice(5, 7)}–${t.end.slice(8)}/${t.end.slice(5, 7)}. `)
    .join('');
  const body =
    report.officeNeeded === 0
      ? 'Meta do semestre já cumprida. Semana livre para escolher! 🎉'
      : `Recomendado: ${week.recommendedOffice} de ${week.working - week.absence} dias úteis no escritório${hol}. ` +
        `Faltam ${report.officeNeeded} dias no semestre (${fmtPct(report.paceNeeded ?? 1)} dos dias restantes).`;
  const ask = settings.offices.length > 1 && !trips ? ' Vai trabalhar em outro escritório esta semana? Registre a viagem na app.' : '';
  return { title: 'Planejamento da semana', body: trips + body + ask, tag: `weekly-${week.start}`, url: '/#planejamento' };
}

export function monthlyMessage(report, today) {
  const [y, m] = today.split('-').map(Number);
  const prevKey = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const prev = report.months.find((x) => x.key === prevKey);
  const cur = report.months.find((x) => x.key === today.slice(0, 7));
  const parts = [];
  if (prev && prev.officePct !== null) {
    const below = prev.officePct < report.rules.officePct / 100;
    parts.push(`${monthName(prev.month)}: ${fmtPct(prev.officePct)} no escritório${below ? ' ⚠️ abaixo da meta' : ' ✅'}.`);
  }
  if (cur) parts.push(`Para ${monthName(cur.month)}: ${cur.recommendedOffice} de ${cur.open} dias úteis no escritório.`);
  if (!parts.length) return null;
  return { title: 'Resumo do mês', body: parts.join(' '), tag: `monthly-${today.slice(0, 7)}`, url: '/#painel' };
}

export { semesterOf };
