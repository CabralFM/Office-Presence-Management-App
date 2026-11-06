// Modo LOCAL (sem servidor): mesma API, dados no "armazenamento do celular".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalRepo } from '../src/core/local-repo.js';
import { createApi } from '../src/core/api.js';
import { buildCsv } from '../src/core/export.js';
import { buildReminderIcs, googleCalendarLink } from '../src/core/calendar.js';
import { buildHolidayMap, normalizeSettings } from '../src/core/offices.js';
import { DEFAULT_SETTINGS, deepMerge } from '../src/core/settings.js';

/** Substituto do window.localStorage. */
function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), raw: m };
}

// "Hoje" = quinta 05/11/2026, 10h em Lisboa
const clock = () => new Date('2026-11-05T10:00:00Z');

function setup() {
  const storage = fakeStorage();
  const repo = createLocalRepo(storage);
  const api = createApi({ repo, clock });
  const call = (m, p, b) => api.handle(m, p, b);
  call('POST', '/api/offices', { id: 'principal', name: 'Lisboa', country: 'PT', timezone: 'Europe/Lisbon', customHolidays: [{ date: '06-13', name: 'Santo António', scope: 'municipal' }], primary: true });
  return { storage, repo, api, call };
}

test('fluxo completo sem servidor: registrar, ausência, viagem, relatório', () => {
  const { call } = setup();
  assert.equal(call('POST', '/api/checkin', { status: 'office' }).status, 200);
  assert.equal(call('PUT', '/api/days/2026-11-04', { status: 'home' }).status, 200);
  const ab = call('POST', '/api/absences', { type: 'ferias', start: '2026-12-21', end: '2027-01-01' });
  assert.equal(ab.status, 200);
  // 21/12–01/01: seg–sex 21,22,23,24,28,29,30,31 = 8 (25/12 e 01/01/2027 são feriados)
  assert.equal(ab.data.days, 8);
  call('POST', '/api/offices', { name: 'Madrid', country: 'ES', region: 'MD', customHolidays: [{ date: '11-09', name: 'Virgen de la Almudena', scope: 'municipal' }] });
  const st0 = call('GET', '/api/state').data;
  const madrid = st0.settings.offices.find((o) => o.name === 'Madrid');
  assert.equal(call('POST', '/api/trips', { officeId: madrid.id, start: '2026-11-09', end: '2026-11-11' }).status, 200);

  const st = call('GET', '/api/state?semester=2026-2').data;
  assert.equal(st.now.date, '2026-11-05');
  assert.equal(st.days['2026-11-05'].status, 'office');
  assert.equal(st.report.totals.absenceByType.ferias, 8); // 21–31/12 (25/12 e 01/01 são feriados)
  assert.equal(st.holidays['2026-11-09'].officeName, 'Madrid'); // Almudena, durante a viagem
  assert.equal(st.meta.mode, undefined); // extraMeta não definido neste teste
});

test('os dados sobrevivem a "fechar e abrir a app" (novo repo sobre o mesmo armazenamento)', () => {
  const { storage, call } = setup();
  call('POST', '/api/checkin', { status: 'home' });
  const again = createApi({ repo: createLocalRepo(storage), clock });
  assert.equal(again.handle('GET', '/api/state').data.days['2026-11-05'].status, 'home');
});

test('mesmas validações do servidor (ex.: doença sem justificação, conflito 409)', () => {
  const { call } = setup();
  assert.equal(call('POST', '/api/absences', { type: 'doenca', start: '2026-11-03', end: '2026-11-03' }).status, 400);
  call('PUT', '/api/days/2026-11-03', { status: 'office' });
  const r = call('POST', '/api/absences', { type: 'doenca', start: '2026-11-03', end: '2026-11-03', justification: 'Atestado' });
  assert.equal(r.status, 409);
  assert.deepEqual(r.data.conflicts, ['2026-11-03']);
});

test('cópia de segurança: exportar → importar noutro aparelho', () => {
  const a = setup();
  a.call('POST', '/api/checkin', { status: 'office' });
  a.call('POST', '/api/absences', { type: 'doenca', start: '2026-11-02', end: '2026-11-03', justification: 'Atestado nº 9' });
  const backup = JSON.parse(JSON.stringify(a.repo.exportBackup()));

  const b = createLocalRepo(fakeStorage());
  assert.equal(b.importBackup(backup), 3);
  assert.equal(b.getDay('2026-11-03').justification, 'Atestado nº 9');
  assert.equal(b.getSettings().offices[0].name, 'Lisboa');
  assert.throws(() => b.importBackup({ foo: 1 }), /não é uma cópia de segurança/);
});

test('CSV inclui ausências e justificação', () => {
  const { repo, call } = setup();
  call('POST', '/api/absences', { type: 'doenca', start: '2026-11-02', end: '2026-11-02', justification: 'Atestado; nº 9' });
  const csv = buildCsv(repo.allDays(), repo.getSettings().offices);
  assert.match(csv, /2026-11-02;Ausência;Doença;Atestado, nº 9;/);
});

// ---------------------------------------------------------------- calendário
function calSetup(extra = {}) {
  const settings = normalizeSettings(
    deepMerge(DEFAULT_SETTINGS, {
      offices: [
        { id: 'lx', name: 'Lisboa', country: 'PT', timezone: 'Europe/Lisbon', customHolidays: [] },
        { id: 'ny', name: 'Nova Iorque', country: 'US', region: 'NY', timezone: 'America/New_York', customHolidays: [] },
      ],
      primaryOfficeId: 'lx',
      ...extra,
    }),
  );
  return settings;
}

test('ICS: um lembrete por dia útil, sem fins de semana, feriados, férias nem dias respondidos', () => {
  const settings = calSetup();
  const days = new Map([
    ['2026-11-30', { status: 'office' }], // já respondido
    ['2026-12-02', { status: 'absence', absenceType: 'ferias' }],
  ]);
  const holidays = buildHolidayMap(settings, '2026-11-30', '2026-12-11', days);
  const { ics, count } = buildReminderIcs({ settings, days, holidays, from: '2026-11-30', to: '2026-12-11', appUrl: 'https://ex.pt/app/', stamp: new Date('2026-11-01T00:00:00Z') });
  // 30/11–11/12: 10 dias úteis − 01/12 e 08/12 (feriados) − 30/11 (respondido) − 02/12 (férias) = 6
  assert.equal(count, 6);
  assert.ok(!ics.includes('20261201T'), 'sem lembrete no feriado de 01/12');
  assert.ok(!ics.includes('DTSTART:20261202T'), 'sem lembrete nas férias');
  assert.ok(ics.includes('DTSTART:20261203T090000Z'), '09:00 em Lisboa no inverno = 09:00 UTC');
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 6 * 3, '3 alertas por dia (9h00, 9h30, 10h00)');
  assert.ok(ics.includes('TRIGGER:PT30M'));
  assert.ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75), 'linhas dobradas (RFC 5545)');
});

test('ICS: em viagem, o lembrete é às 9h do destino', () => {
  const settings = calSetup({ trips: [{ id: 't', officeId: 'ny', start: '2026-11-16', end: '2026-11-17' }] });
  const holidays = buildHolidayMap(settings, '2026-11-16', '2026-11-16');
  const { ics } = buildReminderIcs({ settings, days: new Map(), holidays, from: '2026-11-16', to: '2026-11-16', appUrl: 'x' });
  assert.ok(ics.includes('DTSTART:20261116T140000Z'), '09:00 em Nova Iorque = 14:00 UTC');
  assert.ok(ics.includes('(Nova Iorque)'));
});

test('link do Google Agenda: evento recorrente seg–sex às 9h', () => {
  const url = new URL(googleCalendarLink({ settings: calSetup(), appUrl: 'https://ex.pt/', firstDate: '2026-11-05' }));
  assert.equal(url.searchParams.get('recur'), 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  assert.equal(url.searchParams.get('dates'), '20261105T090000Z/20261105T091500Z');
  assert.equal(url.searchParams.get('ctz'), 'Europe/Lisbon');
});

test('lista completa de feriados do escritório (Lisboa, 2026) e cidade guardada', () => {
  const { call } = setup();
  const r = call('POST', '/api/holidays/preview', {
    country: 'PT',
    optionalHolidays: { carnaval: true },
    customHolidays: [{ date: '06-13', name: 'Santo António', scope: 'municipal' }],
    year: 2026,
  });
  assert.equal(r.status, 200);
  const byDate = Object.fromEntries(r.data.holidays.map((x) => [x.date, x]));
  assert.equal(byDate['2026-06-13'].name, 'Santo António');
  assert.equal(byDate['2026-06-13'].weekend, true); // sábado em 2026
  assert.equal(byDate['2026-02-17'].type, 'facultativo'); // Carnaval
  assert.equal(byDate['2026-06-10'].type, 'nacional');
  assert.ok(!byDate['2026-06-24'], 'São João (Almada) não entra');
  assert.equal(r.data.holidays.length, 15); // 13 nacionais (inclui Páscoa) + Carnaval + Santo António

  const saved = call('POST', '/api/offices', { id: 'principal', name: 'Lisboa', country: 'PT', city: 'lisboa' });
  assert.equal(saved.data.office.city, 'lisboa');
  assert.equal(call('GET', '/api/state').data.settings.offices[0].city, 'lisboa');
  assert.equal(call('POST', '/api/offices', { name: 'X', country: 'PT', city: 'x'.repeat(41) }).status, 400);
});

test('início da contagem (admissão 02/11/2026, Lisboa): só contam 02/11–31/12', () => {
  const { call } = setup();
  assert.equal(call('PUT', '/api/settings', { rules: { startDate: '2026-13-01' } }).status, 400);
  call('PUT', '/api/settings', { rules: { startDate: '2026-11-02' } });
  call('PUT', '/api/days/2026-10-15', { status: 'home' }); // antes da admissão: ignorado
  const r = call('GET', '/api/state?semester=2026-2').data.report;
  // Nov: 21 dias de seg–sex (sem feriados em dia útil); Dez: 23 − 01/12, 08/12, 25/12 = 20
  assert.equal(r.totals.working, 41);
  assert.equal(r.requiredOffice, 21); // 50% de 41 = 20,5 → 21
  assert.equal(r.totals.home, 0, 'o dia de outubro não conta');
  assert.deepEqual(r.months.map((m) => m.key), ['2026-11', '2026-12']);
  assert.equal(r.weeks[0].start, '2026-11-02');
  assert.deepEqual(r.pendingDates, ['2026-11-02', '2026-11-03', '2026-11-04']);
  assert.ok(r.alerts.some((a) => /Contagem a partir de 02\/11\/2026/.test(a.text)));

  // Semestre anterior à admissão: sem metas
  const r1 = call('GET', '/api/state?semester=2026-1').data.report;
  assert.equal(r1.status, 'sem_contagem');
  assert.equal(r1.requiredOffice, 0);

  // Teto opcional proporcional: 60 × 41/128 = 19 → exige 41 − 19 = 22
  call('PUT', '/api/settings', { rules: { enforceHomeCap: true } });
  const r2 = call('GET', '/api/state?semester=2026-2').data.report;
  assert.equal(r2.homeCap, 19);
  assert.equal(r2.requiredOffice, 22);

  // Sem data: volta a contar o semestre inteiro
  call('PUT', '/api/settings', { rules: { startDate: null, enforceHomeCap: false } });
  assert.equal(call('GET', '/api/state?semester=2026-2').data.report.totals.working, 128);
});

test('lembretes do calendário não começam antes da admissão', () => {
  const settings = calSetup({ rules: { ...DEFAULT_SETTINGS.rules, startDate: '2026-12-03' } });
  const holidays = buildHolidayMap(settings, '2026-11-30', '2026-12-04');
  const { ics, count } = buildReminderIcs({ settings, days: new Map(), holidays, from: '2026-11-30', to: '2026-12-04', appUrl: 'x' });
  assert.equal(count, 2); // 03 e 04/12
  assert.ok(!ics.includes('DTSTART:20261202'));
});

import { isBackupDue } from '../src/core/backup.js';

test('cópias de segurança: quando estão atrasadas', () => {
  assert.equal(isBackupDue({ frequency: 'weekly', lastAt: null }, '2026-11-06'), true, 'nunca feita');
  assert.equal(isBackupDue({ frequency: 'weekly', lastAt: '2026-11-01' }, '2026-11-07'), false, '6 dias');
  assert.equal(isBackupDue({ frequency: 'weekly', lastAt: '2026-11-01' }, '2026-11-08'), true, '7 dias');
  assert.equal(isBackupDue({ frequency: 'monthly', lastAt: '2026-11-01' }, '2026-11-30'), false, 'mesmo mês');
  assert.equal(isBackupDue({ frequency: 'monthly', lastAt: '2026-11-30' }, '2026-12-01'), true, '1º acesso de dezembro');
  assert.equal(isBackupDue({ frequency: 'off', lastAt: null }, '2026-11-06'), false, 'desligada');
});

test('ajustes da cópia: validação do endereço do Google Apps Script', () => {
  const { call } = setup();
  assert.equal(call('PUT', '/api/settings', { backup: { autoUrl: 'https://evil.example/x' } }).status, 400);
  assert.equal(call('PUT', '/api/settings', { backup: { frequency: 'diaria' } }).status, 400);
  const ok = call('PUT', '/api/settings', { backup: { frequency: 'monthly', autoUrl: 'https://script.google.com/macros/s/AKfycb_x-1/exec', autoToken: 'abc', lastAt: '2026-11-06' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.settings.backup.frequency, 'monthly');
  assert.equal(ok.data.settings.backup.email, true);
});
