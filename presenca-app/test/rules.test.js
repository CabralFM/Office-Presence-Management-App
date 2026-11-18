// Regras de outras empresas: N dias por semana/mês, dias fixos, semana de 4 dias,
// períodos mês/trimestre/ano. Escritório em Lisboa (país padrão: Portugal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalRepo } from '../src/core/local-repo.js';
import { createApi } from '../src/core/api.js';

function app(today = '2026-11-18T10:00:00Z') {
  const m = new Map();
  const repo = createLocalRepo({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) });
  const api = createApi({ repo, clock: () => new Date(today) });
  const call = (method, path, body) => api.handle(method, path, body);
  const state = (q = '') => call('GET', `/api/state${q}`).data;
  return { call, state };
}
const mark = (call, status, dates) => dates.forEach((d) => assert.equal(call('PUT', `/api/days/${d}`, { status }).status, 200));

test('padrão: Portugal (Lisboa), "Escritório principal", 50% por semestre', () => {
  const { state } = app();
  const s = state();
  assert.equal(s.settings.offices[0].country, 'PT');
  assert.equal(s.settings.offices[0].name, 'Escritório principal');
  assert.equal(s.semester.id, '2026-2');
  assert.equal(s.semester.label, '2º semestre de 2026');
});

test('"3 dias por semana" (mês de novembro): semanas falhadas não se recuperam', () => {
  const { call, state } = app(); // hoje: quarta 18/11
  call('PUT', '/api/settings', { rules: { target: 'daysPerWeek', daysPerWeek: 3, period: 'month' } });
  mark(call, 'office', ['2026-11-02', '2026-11-03', '2026-11-04']); // semana 02/11: 3 ✅
  mark(call, 'home', ['2026-11-05', '2026-11-06']);
  mark(call, 'office', ['2026-11-09', '2026-11-10']); // semana 09/11: 2 ❌
  mark(call, 'home', ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-17']);
  mark(call, 'office', ['2026-11-16']);
  const s = state();
  const r = s.report;
  assert.equal(s.semester.id, '2026-11');
  // 4 semanas inteiras × 3 + semana de 30/11 (só 1 dia dentro de novembro → 1)
  assert.equal(r.requiredOffice, 13);
  assert.deepEqual(r.missed, [{ key: '2026-11-09', office: 2, target: 3 }]);
  // faltam: semana 16/11 (3 − 1 = 2) + semana 23/11 (3) + 30/11 (1)
  assert.equal(r.officeNeeded, 6);
  assert.equal(r.status, 'atencao');
  assert.equal(r.weeks.find((w) => w.start === '2026-11-16').suggestedOffice, 2);
  assert.ok(r.alerts.some((a) => /1 semana abaixo da regra/.test(a.text)));
  assert.ok(r.alerts.some((a) => /Esta semana: 1 de 3 dias/.test(a.text)));
  assert.equal(r.plan.credit, 0, 'sem crédito numa meta semanal');
});

test('dias fixos (terça e quinta) + 2 por semana', () => {
  const { call, state } = app();
  call('PUT', '/api/settings', { rules: { target: 'daysPerWeek', daysPerWeek: 2, fixedDays: [2, 4], period: 'month' } });
  mark(call, 'home', ['2026-11-03']); // terça (fixa) em casa
  mark(call, 'office', ['2026-11-05', '2026-11-06']);
  const r = state().report;
  // 8 terças/quintas em novembro; meta semanal: 2×4 + 1 (semana de 30/11) = 9
  assert.equal(r.requiredByFixed, 8);
  assert.equal(r.requiredOffice, 9);
  assert.deepEqual(r.fixedMissed, ['2026-11-03']);
  assert.ok(r.alerts.some((a) => /dia fixo de escritório passado em casa: 03\/11/.test(a.text)));
  // dias fixos livres são sugeridos primeiro: semana de 23/11 → ter 24 e qui 26
  assert.equal(r.weeks.find((w) => w.start === '2026-11-23').suggestedOffice, 2);
  // planejar uma terça fixa em casa gera aviso
  call('PUT', '/api/days/2026-11-24', { plan: 'home' });
  assert.ok(state().report.alerts.some((a) => /dias fixos de escritório planejados em casa: 24\/11/.test(a.text)));
});

test('"8 dias por mês" num trimestre, com admissão e férias (proporcional)', () => {
  const { call, state } = app();
  call('PUT', '/api/settings', { rules: { target: 'daysPerMonth', daysPerMonth: 8, period: 'quarter', startDate: '2026-11-02' } });
  call('POST', '/api/absences', { type: 'ferias', start: '2026-12-28', end: '2026-12-31' });
  const s = state();
  assert.equal(s.semester.id, '2026-Q4');
  assert.equal(s.semester.label, '4º trimestre de 2026');
  const byMonth = Object.fromEntries(s.report.months.map((m) => [m.key, m.target]));
  // outubro fora (antes da admissão); novembro 8; dezembro: 20 úteis, 16 trabalháveis → 8×16/20 = 6,4 → 7
  assert.deepEqual(byMonth, { '2026-11': 8, '2026-12': 7 });
  assert.equal(s.report.requiredOffice, 15);
});

test('semana de 4 dias (seg–qui): sextas não contam, nem para ausências', () => {
  const { call, state } = app();
  call('PUT', '/api/settings', { workdays: [1, 2, 3, 4], rules: { period: 'month' } });
  const r = state().report;
  // novembro: 5 segundas + 4 terças + 4 quartas + 4 quintas = 17 → 50% = 9
  assert.equal(r.totals.working, 17);
  assert.equal(r.requiredOffice, 9);
  // férias de segunda 23 a domingo 29: só 4 dias (sexta 27 não é dia de trabalho)
  assert.equal(call('POST', '/api/absences', { type: 'ferias', start: '2026-11-23', end: '2026-11-29' }).data.days, 4);
  assert.equal(call('PUT', '/api/settings', { workdays: [] }).status, 400);
});

test('trocar o tipo de período volta ao período de hoje', () => {
  const { call, state } = app();
  assert.equal(state('?period=2026-1').semester.id, '2026-1');
  call('PUT', '/api/settings', { rules: { period: 'year' } });
  assert.equal(state('?period=2026-1').semester.id, '2026'); // pedia semestre, regra agora é anual
  assert.equal(state().semester.label, 'Ano de 2026');
});
