// Testa o script do Google (integrations/google-backup.gs) com simulações do
// Drive, Gmail e propriedades do Apps Script — sem precisar de conta Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CODE = readFileSync(new URL('../integrations/google-backup.gs', import.meta.url), 'utf8');

function sandbox() {
  const files = [];
  const mails = [];
  const props = new Map();
  let clock = Date.UTC(2026, 10, 6);
  const mkFile = (name, content) => {
    const f = { name, content, trashed: false, created: new Date(clock++), getName: () => name, getBlob: () => ({ name, content }), getDateCreated: () => f.created, setTrashed: (v) => (f.trashed = v) };
    files.push(f);
    return f;
  };
  const folder = {
    createFile: (name, content) => mkFile(name, content),
    getUrl: () => 'https://drive.google.com/drive/folders/abc',
    getFiles: () => {
      const live = files.filter((f) => !f.trashed);
      let i = 0;
      return { hasNext: () => i < live.length, next: () => live[i++] };
    },
  };
  let folderCreated = false;
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    Utilities: { getUuid: () => 'chave-123' },
    DriveApp: {
      getFoldersByName: () => ({ hasNext: () => folderCreated, next: () => folder }),
      createFolder: () => ((folderCreated = true), folder),
    },
    MailApp: { sendEmail: (m) => mails.push(m) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'cabralf@gmail.com' }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ body: JSON.parse(t) }) }) },
    Logger: { log: () => {} },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  const post = (data) => ctx.doPost({ postData: { contents: JSON.stringify(data) } }).body;
  return { ctx, files, mails, post };
}

const payload = (over = {}) => ({ token: 'chave-123', filename: 'presenca-copia-2026-11-06', json: '{"format":"presenca-backup"}', csv: 'data;situacao', summary: 'Resumo', email: true, ...over });

test('sem configurar ou com chave errada: recusa', () => {
  const { ctx, post, files } = sandbox();
  assert.equal(post(payload()).ok, false); // ainda sem chave
  ctx.configurar();
  const r = post(payload({ token: 'outra' }));
  assert.equal(r.ok, false);
  assert.match(r.error, /Chave secreta inválida/);
  assert.equal(files.length, 0);
});

test('cópia válida: grava .json e .csv no Drive e envia e-mail com anexos', () => {
  const { ctx, post, files, mails } = sandbox();
  assert.equal(ctx.configurar(), 'chave-123');
  const r = post(payload());
  assert.equal(r.ok, true);
  assert.equal(r.emailed, true);
  assert.deepEqual(files.map((f) => f.name), ['presenca-copia-2026-11-06.json', 'presenca-copia-2026-11-06.csv']);
  assert.equal(mails[0].to, 'cabralf@gmail.com');
  assert.equal(mails[0].attachments.length, 2);
  assert.match(mails[0].body, /Resumo[\s\S]*drive\.google\.com/);
});

test('sem e-mail quando desligado; nome de arquivo higienizado', () => {
  const { ctx, post, files, mails } = sandbox();
  ctx.configurar();
  const r = post(payload({ email: false, filename: '../../x y' }));
  assert.equal(r.ok, true);
  assert.equal(mails.length, 0);
  assert.ok(files.every((f) => !f.name.includes('/') && !f.name.includes(' ')));
});

test('guarda só as 60 cópias mais recentes', () => {
  const { ctx, post, files } = sandbox();
  ctx.configurar();
  for (let i = 0; i < 65; i++) post(payload({ email: false, filename: `presenca-copia-${i}` }));
  const live = files.filter((f) => !f.trashed);
  assert.equal(live.length, 120);
  assert.ok(files.find((f) => f.name === 'presenca-copia-0.json').trashed, 'a mais antiga foi para o lixo');
});
