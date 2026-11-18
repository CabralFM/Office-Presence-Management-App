// Backend LOCAL: a mesma API do servidor (core/api.js), mas a correr dentro do
// celular, com os dados no armazenamento do navegador. Sem rede, sem servidor,
// sem custos. Só é carregado quando config.js diz MODE = 'local'.

import { createApi } from './core/api.js';
import { createLocalRepo } from './core/local-repo.js';
import { buildCsv } from './core/export.js';
import { buildReminderIcs, googleCalendarLink } from './core/calendar.js';
import { buildHolidayMap } from './core/offices.js';
import { semesterOf, addDays } from './core/dates.js';
import { t } from './core/i18n.js';
import { backupSummary } from './core/backup.js';

const repo = createLocalRepo(window.localStorage);
const api = createApi({ repo, extraMeta: () => ({ mode: 'local' }) });

/** Mesmo contrato do fetch() ao servidor: devolve {status, data}. */
export function localRequest(method, path, body) {
  if (path === '/api/auth') return { status: 200, data: { required: false, ok: true } };
  const r = api.handle(method, path, body);
  return r || { status: 404, data: { error: `Indisponível sem servidor: ${path}` } };
}

/** Endereço da app (para o link nos lembretes do calendário). */
const appUrl = () => location.href.split('#')[0].split('?')[0];

export function exportCsv() {
  return buildCsv(repo.allDays(), repo.getSettings().offices);
}

export function exportBackup() {
  return JSON.stringify(repo.exportBackup(), null, 1);
}

/** Tudo o que uma cópia leva: .json (restaurar), .csv (Excel/Sheets) e um resumo. */
export function backupBundle() {
  const today = api.now().date;
  const report = api.handle('GET', '/api/state').data.report;
  return { today, filename: `onsitely-backup-${today}`, json: exportBackup(), csv: exportCsv(), summary: backupSummary(report, today) };
}

export function importBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t('err.json'));
  }
  return repo.importBackup(data);
}

/** .ics com um lembrete por dia útil de hoje até ao fim do semestre (mín. 3 meses). */
export function reminderIcs() {
  const settings = repo.getSettings();
  const today = api.now().date;
  // Até ao fim do semestre, mas sempre pelo menos ~3 meses.
  const semEnd = semesterOf(today).end;
  const end = semEnd > addDays(today, 90) ? semEnd : addDays(today, 90);
  const days = repo.getDays(today, end);
  const holidays = buildHolidayMap(settings, today, end, days);
  // O link do lembrete pede a verificação por localização (se estiver ligada).
  const url = `${appUrl()}?checkin=${settings.location.enabled ? 'location' : '1'}`;
  return { ...buildReminderIcs({ settings, days, holidays, from: today, to: end, appUrl: url }), until: end };
}

export function googleLink() {
  const settings = repo.getSettings();
  const url = `${appUrl()}?checkin=${settings.location.enabled ? 'location' : '1'}`;
  return googleCalendarLink({ settings, appUrl: url, firstDate: api.now().date });
}
