// Servidor HTTP: API REST + arquivos estáticos da PWA + agendador de lembretes.

import express from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './db.js';
import { setupPush } from './reminders/push.js';
import { startScheduler } from './reminders/runner.js';
import { COUNTRIES, CITY_PRESETS, OPTIONAL_HOLIDAYS } from './core/holidays.js';
import { parseSemesterId, semesterOf } from './core/dates.js';
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
    const todaySem = semesterOf(now.date);
    const todayHolidays = todaySem.id === sem.id ? holidays : holidaysFor(settings, todaySem);
    res.json({
      now,
      semester: sem,
      report,
      settings,
      days: Object.fromEntries(days),
      holidays: Object.fromEntries([...holidays].filter(([d]) => d >= sem.start && d <= sem.end)),
      today: {
        date: now.date,
        record: repo.getDay(now.date),
        workingDay: isWorkingDay(now.date, todayHolidays),
        holiday: todayHolidays.get(now.date) || null,
      },
      meta: {
        countries: COUNTRIES,
        optionalHolidays: OPTIONAL_HOLIDAYS,
        presets: CITY_PRESETS,
        vapidPublicKey: push.publicKey,
        subscriptions: repo.listSubscriptions().length,
      },
    });
  });

  // ---- registro de dias -------------------------------------------------------
  app.put('/api/days/:date', (req, res) => {
    const { date } = req.params;
    if (!ISO_RE.test(date)) return res.status(400).json({ error: 'Data inválida' });
    const { status, plan, note } = req.body || {};
    const today = localNow(repo).date;
    // Não faz sentido "registrar" presença no futuro: no futuro é planejamento.
    if (status && status !== 'absence' && date > today) {
      return res.status(400).json({ error: 'Datas futuras só podem ser planejadas (use "plan").' });
    }
    try {
      const saved = repo.upsertDay(date, {
        status,
        plan,
        note,
        source: status !== undefined ? 'manual' : undefined,
        distance: status !== undefined ? null : undefined,
      });
      res.json({ ok: true, day: saved });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  /** Resposta ao lembrete (botões da notificação, check-in por localização ou tela de início). */
  app.post('/api/checkin', (req, res) => {
    const { status, source = 'manual', distance = null, date } = req.body || {};
    if (!['office', 'home', 'absence'].includes(status)) return res.status(400).json({ error: 'status inválido' });
    const today = localNow(repo).date;
    // A notificação leva a data a que se refere; se responder a um lembrete de
    // ontem já depois da meia-noite, registra no dia certo (mas nunca no futuro).
    const target = ISO_RE.test(date || '') && date <= today ? date : today;
    const saved = repo.upsertDay(target, {
      status,
      source: ['manual', 'lembrete', 'localizacao'].includes(source) ? source : 'manual',
      distance: Number.isFinite(distance) ? Math.round(distance) : null,
    });
    res.json({ ok: true, date: target, day: saved });
  });

  // ---- configurações ------------------------------------------------------------
  app.put('/api/settings', (req, res) => {
    const errors = validateSettingsPatch(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    const patch = { ...req.body };
    if (patch.country && !patch.timezone && patch.country !== repo.getSettings().country) {
      patch.timezone = COUNTRIES[patch.country].timezone;
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
    const lines = ['data;situacao;planejado;origem;distancia_m;nota'];
    for (const d of repo.allDays()) {
      lines.push([d.date, label[d.status] || '', label[d.plan] || '', d.source || '', d.distance_m ?? '', (d.note || '').replace(/[;\n]/g, ' ')].join(';'));
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
  if (p.country !== undefined && !COUNTRIES[p.country]) e.push('país inválido');
  if (p.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: p.timezone });
    } catch {
      e.push('fuso horário inválido');
    }
  }
  if (p.rules) {
    const { officePct, maxHomeDays } = p.rules;
    if (officePct !== undefined && !(Number.isInteger(officePct) && officePct >= 0 && officePct <= 100)) e.push('percentagem deve ser 0–100');
    if (maxHomeDays !== undefined && !(Number.isInteger(maxHomeDays) && maxHomeDays >= 0 && maxHomeDays <= 200)) e.push('máximo de dias em casa inválido');
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
    if (l.radiusM !== undefined && !(Number.isFinite(l.radiusM) && l.radiusM >= 50 && l.radiusM <= 5000)) e.push('raio deve estar entre 50 e 5000 m');
    if (l.office && !(Number.isFinite(l.office.lat) && Number.isFinite(l.office.lng))) e.push('coordenadas do escritório inválidas');
  }
  if (p.customHolidays !== undefined) {
    if (!Array.isArray(p.customHolidays)) e.push('feriados locais inválidos');
    else
      for (const h of p.customHolidays)
        if (!/^(\d{4}-)?\d{2}-\d{2}$/.test(h?.date || '') || !h?.name) e.push(`feriado inválido: ${JSON.stringify(h)}`);
  }
  return e;
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
