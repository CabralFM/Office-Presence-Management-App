import { test } from 'node:test';
import assert from 'node:assert/strict';
import { easterSunday } from '../src/core/dates.js';
import { holidayMap, nationalHolidays } from '../src/core/holidays.js';

test('Páscoa em anos conhecidos', () => {
  assert.equal(easterSunday(2024), '2024-03-31');
  assert.equal(easterSunday(2025), '2025-04-20');
  assert.equal(easterSunday(2026), '2026-04-05');
  assert.equal(easterSunday(2027), '2027-03-28');
});

test('Brasil 2026: feriados móveis e Consciência Negra', () => {
  const dates = Object.fromEntries(nationalHolidays('BR', 2026).map((h) => [h.date, h.name]));
  assert.equal(dates['2026-02-16'], 'Carnaval (segunda)');
  assert.equal(dates['2026-02-17'], 'Carnaval (terça)');
  assert.equal(dates['2026-04-03'], 'Sexta-feira Santa');
  assert.equal(dates['2026-06-04'], 'Corpus Christi');
  assert.match(dates['2026-11-20'], /Consciência Negra/);
});

test('Pontos facultativos podem ser desligados', () => {
  const list = nationalHolidays('BR', 2026, { carnaval: false, corpusChristi: false });
  assert.ok(!list.some((h) => h.type === 'facultativo'));
});

test('Portugal 2026: Corpo de Deus é feriado nacional', () => {
  const dates = Object.fromEntries(nationalHolidays('PT', 2026).map((h) => [h.date, h]));
  assert.equal(dates['2026-06-04'].type, 'nacional');
  assert.equal(dates['2026-04-25'].name, 'Dia da Liberdade');
});

test('Feriados municipais recorrentes e pontuais', () => {
  const map = holidayMap(
    {
      country: 'BR',
      customHolidays: [
        { date: '01-25', name: 'Aniversário de SP', scope: 'municipal' },
        { date: '2026-11-21', name: 'Ponte decretada', scope: 'empresa' },
        { date: '2025-12-26', name: 'Outro ano', scope: 'empresa' },
      ],
    },
    [2026],
  );
  assert.equal(map.get('2026-01-25').type, 'municipal');
  assert.equal(map.get('2026-11-21').name, 'Ponte decretada');
  assert.ok(!map.has('2025-12-26'));
});
