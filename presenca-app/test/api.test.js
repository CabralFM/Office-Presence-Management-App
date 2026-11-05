// Teste da API HTTP (servidor real em porta aleatória, banco em memória).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/server.js';

let server;
let base;
const push = { publicKey: 'x', sendToAll: async () => ({ delivered: 0, total: 0 }) };
const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
};

before(async () => {
  const repo = openDb(':memory:');
  repo.updateSettings({ offices: [{ id: 'lx', name: 'Lisboa', country: 'PT', timezone: 'Europe/Lisbon', customHolidays: [] }], primaryOfficeId: 'lx' });
  server = createApp({ repo, push, password: '' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('férias de 2 semanas: só os dias úteis contam (fins de semana e feriado 15/08 fora)', async () => {
  // 03/08 (seg) a 16/08 (dom) de 2026 = 10 dias de seg–sex; 15/08 é sábado → 10
  const r = await call('POST', '/api/absences', { type: 'ferias', start: '2026-08-03', end: '2026-08-16' });
  assert.equal(r.status, 200);
  assert.equal(r.data.days, 10);
  // Período com feriado em dia útil: 05/10/2026 (seg, Implantação da República) → 4 dias
  const r2 = await call('POST', '/api/absences', { type: 'doenca', start: '2026-10-05', end: '2026-10-09', justification: 'Baixa médica nº 42' });
  assert.equal(r2.data.days, 4);
  const st = await call('GET', '/api/state?semester=2026-2');
  assert.equal(st.data.report.totals.absence, 14);
  assert.equal(st.data.absences.length, 2);
  assert.equal(st.data.absences[1].justification, 'Baixa médica nº 42');
  assert.equal(st.data.days['2026-08-03'].absenceType, 'ferias');
});

test('doença exige justificação; férias não', async () => {
  const r = await call('POST', '/api/absences', { type: 'doenca', start: '2026-09-01', end: '2026-09-01' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /justificação é obrigatória/);
});

test('não sobrescreve dias de escritório sem confirmação', async () => {
  await call('PUT', '/api/days/2026-07-06', { status: 'office' });
  const r = await call('POST', '/api/absences', { type: 'folga', start: '2026-07-06', end: '2026-07-07', justification: 'Compensação de horas' });
  assert.equal(r.status, 409);
  assert.deepEqual(r.data.conflicts, ['2026-07-06']);
  const r2 = await call('POST', '/api/absences', { type: 'folga', start: '2026-07-06', end: '2026-07-07', justification: 'Compensação de horas', overwrite: true });
  assert.equal(r2.data.days, 2);
});

test('editar e remover um período', async () => {
  const st = await call('GET', '/api/state?semester=2026-2');
  const ferias = st.data.absences.find((a) => a.type === 'ferias');
  // editar: encurtar para 1 semana (substitui o período)
  const r = await call('POST', '/api/absences', { type: 'ferias', start: '2026-08-03', end: '2026-08-07', replaceId: ferias.id });
  assert.equal(r.data.days, 5);
  let s2 = await call('GET', '/api/state?semester=2026-2');
  assert.equal(s2.data.days['2026-08-10'], undefined, 'segunda semana voltou a "sem registro"');
  // remover
  await call('DELETE', `/api/absences/${r.data.id}`);
  s2 = await call('GET', '/api/state?semester=2026-2');
  assert.equal(s2.data.days['2026-08-03'], undefined);
});

test('check-in de ausência pela notificação é recusado (precisa de tipo/justificação)', async () => {
  const r = await call('POST', '/api/checkin', { status: 'absence' });
  assert.equal(r.status, 400);
});
