// Executa o agendador a cada 30 s: lê o estado, chama decide() e envia as
// notificações. Usamos setInterval simples em vez de uma lib de cron porque
// o horário depende de configurações que mudam (hora, janela, fuso) e assim
// cada "tique" lê sempre a configuração mais recente.

import { decide } from './scheduler.js';
import { addDays, mondayOf, semesterOf } from '../core/dates.js';
import {
  dailyMessage, firstWorkingDay, holidaysFor, isWorkingDay, localNow,
  monthlyMessage, semesterReport, weeklyMessage,
} from '../service.js';

export async function tick(repo, push, date = new Date()) {
  const settings = repo.getSettings();
  const now = localNow(repo, date);
  const sem = semesterOf(now.date);
  const holidays = holidaysFor(settings, sem);
  const day = repo.getDay(now.date);
  const monday = mondayOf(now.date);
  const monthStart = now.date.slice(0, 8) + '01';
  const weekKey = `week:${monday}`;
  const monthKey = `month:${now.date.slice(0, 7)}`;

  const actions = decide({
    now,
    settings,
    isWorkingDay: isWorkingDay(now.date, holidays),
    answered: Boolean(day?.status || day?.plan === 'absence'),
    reminderState: repo.getReminderState(now.date),
    sentKeys: repo.sentKeys([weekKey, monthKey]),
    firstWorkingDayOfWeek: firstWorkingDay(monday, addDays(monday, 4), holidays) === now.date,
    firstWorkingDayOfMonth: firstWorkingDay(monthStart, now.date, holidays) === now.date,
    weekKey,
    monthKey,
  });
  if (!actions.length) return [];

  const { report } = semesterReport(repo, sem, now.date);
  for (const a of actions) {
    let msg = null;
    if (a.type === 'daily') {
      msg = dailyMessage(report, now.date, a.count, a.useLocation);
      repo.setReminderState(now.date, now.minutes, a.count);
    } else if (a.type === 'weekly') {
      msg = weeklyMessage(report, now.date);
      repo.markSent(a.key);
    } else if (a.type === 'monthly') {
      msg = monthlyMessage(report, now.date);
      repo.markSent(a.key);
    }
    if (msg) await push.sendToAll(msg);
  }
  return actions;
}

export function startScheduler(repo, push, intervalMs = 30_000) {
  const run = () => tick(repo, push).catch((e) => console.error('[lembretes]', e));
  run();
  return setInterval(run, intervalMs);
}
