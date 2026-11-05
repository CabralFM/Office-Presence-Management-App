// Teste de integração: banco em memória + agendador + "push" falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { tick } from '../src/reminders/runner.js';

function setup() {
  const repo = openDb(':memory:');
  const sent = [];
  const push = { sendToAll: async (msg) => (sent.push(msg), { delivered: 1, total: 1 }) };
  return { repo, push, sent };
}
// 12:00 UTC = 09:00 em São Paulo (UTC−3)
const sp = (iso, hh, mm = 0) => new Date(`${iso}T${String(hh + 3).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);

test('segunda 09/11/2026 às 9h: lembrete diário + resumo semanal; repete até responder', async () => {
  const { repo, push, sent } = setup();
  await tick(repo, push, sp('2026-11-09', 8, 59));
  assert.equal(sent.length, 0);

  await tick(repo, push, sp('2026-11-09', 9, 0));
  assert.deepEqual(sent.map((m) => m.tag), ['daily-2026-11-09', 'weekly-2026-11-09']);
  assert.deepEqual(sent[0].actions.map((a) => a.action), ['office', 'home']);

  await tick(repo, push, sp('2026-11-09', 9, 15)); // ainda não passou 30 min
  assert.equal(sent.length, 2);
  await tick(repo, push, sp('2026-11-09', 9, 30)); // 2º lembrete
  assert.equal(sent.length, 3);
  assert.match(sent[2].title, /Ainda sem resposta/);

  repo.upsertDay('2026-11-09', { status: 'office', source: 'lembrete' });
  await tick(repo, push, sp('2026-11-09', 10, 0)); // respondido → silêncio
  assert.equal(sent.length, 3);
});

test('feriado (20/11 Consciência Negra) não gera lembrete', async () => {
  const { repo, push, sent } = setup();
  await tick(repo, push, sp('2026-11-20', 9, 0));
  assert.equal(sent.length, 0);
});

test('resumo mensal no 1º dia útil do mês (01/12/2026, terça)', async () => {
  const { repo, push, sent } = setup();
  await tick(repo, push, sp('2026-12-01', 9, 0));
  assert.ok(sent.some((m) => m.tag === 'monthly-2026-12'));
  await tick(repo, push, sp('2026-12-01', 9, 30));
  assert.equal(sent.filter((m) => m.tag === 'monthly-2026-12').length, 1);
});
