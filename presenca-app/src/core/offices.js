// Escritórios, viagens de trabalho e "que calendário de feriados vale em cada dia".
//
// Regra adotada (conforme pedido): os feriados seguem o LOCAL DE TRABALHO,
// não o local onde você mora.
//   - Mora em Almada (feriado municipal 24/06) e trabalha em Lisboa (13/06):
//     13/06 é feriado para você — mesmo num dia de home office em Almada —
//     e 24/06 é dia útil normal.
//   - Numa viagem ao escritório de Madrid de 08 a 12/06, o 10/06 (Dia de
//     Portugal) é dia útil (você está trabalhando em Madrid) e qualquer feriado
//     de Madrid nesse período deixa de ser dia útil.
//
// Precedência para decidir o escritório de um dia:
//   1. o escritório registrado nesse dia (você disse "estive no escritório X");
//   2. uma viagem de trabalho que cubra a data;
//   3. o escritório principal.

import { holidayMap, COUNTRIES, DEFAULT_OPTIONAL } from './holidays.js';
import { eachDay } from './dates.js';

export const DEFAULT_OFFICE = {
  id: 'principal',
  name: 'Escritório principal',
  country: 'BR',
  region: '',
  city: '', // id do modelo de cidade (feriado municipal), ex.: 'lisboa'
  timezone: COUNTRIES.BR.timezone,
  location: null, // { lat, lng, label }
  radiusM: 200,
  optionalHolidays: { ...DEFAULT_OPTIONAL },
  customHolidays: [],
};

/**
 * Converte configurações antigas (um único país/fuso/feriados no topo) para o
 * modelo com escritórios. Assim quem já usava a app não perde nada.
 */
export function normalizeSettings(s) {
  const out = { ...s };
  if (!Array.isArray(out.offices) || out.offices.length === 0) {
    out.offices = [
      {
        ...DEFAULT_OFFICE,
        country: s.country || DEFAULT_OFFICE.country,
        timezone: s.timezone || COUNTRIES[s.country || 'BR']?.timezone || DEFAULT_OFFICE.timezone,
        optionalHolidays: s.optionalHolidays || DEFAULT_OFFICE.optionalHolidays,
        customHolidays: s.customHolidays || [],
        location: s.location?.office || null,
        radiusM: s.location?.radiusM || DEFAULT_OFFICE.radiusM,
      },
    ];
  }
  out.offices = out.offices.map((o) => ({ ...DEFAULT_OFFICE, ...o }));
  if (!out.offices.some((o) => o.id === out.primaryOfficeId)) out.primaryOfficeId = out.offices[0].id;
  out.trips = Array.isArray(out.trips) ? out.trips : [];
  for (const k of ['country', 'timezone', 'optionalHolidays', 'customHolidays']) delete out[k];
  if (out.location) {
    const { office, radiusM, ...rest } = out.location;
    out.location = rest;
  }
  return out;
}

export function officeById(settings, id) {
  return settings.offices.find((o) => o.id === id) || null;
}

export function primaryOffice(settings) {
  return officeById(settings, settings.primaryOfficeId) || settings.offices[0];
}

export function tripForDay(settings, date) {
  return settings.trips.find((t) => t.start <= date && date <= t.end && officeById(settings, t.officeId)) || null;
}

/** Escritório "previsto" para o dia (antes de você responder). */
export function expectedOffice(settings, date) {
  const trip = tripForDay(settings, date);
  return (trip && officeById(settings, trip.officeId)) || primaryOffice(settings);
}

/** Escritório cujo calendário vale para o dia, considerando o que foi registrado. */
export function officeForDay(settings, date, rec) {
  return (rec?.officeId && officeById(settings, rec.officeId)) || expectedOffice(settings, date);
}

/**
 * Map ISO → {name, type, officeId, officeName}: para cada dia do intervalo,
 * os feriados do escritório que vale nesse dia.
 */
export function buildHolidayMap(settings, start, end, days = new Map()) {
  const perOffice = new Map(); // cache: officeId → Map de feriados
  const years = [Number(start.slice(0, 4)), Number(end.slice(0, 4))];
  const calendarOf = (office) => {
    if (!perOffice.has(office.id)) perOffice.set(office.id, holidayMap(office, [...new Set(years)]));
    return perOffice.get(office.id);
  };
  const out = new Map();
  for (const date of eachDay(start, end)) {
    const office = officeForDay(settings, date, days.get(date));
    const h = calendarOf(office).get(date);
    if (h) out.set(date, { ...h, officeId: office.id, officeName: office.name });
  }
  return out;
}
