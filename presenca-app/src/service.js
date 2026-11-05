// Camada de serviço: junta banco + regras e produz os relatórios e os textos das
// notificações. Mantida separada do servidor HTTP para ser reutilizada pelo
// agendador de lembretes.

import { computeSemester, monthName } from './core/compliance.js';
import { holidayMap } from './core/holidays.js';
import { addDays, isWeekend, mondayOf, nowInTimeZone, semesterOf } from './core/dates.js';

export function holidaysFor(settings, semester) {
  return holidayMap(settings, [semester.year]);
}

export function isWorkingDay(date, holidays) {
  return !isWeekend(date) && !holidays.has(date);
}

export function semesterReport(repo, semester, today) {
  const settings = repo.getSettings();
  const holidays = holidaysFor(settings, semester);
  const days = repo.getDays(semester.start, semester.end);
  const report = computeSemester({ semester, today, days, holidays, rules: settings.rules });
  return { report, holidays, days, settings };
}

export function localNow(repo, date = new Date()) {
  return nowInTimeZone(repo.getSettings().timezone, date);
}

/** Primeiro dia útil da semana/mês — é quando enviamos os resumos. */
export function firstWorkingDay(fromIso, toIso, holidays) {
  for (let d = fromIso; d <= toIso; d = addDays(d, 1)) if (isWorkingDay(d, holidays)) return d;
  return null;
}

const fmtPct = (x) => `${Math.round(x * 100)}%`;
const weekdayName = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function dailyMessage(report, today, count, useLocation) {
  const dm = `${weekdayName[new Date(today + 'T12:00:00Z').getUTCDay()]}, ${today.slice(8, 10)}/${today.slice(5, 7)}`;
  const tail = `Semestre: ${report.totals.office}/${report.requiredOffice} no escritório · ${Math.max(0, report.homeLeft)} dias de casa disponíveis.`;
  return {
    title: count > 1 ? `Ainda sem resposta — onde você está hoje? (${dm})` : `Bom dia! Onde você trabalha hoje? (${dm})`,
    body: useLocation ? `Toque para confirmar pela localização. ${tail}` : tail,
    tag: `daily-${today}`,
    url: useLocation ? '/?checkin=location' : '/?checkin=1',
    actions: [
      { action: 'office', title: '🏢 Escritório' },
      { action: 'home', title: '🏠 Casa' },
    ],
    date: today,
    requireInteraction: true,
  };
}

export function weeklyMessage(report, today) {
  const week = report.weeks.find((w) => w.start === mondayOf(today));
  if (!week) return null;
  const hol = week.holidayList.length ? ` (feriado: ${week.holidayList.map((h) => h.name).join(', ')})` : '';
  const body =
    report.officeNeeded === 0
      ? 'Meta do semestre já cumprida. Semana livre para escolher! 🎉'
      : `Recomendado: ${week.recommendedOffice} de ${week.working - week.absence} dias úteis no escritório${hol}. ` +
        `Faltam ${report.officeNeeded} dias no semestre (${fmtPct(report.paceNeeded ?? 1)} dos dias restantes).`;
  return { title: 'Planejamento da semana', body, tag: `weekly-${week.start}`, url: '/#planejamento' };
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
