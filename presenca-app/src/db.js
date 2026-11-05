// Persistência em SQLite usando o módulo nativo do Node (node:sqlite).
// Decisão: SQLite num único arquivo (data/presenca.db) é ideal para uma app
// pessoal — zero configuração, backup = copiar o arquivo, e aguenta anos de
// registros (são ~250 linhas por ano) sem esforço.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeSettings } from './core/offices.js';
import { DEFAULT_SETTINGS, deepMerge } from './core/settings.js';
import { mergeDay, groupAbsences, absenceDates } from './core/days.js';

export { DEFAULT_SETTINGS };

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

  // Migrações: colunas acrescentadas em versões posteriores.
  const cols = new Set(db.prepare('PRAGMA table_info(days)').all().map((c) => c.name));
  for (const [name, type] of [
    ['office_id', 'TEXT'], //      escritório em que o dia foi trabalhado
    ['absence_type', 'TEXT'], //   ferias | doenca | licenca | folga | outro
    ['justification', 'TEXT'], //  justificação da ausência
    ['absence_id', 'TEXT'], //     agrupa os dias de um mesmo período (ex.: 2 semanas de férias)
  ]) {
    if (!cols.has(name)) db.exec(`ALTER TABLE days ADD COLUMN ${name} ${type}`);
  }

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
      return normalizeSettings(deepMerge(DEFAULT_SETTINGS, repo.getKV('settings') || {}));
    },
    updateSettings(patch) {
      const next = deepMerge(repo.getSettings(), patch);
      repo.setKV('settings', next);
      return next;
    },

    /** Map ISO → {status, plan, source, note, distance} */
    getDays(start, end) {
      const rows = db.prepare('SELECT * FROM days WHERE date BETWEEN ? AND ? ORDER BY date').all(start, end);
      return new Map(
        rows.map((r) => [
          r.date,
          {
            status: r.status,
            plan: r.plan,
            source: r.source,
            note: r.note,
            distance: r.distance_m,
            officeId: r.office_id,
            absenceType: r.absence_type,
            justification: r.justification,
            absenceId: r.absence_id,
          },
        ]),
      );
    },
    getDay(date) {
      return repo.getDays(date, date).get(date) || null;
    },

    /** Grava/atualiza um dia. Campos ausentes mantêm o valor anterior; null apaga. */
    upsertDay(date, patch) {
      const next = mergeDay(repo.getDay(date), patch);
      if (!next) {
        db.prepare('DELETE FROM days WHERE date = ?').run(date);
        return null;
      }
      db.prepare(
        `INSERT INTO days (date, status, plan, source, note, distance_m, office_id, absence_type, justification, absence_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET status=excluded.status, plan=excluded.plan, source=excluded.source,
           note=excluded.note, distance_m=excluded.distance_m, office_id=excluded.office_id,
           absence_type=excluded.absence_type, justification=excluded.justification, absence_id=excluded.absence_id,
           updated_at=excluded.updated_at`,
      ).run(
        date, next.status, next.plan, next.source, next.note, next.distance, next.officeId,
        next.absenceType, next.justification, next.absenceId, new Date().toISOString(),
      );
      return next;
    },

    /** Períodos de ausência no intervalo (ver core/days.js). */
    listAbsences(start, end) {
      return groupAbsences([...repo.getDays(start, end)]);
    },

    /** Remove um período de ausência (os dias voltam a "sem registro"). */
    deleteAbsence(id) {
      const dates = absenceDates([...repo.getDays('0000-01-01', '9999-12-31')], id);
      for (const date of dates) {
        const prev = repo.getDay(date);
        repo.upsertDay(date, { status: prev.status === 'absence' ? null : prev.status, plan: prev.plan === 'absence' ? null : prev.plan });
      }
      return dates.length;
    },

    /** Todos os dias, por ordem: [{ date, status, plan, ... }] */
    allDays() {
      return [...repo.getDays('0000-01-01', '9999-12-31')].map(([date, r]) => ({ date, ...r }));
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
