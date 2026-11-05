// Armazenamento LOCAL (modo sem servidor): os dados ficam no próprio celular,
// no armazenamento do navegador (localStorage), com a mesma interface do
// db.js do servidor — por isso core/api.js funciona igual nos dois modos.
//
// Decisão: localStorage em vez de IndexedDB porque os dados são pequenos
// (~250 dias/ano ≈ 30 KB) e a API é síncrona, como a do SQLite no servidor.
// Riscos de guardar só no aparelho, e como os mitigamos:
//   - limpar os dados do navegador apaga tudo  → cópia de segurança (exportar/importar);
//   - o iPhone apaga dados de SITES não usados → instalar na Tela de Início
//     (apps instaladas ficam isentas) e pedir armazenamento persistente.

import { DEFAULT_SETTINGS, deepMerge } from './settings.js';
import { normalizeSettings } from './offices.js';
import { mergeDay, groupAbsences, absenceDates } from './days.js';

const KEY = 'presenca:v1';
export const BACKUP_FORMAT = 'presenca-backup';

/** @param {Storage} storage  window.localStorage (ou um substituto nos testes) */
export function createLocalRepo(storage) {
  let cache = null;
  const load = () => {
    if (cache) return cache;
    try {
      cache = JSON.parse(storage.getItem(KEY) || 'null');
    } catch {
      cache = null;
    }
    if (!cache || typeof cache !== 'object') cache = { settings: {}, days: {} };
    cache.days ||= {};
    cache.settings ||= {};
    return cache;
  };
  const save = () => storage.setItem(KEY, JSON.stringify(cache));
  const sortedEntries = (start = '0000-01-01', end = '9999-12-31') =>
    Object.entries(load().days)
      .filter(([d]) => d >= start && d <= end)
      .sort(([a], [b]) => a.localeCompare(b));

  const repo = {
    getSettings() {
      return normalizeSettings(deepMerge(DEFAULT_SETTINGS, load().settings));
    },
    updateSettings(patch) {
      const next = deepMerge(repo.getSettings(), patch);
      load().settings = next;
      save();
      return next;
    },
    getDays(start, end) {
      return new Map(sortedEntries(start, end).map(([d, r]) => [d, { ...r }]));
    },
    getDay(date) {
      const r = load().days[date];
      return r ? { ...r } : null;
    },
    upsertDay(date, patch) {
      const next = mergeDay(repo.getDay(date), patch);
      if (next) load().days[date] = next;
      else delete load().days[date];
      save();
      return next;
    },
    listAbsences(start, end) {
      return groupAbsences(sortedEntries(start, end));
    },
    deleteAbsence(id) {
      const dates = absenceDates(sortedEntries(), id);
      for (const date of dates) {
        const prev = repo.getDay(date);
        repo.upsertDay(date, { status: prev.status === 'absence' ? null : prev.status, plan: prev.plan === 'absence' ? null : prev.plan });
      }
      return dates.length;
    },
    allDays() {
      return sortedEntries().map(([date, r]) => ({ date, ...r }));
    },

    // ---- cópia de segurança --------------------------------------------------
    exportBackup() {
      return { format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), settings: load().settings, days: load().days };
    },
    /** Substitui todos os dados pelos da cópia. Valida antes de tocar em nada. */
    importBackup(data) {
      if (!data || data.format !== BACKUP_FORMAT || typeof data.days !== 'object' || typeof data.settings !== 'object') {
        throw new Error('Arquivo inválido: não é uma cópia de segurança da app Presença.');
      }
      const days = {};
      for (const [d, r] of Object.entries(data.days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Data inválida na cópia: ${d}`);
        const clean = mergeDay(null, r || {}); // reaplica as regras de validação
        if (clean) days[d] = clean;
      }
      cache = { settings: data.settings, days };
      save();
      return Object.keys(days).length;
    },
  };
  return repo;
}
