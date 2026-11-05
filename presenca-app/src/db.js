// Persistência em SQLite usando o módulo nativo do Node (node:sqlite).
// Decisão: SQLite num único arquivo (data/presenca.db) é ideal para uma app
// pessoal — zero configuração, backup = copiar o arquivo, e aguenta anos de
// registros (são ~250 linhas por ano) sem esforço.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeSettings } from './core/offices.js';

export const DEFAULT_SETTINGS = {
  // Escritórios (cada um com país, região, fuso, feriados e localização).
  // Vazio aqui → normalizeSettings() cria o "Escritório principal".
  offices: [],
  primaryOfficeId: null,
  // Viagens de trabalho: [{ id, officeId, start, end, note }]
  trips: [],
  // Regra mãe: officePct dos dias trabalháveis. O teto absoluto de dias em casa
  // é opcional (enforceHomeCap) — ver src/core/compliance.js.
  rules: { officePct: 50, maxHomeDays: 60, enforceHomeCap: false },
  reminder: {
    enabled: true,
    time: '09:00',
    repeatMinutes: 30, // repete a cada 30 min até você responder…
    until: '18:00', //    …ou até esta hora
    weekdays: [1, 2, 3, 4, 5],
  },
  location: {
    enabled: false,
    windowStart: '09:00',
    windowEnd: '10:30',
  },
  // Perguntar quando o fuso do aparelho não bate com o do escritório previsto
  askOnTimezoneChange: true,
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
    upsertDay(date, { status, plan, source, note, distance, officeId, absenceType, justification, absenceId }) {
      if (status != null && !VALID_STATUS.has(status)) throw new Error('status inválido');
      if (plan != null && !VALID_STATUS.has(plan)) throw new Error('plan inválido');
      const prev = repo.getDay(date) || {};
      const next = {
        status: status === undefined ? prev.status ?? null : status,
        plan: plan === undefined ? prev.plan ?? null : plan,
        source: source === undefined ? prev.source ?? null : source,
        note: note === undefined ? prev.note ?? null : note,
        distance: distance === undefined ? prev.distance ?? null : distance,
        officeId: officeId === undefined ? prev.officeId ?? null : officeId,
        absenceType: absenceType === undefined ? prev.absenceType ?? null : absenceType,
        justification: justification === undefined ? prev.justification ?? null : justification,
        absenceId: absenceId === undefined ? prev.absenceId ?? null : absenceId,
      };
      // O escritório só faz sentido em dias de escritório; tipo/justificação só em ausências.
      if (next.status !== 'office') next.officeId = null;
      if (next.status !== 'absence' && next.plan !== 'absence') {
        next.absenceType = next.justification = next.absenceId = null;
      }
      if (!next.status && !next.plan && !next.note) {
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

    /**
     * Períodos de ausência no intervalo, agrupados (dias com o mesmo absence_id;
     * registros antigos sem id viram períodos de 1 dia).
     */
    listAbsences(start, end) {
      const rows = db
        .prepare(`SELECT date, absence_type, justification, absence_id FROM days
                  WHERE date BETWEEN ? AND ? AND (status = 'absence' OR (status IS NULL AND plan = 'absence')) ORDER BY date`)
        .all(start, end);
      const groups = new Map();
      for (const r of rows) {
        const id = r.absence_id || `dia-${r.date}`;
        if (!groups.has(id)) groups.set(id, { id, type: r.absence_type || 'nao_especificado', justification: r.justification || '', start: r.date, end: r.date, days: 0 });
        const g = groups.get(id);
        g.end = r.date;
        g.days++;
      }
      return [...groups.values()];
    },

    /** Remove um período de ausência (os dias voltam a "sem registro"). */
    deleteAbsence(id) {
      const rows = id.startsWith('dia-')
        ? db.prepare(`SELECT date FROM days WHERE date = ? AND absence_id IS NULL`).all(id.slice(4))
        : db.prepare('SELECT date FROM days WHERE absence_id = ?').all(id);
      for (const { date } of rows) {
        const prev = repo.getDay(date);
        repo.upsertDay(date, { status: prev.status === 'absence' ? null : prev.status, plan: prev.plan === 'absence' ? null : prev.plan });
      }
      return rows.length;
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
