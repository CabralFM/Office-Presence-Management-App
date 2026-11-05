// A "API" da aplicação como função pura: handle(método, caminho, corpo) → {status, data}.
//
// Decisão: a mesma lógica serve dois modos:
//   - servidor (Node/Express): server.js só encaminha os pedidos HTTP para aqui;
//   - local (sem servidor, tudo no celular): o navegador chama handle() direto,
//     com os dados guardados no próprio aparelho (core/local-repo.js).
// Assim as regras (validações, ausências, viagens…) existem num só sítio e os
// dois modos comportam-se exatamente igual — os mesmos testes cobrem ambos.

import { CITY_PRESETS, holidayMap, listCountries, listRegions, optionalHolidaysFor, timezonesFor } from './holidays.js';
import { addDays, parseISO, parseSemesterId, semesterOf, toISO } from './dates.js';
import { DEFAULT_OFFICE, expectedOffice, officeById, tripForDay, buildHolidayMap } from './offices.js';
import { ABSENCE_TYPES, ABSENCE_LABEL, validateAbsence } from './absences.js';
import { holidaysFor, isWorkingDay, localNow, semesterReport } from './report.js';

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
// Formato certo E data que existe (rejeita 2026-13-01, 2026-02-30…).
const isDate = (x) => typeof x === 'string' && ISO_RE.test(x) && toISO(parseISO(x)) === x;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const newId = () => globalThis.crypto.randomUUID().slice(0, 8);
const ok = (data) => ({ status: 200, data: { ok: true, ...data } });
const fail = (status, error, extra = {}) => ({ status, data: { error, ...extra } });

/**
 * @param {object} repo      armazenamento (db.js no servidor, local-repo.js no celular)
 * @param {() => object} [extraMeta]  metadados extra para /api/state (ex.: chave push)
 * @param {() => Date} [clock]        relógio (injetável nos testes)
 */
export function createApi({ repo, extraMeta = () => ({}), clock = () => new Date() }) {
  const now = () => localNow(repo, clock());

  const routes = [
    // ---- estado completo para a tela ----------------------------------------
    ['GET', /^\/api\/state$/, (_m, _b, q) => {
      const n = now();
      const sem = parseSemesterId(q.get('semester')) || semesterOf(n.date);
      const { report, holidays, days, settings } = semesterReport(repo, sem, n.date);
      const todayRec = repo.getDay(n.date);
      const todayHolidays = holidaysFor(settings, n.date, n.date, new Map([[n.date, todayRec]]));
      return {
        status: 200,
        data: {
          now: n,
          semester: sem,
          report,
          settings,
          days: Object.fromEntries(days),
          absences: repo.listAbsences(sem.start, sem.end),
          holidays: Object.fromEntries([...holidays].filter(([d]) => d >= sem.start && d <= sem.end)),
          today: {
            date: n.date,
            record: todayRec,
            workingDay: isWorkingDay(n.date, todayHolidays),
            holiday: todayHolidays.get(n.date) || null,
            expectedOfficeId: expectedOffice(settings, n.date).id,
            trip: tripForDay(settings, n.date),
          },
          meta: { countries: countryNames(), absenceTypes: ABSENCE_TYPES, cityPresets: CITY_PRESETS, ...extraMeta() },
        },
      };
    }],

    // ---- registro de dias ----------------------------------------------------
    ['PUT', /^\/api\/days\/([^/]+)$/, ([date], body) => {
      if (!isDate(date)) return fail(400, 'Data inválida');
      const { status, plan, note, officeId, absenceType, justification } = body;
      if (officeId && !officeById(repo.getSettings(), officeId)) return fail(400, 'Escritório desconhecido');
      // Não faz sentido "registrar" presença no futuro: no futuro é planejamento.
      if (status && status !== 'absence' && date > now().date) return fail(400, 'Datas futuras só podem ser planejadas (use "plan").');
      if (status === 'absence' || plan === 'absence') {
        const err = validateAbsence({ type: absenceType, justification });
        if (err) return fail(400, err);
      }
      try {
        const day = repo.upsertDay(date, {
          status,
          plan,
          note,
          source: status !== undefined ? 'manual' : undefined,
          distance: status !== undefined ? null : undefined,
          officeId: status !== undefined ? officeId || null : undefined,
          ...(status === 'absence' || plan === 'absence'
            ? { absenceType, justification: String(justification || '').trim() || null, absenceId: newId() }
            : {}),
        });
        return ok({ day });
      } catch (e) {
        return fail(400, e.message);
      }
    }],

    /** Resposta ao lembrete (botões da notificação, check-in por localização ou tela inicial). */
    ['POST', /^\/api\/checkin$/, (_m, body) => {
      const { status, source = 'manual', distance = null, date, officeId } = body;
      // Ausências têm tipo e justificação → registram-se por POST /api/absences.
      if (!['office', 'home'].includes(status)) return fail(400, 'status inválido (para ausências use /api/absences)');
      const settings = repo.getSettings();
      if (officeId && !officeById(settings, officeId)) return fail(400, 'Escritório desconhecido');
      const today = now().date;
      // A notificação leva a data a que se refere; se responder a um lembrete de
      // ontem já depois da meia-noite, registra no dia certo (mas nunca no futuro).
      const target = isDate(date || '') && date <= today ? date : today;
      const day = repo.upsertDay(target, {
        status,
        source: ['manual', 'lembrete', 'localizacao'].includes(source) ? source : 'manual',
        distance: Number.isFinite(distance) ? Math.round(distance) : null,
        // Sem escritório indicado → o previsto (viagem ou principal).
        officeId: status === 'office' ? officeId || expectedOffice(settings, target).id : null,
      });
      return ok({ date: target, day });
    }],

    // ---- férias e ausências ----------------------------------------------------
    // Registra um período. Só os dias úteis (sem fins de semana nem feriados do
    // local de trabalho) viram ausência — são esses que saem da base dos 50%.
    ['POST', /^\/api\/absences$/, (_m, body) => {
      const { start, end, type, justification = '', overwrite = false, replaceId } = body;
      if (!isDate(start || '') || !isDate(end || '') || end < start) return fail(400, 'Datas inválidas');
      if (addDays(start, 366) < end) return fail(400, 'Período longo demais (máx. 1 ano).');
      const err = validateAbsence({ type, justification });
      if (err) return fail(400, err);

      const settings = repo.getSettings();
      const days = repo.getDays(start, end);
      const holidays = buildHolidayMap(settings, start, end, days);
      const targets = [];
      for (let d = start; d <= end; d = addDays(d, 1)) {
        const wd = new Date(d + 'T12:00:00Z').getUTCDay();
        if (wd !== 0 && wd !== 6 && !holidays.has(d)) targets.push(d);
      }
      if (!targets.length) return fail(400, 'O período não tem dias úteis (só fins de semana/feriados).');

      // Não apaga silenciosamente dias já registrados como escritório/casa.
      const conflicts = targets.filter((d) => ['office', 'home'].includes(days.get(d)?.status));
      if (conflicts.length && !overwrite) {
        return fail(409, `${conflicts.length} dia(s) já registrado(s) como escritório/casa.`, { conflicts });
      }
      if (replaceId) repo.deleteAbsence(replaceId); // edição = substitui o período anterior
      const absenceId = newId();
      const j = String(justification).trim() || null;
      for (const d of targets) {
        repo.upsertDay(d, { status: 'absence', plan: null, source: 'manual', absenceType: type, justification: j, absenceId, distance: null });
      }
      return ok({ id: absenceId, days: targets.length, label: ABSENCE_LABEL(type) });
    }],

    ['DELETE', /^\/api\/absences\/([^/]+)$/, ([id]) => ok({ removed: repo.deleteAbsence(id) })],

    // ---- escritórios -------------------------------------------------------------
    ['GET', /^\/api\/countries\/([^/]+)$/, ([code]) => {
      const c = code.toUpperCase();
      if (!countryNames()[c]) return fail(404, 'País desconhecido');
      return { status: 200, data: { regions: listRegions(c), timezones: timezonesFor(c), optional: optionalHolidaysFor(c), presets: CITY_PRESETS[c] || [] } };
    }],

    ['POST', /^\/api\/offices$/, (_m, o) => {
      const errors = validateOffice(o);
      if (errors.length) return fail(400, errors.join('; '));
      const settings = repo.getSettings();
      const existing = officeById(settings, o.id);
      const office = {
        ...DEFAULT_OFFICE,
        ...(existing || {}),
        ...pick(o, ['name', 'country', 'region', 'regionName', 'city', 'timezone', 'location', 'radiusM', 'optionalHolidays', 'customHolidays']),
        id: existing ? o.id : newId(),
      };
      if (!office.timezone) office.timezone = timezonesFor(office.country)[0] || 'UTC';
      const offices = existing ? settings.offices.map((x) => (x.id === office.id ? office : x)) : [...settings.offices, office];
      const patch = { offices };
      if (o.primary) patch.primaryOfficeId = office.id;
      repo.updateSettings(patch);
      return ok({ office });
    }],

    /**
     * Todos os feriados de um escritório num ano (nacionais, regionais,
     * facultativos ligados, municipais e da empresa) — para o diálogo do
     * escritório mostrar a lista completa ANTES de salvar.
     */
    ['POST', /^\/api\/holidays\/preview$/, (_m, o) => {
      if (!countryNames()[o.country]) return fail(400, 'país inválido');
      const year = Number.isInteger(o.year) && o.year > 1900 && o.year < 2200 ? o.year : Number(now().date.slice(0, 4));
      const map = holidayMap(
        { country: o.country, region: o.region || '', optionalHolidays: o.optionalHolidays || {}, customHolidays: Array.isArray(o.customHolidays) ? o.customHolidays : [] },
        [year],
      );
      const holidays = [...map]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, h]) => {
          const wd = new Date(date + 'T12:00:00Z').getUTCDay();
          return { date, name: h.name, type: h.type, weekend: wd === 0 || wd === 6 };
        });
      return { status: 200, data: { year, holidays } };
    }],

    ['DELETE', /^\/api\/offices\/([^/]+)$/, ([id]) => {
      const settings = repo.getSettings();
      if (settings.offices.length <= 1) return fail(400, 'É preciso ter pelo menos um escritório.');
      if (id === settings.primaryOfficeId) return fail(400, 'Defina outro escritório como principal antes de remover este.');
      repo.updateSettings({
        offices: settings.offices.filter((o) => o.id !== id),
        trips: settings.trips.filter((t) => t.officeId !== id),
      });
      return ok({});
    }],

    // ---- viagens de trabalho -----------------------------------------------------
    // Durante a viagem: valem os feriados e o fuso do escritório de destino, e os
    // dias úteis contam como "planejado escritório".
    ['POST', /^\/api\/trips$/, (_m, { officeId, start, end, note = '' }) => {
      const settings = repo.getSettings();
      if (!officeById(settings, officeId)) return fail(400, 'Escritório desconhecido');
      if (!isDate(start || '') || !isDate(end || '') || end < start) return fail(400, 'Datas inválidas');
      if (addDays(start, 92) < end) return fail(400, 'Viagem longa demais (máx. 3 meses).');
      const clash = settings.trips.find((t) => t.start <= end && start <= t.end);
      if (clash) return fail(400, `Conflita com outra viagem (${clash.start} a ${clash.end}).`);
      const trip = { id: newId(), officeId, start, end, note: String(note).slice(0, 200) };
      repo.updateSettings({ trips: [...settings.trips, trip].sort((a, b) => a.start.localeCompare(b.start)) });
      return ok({ trip });
    }],

    ['DELETE', /^\/api\/trips\/([^/]+)$/, ([id]) => {
      repo.updateSettings({ trips: repo.getSettings().trips.filter((t) => t.id !== id) });
      return ok({});
    }],

    // ---- configurações -------------------------------------------------------------
    ['PUT', /^\/api\/settings$/, (_m, body) => {
      const errors = validateSettingsPatch(body);
      if (errors.length) return fail(400, errors.join('; '));
      const patch = { ...body };
      // Escritórios e viagens têm rotas próprias (com validação própria).
      delete patch.offices;
      delete patch.trips;
      if (patch.primaryOfficeId && !officeById(repo.getSettings(), patch.primaryOfficeId)) return fail(400, 'Escritório desconhecido');
      return ok({ settings: repo.updateSettings(patch) });
    }],
  ];

  /**
   * @returns {{status:number, data:object}|null} null se a rota não existir aqui
   */
  function handle(method, url, body = {}) {
    const u = new URL(url, 'http://local');
    for (const [m, re, fn] of routes) {
      if (m !== method.toUpperCase()) continue;
      const match = re.exec(u.pathname);
      if (match) return fn(match.slice(1).map(decodeURIComponent), body || {}, u.searchParams);
    }
    return null;
  }

  return { handle, now };
}

// ---- validações --------------------------------------------------------------------
export function validateSettingsPatch(p) {
  const e = [];
  if (p.rules) {
    const { officePct, maxHomeDays } = p.rules;
    if (officePct !== undefined && !(Number.isInteger(officePct) && officePct >= 0 && officePct <= 100)) e.push('percentagem deve ser 0–100');
    if (maxHomeDays !== undefined && !(Number.isInteger(maxHomeDays) && maxHomeDays >= 0 && maxHomeDays <= 200)) e.push('máximo de dias em casa inválido');
    if (p.rules.enforceHomeCap !== undefined && typeof p.rules.enforceHomeCap !== 'boolean') e.push('enforceHomeCap deve ser verdadeiro/falso');
    if (p.rules.startDate !== undefined && p.rules.startDate !== null && !isDate(p.rules.startDate)) e.push('data de início inválida');
  }
  if (p.reminder) {
    const r = p.reminder;
    for (const k of ['time', 'until']) if (r[k] !== undefined && !HHMM_RE.test(r[k])) e.push(`hora inválida em ${k}`);
    if (r.repeatMinutes !== undefined && !(Number.isInteger(r.repeatMinutes) && r.repeatMinutes >= 5)) e.push('repetição mínima de 5 minutos');
    if (r.weekdays !== undefined && !(Array.isArray(r.weekdays) && r.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))) e.push('dias da semana inválidos');
  }
  if (p.location) {
    const l = p.location;
    for (const k of ['windowStart', 'windowEnd']) if (l[k] !== undefined && !HHMM_RE.test(l[k])) e.push(`hora inválida em ${k}`);
  }
  return e;
}

export function validateOffice(o) {
  const e = [];
  if (!o.name || String(o.name).length > 60) e.push('nome obrigatório (até 60 caracteres)');
  if (!countryNames()[o.country]) e.push('país inválido');
  if (o.region && !listRegions(o.country)[o.region]) e.push('região inválida para o país');
  if (o.timezone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: o.timezone });
    } catch {
      e.push('fuso horário inválido');
    }
  }
  if (o.radiusM !== undefined && !(Number.isFinite(o.radiusM) && o.radiusM >= 50 && o.radiusM <= 5000)) e.push('raio deve estar entre 50 e 5000 m');
  if (o.city !== undefined && o.city !== null && !(typeof o.city === 'string' && o.city.length <= 40)) e.push('cidade inválida');
  if (o.location && !(Number.isFinite(o.location.lat) && Number.isFinite(o.location.lng))) e.push('coordenadas inválidas');
  if (o.customHolidays !== undefined) {
    if (!Array.isArray(o.customHolidays)) e.push('feriados locais inválidos');
    else for (const h of o.customHolidays) if (!/^(\d{4}-)?\d{2}-\d{2}$/.test(h?.date || '') || !h?.name) e.push(`feriado inválido: ${JSON.stringify(h)}`);
  }
  return e;
}

let countriesCache = null;
function countryNames() {
  return (countriesCache ??= listCountries());
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
}
