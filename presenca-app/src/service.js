// Textos das notificações push (só no modo servidor), no idioma dos Ajustes.

import { monthName } from './core/compliance.js';
import { expectedOffice, tripForDay, officeById } from './core/offices.js';
import { mondayOf, semesterOf } from './core/dates.js';
import { t, fmtDayMonth, weekdayShort, periodLabel } from './core/i18n.js';

// Relatório, feriados do dia e "agora" vivem em core/report.js (também usados
// no modo local, no celular). Reexportados aqui para o agendador de lembretes.
export { holidaysFor, isWorkingDay, semesterReport, localNow, firstWorkingDay } from './core/report.js';

const fmtPct = (x) => `${Math.round(x * 100)}%`;

export function dailyMessage(report, today, count, useLocation, settings) {
  const dm = `${weekdayShort(new Date(today + 'T12:00:00Z').getUTCDay())} ${fmtDayMonth(today)}`;
  const office = expectedOffice(settings, today);
  const trip = tripForDay(settings, today);
  const multi = settings.offices.length > 1;
  const tail = t('pn.tail', { office: report.totals.office, required: report.requiredOffice, home: Math.max(0, report.homeLeft) });
  const where = trip ? `${t('pn.trip', { office: office.name })} ` : '';
  return {
    title: t(count > 1 ? 'pn.again' : 'pn.morning', { date: dm }),
    body: where + (useLocation ? `${t('pn.tapLocation')} ${tail}` : multi ? `${t('pn.otherOffice')} ${tail}` : tail),
    tag: `daily-${today}`,
    url: useLocation ? '/?checkin=location' : '/?checkin=1',
    actions: [
      { action: 'office', title: multi ? `🏢 ${office.name}` : `🏢 ${t('status.office')}` },
      { action: 'home', title: `🏠 ${t('status.home')}` },
    ],
    date: today,
    officeId: office.id,
    requireInteraction: true,
  };
}

export function weeklyMessage(report, today, settings) {
  const week = report.weeks.find((w) => w.start === mondayOf(today));
  if (!week) return null;
  const hol = week.holidayList.length ? ` (${t('cal.holiday')}: ${week.holidayList.map((h) => h.name).join(', ')})` : '';
  const trips = settings.trips
    .filter((x) => x.start <= week.end && x.end >= week.start)
    .map((x) => `✈️ ${officeById(settings, x.officeId)?.name} ${fmtDayMonth(x.start)}–${fmtDayMonth(x.end)}. `)
    .join('');
  const body =
    report.officeNeeded === 0
      ? t('pn.weekDone')
      : `${t('pn.weekRec', { rec: week.recommendedOffice, n: week.working - week.absence })}${hol}. ` +
        t('pn.weekLeft', { n: report.officeNeeded, pct: fmtPct(report.paceNeeded ?? 1) });
  const ask = settings.offices.length > 1 && !trips ? ` ${t('pn.weekTrip')}` : '';
  return { title: t('pn.weekTitle'), body: trips + body + ask, tag: `weekly-${week.start}`, url: '/#planejamento' };
}

export function monthlyMessage(report, today) {
  const [y, m] = today.split('-').map(Number);
  const prevKey = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const prev = report.months.find((x) => x.key === prevKey);
  const cur = report.months.find((x) => x.key === today.slice(0, 7));
  const parts = [];
  if (prev && prev.officePct !== null) {
    const below = prev.officePct < report.rules.officePct / 100;
    parts.push(`${t('pn.monthPrev', { month: monthName(prev.month), pct: fmtPct(prev.officePct) })}${below ? ` ⚠️ ${t('pn.below')}` : ' ✅'}.`);
  }
  if (cur) parts.push(t('pn.monthNext', { month: monthName(cur.month), rec: cur.recommendedOffice, open: cur.open }));
  if (!parts.length) return null;
  return { title: t('pn.monthTitle'), body: parts.join(' '), tag: `monthly-${today.slice(0, 7)}`, url: '/#painel' };
}

export { semesterOf, periodLabel };
