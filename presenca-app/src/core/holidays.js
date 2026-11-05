// Feriados nacionais (calculados), pontos facultativos opcionais e feriados
// locais (municipais / estaduais / da empresa) configurados pelo usuário.
//
// Decisão: os feriados nacionais são *calculados* (datas fixas + móveis a
// partir da Páscoa) em vez de consultados numa API externa. Vantagens:
//  - funciona offline e não depende de um serviço de terceiros estar no ar;
//  - dá para projetar semestres futuros (planejamento) sem chamadas de rede.
// Feriados municipais variam por cidade e às vezes por decreto do ano, por isso
// são uma lista editável (com alguns modelos de cidades para começar).

import { addDays, easterSunday, isoFromParts } from './dates.js';

export const COUNTRIES = {
  BR: { name: 'Brasil', timezone: 'America/Sao_Paulo' },
  PT: { name: 'Portugal', timezone: 'Europe/Lisbon' },
};

/** Pontos facultativos que muitas empresas concedem — o usuário liga/desliga. */
export const OPTIONAL_HOLIDAYS = {
  BR: [
    { key: 'carnaval', name: 'Carnaval (segunda e terça)' },
    { key: 'corpusChristi', name: 'Corpus Christi' },
    { key: 'vesperaNatal', name: 'Véspera de Natal (24/12)' },
    { key: 'vesperaAnoNovo', name: 'Véspera de Ano Novo (31/12)' },
  ],
  PT: [
    { key: 'carnaval', name: 'Carnaval (terça-feira)' },
    { key: 'vesperaNatal', name: 'Véspera de Natal (24/12)' },
    { key: 'vesperaAnoNovo', name: 'Véspera de Ano Novo (31/12)' },
  ],
};

export const DEFAULT_OPTIONAL = { carnaval: true, corpusChristi: true, vesperaNatal: false, vesperaAnoNovo: false };

function fixed(year, month, day, name, type = 'nacional') {
  return { date: isoFromParts(year, month, day), name, type };
}

export function nationalHolidays(country, year, optional = DEFAULT_OPTIONAL) {
  const easter = easterSunday(year);
  const rel = (n, name, type = 'nacional') => ({ date: addDays(easter, n), name, type });
  const list = [];

  if (country === 'PT') {
    list.push(
      fixed(year, 1, 1, 'Ano Novo'),
      rel(-2, 'Sexta-feira Santa'),
      rel(0, 'Domingo de Páscoa'),
      fixed(year, 4, 25, 'Dia da Liberdade'),
      fixed(year, 5, 1, 'Dia do Trabalhador'),
      rel(60, 'Corpo de Deus'),
      fixed(year, 6, 10, 'Dia de Portugal'),
      fixed(year, 8, 15, 'Assunção de Nossa Senhora'),
      fixed(year, 10, 5, 'Implantação da República'),
      fixed(year, 11, 1, 'Dia de Todos os Santos'),
      fixed(year, 12, 1, 'Restauração da Independência'),
      fixed(year, 12, 8, 'Imaculada Conceição'),
      fixed(year, 12, 25, 'Natal'),
    );
    if (optional.carnaval) list.push(rel(-47, 'Carnaval', 'facultativo'));
  } else {
    // Brasil (Lei 662/1949, Lei 6.802/1980, Lei 14.759/2023 — Consciência Negra desde 2024)
    list.push(
      fixed(year, 1, 1, 'Confraternização Universal'),
      rel(-2, 'Sexta-feira Santa'),
      fixed(year, 4, 21, 'Tiradentes'),
      fixed(year, 5, 1, 'Dia do Trabalho'),
      fixed(year, 9, 7, 'Independência do Brasil'),
      fixed(year, 10, 12, 'Nossa Senhora Aparecida'),
      fixed(year, 11, 2, 'Finados'),
      fixed(year, 11, 15, 'Proclamação da República'),
      fixed(year, 12, 25, 'Natal'),
    );
    if (year >= 2024) list.push(fixed(year, 11, 20, 'Dia Nacional de Zumbi e da Consciência Negra'));
    if (optional.carnaval) {
      list.push(rel(-48, 'Carnaval (segunda)', 'facultativo'), rel(-47, 'Carnaval (terça)', 'facultativo'));
    }
    if (optional.corpusChristi) list.push(rel(60, 'Corpus Christi', 'facultativo'));
  }
  if (optional.vesperaNatal) list.push(fixed(year, 12, 24, 'Véspera de Natal', 'facultativo'));
  if (optional.vesperaAnoNovo) list.push(fixed(year, 12, 31, 'Véspera de Ano Novo', 'facultativo'));
  return list;
}

/**
 * Feriado configurado pelo usuário.
 *  - recorrente: date = "MM-DD" (ex.: "01-25" aniversário de São Paulo)
 *  - pontual:    date = "YYYY-MM-DD" (ex.: ponte decretada pela prefeitura)
 */
export function expandCustomHolidays(custom = [], year) {
  const out = [];
  for (const h of custom) {
    if (/^\d{2}-\d{2}$/.test(h.date)) {
      const [m, d] = h.date.split('-').map(Number);
      out.push({ date: isoFromParts(year, m, d), name: h.name, type: h.scope || 'municipal' });
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(h.date) && h.date.startsWith(String(year))) {
      out.push({ date: h.date, name: h.name, type: h.scope || 'municipal' });
    }
  }
  return out;
}

/** Map ISO → {name, type}. Se dois feriados caem no mesmo dia, junta os nomes. */
export function holidayMap(settings, years) {
  const map = new Map();
  for (const year of years) {
    const all = [
      ...nationalHolidays(settings.country, year, settings.optionalHolidays || DEFAULT_OPTIONAL),
      ...expandCustomHolidays(settings.customHolidays, year),
    ];
    for (const h of all) {
      const prev = map.get(h.date);
      map.set(h.date, prev ? { name: `${prev.name} / ${h.name}`, type: prev.type } : { name: h.name, type: h.type });
    }
  }
  return map;
}

/**
 * Modelos de feriados locais para algumas cidades. São só um ponto de partida:
 * confirme sempre com o RH/calendário oficial da sua cidade.
 */
export const CITY_PRESETS = {
  BR: [
    {
      id: 'sao-paulo',
      name: 'São Paulo (capital)',
      holidays: [
        { date: '01-25', name: 'Aniversário de São Paulo', scope: 'municipal' },
        { date: '07-09', name: 'Revolução Constitucionalista (SP)', scope: 'estadual' },
      ],
    },
    {
      id: 'rio-de-janeiro',
      name: 'Rio de Janeiro (capital)',
      holidays: [
        { date: '01-20', name: 'São Sebastião', scope: 'municipal' },
        { date: '04-23', name: 'São Jorge (RJ)', scope: 'estadual' },
      ],
    },
    {
      id: 'belo-horizonte',
      name: 'Belo Horizonte',
      holidays: [
        { date: '08-15', name: 'Assunção de Nossa Senhora', scope: 'municipal' },
        { date: '12-08', name: 'Imaculada Conceição', scope: 'municipal' },
      ],
    },
    {
      id: 'porto-alegre',
      name: 'Porto Alegre',
      holidays: [
        { date: '02-02', name: 'Nossa Senhora dos Navegantes', scope: 'municipal' },
        { date: '09-20', name: 'Revolução Farroupilha (RS)', scope: 'estadual' },
      ],
    },
    {
      id: 'curitiba',
      name: 'Curitiba',
      holidays: [{ date: '09-08', name: 'Nossa Senhora da Luz dos Pinhais', scope: 'municipal' }],
    },
  ],
  PT: [
    { id: 'lisboa', name: 'Lisboa', holidays: [{ date: '06-13', name: 'Santo António', scope: 'municipal' }] },
    { id: 'porto', name: 'Porto', holidays: [{ date: '06-24', name: 'São João', scope: 'municipal' }] },
    { id: 'braga', name: 'Braga', holidays: [{ date: '06-24', name: 'São João', scope: 'municipal' }] },
    { id: 'coimbra', name: 'Coimbra', holidays: [{ date: '07-04', name: 'Rainha Santa Isabel', scope: 'municipal' }] },
    { id: 'faro', name: 'Faro', holidays: [{ date: '09-07', name: 'Dia do Município', scope: 'municipal' }] },
  ],
};
