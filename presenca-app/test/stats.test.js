// Estatísticas anónimas: consentimento, envio 1×/dia, pedido de apagamento, e o
// script da planilha Google (integrations/google-stats.gs) a correr com uma
// planilha simulada — para não haver surpresas depois de instalado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { shouldAsk, shouldPing, buildPing, buildForget, newDeviceId, platformOf, STATS_URL_RE } from '../src/core/stats.js';
import { createLocalRepo } from '../src/core/local-repo.js';
import { createApi } from '../src/core/api.js';

const SURL = 'https://script.google.com/macros/s/AKfy_test-1/exec';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('consentimento: sem endereço não pergunta nem envia; sem "sim" não envia', () => {
  assert.equal(shouldAsk('', { consent: null }), false);
  assert.equal(shouldAsk(SURL, { consent: null }), true);
  assert.equal(shouldAsk(SURL, { consent: false }), false);
  const st = { consent: true, id: newDeviceId(), lastPing: null };
  assert.equal(shouldPing('', st, '2026-11-18'), false);
  assert.equal(shouldPing('https://evil.example/x', st, '2026-11-18'), false);
  assert.equal(shouldPing(SURL, { ...st, consent: null }, '2026-11-18'), false);
  assert.equal(shouldPing(SURL, st, '2026-11-18'), true);
  assert.equal(shouldPing(SURL, { ...st, lastPing: '2026-11-18' }, '2026-11-18'), false, 'no máximo 1×/dia');
  assert.ok(STATS_URL_RE.test(SURL));
});

test('o pacote só tem a lista fechada de campos (nada de presenças, local, empresa)', () => {
  const m = new Map();
  const repo = createLocalRepo({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) });
  const api = createApi({ repo, clock: () => new Date('2026-11-18T10:00:00Z') });
  const id = newDeviceId();
  assert.match(id, UUID_RE);
  assert.equal(api.handle('PUT', '/api/settings', { companyName: 'ACME', stats: { consent: true, id, firstSeen: '2026-11-02' } }).status, 200);
  assert.equal(api.handle('PUT', '/api/settings', { stats: { id: 'not-a-uuid' } }).status, 400);
  assert.equal(api.handle('PUT', '/api/settings', { stats: { consent: 'yes' } }).status, 400);
  api.handle('PUT', '/api/days/2026-11-18', { status: 'office' });
  const settings = api.handle('GET', '/api/state').data.settings;
  const p = buildPing({ settings, today: '2026-11-18', version: '2.1', ruleId: 'pct50-semester', platform: platformOf('Mozilla/5.0 (Linux; Android 14)') });
  assert.deepEqual(Object.keys(p).sort(), ['country', 'day', 'firstSeen', 'id', 'installed', 'lang', 'onboarded', 'period', 'platform', 'rule', 'type', 'v', 'version']);
  assert.equal(p.country, 'PT');
  assert.equal(p.platform, 'android');
  assert.equal(p.firstSeen, '2026-11-02');
  assert.ok(!JSON.stringify(p).includes('ACME'));
  assert.deepEqual(buildForget(id), { type: 'forget', v: 1, id });
  assert.equal(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), 'ios');
});

// ---- planilha Google simulada -------------------------------------------------------
function fakeGoogle(now) {
  const sheets = new Map();
  const props = new Map();
  const pad = (n) => String(n).padStart(2, '0');
  function makeSheet(name) {
    const data = [];
    const sh = {
      name,
      data,
      charts: [],
      appendRow: (row) => data.push([...row]),
      getLastRow: () => data.length,
      getLastColumn: () => Math.max(0, ...data.map((r) => r.length)),
      deleteRow: (r) => data.splice(r - 1, 1),
      deleteRows: (r, n) => data.splice(r - 1, n),
      clear: () => data.splice(0),
      setFrozenRows() {},
      autoResizeColumns() {},
      getCharts: () => sh.charts,
      removeChart: (c) => sh.charts.splice(sh.charts.indexOf(c), 1),
      insertChart: (c) => sh.charts.push(c),
      newChart() {
        const b = { setChartType: () => b, addRange: () => b, setPosition: () => b, setOption: () => b, build: () => ({}) };
        return b;
      },
      getRange(r, c, nr = 1, nc = 1) {
        if (typeof r === 'string') return rangeStub;
        const rg = {
          getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => data[r - 1 + i]?.[c - 1 + j] ?? '')),
          setValues(v) {
            v.forEach((row, i) => row.forEach((x, j) => {
              while (data.length < r + i) data.push([]);
              data[r - 1 + i][c - 1 + j] = x;
            }));
            return rg;
          },
          setFontWeight: () => rg,
          setFontSize: () => rg,
          setNumberFormat: () => rg,
          clearContent() {
            for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (data[r - 1 + i]) data[r - 1 + i][c - 1 + j] = '';
            return rg;
          },
          createTextFinder: (text) => ({
            matchEntireCell: () => ({
              findNext: () => {
                for (let i = 0; i < nr; i++) if (String(data[r - 1 + i]?.[c - 1]) === text) return { getRow: () => r + i };
                return null;
              },
            }),
          }),
        };
        return rg;
      },
    };
    const rangeStub = { setFontWeight: () => rangeStub, setFontSize: () => rangeStub, setNumberFormat: () => rangeStub };
    return sh;
  }
  const ss = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => (sheets.set(n, makeSheet(n)), sheets.get(n)),
    getSpreadsheetTimeZone: () => 'Europe/Lisbon',
  };
  const ctx = {
    SpreadsheetApp: { getActive: () => ss, getUi: () => ({}) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Utilities: {
      formatDate: (d, _tz, fmt) => {
        const y = d.getUTCFullYear();
        const iso = `${y}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
        return fmt === 'yyyy-MM-dd' ? iso : `${iso} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
      },
    },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create() {} }) }) }) }) },
    Charts: { ChartType: { LINE: 'line' } },
    Logger: { log() {} },
    Date: class extends Date {
      constructor(...a) {
        super(...(a.length ? a : [now()]));
      }
      static now() {
        return now();
      }
    },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../integrations/google-stats.gs', import.meta.url), 'utf8'), ctx);
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).s);
  return { ctx, post, sheets, props };
}

test('planilha: 1 linha por aparelho, atividade por dia, apagar e resumo', () => {
  let clock = Date.parse('2026-11-02T10:00:00Z');
  const g = fakeGoogle(() => clock);
  g.ctx.configurar();
  const a = newDeviceId();
  const b = newDeviceId();
  const ping = (id, day, extra = {}) => g.post({ type: 'ping', v: 1, id, day, firstSeen: day, version: '2.1', lang: 'pt-PT', country: 'PT', rule: 'week3', period: 'month', platform: 'android', installed: true, onboarded: true, ...extra });

  assert.deepEqual(ping(a, '2026-11-02'), { ok: true, new: true });
  assert.deepEqual(ping(a, '2026-11-02'), { ok: true }, 'repetido no mesmo dia: não conta 2×');
  assert.equal(ping(b, '2026-11-02', { platform: 'ios', lang: 'en', country: 'GB' }).ok, true);
  // aparelho A volta em mais 16 dias; B nunca mais
  for (let i = 3; i <= 18; i++) {
    clock = Date.parse(`2026-11-${String(i).padStart(2, '0')}T10:00:00Z`);
    ping(a, `2026-11-${String(i).padStart(2, '0')}`);
  }
  const dev = g.sheets.get('Aparelhos').data;
  assert.equal(dev.length, 3); // cabeçalho + 2
  const rowA = dev.find((r) => r[0] === a);
  assert.deepEqual(rowA.slice(1, 4), ['2026-11-02', '2026-11-18', 17]);
  assert.equal(g.sheets.get('Atividade').data.length, 1 + 17 + 1);

  // Validação: dia antigo (encher o passado), id inválido, campos estranhos ignorados.
  assert.equal(ping(newDeviceId(), '2026-10-01').ok, false);
  assert.equal(g.post({ type: 'ping', id: 'x', day: '2026-11-18' }).ok, false);
  assert.equal(ping(newDeviceId(), '2026-11-18', { lang: '=HYPERLINK("x")', email: 'a@b.c' }).ok, true);
  assert.ok(!JSON.stringify(g.sheets.get('Aparelhos').data).includes('HYPERLINK'));
  assert.ok(!JSON.stringify(g.sheets.get('Aparelhos').data).includes('a@b.c'));

  g.ctx.atualizarResumo();
  const res = Object.fromEntries(g.sheets.get('Resumo').data.map((r) => [r[0], r[1]]));
  assert.equal(res['Aparelhos registados (aceitaram estatísticas)'], 3);
  assert.equal(res['Ativos hoje'], 2);
  assert.equal(res['Quase todos os dias úteis (16 ou mais)'], 1);
  assert.equal(res['Usaram só uma vez e não voltaram'], 1);
  assert.equal(g.sheets.get('Resumo').charts.length, 1);

  // Desligar: apaga tudo do aparelho A.
  assert.deepEqual(g.post({ type: 'forget', v: 1, id: a }), { ok: true });
  assert.ok(!JSON.stringify(g.sheets.get('Aparelhos').data).includes(a));
  assert.ok(!JSON.stringify(g.sheets.get('Atividade').data).includes(a));
});

test('planilha: trava de abuso (aparelhos novos por dia)', () => {
  const g = fakeGoogle(() => Date.parse('2026-11-18T10:00:00Z'));
  g.props.set('new:2026-11-18', '500');
  assert.deepEqual(g.post({ type: 'ping', v: 1, id: newDeviceId(), day: '2026-11-18' }), { ok: false, error: 'limit' });
});

test('planilha: apaga dados com mais de ~13 meses', () => {
  let clock = Date.parse('2026-11-18T10:00:00Z');
  const g = fakeGoogle(() => clock);
  g.ctx.configurar();
  const old = newDeviceId();
  const cur = newDeviceId();
  g.post({ type: 'ping', v: 1, id: old, day: '2026-11-18' });
  clock = Date.parse('2027-12-30T10:00:00Z');
  g.post({ type: 'ping', v: 1, id: cur, day: '2027-12-30' });
  g.ctx.atualizarResumo();
  assert.ok(!JSON.stringify(g.sheets.get('Aparelhos').data).includes(old));
  assert.ok(!JSON.stringify(g.sheets.get('Atividade').data).includes(old));
  assert.ok(JSON.stringify(g.sheets.get('Aparelhos').data).includes(cur));
  assert.equal(g.sheets.get('Atividade').data.length, 2);
});
