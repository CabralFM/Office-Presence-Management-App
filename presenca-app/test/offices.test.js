// Cenário real: mora em Almada, trabalha em Lisboa, viaja ao escritório de Madrid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHolidayMap, expectedOffice, normalizeSettings, officeForDay } from '../src/core/offices.js';
import { computeSemester } from '../src/core/compliance.js';
import { semester } from '../src/core/dates.js';
import { nearestOffice } from '../src/core/geo.js';

const lisboa = {
  id: 'lx',
  name: 'Lisboa',
  country: 'PT',
  timezone: 'Europe/Lisbon',
  customHolidays: [{ date: '06-13', name: 'Santo António', scope: 'municipal' }],
  location: { lat: 38.7223, lng: -9.1393 },
  radiusM: 200,
};
const madrid = {
  id: 'mad',
  name: 'Madrid',
  country: 'ES',
  region: 'MD',
  timezone: 'Europe/Madrid',
  customHolidays: [{ date: '05-15', name: 'San Isidro', scope: 'municipal' }],
  location: { lat: 40.4168, lng: -3.7038 },
  radiusM: 200,
};
const settings = (trips = []) => normalizeSettings({ offices: [lisboa, madrid], primaryOfficeId: 'lx', trips });

test('feriado segue o local de trabalho: 13/06 (Lisboa) sim, 24/06 (Almada) não', () => {
  const map = buildHolidayMap(settings(), '2026-06-01', '2026-06-30');
  assert.equal(map.get('2026-06-13')?.name, 'Santo António'); // sábado em 2026, mas está no calendário
  assert.equal(map.get('2026-06-10')?.name, 'Dia de Portugal');
  assert.ok(!map.has('2026-06-24'), '24/06 (São João, Almada) não é feriado para quem trabalha em Lisboa');
});

test('viagem a Madrid: valem os feriados de Madrid e NÃO os de Portugal nesses dias', () => {
  const s = settings([{ id: 't1', officeId: 'mad', start: '2026-06-08', end: '2026-06-12' }]);
  const map = buildHolidayMap(s, '2026-05-01', '2026-06-30');
  assert.ok(!map.has('2026-06-10'), '10/06 (Dia de Portugal) é dia útil em Madrid');
  assert.equal(expectedOffice(s, '2026-06-10').id, 'mad');
  // Fora da viagem, de volta ao calendário de Lisboa
  assert.ok(!map.has('2026-05-15'), 'San Isidro não conta sem viagem');
  assert.equal(map.get('2026-06-04')?.name, 'Corpo de Deus');
});

test('feriados da Comunidade de Madrid aplicam-se durante a viagem', () => {
  const s = settings([{ id: 't1', officeId: 'mad', start: '2026-05-11', end: '2026-05-15' }]);
  const map = buildHolidayMap(s, '2026-05-01', '2026-05-31');
  assert.equal(map.get('2026-05-15')?.officeName, 'Madrid'); // San Isidro (municipal de Madrid)
  assert.ok(!map.has('2026-05-18'), 'segunda seguinte, já de volta a Lisboa, é dia útil');
});

test('registrar "estive no escritório de Madrid" sem viagem muda o calendário desse dia', () => {
  const s = settings();
  const days = new Map([['2026-06-10', { status: 'office', officeId: 'mad' }]]);
  assert.equal(officeForDay(s, '2026-06-10', days.get('2026-06-10')).id, 'mad');
  const map = buildHolidayMap(s, '2026-06-01', '2026-06-30', days);
  assert.ok(!map.has('2026-06-10'));
});

test('dias úteis de uma viagem futura contam como "planejado escritório"', () => {
  const s = settings([{ id: 't1', officeId: 'mad', start: '2026-09-14', end: '2026-09-18' }]);
  const sem = semester(2026, 2);
  const holidays = buildHolidayMap(s, sem.start, sem.end);
  const r = computeSemester({
    semester: sem,
    today: '2026-09-01',
    days: new Map(),
    holidays,
    rules: { officePct: 50, maxHomeDays: 60 },
    defaultPlan: (d) => (s.trips.some((t) => t.start <= d && d <= t.end) ? 'office' : null),
  });
  assert.equal(r.totals.plannedOffice, 5);
});

test('migração: configurações antigas (país único) viram um escritório principal', () => {
  const s = normalizeSettings({ country: 'PT', timezone: 'Europe/Lisbon', customHolidays: [{ date: '06-13', name: 'Santo António' }], location: { enabled: true, office: { lat: 1, lng: 2 }, radiusM: 300 } });
  assert.equal(s.offices.length, 1);
  assert.equal(s.offices[0].country, 'PT');
  assert.equal(s.offices[0].radiusM, 300);
  assert.deepEqual(s.offices[0].location, { lat: 1, lng: 2 });
  assert.equal(s.primaryOfficeId, s.offices[0].id);
  assert.equal(s.country, undefined);
  assert.equal(s.location.office, undefined);
});

test('localização reconhece em que escritório você está', () => {
  const s = settings();
  const atMadrid = nearestOffice({ lat: 40.4169, lng: -3.7035, accuracy: 20 }, s.offices);
  assert.equal(atMadrid.office.id, 'mad');
  assert.equal(atMadrid.atOffice, true);
  const almada = nearestOffice({ lat: 38.6790, lng: -9.1569, accuracy: 20 }, s.offices); // casa em Almada
  assert.equal(almada.office.id, 'lx');
  assert.equal(almada.atOffice, false);
});

import { assessPosition } from '../src/core/geo.js';

test('localização: registra sozinha só quando é confiável e no escritório previsto', () => {
  const s = settings();
  const at = (dLat, accuracy) => ({ lat: 38.7223 + dLat, lng: -9.1393, accuracy });
  // Dentro do escritório de Lisboa, GPS bom → regista sozinha
  assert.equal(assessPosition(at(0.0003, 20), s.offices, 'lx').verdict, 'office');
  // Dentro do raio mas GPS impreciso (900 m) → pergunta
  assert.equal(assessPosition(at(0.0003, 900), s.offices, 'lx').verdict, 'probable');
  // A ~600 m com precisão de 900 m → pergunta (não regista sozinha)
  assert.equal(assessPosition(at(0.0054, 900), s.offices, 'lx').verdict, 'probable');
  // No escritório de Madrid quando o previsto era Lisboa → pergunta
  assert.equal(assessPosition({ lat: 40.4169, lng: -3.7035, accuracy: 15 }, s.offices, 'lx').verdict, 'probable');
  // Em casa (Almada) → longe de todos → pergunta
  const home = assessPosition({ lat: 38.679, lng: -9.1569, accuracy: 30 }, s.offices, 'lx');
  assert.equal(home.verdict, 'away');
  assert.ok(home.distance > 4000);
});
