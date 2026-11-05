import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, computeSemester } from '../src/core/compliance.js';
import { holidayMap } from '../src/core/holidays.js';
import { eachDay, isWeekend, semester } from '../src/core/dates.js';

const rules = { officePct: 50, maxHomeDays: 60 };
const S2 = semester(2026, 2);
const hol = holidayMap({ country: 'BR', optionalHolidays: { carnaval: true, corpusChristi: true } }, [2026]);

function fill(start, end, pattern) {
  // pattern: função (date, idx) → 'office' | 'home'
  const days = new Map();
  let i = 0;
  for (const d of eachDay(start, end)) {
    if (isWeekend(d) || hol.has(d)) continue;
    days.set(d, { status: pattern(d, i++) });
  }
  return days;
}

test('2º semestre 2026 (BR): 127 dias úteis e o teto de 60 é a regra que manda', () => {
  const r = computeSemester({ semester: S2, today: '2026-07-01', days: new Map(), holidays: hol, rules });
  assert.equal(r.totals.working, 127);
  assert.equal(r.requiredByPct, 64);
  assert.equal(r.requiredByCap, 67);
  assert.equal(r.requiredOffice, 67);
  assert.equal(r.bindingRule, 'teto');
  assert.equal(r.maxHome, 60);
  assert.equal(r.status, 'ok');
});

test('Férias reduzem a base: 10 dias de férias → 117 dias, 59 no escritório', () => {
  const days = new Map();
  for (const d of ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']) {
    days.set(d, { plan: 'absence' });
  }
  const r = computeSemester({ semester: S2, today: '2026-07-01', days, holidays: hol, rules });
  assert.equal(r.totals.base, 117);
  assert.equal(r.requiredOffice, 59); // ceil(58,5)=59 ; 117−60=57 → percentual manda
  assert.equal(r.bindingRule, 'percentual');
});

test('Ir só 2x por semana até novembro deixa a situação crítica e gera alertas', () => {
  // seg e ter no escritório, resto em casa, de julho até 04/11
  const days = fill('2026-07-01', '2026-11-04', (d) => ([1, 2].includes(new Date(d).getUTCDay()) ? 'office' : 'home'));
  const r = computeSemester({ semester: S2, today: '2026-11-05', days, holidays: hol, rules });
  assert.ok(r.totals.office < r.totals.home);
  assert.ok(['critico', 'impossivel'].includes(r.status), r.status);
  assert.ok(r.alerts.some((a) => /outubro fechou com/i.test(a.text)));
  assert.ok(r.alerts.some((a) => /novembro/i.test(a.text)));
  // A soma das recomendações semanais = dias que faltam (se for possível)
  const sum = r.weeks.reduce((a, w) => a + w.recommendedOffice, 0);
  assert.equal(sum, Math.min(r.officeNeeded, r.totals.open));
});

test('Dias passados sem registro aparecem como pendentes', () => {
  const r = computeSemester({ semester: S2, today: '2026-07-08', days: new Map(), holidays: hol, rules });
  assert.deepEqual(r.pendingDates, ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-06', '2026-07-07']);
  assert.ok(r.alerts.some((a) => /sem registro/.test(a.text)));
});

test('Meta cumprida', () => {
  const days = fill('2026-07-01', '2026-12-31', () => 'office');
  const r = computeSemester({ semester: S2, today: '2026-12-31', days, holidays: hol, rules });
  assert.equal(r.status, 'cumprido');
});

test('Impossível quando já passou do teto de casa', () => {
  const days = fill('2026-07-01', '2026-10-31', () => 'home');
  const r = computeSemester({ semester: S2, today: '2026-11-02', days, holidays: hol, rules });
  assert.equal(r.status, 'impossivel');
  assert.ok(r.homeLeft < 0);
});

test('allocate distribui proporcionalmente e respeita capacidade', () => {
  assert.deepEqual(allocate(10, [5, 5, 5, 5]), [3, 3, 2, 2]);
  assert.deepEqual(allocate(3, [1, 5]), [1, 2]);
  assert.deepEqual(allocate(20, [2, 3]), [2, 3]);
  assert.deepEqual(allocate(0, [5]), [0]);
});

test('Planejamento: projeção considera dias planejados', () => {
  const days = new Map([['2026-07-06', { plan: 'office' }], ['2026-07-07', { plan: 'home' }]]);
  const r = computeSemester({ semester: S2, today: '2026-07-01', days, holidays: hol, rules });
  assert.equal(r.plan.officeWithPlan, 1);
  assert.equal(r.plan.homeWithPlan, 1);
  assert.equal(r.plan.neededAfterPlan, 66);
});
