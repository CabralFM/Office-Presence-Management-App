import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../src/reminders/scheduler.js';
import { DEFAULT_SETTINGS } from '../src/db.js';
import { nowInTimeZone } from '../src/core/dates.js';

const base = {
  settings: DEFAULT_SETTINGS,
  isWorkingDay: true,
  answered: false,
  reminderState: null,
  sentKeys: new Set(),
  firstWorkingDayOfWeek: false,
  firstWorkingDayOfMonth: false,
  weekKey: 'week:2026-11-02',
  monthKey: 'month:2026-11',
};
const at = (h, m = 0, weekday = 4) => ({ date: '2026-11-05', minutes: h * 60 + m, weekday });

test('não envia antes das 9h', () => {
  assert.deepEqual(decide({ ...base, now: at(8, 59) }), []);
});

test('envia às 9h e repete a cada 30 min até responder', () => {
  assert.equal(decide({ ...base, now: at(9) })[0].type, 'daily');
  assert.deepEqual(decide({ ...base, now: at(9, 20), reminderState: { lastMinutes: 540, count: 1 } }), []);
  const again = decide({ ...base, now: at(9, 30), reminderState: { lastMinutes: 540, count: 1 } });
  assert.equal(again[0].count, 2);
});

test('para depois de responder, em feriados, fins de semana e depois das 18h', () => {
  assert.deepEqual(decide({ ...base, now: at(10), answered: true }), []);
  assert.deepEqual(decide({ ...base, now: at(10), isWorkingDay: false }), []);
  assert.deepEqual(decide({ ...base, now: at(18) }), []);
  assert.deepEqual(decide({ ...base, now: at(10, 0, 6) }), []);
});

test('modo localização começa no início da janela', () => {
  const settings = { ...DEFAULT_SETTINGS, offices: [{ id: 'a', location: { lat: 0, lng: 0 } }], location: { ...DEFAULT_SETTINGS.location, enabled: true, windowStart: '10:00' } };
  assert.deepEqual(decide({ ...base, settings, now: at(9, 30) }), []);
  const a = decide({ ...base, settings, now: at(10) });
  assert.equal(a[0].useLocation, true);
});

test('resumos semanal e mensal saem uma única vez', () => {
  const a = decide({ ...base, now: at(9), answered: true, firstWorkingDayOfWeek: true, firstWorkingDayOfMonth: true });
  assert.deepEqual(a.map((x) => x.type), ['monthly', 'weekly']);
  const b = decide({ ...base, now: at(9, 30), answered: true, firstWorkingDayOfWeek: true, sentKeys: new Set(['week:2026-11-02']) });
  assert.deepEqual(b, []);
});

test('fuso horário: 12:00 UTC = 09:00 em São Paulo', () => {
  const n = nowInTimeZone('America/Sao_Paulo', new Date('2026-11-05T12:00:00Z'));
  assert.equal(n.date, '2026-11-05');
  assert.equal(n.minutes, 540);
});
