// Relatório do semestre e "agora" no fuso do escritório — partilhado entre o
// servidor e o modo local (no celular).

import { computeSemester } from './compliance.js';
import { buildHolidayMap, expectedOffice, tripForDay } from './offices.js';
import { addDays, isWeekend, nowInTimeZone } from './dates.js';

/** Feriados de cada dia do intervalo, segundo o escritório que vale nesse dia. */
export function holidaysFor(settings, start, end, days) {
  return buildHolidayMap(settings, start, end, days);
}

export function isWorkingDay(date, holidays) {
  return !isWeekend(date) && !holidays.has(date);
}

export function semesterReport(repo, semester, today) {
  const settings = repo.getSettings();
  const days = repo.getDays(semester.start, semester.end);
  const holidays = holidaysFor(settings, semester.start, semester.end, days);
  const report = computeSemester({
    semester,
    today,
    days,
    holidays,
    rules: settings.rules,
    defaultPlan: (date) => (tripForDay(settings, date) ? 'office' : null),
  });
  return { report, holidays, days, settings };
}

/**
 * "Agora" no fuso do escritório previsto para hoje. Em viagem a outro fuso,
 * o lembrete das 9h passa a ser às 9h locais do destino.
 */
export function localNow(repo, date = new Date()) {
  const settings = repo.getSettings();
  const primary = settings.offices.find((o) => o.id === settings.primaryOfficeId) || settings.offices[0];
  let now = nowInTimeZone(primary.timezone, date);
  const office = expectedOffice(settings, now.date);
  if (office.timezone !== primary.timezone) now = nowInTimeZone(office.timezone, date);
  return { ...now, officeId: office.id, timezone: office.timezone };
}

/** Primeiro dia útil da semana/mês — é quando se enviam os resumos. */
export function firstWorkingDay(fromIso, toIso, holidays) {
  for (let d = fromIso; d <= toIso; d = addDays(d, 1)) if (isWorkingDay(d, holidays)) return d;
  return null;
}
