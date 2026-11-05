// Servidor HTTP: API REST + arquivos estáticos da PWA + agendador de lembretes.

import express from 'express';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './db.js';
import { setupPush } from './reminders/push.js';
import { startScheduler } from './reminders/runner.js';
import { CITY_PRESETS, listCountries, listRegions, optionalHolidaysFor, timezonesFor } from './core/holidays.js';
import { addDays, parseSemesterId, semesterOf } from './core/dates.js';
import { DEFAULT_OFFICE, expectedOffice, officeById, tripForDay, buildHolidayMap } from './core/offices.js';
import { ABSENCE_TYPES, ABSENCE_LABEL, validateAbsence } from './core/absences.js';
import { holidaysFor, isWorkingDay, localNow, semesterReport } from './service.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function createApp({ repo, push, password = process.env.APP_PASSWORD }) {
  const app = express();
  app.use(express.json({ limit: '200kb' }));

  // ---- autenticação opcional --------------------------------------------------
  // Se APP_PASSWORD estiver definida, a API exige login. Indispensável se
  // publicar a app na internet (os seus dados de presença são pessoais).
  let secret = repo.getKV('secret');
  if (!secret) repo.setKV('secret', (secret = randomBytes(32).toString('hex')));
  const token = password ? createHmac('sha256', secret).update(password).digest('hex') : null;
  const cookieName = 'presenca_sid';
  const readCookie = (req) =>
    Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)))[cookieName];
  const authed = (req) => {
    if (!token) return true;
    const c = readCookie(req) || '';
    return c.length === token.length && timingSafeEqual(Buffer.from(c), Buffer.from(token));
  };

  app.get('/api/auth', (req, res) => res.json({ required: Boolean(token), ok: authed(req) }));
  app.post('/api/login', (req, res) => {
    if (!token) return res.json({ ok: true });
    const given = createHmac('sha256', secret).update(String(req.body?.password || '')).digest('hex');
    if (given !== token) return res.status(401).json({ error: 'Senha incorreta' });
    res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${req.secure ? '; Secure' : ''}`);
    res.json({ ok: true });
  });
  app.post('/api/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; Max-Age=0`);
    res.json({ ok: true });
  });
  app.use('/api', (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: 'Não autenticado' })));

  // ---- estado completo para a tela -----------------------------------------------
  app.get('/api/state', (req, res) => {
    const now = localNow(repo);
    const sem = parseSemesterId(req.query.semester) || semesterOf(now.date);
    const { report, holidays, days, settings } = semesterReport(repo, sem, now.date);
    const todayRec = repo.getDay(now.date);
    const todayHolidays = holidaysFor(settings, now.date, now.date, new Map([[now.date, todayRec]]));
    res.json({
      now,
      semester: sem,
      report,
      settings,
      days: Object.fromEntries(days),
      absences: repo.listAbsences(sem.start, sem.end),
      holidays: Object.fromEntries([...holidays].filter(([d]) => d >= sem.start && d <= sem.end)),
      today: {
        date: now.date,
        record: todayRec,
        workingDay: isWorkingDay(now.date, todayHolidays),
        holiday: todayHolidays.get(now.date) || null,
        expectedOfficeId: expectedOffice(settings, now.date).id,
        trip: tripForDay(settings, now.date),
      },
      meta: {
        countries: countryNames(),
        absenceTypes: ABSENCE_TYPES,
        vapidPublicKey: push.publicKey,
        subscriptions: repo.listSubscriptions().length,
      },
    });
  });

  // ---- registro de dias -------------------------------------------------------
  app.put('/api/days/:date', (req, res) => {
    const { date } = req.params;
    if (!ISO_RE.test(date)) return res.status(400).json({ error: 'Data inválida' });
    const { status, plan, note, officeId, absenceType, justification } = req.body || {};
    const today = localNow(repo).date;
    if (officeId && !officeById(repo.getSettings(), officeId)) return res.status(400).json({ error: 'Escritório desconhecido' });
    // Não faz sentido "registrar" presença no futuro: no futuro é planejamento.
    if (status && status !== 'absence' && date > today) {
      return res.status(400).json({ error: 'Datas futuras só podem ser planejadas (use "plan").' });
    }
    if (status === 'absence' || plan === 'absence') {
      const err = validateAbsence({ type: absenceType, justification });
      if (err) return res.status(400).json({ error: err });
    }
    try {
      const saved = repo.upsertDay(date, {
        status,
        plan,
        note,
        source: status !== undefined ? 'manual' : undefined,
        distance: status !== undefined ? null : undefined,
        officeId: status !== undefined ? officeId || null : undefined,
        ...(status === 'absence' || plan === 'absence'
          ? { absenceType, justification: String(justification || '').trim() || null, absenceId: randomUUID().slice(0, 8) }
          : {}),
      });
      res.json({ ok: true, day: saved });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  /** Resposta ao lembrete (botões da notificação, check-in por localização ou tela de início). */
  app.post('/api/checkin', (req, res) => {
    const { status, source = 'manual', distance = null, date, officeId } = req.body || {};
    // Ausências têm tipo e justificação → registram-se por POST /api/absences.
    if (!['office', 'home'].includes(status)) return res.status(400).json({ error: 'status inválido (para ausências use /api/absences)' });
    const settings = repo.getSettings();
    if (officeId && !officeById(settings, officeId)) return res.status(400).json({ error: 'Escritório desconhecido' });
    const today = localNow(repo).date;
    // A notificação leva a data a que se refere; se responder a um lembrete de
    // ontem já depois da meia-noite, registra no dia certo (mas nunca no futuro).
    const target = ISO_RE.test(date || '') && date <= today ? date : today;
    const saved = repo.upsertDay(target, {
      status,
      source: ['manual', 'lembrete', 'localizacao'].includes(source) ? source : 'manual',
      distance: Number.isFinite(distance) ? Math.round(distance) : null,
      // Sem escritório indicado → o previsto (viagem ou principal).
      officeId: status === 'office' ? officeId || expectedOffice(settings, target).id : null,
    });
    res.json({ ok: true, date: target, day: saved });
  });

  // ---- férias e ausências ------------------------------------------------------------
  // Registra um período (ex.: férias de 03 a 14/08, doença de 3 dias). Só os
  // dias úteis do período (sem fins de semana nem feriados) viram ausência —
  // são esses que saem da base dos 50%.
  app.post('/api/absences', (req, res) => {
    const { start, end, type, justification = '', overwrite = false, replaceId } = req.body || {};
    if (!ISO_RE.test(start || '') || !ISO_RE.test(end || '') || end < start) return res.status(400).json({ error: 'Datas inválidas' });
    if (addDays(start, 366) < end) return res.status(400).json({ error: 'Período longo demais (máx. 1 ano).' });
    const err = validateAbsence({ type, justification });
    if (err) return res.status(400).json({ error: err });

    const settings = repo.getSettings();
    const days = repo.getDays(start, end);
    const holidays = buildHolidayMap(settings, start, end, days);
    const targets = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const wd = new Date(d + 'T12:00:00Z').getUTCDay();
      if (wd !== 0 && wd !== 6 && !holidays.has(d)) targets.push(d);
    }
    if (!targets.length) return res.status(400).json({ error: 'O período não tem dias úteis (só fins de semana/feriados).' });

    // Não apaga silenciosamente dias já registrados como escritório/casa.
    const conflicts = targets.filter((d) => {
      const r = days.get(d);
      return r && (r.status === 'office' || r.status === 'home') ;
    });
    if (conflicts.length && !overwrite) {
      return res.status(409).json({ error: `${conflicts.length} dia(s) já registrado(s) como escritório/casa.`, conflicts });
    }
    if (replaceId) repo.deleteAbsence(replaceId); // edição = substitui o período anterior
    const absenceId = randomUUID().slice(0, 8);
    const j = String(justification).trim() || null;
    for (const d of targets) {
      repo.upsertDay(d, { status: 'absence', plan: null, source: 'manual', absenceType: type, justification: j, absenceId, distance: null });
    }
    res.json({ ok: true, id: absenceId, days: targets.length, label: ABSENCE_LABEL(type) });
  });

  app.delete('/api/absences/:id', (req, res) => {
    res.json({ ok: true, removed: repo.deleteAbsence(req.params.id) });
  });

  // ---- escritórios ------------------------------------------------------------------
  // Cada escritório tem o seu calendário de feriados (país, região, cidade).
  app.get('/api/countries/:code', (req, res) => {
    const c = req.params.code.toUpperCase();
    if (!countryNames()[c]) return res.status(404).json({ error: 'País desconhecido' });
    res.json({ regions: listRegions(c), timezones: timezonesFor(c), optional: optionalHolidaysFor(c), presets: CITY_PRESETS[c] || [] });
  });

  app.post('/api/offices', (req, res) => {
    const o = req.body || {};
    const errors = validateOffice(o);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    const settings = repo.getSettings();
    const office = {
      ...DEFAULT_OFFICE,
      ...(officeById(settings, o.id) || {}),
      ...pick(o, ['name', 'country', 'region', 'regionName', 'timezone', 'location', 'radiusM', 'optionalHolidays', 'customHolidays']),
      id: o.id && officeById(settings, o.id) ? o.id : randomUUID().slice(0, 8),
    };
    if (!office.timezone) office.timezone = timezonesFor(office.country)[0] || 'UTC';
    const offices = officeById(settings, office.id) ? settings.offices.map((x) => (x.id === office.id ? office : x)) : [...settings.offices, office];
    const patch = { offices };
    if (o.primary) patch.primaryOfficeId = office.id;
    repo.updateSettings(patch);
    res.json({ ok: true, office });
  });

  app.delete('/api/offices/:id', (req, res) => {
    const settings = repo.getSettings();
    if (settings.offices.length <= 1) return res.status(400).json({ error: 'É preciso ter pelo menos um escritório.' });
    if (req.params.id === settings.primaryOfficeId) return res.status(400).json({ error: 'Defina outro escritório como principal antes de remover este.' });
    repo.updateSettings({
      offices: settings.offices.filter((o) => o.id !== req.params.id),
      trips: settings.trips.filter((t) => t.officeId !== req.params.id),
    });
    res.json({ ok: true });
  });

  // ---- viagens de trabalho ----------------------------------------------------------
  // Durante a viagem: valem os feriados e o fuso do escritório de destino, e os
  // dias úteis contam como "planejado escritório".
  app.post('/api/trips', (req, res) => {
    const { officeId, start, end, note = '' } = req.body || {};
    const settings = repo.getSettings();
    if (!officeById(settings, officeId)) return res.status(400).json({ error: 'Escritório desconhecido' });
    if (!ISO_RE.test(start || '') || !ISO_RE.test(end || '') || end < start) return res.status(400).json({ error: 'Datas inválidas' });
    if (addDays(start, 92) < end) return res.status(400).json({ error: 'Viagem longa demais (máx. 3 meses).' });
    const clash = settings.trips.find((t) => t.start <= end && start <= t.end);
    if (clash) return res.status(400).json({ error: `Conflita com outra viagem (${clash.start} a ${clash.end}).` });
    const trip = { id: randomUUID().slice(0, 8), officeId, start, end, note: String(note).slice(0, 200) };
    repo.updateSettings({ trips: [...settings.trips, trip].sort((a, b) => a.start.localeCompare(b.start)) });
    res.json({ ok: true, trip });
  });

  app.delete('/api/trips/:id', (req, res) => {
    const settings = repo.getSettings();
    repo.updateSettings({ trips: settings.trips.filter((t) => t.id !== req.params.id) });
    res.json({ ok: true });
  });

  // ---- configurações ------------------------------------------------------------
  app.put('/api/settings', (req, res) => {
    const errors = validateSettingsPatch(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    const patch = { ...req.body };
    // Escritórios e viagens têm rotas próprias (com validação própria).
    delete patch.offices;
    delete patch.trips;
    if (patch.primaryOfficeId && !officeById(repo.getSettings(), patch.primaryOfficeId)) {
      return res.status(400).json({ error: 'Escritório desconhecido' });
    }
    res.json({ ok: true, settings: repo.updateSettings(patch) });
  });

  // ---- notificações push --------------------------------------------------------------
  app.post('/api/push/subscribe', (req, res) => {
    const sub = req.body;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return res.status(400).json({ error: 'Inscrição inválida' });
    repo.addSubscription(sub);
    res.json({ ok: true });
  });
  app.post('/api/push/unsubscribe', (req, res) => {
    if (req.body?.endpoint) repo.removeSubscription(req.body.endpoint);
    res.json({ ok: true });
  });
  app.post('/api/push/test', async (_req, res) => {
    const today = localNow(repo).date;
    const r = await push.sendToAll({
      title: 'Teste de notificação ✔',
      body: 'Se você está lendo isto, os lembretes vão funcionar. Você pode testar os botões.',
      tag: 'test',
      url: '/',
      date: today,
      actions: [
        { action: 'office', title: '🏢 Escritório' },
        { action: 'home', title: '🏠 Casa' },
      ],
    });
    res.json(r);
  });

  // ---- exportação (para enviar ao RH ou guardar backup) -----------------------------
  app.get('/api/export.csv', (_req, res) => {
    const label = { office: 'Escritório', home: 'Casa', absence: 'Ausência' };
    const clean = (x) => String(x || '').replace(/[;\n\r]/g, ' ');
    const offices = repo.getSettings().offices;
    const lines = ['data;situacao;tipo_ausencia;justificacao;escritorio;planejado;origem;distancia_m;nota'];
    for (const d of repo.allDays()) {
      lines.push(
        [
          d.date,
          label[d.status] || '',
          d.status === 'absence' || d.plan === 'absence' ? ABSENCE_LABEL(d.absence_type) : '',
          clean(d.justification),
          clean(offices.find((o) => o.id === d.office_id)?.name),
          label[d.plan] || '',
          d.source || '',
          d.distance_m ?? '',
          clean(d.note),
        ].join(';'),
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="presenca.csv"');
    res.send('﻿' + lines.join('\n'));
  });

  // ---- arquivos estáticos ----------------------------------------------------------------
  app.use('/core', express.static(join(ROOT, 'src/core'))); // compartilha geo.js/dates.js com o navegador
  app.use(express.static(join(ROOT, 'public')));
  return app;
}

export function validateSettingsPatch(p) {
  const e = [];
  if (p.rules) {
    const { officePct, maxHomeDays } = p.rules;
    if (officePct !== undefined && !(Number.isInteger(officePct) && officePct >= 0 && officePct <= 100)) e.push('percentagem deve ser 0–100');
    if (maxHomeDays !== undefined && !(Number.isInteger(maxHomeDays) && maxHomeDays >= 0 && maxHomeDays <= 200)) e.push('máximo de dias em casa inválido');
    if (p.rules.enforceHomeCap !== undefined && typeof p.rules.enforceHomeCap !== 'boolean') e.push('enforceHomeCap deve ser verdadeiro/falso');
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

// ---- inicialização ---------------------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repo = openDb(process.env.DB_FILE || join(ROOT, 'data/presenca.db'));
  const push = setupPush(repo, { subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com' });
  const app = createApp({ repo, push });
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`Presença: http://localhost:${port}`));
  startScheduler(repo, push);
}
