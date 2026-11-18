// Idiomas da app. Partilhado entre o navegador e o servidor (sem dependências).
//
// Decisão: chaves curtas (ex.: 'today.where') com dicionários por idioma, em vez
// de usar o texto português como chave. Assim cada tradução só guarda os valores
// e um teste (test/i18n.test.js) garante que nenhuma chave falta em nenhum idioma.
//
// - Plurais: um valor pode ser { one, other } (ou zero/two/few/many para o árabe);
//   escolhe-se com Intl.PluralRules a partir de params.n.
// - Datas e nomes de meses/dias vêm do Intl (já traduzidos pelo navegador).
// - Árabe: escrita da direita para a esquerda (dir="rtl").

import ptBR from './locales/pt-BR.js';
import ptPT from './locales/pt-PT.js';
import en from './locales/en.js';
import es from './locales/es.js';
import fr from './locales/fr.js';
import de from './locales/de.js';
import zh from './locales/zh.js';
import ar from './locales/ar.js';

export const LANGUAGES = [
  { code: 'pt-PT', name: 'Português (Portugal)', intl: 'pt-PT' },
  { code: 'pt-BR', name: 'Português (Brasil)', intl: 'pt-BR' },
  { code: 'en', name: 'English', intl: 'en-GB' },
  { code: 'es', name: 'Español', intl: 'es-ES' },
  { code: 'fr', name: 'Français', intl: 'fr-FR' },
  { code: 'de', name: 'Deutsch', intl: 'de-DE' },
  { code: 'zh', name: '中文（简体）', intl: 'zh-CN' },
  // -u-nu-latn: algarismos 0–9 (iguais aos do resto da app e das datas)
  { code: 'ar', name: 'العربية', intl: 'ar-u-nu-latn', rtl: true },
];

// pt-PT só guarda o que difere do pt-BR (registo, telemóvel…).
export const DICTIONARIES = { 'pt-BR': ptBR, 'pt-PT': { ...ptBR, ...ptPT }, en, es, fr, de, zh, ar };

let current = 'pt-BR';

export function setLocale(code) {
  if (DICTIONARIES[code]) current = code;
  return current;
}
export const getLocale = () => current;
const meta = () => LANGUAGES.find((l) => l.code === current) || LANGUAGES[1];
export const intlLocale = () => meta().intl;
export const isRtl = () => Boolean(meta().rtl);
/** Código de 2 letras para bibliotecas (ex.: nomes de feriados). */
export const shortLang = () => current.slice(0, 2);

/** Idioma a partir das preferências do navegador; sem correspondência → inglês. */
export function detectLocale(prefs = []) {
  for (const p of prefs) {
    const l = String(p).toLowerCase();
    if (l === 'pt-br') return 'pt-BR';
    if (l.startsWith('pt')) return 'pt-PT';
    const two = l.slice(0, 2);
    if (DICTIONARIES[two]) return two;
  }
  return 'en';
}

/**
 * Traduz uma chave. Parâmetros {nome} são substituídos; params.n escolhe o plural.
 * Falta no idioma atual → inglês → português (nunca mostra a chave crua se houver texto).
 */
export function t(key, params = {}) {
  let v = DICTIONARIES[current]?.[key] ?? DICTIONARIES.en[key] ?? ptBR[key];
  if (v == null) return key;
  if (typeof v === 'object') {
    let cat = 'other';
    try {
      cat = new Intl.PluralRules(intlLocale()).select(Number(params.n ?? 0));
    } catch {}
    v = v[cat] ?? v.other;
  }
  return v.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined ? m : String(params[k])));
}

// ---- formatação (datas sem fuso: "AAAA-MM-DD" é um dia de calendário) ----------
const asDate = (iso) => new Date(`${iso}T12:00:00Z`);
export function fmtDate(iso, opts) {
  try {
    return asDate(iso).toLocaleDateString(intlLocale(), { timeZone: 'UTC', ...opts });
  } catch {
    return iso;
  }
}
/** "02/11" (pt), "02/11" (en-GB), "02.11." (de), "11/02" (zh)… */
export const fmtDayMonth = (iso) => fmtDate(iso, { day: '2-digit', month: '2-digit' });
export const fmtFull = (iso) => fmtDate(iso, { day: '2-digit', month: '2-digit', year: 'numeric' });
export const fmtLong = (iso) => fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long' });
/** Nome do dia da semana (0 = domingo). */
// 01/11/2026 é domingo. Algumas línguas (ex.: pt-PT) devolvem o nome inteiro em
// "short" ("sábado"): corta-se em 3 letras para caber nas grelhas a 320 px.
export const weekdayShort = (wd) => {
  const s = fmtDate(`2026-11-${String(1 + wd).padStart(2, '0')}`, { weekday: 'short' }).replace(/\.$/, '');
  return /^[a-zà-ÿ-]{5,}$/i.test(s) ? s.slice(0, 3) : s;
};
export const monthLong = (m) => fmtDate(`2026-${String(m).padStart(2, '0')}-15`, { month: 'long' });
export const monthYear = (iso) => fmtDate(iso, { month: 'long', year: 'numeric' });

/** Nome de um período no idioma atual: "novembro de 2026", "4.º trimestre de 2026"… */
export function periodLabel(p) {
  if (!p) return '';
  if (p.kind === 'month') {
    const s = monthYear(p.start);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return t(`period.${p.kind}`, { n: p.n, year: p.year });
}
