// Lógica de agendamento dos lembretes — função pura (sem relógio, sem banco, sem
// rede), para poder ser testada com datas simuladas. Quem a chama (runner.js)
// fornece "agora", o estado salvo e executa as ações devolvidas.

import { minutesFromHHMM } from '../core/dates.js';

/**
 * @param {object} p
 * @param {{date:string, minutes:number, weekday:number}} p.now  hora local no fuso configurado
 * @param {object} p.settings
 * @param {boolean} p.isWorkingDay            seg–sex e não feriado
 * @param {boolean} p.answered                hoje já tem registro (ou férias planejadas)
 * @param {{lastMinutes:number,count:number}|null} p.reminderState  estado de hoje
 * @param {Set<string>} p.sentKeys            resumos já enviados (semana/mês)
 * @param {boolean} p.firstWorkingDayOfWeek
 * @param {boolean} p.firstWorkingDayOfMonth
 * @param {string} p.weekKey                  ex.: "week:2026-11-02"
 * @param {string} p.monthKey                 ex.: "month:2026-11"
 */
export function decide(p) {
  const { now, settings, isWorkingDay } = p;
  const actions = [];
  if (!isWorkingDay) return actions;

  const r = settings.reminder;
  const loc = settings.location;
  const useLocation = Boolean(loc?.enabled && loc.office);
  // No modo localização o primeiro lembrete sai no início da janela de localização.
  const start = minutesFromHHMM(useLocation ? loc.windowStart : r.time);
  const end = minutesFromHHMM(r.until);
  const inWindow = now.minutes >= start && now.minutes < end;

  if (r.enabled && r.weekdays.includes(now.weekday) && !p.answered && inWindow) {
    const st = p.reminderState;
    const every = Math.max(5, Number(r.repeatMinutes) || 30);
    if (!st || now.minutes - st.lastMinutes >= every) {
      actions.push({ type: 'daily', count: (st?.count || 0) + 1, useLocation });
    }
  }

  if (now.minutes >= start) {
    if (settings.summaries?.monthly && p.firstWorkingDayOfMonth && !p.sentKeys.has(p.monthKey)) {
      actions.push({ type: 'monthly', key: p.monthKey });
    }
    if (settings.summaries?.weekly && p.firstWorkingDayOfWeek && !p.sentKeys.has(p.weekKey)) {
      actions.push({ type: 'weekly', key: p.weekKey });
    }
  }
  return actions;
}
