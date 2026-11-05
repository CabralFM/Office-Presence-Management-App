import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, computeSemester } from '../src/core/compliance.js';
import { holidayMap } from '../src/core/holidays.js';
import { eachDay, isWeekend, semester } from '../src/core/dates.js';

const rules = { officePct: 50, maxHomeDays: 60, enforceHomeCap: false };
const rulesWithCap = { ...rules, enforceHomeCap: true };
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

test('regra mãe: 50% de 127 dias úteis = 64 no escritório (até 63 em casa)', () => {
  const r = computeSemester({ semester: S2, today: '2026-07-01', days: new Map(), holidays: hol, rules });
  assert.equal(r.totals.working, 127);
  assert.equal(r.requiredOffice, 64);
  assert.equal(r.bindingRule, 'percentual');
  assert.equal(r.maxHome, 63);
  assert.equal(r.status, 'ok');
});

test('teto absoluto opcional: ligado, 127 − 60 = 67 no escritório', () => {
  const r = computeSemester({ semester: S2, today: '2026-07-01', days: new Map(), holidays: hol, rules: rulesWithCap });
  assert.equal(r.requiredByPct, 64);
  assert.equal(r.requiredByCap, 67);
  assert.equal(r.requiredOffice, 67);
  assert.equal(r.bindingRule, 'teto');
  assert.equal(r.maxHome, 60);
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
  assert.equal(r.plan.neededAfterPlan, 63); // 64 − 1 planejado
});

test('férias + doença saem da base e os 50% aplicam-se ao que sobra', () => {
  const days = new Map();
  // 10 dias úteis de férias em agosto
  for (const d of ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']) {
    days.set(d, { status: 'absence', absenceType: 'ferias' });
  }
  // 3 dias de doença com atestado
  for (const d of ['2026-09-21', '2026-09-22', '2026-09-23']) days.set(d, { status: 'absence', absenceType: 'doenca', justification: 'Atestado médico nº 123' });
  const r = computeSemester({ semester: S2, today: '2026-10-01', days, holidays: hol, rules });
  assert.equal(r.totals.absence, 13);
  assert.deepEqual(r.totals.absenceByType, { ferias: 10, doenca: 3 });
  assert.equal(r.totals.base, 114);
  assert.equal(r.requiredOffice, 57); // 50% de 114
  assert.equal(r.maxHome, 57);
  assert.equal(r.unjustifiedAbsences.length, 0);
  assert.ok(r.alerts.some((a) => /127 dias úteis − 13 = 114 dias trabalháveis → mínimo 57/.test(a.text)));
});

test('ausência sem justificação (ou sem tipo) gera aviso; férias não precisam', () => {
  const days = new Map([
    ['2026-07-06', { status: 'absence', absenceType: 'doenca' }],
    ['2026-07-07', { status: 'absence' }], // registro antigo, sem tipo
    ['2026-07-08', { status: 'absence', absenceType: 'ferias' }],
  ]);
  const r = computeSemester({ semester: S2, today: '2026-07-10', days, holidays: hol, rules });
  assert.deepEqual(r.unjustifiedAbsences, ['2026-07-06', '2026-07-07']);
  assert.ok(r.alerts.some((a) => /2 ausências sem justificação/.test(a.text)));
});

test('mesmo com ausências, a regra é cumprida só com 50% dos dias trabalhados', () => {
  // Julho–dezembro: alterna escritório/casa, com 5 dias de doença no meio
  const days = fill('2026-07-01', '2026-12-31', (d, i) => (i % 2 === 0 ? 'office' : 'home'));
  for (const d of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']) days.set(d, { status: 'absence', absenceType: 'doenca', justification: 'atestado' });
  const r = computeSemester({ semester: S2, today: '2026-12-31', days, holidays: hol, rules });
  assert.equal(r.totals.base, 122);
  assert.equal(r.requiredOffice, 61);
  assert.ok(r.totals.office >= 61, `office=${r.totals.office}`);
  assert.equal(r.status, 'cumprido');
});
