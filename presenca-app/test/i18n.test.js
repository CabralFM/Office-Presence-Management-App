// Cobertura das traduções: todas as línguas têm as mesmas chaves e os mesmos
// marcadores {nome} que o pt-BR (idioma de referência).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ptBR from '../src/core/locales/pt-BR.js';
import { DICTIONARIES, LANGUAGES, setLocale, t, periodLabel } from '../src/core/i18n.js';
import { periodOf } from '../src/core/dates.js';

const placeholders = (v) => {
  const texts = typeof v === 'object' ? Object.values(v) : [v];
  return [...new Set(texts.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();
};
const tags = (v) => (typeof v === 'object' ? Object.values(v) : [v]).map((s) => (s.match(/<\/?[a-z]+/g) || []).sort().join());

for (const { code } of LANGUAGES) {
  test(`${code}: mesmas chaves e marcadores do pt-BR`, () => {
    const d = DICTIONARIES[code];
    const missing = Object.keys(ptBR).filter((k) => !(k in d));
    const extra = Object.keys(d).filter((k) => !(k in ptBR));
    assert.deepEqual(missing, [], `faltam chaves em ${code}`);
    assert.deepEqual(extra, [], `chaves a mais em ${code}`);
    for (const k of Object.keys(ptBR)) {
      assert.ok(typeof d[k] === 'string' ? d[k].trim() : Object.keys(d[k]).length, `${code} ${k}: vazio`);
      // Plurais podem virar texto simples (ex.: chinês) e vice-versa, mas os marcadores
      // usados têm de existir no original (um {n} a menos é aceitável, a mais não).
      const extraPh = placeholders(d[k]).filter((p) => !placeholders(ptBR[k]).includes(p));
      assert.deepEqual(extraPh, [], `${code} ${k}: marcador desconhecido`);
      const missingPh = placeholders(ptBR[k]).filter((p) => p !== 'n' && !placeholders(d[k]).includes(p));
      assert.deepEqual(missingPh, [], `${code} ${k}: marcador em falta`);
      if (k.match(/\.(hint|privacy|creditOsm|creditHolidays|osm)$|^plan\.hint/)) assert.equal(tags(d[k])[0].includes('<a') , tags(ptBR[k])[0].includes('<a'), `${code} ${k}: links`);
    }
  });
}

test('t(): plural, interpolação e períodos em vários idiomas', () => {
  setLocale('en');
  assert.equal(t('abs.days', { n: 1 }), '1 day');
  assert.equal(t('abs.days', { n: 3 }), '3 days');
  assert.equal(periodLabel(periodOf('2026-11-18', 'semester')), 'H2 2026');
  setLocale('pt-PT');
  assert.equal(t('tab.planning'), 'Planeamento');
  assert.equal(t('tab.dashboard'), 'Painel'); // herdado do pt-BR
  setLocale('pt-BR');
  assert.equal(periodLabel(periodOf('2026-11-18', 'quarter')), '4º trimestre de 2026');
});
