// Persistência em SQLite usando o módulo nativo do Node (node:sqlite).
// Decisão: SQLite num único arquivo (data/presenca.db) é ideal para uma app
// pessoal — zero configuração, backup = copiar o arquivo, e aguenta anos de
// registros (são ~250 linhas por ano) sem esforço.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { COUNTRIES, DEFAULT_OPTIONAL } from './core/holidays.js';

export const DEFAULT_SETTINGS = {
  country: 'BR',
  timezone: COUNTRIES.BR.timezone,
  optionalHolidays: { ...DEFAULT_OPTIONAL },
  customHolidays: [],
  rules: { officePct: 50, maxHomeDays: 60 },
  reminder: {
    enabled: true,
    time: '09:00',
    repeatMinutes: 30, // repete a cada 30 min até você responder…
    until: '18:00', //    …ou até esta hora
    weekdays: [1, 2, 3, 4, 5],
  },
  location: {
    enabled: false,
    office: null, // { lat, lng, label }
    radiusM: 200,
    windowStart: '09:00',
    windowEnd: '10:30',
  },
  summaries: { weekly: true, monthly: true },
};

const VALID_STATUS = new Set(['office', 'home', 'absence']);

function deepMerge(base, patch) {
  if (patch === undefined) return base;
  if (Array.isArray(base) || Array.isArray(patch) || typeof base !== 'object' || base === null || patch === null) return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS days (
      date        TEXT PRIMARY KEY,           -- YYYY-MM-DD
      status      TEXT CHECK (status IN ('office','home','absence')),
      plan        TEXT CHECK (plan   IN ('office','home','absence')),
      source      TEXT,                       -- manual | lembrete | localizacao
      note        TEXT,
      distance_m  INTEGER,                    -- só quando veio da localização
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscriptions (endpoint TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reminder_state (date TEXT PRIMARY KEY, last_minutes INTEGER NOT NULL, count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sent_log (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL);
  `);

  const kvGet = db.prepare('SELECT value FROM kv WHERE key = ?');
  const kvSet = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

  const repo = {
    raw: db,

    getKV(key) {
      const row = kvGet.get(key);
      return row ? JSON.parse(row.value) : undefined;
    },
    setKV(key, value) {
      kvSet.run(key, JSON.stringify(value));
    },

    getSettings() {
      return deepMerge(DEFAULT_SETTINGS, repo.getKV('settings') || {});
    },
    updateSettings(patch) {
      const next = deepMerge(repo.getSettings(), patch);
      repo.setKV('settings', next);
      return next;
    },

    /** Map ISO → {status, plan, source, note, distance} */
    getDays(start, end) {
      const rows = db.prepare('SELECT * FROM days WHERE date BETWEEN ? AND ? ORDER BY date').all(start, end);
      return new Map(rows.map((r) => [r.date, { status: r.status, plan: r.plan, source: r.source, note: r.note, distance: r.distance_m }]));
    },
    getDay(date) {
      return repo.getDays(date, date).get(date) || null;
    },

    /** Grava/atualiza um dia. Campos ausentes mantêm o valor anterior; null apaga. */
    upsertDay(date, { status, plan, source, note, distance }) {
      if (status != null && !VALID_STATUS.has(status)) throw new Error('status inválido');
      if (plan != null && !VALID_STATUS.has(plan)) throw new Error('plan inválido');
      const prev = repo.getDay(date) || {};
      const next = {
        status: status === undefined ? prev.status ?? null : status,
        plan: plan === undefined ? prev.plan ?? null : plan,
        source: source === undefined ? prev.source ?? null : source,
        note: note === undefined ? prev.note ?? null : note,
        distance: distance === undefined ? prev.distance ?? null : distance,
      };
      if (!next.status && !next.plan && !next.note) {
        db.prepare('DELETE FROM days WHERE date = ?').run(date);
        return null;
      }
      db.prepare(
        `INSERT INTO days (date, status, plan, source, note, distance_m, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET status=excluded.status, plan=excluded.plan, source=excluded.source,
           note=excluded.note, distance_m=excluded.distance_m, updated_at=excluded.updated_at`,
      ).run(date, next.status, next.plan, next.source, next.note, next.distance, new Date().toISOString());
      return next;
    },

    allDays() {
      return db.prepare('SELECT * FROM days ORDER BY date').all();
    },

    // ---- push ---------------------------------------------------------------
    addSubscription(sub) {
      db.prepare('INSERT INTO subscriptions (endpoint, data, created_at) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET data = excluded.data')
        .run(sub.endpoint, JSON.stringify(sub), new Date().toISOString());
    },
    removeSubscription(endpoint) {
      db.prepare('DELETE FROM subscriptions WHERE endpoint = ?').run(endpoint);
    },
    listSubscriptions() {
      return db.prepare('SELECT data FROM subscriptions').all().map((r) => JSON.parse(r.data));
    },

    // ---- estado dos lembretes ---------------------------------------------
    getReminderState(date) {
      const r = db.prepare('SELECT last_minutes, count FROM reminder_state WHERE date = ?').get(date);
      return r ? { lastMinutes: r.last_minutes, count: r.count } : null;
    },
    setReminderState(date, lastMinutes, count) {
      db.prepare('INSERT INTO reminder_state (date, last_minutes, count) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET last_minutes = excluded.last_minutes, count = excluded.count')
        .run(date, lastMinutes, count);
    },
    sentKeys(keys) {
      const found = new Set();
      const stmt = db.prepare('SELECT 1 FROM sent_log WHERE key = ?');
      for (const k of keys) if (stmt.get(k)) found.add(k);
      return found;
    },
    markSent(key) {
      db.prepare('INSERT OR IGNORE INTO sent_log (key, sent_at) VALUES (?, ?)').run(key, new Date().toISOString());
    },
  };
  return repo;
}
