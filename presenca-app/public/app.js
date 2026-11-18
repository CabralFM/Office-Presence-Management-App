// Interface da app (JavaScript puro, sem framework). Tudo é "desenhar a partir do
// estado": cada ação chama a API (no próprio celular, no modo local) e redesenha.
//
// Idiomas: todos os textos passam por t('chave') — ver src/core/i18n.js e
// src/core/locales/. O HTML usa data-i18n="chave" (preenchido por applyI18n).

import { assessPosition } from './core/geo.js';
import { nowInTimeZone, periodOf, shiftPeriod, parsePeriodId } from './core/dates.js';
import { isBackupDue, APPS_SCRIPT_URL_RE } from './core/backup.js';
import { ABSENCE_TYPES, ABSENCE_LABEL, ABSENCE_ICON } from './core/absences.js';
import { RULE_TEMPLATES, matchTemplate } from './core/rule-templates.js';
import { t, setLocale, getLocale, detectLocale, LANGUAGES, DICTIONARIES, isRtl, intlLocale, fmtDayMonth, fmtFull, fmtLong, weekdayShort, monthYear, periodLabel } from './core/i18n.js';
import { MODE, STATS_URL } from './config.js';
import { shouldAsk, shouldPing, buildPing, buildForget, newDeviceId, platformOf } from './core/stats.js';

export const APP_VERSION = '2.1';
const NEWS = ['news.v21', 'news.v2a', 'news.v2b', 'news.v2c', 'news.v2d'];

const LOCAL = MODE === 'local';
// No modo local o "backend" corre dentro do celular (carregado só neste modo).
const localBackend = LOCAL ? import('./local-backend.js') : null;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICON = { office: '🏢', home: '🏠', absence: '🌴' };
const LABEL = (s) => t(`status.${s}`);
const DOW = (wd) => weekdayShort(wd);
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // segunda primeiro
const fmtDM = fmtDayMonth;
const dayIcon = (rec) => (rec?.status === 'absence' ? ABSENCE_ICON(rec.absenceType) : ICON[rec?.status] || '');
const dayLabel = (rec) => (rec?.status === 'absence' ? ABSENCE_LABEL(rec.absenceType) : rec?.status ? LABEL(rec.status) : '');
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

let S = null; // último estado
let periodId = null;

// ---------------------------------------------------------------- idioma
const LOCALE_KEY = 'presenca:locale';
function savedLocale() {
  try {
    return localStorage.getItem(LOCALE_KEY);
  } catch {
    return null;
  }
}
function useLocale(code) {
  setLocale(code || detectLocale(navigator.languages || [navigator.language]));
  try {
    localStorage.setItem(LOCALE_KEY, getLocale());
  } catch {}
  document.documentElement.lang = getLocale();
  document.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
  applyI18n();
}
/** Preenche os textos fixos do HTML (data-i18n, data-i18n-html, -ph, -aria). */
function applyI18n(root = document) {
  for (const el of $$('[data-i18n]', root)) el.textContent = t(el.dataset.i18n);
  // Só textos dos dicionários da app (confiáveis) entram como HTML.
  for (const el of $$('[data-i18n-html]', root)) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of $$('[data-i18n-ph]', root)) el.placeholder = t(el.dataset.i18nPh);
  for (const el of $$('[data-i18n-aria]', root)) el.setAttribute('aria-label', t(el.dataset.i18nAria));
}
const langOptions = (sel) =>
  LANGUAGES.map((l) => `<option value="${l.code}" ${l.code === sel ? 'selected' : ''}>${h(l.name)}</option>`).join('');

// ---------------------------------------------------------------- API
class ApiError extends Error {
  constructor(status, data) {
    super(data.error || `${t('ui.error')} ${status}`);
    this.status = status;
    this.data = data;
  }
}

async function api(path, opts = {}) {
  const method = opts.method || 'GET';
  let status;
  let data;
  if (LOCAL) {
    // Sem rede: a mesma API, executada no próprio aparelho.
    ({ status, data } = (await localBackend).localRequest(method, path, opts.body ? JSON.parse(JSON.stringify(opts.body)) : {}));
  } else {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${path.replace(/^\//, '')}${sep}lang=${getLocale()}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    status = res.status;
    data = await res.json().catch(() => ({}));
  }
  if (status === 401 && path !== '/api/login') {
    showLogin();
    throw new ApiError(401, { error: t('login.required') });
  }
  if (status >= 400) throw new ApiError(status, data);
  return data;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2800);
}

async function load() {
  S = await api(`/api/state${periodId ? `?period=${periodId}` : ''}`);
  // O idioma escolhido nos Ajustes vale em todos os aparelhos que usem a cópia.
  if (S.settings.locale && S.settings.locale !== getLocale()) {
    useLocale(S.settings.locale);
    S = await api(`/api/state${periodId ? `?period=${periodId}` : ''}`);
  }
  periodId = S.semester.id;
  render();
}

// ---------------------------------------------------------------- navegação
function showTab() {
  const id = (location.hash || '#painel').slice(1);
  if (!$(`#${CSS.escape(id)}.tab`)) return;
  $$('.tab').forEach((s) => (s.hidden = s.id !== id));
  $$('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === id));
  $(`.tabs a[data-tab="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#cfg=')) return checkConfigLink();
  showTab();
});

function showLogin() {
  $$('.tab').forEach((s) => (s.hidden = true));
  $('#login').hidden = false;
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/login', { method: 'POST', body: { password: e.target.password.value } });
    $('#login').hidden = true;
    await boot();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

// ---------------------------------------------------------------- render
function render() {
  applyI18n();
  renderPeriodSelect();
  renderToday();
  renderSemester();
  renderAlerts();
  renderMonths();
  renderCalendar();
  renderPlanning();
  renderSettings();
  renderStats();
  showTab();
}

function renderPeriodSelect() {
  const cur = periodOf(S.now.date, S.settings.rules.period);
  const sel = parsePeriodId(periodId) || cur;
  const back = cur.kind === 'month' ? 6 : cur.kind === 'year' ? 2 : 3;
  const opts = [];
  for (let i = -back; i <= 2; i++) opts.push(shiftPeriod(cur, i));
  if (!opts.some((p) => p.id === sel.id)) opts.push(sel);
  $('#semester-select').innerHTML = opts.map((p) => `<option value="${p.id}" ${p.id === sel.id ? 'selected' : ''}>${h(periodLabel(p))}</option>`).join('');
}
$('#semester-select').addEventListener('change', (e) => {
  periodId = e.target.value;
  load();
});

const officeById = (id) => S.settings.offices.find((o) => o.id === id);
const officeName = (id) => officeById(id)?.name || '?';
const multiOffice = () => S.settings.offices.length > 1;
const tripFor = (date) => S.settings.trips.find((x) => x.start <= date && date <= x.end) || null;
const fmtDist = (m) => (m == null ? '?' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
const workdays = () => S.settings.workdays;
const weekCols = () => WEEK_ORDER.filter((d) => workdays().includes(d));

function renderToday() {
  const td = S.today;
  const el = $('#today-card');
  const expected = td.expectedOfficeId;
  const where = td.trip
    ? t('today.trip', { office: `<b>${h(officeName(td.trip.officeId))}</b>`, from: fmtDM(td.trip.start), to: fmtDM(td.trip.end) })
    : multiOffice()
      ? t('today.refOffice', { office: `<b>${h(officeName(expected))}</b>` })
      : '';
  const head = `<div class="big">${h(t('today.title', { date: fmtLong(td.date) }))}</div>${where ? `<p class="hint">${where}</p>` : ''}<div id="tz-banner"></div>`;
  const start = S.settings.rules.startDate;
  if (start && td.date < start) {
    el.innerHTML = `${head}<p>⏳ ${t('today.beforeStart', { date: `<b>${fmtFull(start)}</b>` })}</p>`;
    renderTzBanner();
    return;
  }
  if (!td.workingDay) {
    el.innerHTML = `${head}<p>${td.holiday ? `🎉 ${t('today.holiday', { name: `<b>${h(td.holiday.name)}</b>`, office: h(td.holiday.officeName) })}` : t('today.dayOff')}</p>`;
    renderTzBanner();
    return;
  }
  const rec = td.record;
  const cur = rec?.status;
  const canGeo = S.settings.location.enabled && S.settings.offices.some((o) => o.location);
  const officeSel = multiOffice()
    ? `<label class="inline">🏢 ${h(t('today.whichOffice'))} <select id="office-pick">${S.settings.offices
        .map((o) => `<option value="${o.id}" ${o.id === (rec?.officeId || expected) ? 'selected' : ''}>${h(o.name)}</option>`)
        .join('')}</select></label>`
    : '';
  const geoDone = cur === 'office' && rec.source === 'localizacao';
  let recorded = '';
  if (cur) {
    const what = `<b>${dayIcon(rec)} ${h(dayLabel(rec))}${cur === 'office' && multiOffice() ? ` · ${h(officeName(rec.officeId))}` : ''}</b>`;
    const extra =
      rec.source === 'localizacao' ? ` ${t('today.byLocation', { dist: fmtDist(rec.distance) })}` : cur === 'absence' ? ` — ${rec.justification ? h(rec.justification) : h(t('abs.noJust'))}` : '';
    recorded = `${t('today.recorded', { what })}${extra}. ${h(t('today.canChange'))}`;
  }
  el.innerHTML = `${head}
    ${geoDone ? `<div class="geo-result ok-box">✅ ${t('today.geoDone', { office: `<b>${h(LABEL('office'))}${multiOffice() ? ` ${h(officeName(rec.officeId))}` : ''}</b>`, dist: fmtDist(rec.distance) })}
      <div class="row"><button id="geo-undo">↩️ ${h(t('ui.undo'))}</button></div></div>` : ''}
    <p class="hint">${cur ? recorded : h(t('today.question'))}</p>
    <div class="choice">
      ${['office', 'home', 'absence'].map((s) => `<button data-checkin="${s}" class="${s} ${cur === s ? 'sel' : ''}">${ICON[s]} ${h(LABEL(s))}</button>`).join('')}
    </div>
    ${officeSel}
    ${canGeo && !cur ? `<button id="geo-check">📍 ${h(t('geo.check'))}</button>` : ''}
    <div id="geo-box"></div>`;
  $$('[data-checkin]', el).forEach((b) =>
    b.addEventListener('click', () =>
      b.dataset.checkin === 'absence'
        ? openAbsence({ start: td.date, end: td.date, ...(cur === 'absence' ? absenceOf(td.date) : {}) })
        : checkin(b.dataset.checkin, 'manual', null, b.dataset.checkin === 'office' ? $('#office-pick')?.value : undefined),
    ),
  );
  $('#office-pick')?.addEventListener('change', (e) => cur === 'office' && checkin('office', 'manual', null, e.target.value));
  $('#geo-check', el)?.addEventListener('click', () => locationCheckin());
  $('#geo-undo', el)?.addEventListener('click', undoToday);
  renderTzBanner();
  renderGeoBox();
}

async function checkin(status, source, distance = null, officeId, { quiet = false } = {}) {
  await api('/api/checkin', { method: 'POST', body: { status, source, distance, officeId } });
  geoStatus = null;
  if (!quiet) toast(t('toast.recorded', { what: `${LABEL(status)}${status === 'office' && multiOffice() && officeId ? ` · ${officeName(officeId)}` : ''}` }));
  await load();
}

// ---------------------------------------------------------------- fuso horário
function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function renderTzBanner() {
  const box = $('#tz-banner');
  if (!box) return;
  const tz = deviceTimeZone();
  const exp = officeById(S.today.expectedOfficeId);
  const key = `tz-dismiss-${S.now.date}`;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(key) === '1';
  } catch {}
  if (!S.settings.askOnTimezoneChange || !tz || !exp || tz === exp.timezone || dismissed || S.today.trip) {
    box.innerHTML = '';
    return;
  }
  const match = S.settings.offices.find((o) => o.timezone === tz && o.id !== exp.id);
  box.innerHTML = `<div class="geo-result">🌍 ${t('tz.question', { tz: `<b>${h(tz)}</b>`, office: h(exp.name), officeTz: `<b>${h(exp.timezone)}</b>` })}
    <div class="row"><button id="tz-trip" class="primary">✈️ ${h(match ? t('tz.yesTo', { office: match.name }) : t('tz.yes'))}</button><button id="tz-no">${h(t('tz.no'))}</button></div></div>`;
  $('#tz-no').onclick = () => {
    try {
      localStorage.setItem(key, '1');
    } catch {}
    box.innerHTML = '';
  };
  $('#tz-trip').onclick = () => {
    if (!match) {
      toast(t('tz.addOfficeFirst'));
      location.hash = '#config';
      openOffice(null, { timezone: tz });
      return;
    }
    location.hash = '#planejamento';
    const f = $('#trip-form');
    f.officeId.value = match.id;
    f.start.value = f.end.value = S.now.date;
    f.end.focus();
  };
}

// ---------------------------------------------------------------- localização
// Leitura ÚNICA (nunca rastreio): rede/Wi-Fi primeiro, GPS só se for imprecisa.
// Coordenadas nunca saem do aparelho nem são guardadas.
function inLocationWindow() {
  const loc = S.settings.location;
  // Hora exata DESTE momento (não a da última atualização da tela).
  const m = nowInTimeZone(S.now.timezone).minutes;
  const toMin = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
  return m >= toMin(loc.windowStart) && m <= toMin(loc.windowEnd);
}

const geoError = (code) => t(`geo.err${[1, 2, 3].includes(code) ? code : 0}`);

function readPosition(opts) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(Object.assign(new Error(t('geo.unsupported')), { code: 0 }));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => reject(Object.assign(new Error(geoError(err.code)), { code: err.code })),
      opts,
    );
  });
}

// Teto absoluto: nunca mais de 2 min com a localização em uso (na prática ≤ 40 s).
const GEO_MAX_MS = 120_000;
function getPosition(onProgress = () => {}) {
  let timer;
  const capP = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(geoError(3)), { code: 3 })), GEO_MAX_MS);
  });
  return Promise.race([readBestPosition(onProgress), capP]).finally(() => clearTimeout(timer));
}

async function readBestPosition(onProgress) {
  let best = null;
  let lastErr = null;
  try {
    best = await readPosition({ enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 });
  } catch (e) {
    if (e.code === 1 || e.code === 0) throw e;
    lastErr = e;
  }
  if (!best || best.accuracy > 100) {
    onProgress(t('geo.improving'));
    try {
      const gps = await readPosition({ enableHighAccuracy: true, timeout: 30000, maximumAge: 0 });
      if (!best || gps.accuracy < best.accuracy) best = gps;
    } catch (e) {
      if (e.code === 1) throw e;
      lastErr = e;
    }
  }
  if (!best) throw lastErr || new Error(geoError(0));
  return best;
}

let geoStatus = null; // { kind: 'loading' | 'error', text }

function renderGeoBox() {
  const box = $('#geo-box');
  if (!box) return;
  if (!geoStatus) {
    box.innerHTML = '';
    return;
  }
  if (geoStatus.kind === 'loading') {
    box.innerHTML = `<div class="geo-result"><span class="spinner"></span> 📍 ${h(geoStatus.text)}</div>`;
  } else {
    box.innerHTML = `<div class="geo-result error-box">⚠️ ${h(geoStatus.text)}
      <div class="row"><button id="geo-retry" class="primary">📍 ${h(t('geo.retry'))}</button></div></div>`;
    $('#geo-retry').onclick = () => locationCheckin();
  }
}

async function locationCheckin({ fromLink = false } = {}) {
  const loc = S.settings.location;
  if (!inLocationWindow()) {
    toast(t(fromLink ? 'geo.outsideLink' : 'geo.outside', { from: loc.windowStart, to: loc.windowEnd }));
    return;
  }
  geoStatus = { kind: 'loading', text: t('geo.checking') };
  renderGeoBox();
  let pos;
  try {
    pos = await getPosition((text) => {
      geoStatus = { kind: 'loading', text };
      renderGeoBox();
    });
  } catch (e) {
    geoStatus = { kind: 'error', text: e.message };
    renderGeoBox();
    return;
  }
  geoStatus = null;
  renderGeoBox();
  const expected = S.today.expectedOfficeId;
  const g = assessPosition(pos, S.settings.offices, expected); // pos é descartada aqui
  if (!g) return;
  if (g.verdict === 'office') {
    await checkin('office', 'localizacao', g.distance, g.office.id, { quiet: true });
    toast(t('geo.autoDone', { dist: fmtDist(g.distance) }));
    return;
  }
  openGeoDialog(g, expected);
}

function openGeoDialog(g, expected) {
  const dlg = $('#geo-dialog');
  const acc = g.accuracy ? ` ${t('geo.accuracy', { acc: fmtDist(g.accuracy) })}` : '';
  let text;
  let buttons;
  if (g.verdict === 'probable') {
    const other = g.office.id !== expected;
    text = `${t('geo.probable', { office: `<b>${h(g.office.name)}</b>`, dist: fmtDist(g.distance) })}${acc}.${
      other ? `<br>⚠️ ${t('geo.otherOffice', { expected: `<b>${h(officeName(expected))}</b>`, office: h(g.office.name) })}` : ''
    }<br>${h(t('geo.confirm'))}`;
    buttons = [
      { label: `🏢 ${h(t('geo.yesOffice'))}${multiOffice() ? ` ${h(g.office.name)}` : ''}`, cls: 'office primary-choice', go: () => checkin('office', 'localizacao', g.distance, g.office.id) },
      { label: `🏠 ${h(t('geo.noHome'))}`, cls: 'home', go: () => checkin('home', 'manual', g.distance) },
    ];
  } else {
    text = `${t('geo.away', { dist: `<b>${fmtDist(g.distance)}</b>`, office: h(g.office.name) })}${acc}. ${h(t('today.question'))}`;
    buttons = [
      { label: `🏠 ${h(t('geo.atHome'))}`, cls: 'home primary-choice', go: () => checkin('home', 'localizacao', g.distance) },
      { label: `🏢 ${h(t('geo.atOffice'))}`, cls: 'office', go: () => checkin('office', 'manual', g.distance, $('#office-pick')?.value || expected) },
    ];
  }
  $('#geo-title').textContent = `📍 ${t(g.verdict === 'probable' ? 'geo.titleConfirm' : 'geo.titleAway')}`;
  $('#geo-text').innerHTML = text;
  $('#geo-buttons').innerHTML = buttons.map((b, i) => `<button type="button" class="${b.cls}" data-i="${i}">${b.label}</button>`).join('');
  $$('#geo-buttons button').forEach((el) =>
    el.addEventListener('click', async () => {
      dlg.close();
      await buttons[Number(el.dataset.i)].go();
    }),
  );
  dlg.showModal();
}

async function undoToday() {
  await api(`/api/days/${S.today.date}`, { method: 'PUT', body: { status: null } });
  toast(t('toast.undone'));
  await load();
}

// ---------------------------------------------------------------- período (Painel)
/** Descrição curta da regra: "50% dos dias trabalháveis", "3 dias por semana"… */
function ruleText(r = S.settings.rules) {
  const base =
    r.target === 'daysPerWeek' ? t('rule.sumWeek', { n: r.daysPerWeek }) : r.target === 'daysPerMonth' ? t('rule.sumMonth', { n: r.daysPerMonth }) : t('rule.sumPct', { pct: r.officePct });
  const fixed = (r.fixedDays || []).length ? ` + ${t('rule.sumFixed', { days: r.fixedDays.map(DOW).join(', ') })}` : '';
  return `${base}${fixed} · ${t(`periodKind.${r.period || 'semester'}`)}`;
}

function renderSemester() {
  const r = S.report;
  const tt = r.totals;
  const label = h(S.semester.label);
  if (r.notStarted) {
    $('#semester-card').innerHTML = `<h3>${label} <span class="badge sem_contagem">${h(t('state.sem_contagem'))}</span></h3>
      <p class="hint">${h(t('alert.notStarted', { date: fmtFull(r.startDate) }))}</p>`;
    return;
  }
  const donePct = r.requiredOffice ? Math.min(100, (tt.office / r.requiredOffice) * 100) : 100;
  const planPct = r.requiredOffice ? Math.min(100, (r.plan.officeWithPlan / r.requiredOffice) * 100) : 100;
  const isPct = r.rules.target === 'percent';
  const planLine =
    r.plan.officeWithPlan > tt.office || r.plan.homeWithPlan > tt.home
      ? `<p class="hint">🗓️ ${t('sem.withPlan', { pct: `<b>${pct(r.plan.projectedPct)}</b>` })}${
          r.plan.neededAfterPlan === 0 && r.plan.credit > 0 ? ` · ${t('sem.credit', { n: r.plan.credit })}` : r.plan.neededAfterPlan ? ` · ${t('sem.toPlan', { n: r.plan.neededAfterPlan })}` : ''
        }. <a href="#planejamento">${h(t('sem.seePlan'))}</a></p>`
      : '';
  let ruleLine = `${h(t('sem.rule'))}: <b>${h(ruleText(r.rules))}</b>`;
  if (isPct) ruleLine += ` — ${t('sem.rulePct', { pct: r.rules.officePct, base: tt.base, n: r.requiredByPct })}`;
  if (r.bindingRule === 'teto') ruleLine += ` — ${t('sem.ruleCap', { cap: r.homeCap, n: `<b>${r.requiredOffice}</b>` })}`;
  $('#semester-card').innerHTML = `
    <h3>${label} <span class="badge ${r.status}">${h(t(`state.${r.status}`))}</span></h3>
    ${planLine}
    ${r.startDate ? `<p class="hint">📌 ${t('sem.since', { date: `<b>${fmtFull(r.startDate)}</b>` })}</p>` : ''}
    <div class="bar" title="${h(t('sem.barTitle'))}"><i class="plan" style="width:${planPct}%"></i><i style="width:${donePct}%"></i></div>
    <p class="hint">${h(t('sem.progress', { office: tt.office, required: r.requiredOffice }))}${r.plan.officeWithPlan > tt.office ? ` (+${r.plan.officeWithPlan - tt.office} ${h(t('sem.planned'))})` : ''}.<br>${ruleLine}.</p>
    <div class="stats">
      <div class="stat"><b>${tt.base}</b><span>${h(t('sem.base', { working: tt.working, absence: tt.absence }))}${
        tt.absence ? ` (${Object.entries(tt.absenceByType).map(([k, n]) => `${ABSENCE_ICON(k)} ${n}`).join(' ')})` : ''
      }</span></div>
      <div class="stat"><b>${r.officeNeeded}</b><span>${h(t('sem.needed'))}</span></div>
      <div class="stat"><b>${Math.max(0, r.homeLeft)}</b><span>${h(t('sem.homeLeft', { max: r.maxHome }))}</span></div>
      <div class="stat"><b>${tt.undecided}</b><span>${h(t('sem.undecided'))}${tt.pending ? ` (${h(t('sem.pending', { n: tt.pending }))})` : ''}</span></div>
      <div class="stat"><b>${pct(r.paceNeeded)}</b><span>${h(t('sem.pace', { perWeek: r.paceNeeded == null ? '—' : (r.paceNeeded * workdays().length).toLocaleString(intlLocale(), { maximumFractionDigits: 1 }) }))}</span></div>
      <div class="stat"><b>${tt.office + tt.home ? pct(tt.office / (tt.office + tt.home)) : '—'}</b><span>${h(t('sem.soFar'))}</span></div>
    </div>`;
}

function renderAlerts() {
  $('#alerts').innerHTML = S.report.alerts.map((a) => `<li class="${a.level}">${h(a.text)}</li>`).join('') || `<li class="ok">${h(t('dash.noAlerts'))}</li>`;
}

function renderMonths() {
  const target = S.report.rules.officePct / 100;
  $('#months-table').innerHTML = `
    <thead><tr><th>${h(t('mt.month'))}</th><th>${h(t('mt.workdays'))}</th><th>🏢</th><th>🏠</th><th>🌴</th><th>${h(t('mt.pct'))}</th><th>${h(t('mt.withPlan'))}</th><th>${h(t('mt.suggested'))}</th></tr></thead>
    <tbody>${S.report.months
      .map(
        (m) => `<tr class="${m.isCurrent ? 'current' : ''}">
          <td style="text-transform:capitalize">${h(m.name)}</td><td>${m.working}</td><td>${m.office}</td><td>${m.home}</td><td>${m.absence}</td>
          <td class="${m.officePct == null ? '' : m.officePct < target ? 'low' : 'good'}">${pct(m.officePct)}</td>
          <td>${pct(m.projectedPct)}</td><td>${m.open ? h(t('mt.recOf', { rec: m.recommendedOffice, open: m.open })) : '—'}</td></tr>`,
      )
      .join('')}</tbody>`;
}

// ---------------------------------------------------------------- calendário
function dayInfo(date) {
  const hol = S.holidays[date];
  const rec = S.days[date] || {};
  const wd = new Date(date + 'T12:00:00Z').getUTCDay();
  const trip = tripFor(date);
  const plan = rec.status ? null : rec.plan || (trip && date >= S.now.date ? 'office' : null);
  const beforeStart = Boolean(S.settings.rules.startDate && date < S.settings.rules.startDate);
  return { hol, rec, trip, plan, beforeStart, wd, weekend: !workdays().includes(wd), past: date < S.now.date, today: date === S.now.date, future: date > S.now.date };
}

function dayClasses(date) {
  const { hol, rec, plan, beforeStart, weekend, past, today } = dayInfo(date);
  const c = ['day'];
  if (beforeStart && !weekend) {
    c.push('before-start');
    if (today) c.push('today');
    return c.join(' ');
  }
  if (weekend) c.push('weekend');
  else if (hol) c.push('holiday');
  else if (rec.status) c.push(rec.status);
  else if (past) c.push('pending');
  if (plan) c.push(`plan-${plan}`);
  if (today) c.push('today');
  return c.join(' ');
}

function renderCalendar() {
  const { start, end } = S.semester;
  let html = '';
  for (let cur = start.slice(0, 7); cur <= end.slice(0, 7); ) {
    const [y, m] = cur.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const mi = S.report.months.find((x) => x.key === cur);
    const lead = (first.getUTCDay() + 6) % 7; // semana começa na segunda
    let cells = WEEK_ORDER.map((d) => `<div class="dow">${h(DOW(d))}</div>`).join('');
    cells += '<div class="day empty"></div>'.repeat(lead);
    for (let d = 1; d <= nDays; d++) {
      const iso = `${cur}-${String(d).padStart(2, '0')}`;
      const { hol, rec, trip } = dayInfo(iso);
      const title = [
        hol && `${hol.name} (${hol.officeName})`,
        rec.status === 'absence' && `${dayLabel(rec)}${rec.justification ? `: ${rec.justification}` : ` (${t('abs.noJust')})`}`,
        trip && `${t('cal.trip')}: ${officeName(trip.officeId)}`,
        rec.note,
      ]
        .filter(Boolean)
        .join(' · ');
      cells += `<button class="${dayClasses(iso)}" data-day="${iso}" title="${h(title)}">${trip ? '<span class="trip">✈️</span>' : ''}${d}${rec.status ? `<small>${dayIcon(rec)}</small>` : ''}</button>`;
    }
    html += `<div class="month"><h3>${h(monthYear(`${cur}-15`))}
      <small>${mi ? `🏢 ${mi.office} · 🏠 ${mi.home} · ${pct(mi.officePct)}` : ''}</small></h3><div class="cal">${cells}</div></div>`;
    cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  $('#calendar').innerHTML = html;
  $$('#calendar [data-day]').forEach((b) => b.addEventListener('click', () => openDay(b.dataset.day)));

  $('#holiday-list').innerHTML =
    Object.entries(S.holidays)
      .filter(([d]) => !S.settings.rules.startDate || d >= S.settings.rules.startDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, x]) => {
        const { wd, weekend } = dayInfo(d);
        return `<li${weekend ? ' class="hint"' : ''}><span>${h(DOW(wd))} ${fmtDM(d)} — ${h(x.name)} <small>${h(t(`scope.${x.type}`))} · ${h(x.officeName)}${weekend ? ` · ${h(t('cal.onDayOff'))}` : ''}</small></span></li>`;
      })
      .join('') || `<li class="hint">${h(t('cal.noHolidays'))}</li>`;
}

function openDay(date) {
  const { hol, rec, weekend, future, beforeStart } = dayInfo(date);
  if (weekend) return;
  if (beforeStart) return toast(t('toast.beforeStart'));
  if (hol) return toast(`${t('cal.holiday')}: ${hol.name} (${hol.officeName})`);
  const dlg = $('#day-dialog');
  $('#dd-title').textContent = fmtLong(date);
  let sub = future ? t('day.future') : rec.status ? t('day.recorded', { what: dayLabel(rec) }) : t('day.none');
  if (rec.status === 'absence') sub += ` — ${rec.justification || t('abs.noJust')}`;
  const trip = tripFor(date);
  if (trip) sub += ` ✈️ ${t('cal.trip')}: ${officeName(trip.officeId)}.`;
  $('#dd-sub').textContent = sub;
  const field = future ? 'plan' : 'status';
  const showOffice = !future && multiOffice();
  $('#dd-office-wrap').hidden = !showOffice;
  if (showOffice) {
    const sel = rec.officeId || trip?.officeId || S.settings.primaryOfficeId;
    $('#dd-office').innerHTML = S.settings.offices.map((o) => `<option value="${o.id}" ${o.id === sel ? 'selected' : ''}>${h(o.name)}</option>`).join('');
  }
  const cur = rec[field];
  $('#dd-buttons').innerHTML =
    ['office', 'home'].map((s) => `<button type="button" class="${s} ${cur === s ? 'sel' : ''}" data-v="${s}">${ICON[s]} ${h(future ? t('day.plan', { what: LABEL(s) }) : LABEL(s))}</button>`).join('') +
    `<button type="button" class="absence ${rec.status === 'absence' ? 'sel' : ''}" data-v="absence">${rec.status === 'absence' ? `${dayIcon(rec)} ${h(t('day.editAbsence'))}` : `🌴 ${h(t('day.absence'))}`}</button>` +
    `<button type="button" data-v="">${h(t('ui.clear'))}</button>`;
  $('#dd-note').value = rec.note || '';
  $$('#dd-buttons button').forEach((b) =>
    b.addEventListener('click', async () => {
      if (b.dataset.v === 'absence') {
        dlg.close();
        openAbsence({ start: date, end: date, ...(rec.status === 'absence' ? absenceOf(date) : {}) });
        return;
      }
      const body = { [field]: b.dataset.v || null, note: $('#dd-note').value || null };
      if (showOffice && b.dataset.v === 'office') body.officeId = $('#dd-office').value;
      await api(`/api/days/${date}`, { method: 'PUT', body });
      dlg.close();
      await load();
    }),
  );
  dlg.showModal();
}

// ---------------------------------------------------------------- planejamento
function addDaysIso(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Dias de trabalho de uma semana (que começa na segunda `start`). */
const weekDates = (start) => weekCols().map((wd) => addDaysIso(start, (wd + 6) % 7));

function editable(d) {
  const { hol, rec, future, today, beforeStart, weekend } = dayInfo(d);
  return d >= S.semester.start && d <= S.semester.end && !weekend && !hol && (future || today) && !rec.status && !beforeStart;
}

function renderPlanning() {
  const r = S.report;
  renderTrips();
  renderAbsences();
  const target = r.rules.target;
  $('#plan-hint').innerHTML = t(target === 'percent' ? 'plan.hintPct' : target === 'daysPerWeek' ? 'plan.hintWeek' : 'plan.hintMonth');
  if (r.notStarted) {
    $('#plan-bar').innerHTML = `<p class="hint">${h(t('plan.notStarted'))}</p>`;
    $('#plan-detail').innerHTML = '';
    $('#weeks').innerHTML = '';
    $('#plan-actions').innerHTML = '';
    return;
  }
  renderPlanBar(r);
  const pctT = r.baselinePace;
  const cols = weekCols();
  const weekHtml = (w) => {
    const days = weekDates(w.start).map((d) => {
      const { hol, rec, plan, trip, beforeStart, wd } = dayInfo(d);
      const inP = d >= S.semester.start && d <= S.semester.end;
      const cls = rec.status || (plan ? `plan-${plan}` : '');
      const lbl = !inP || beforeStart ? '–' : hol ? '🎉' : rec.status ? dayIcon(rec) : plan ? ICON[plan] + (trip ? '✈️' : '') : '·';
      const fixed = (r.rules.fixedDays || []).includes(wd) ? ' fixed' : '';
      return `<button data-plan="${d}" class="${cls}${fixed}" ${editable(d) ? '' : 'disabled'} title="${h(hol?.name || '')}">${h(DOW(wd))} ${fmtDM(d)}<br>${lbl}</button>`;
    });
    const off = w.office + w.plannedOffice;
    const home = w.home + w.plannedHome;
    const anyEditable = weekDates(w.start).some(editable);
    const goal = target === 'daysPerWeek' ? ` · ${h(t('plan.weekGoal', { office: off, target: w.target }))}${w.isPast ? (w.met ? ' ✅' : ' ❌') : ''}` : '';
    const cum = w.cumPct == null || target === 'daysPerWeek' ? '' : `<span class="cum ${w.cumPct + 1e-9 >= pctT ? 'good' : 'low'}" title="${h(t('plan.cumTitle'))}">${h(t('plan.cum', { pct: pct(w.cumPct), office: w.cumOffice, base: w.cumBase }))}</span>`;
    return `<div class="week ${w.isCurrent ? 'current' : ''} ${w.isPast ? 'past' : ''}">
        <header><b>${h(w.isCurrent ? t('plan.thisWeek') : t('plan.weekOf', { date: fmtDM(w.start) }))}</b>
          <span>🏢 ${off} · 🏠 ${home}${w.absence ? ` · 🌴 ${w.absence}` : ''}${w.unplanned ? ` · ${h(t('plan.free', { n: w.unplanned }))}` : ''}${goal} ${cum}</span></header>
        ${w.holidayList.length ? `<small class="hint">🎉 ${h(w.holidayList.map((x) => `${fmtDM(x.date)} ${x.name}`).join(', '))}</small>` : ''}
        <div class="days" style="grid-template-columns:repeat(${cols.length},minmax(0,1fr))">${days.join('')}</div>
        ${w.suggestedOffice ? `<p class="hint suggest">💡 ${h(t('plan.suggest', { n: w.suggestedOffice }))}</p>` : ''}
        ${anyEditable ? `<div class="week-actions">
          <button data-week="${w.start}" data-set="office">🏢 ${h(t('plan.allOffice'))}</button>
          <button data-week="${w.start}" data-set="home">🏠 ${h(t('plan.allHome'))}</button>
          <button data-week="${w.start}" data-set="vacation">🌴 ${h(t('abs.ferias'))}</button>
          <button data-week="${w.start}" data-set="clear">${h(t('ui.clear'))}</button></div>` : ''}
      </div>`;
  };
  const past = r.weeks.filter((w) => w.isPast);
  const coming = r.weeks.filter((w) => !w.isPast);
  $('#weeks').innerHTML =
    (past.length ? `<details class="past-weeks"><summary>${h(t('plan.pastWeeks', { n: past.length }))}</summary>${past.map(weekHtml).join('')}</details>` : '') +
    (coming.map(weekHtml).join('') || `<p class="hint">${h(t('plan.ended'))}</p>`);
  $$('#weeks [data-plan]').forEach((b) => b.addEventListener('click', () => cyclePlan(b.dataset.plan)));
  $$('#weeks [data-week]').forEach((b) => b.addEventListener('click', () => setWeek(b.dataset.week, b.dataset.set)));

  $('#plan-actions').innerHTML = `<div class="row">
      ${r.plan.unplanned ? `<button id="auto-plan">✨ ${h(t('plan.autoFill'))}</button>` : ''}
      ${r.totals.plannedOffice || r.totals.plannedHome ? `<button id="clear-plan">↺ ${h(t('plan.clearAll'))}</button>` : ''}</div>
    <p class="hint">${h(t('plan.tapHint'))}</p>`;
  $('#auto-plan')?.addEventListener('click', autoPlan);
  $('#clear-plan')?.addEventListener('click', clearPlan);
}

/** Barra de projeção: feito + planejado vs. o mínimo, e o "crédito". */
function renderPlanBar(r) {
  const tt = r.totals;
  const p = r.plan;
  const base = tt.base || 1;
  const seg = (n, cls, title) => (n > 0 ? `<i class="${cls}" style="width:${(n / base) * 100}%" title="${h(title)}: ${n}"></i>` : '');
  const minPct = (r.requiredOffice / base) * 100;
  let verdict;
  if (p.homeOverCap) verdict = `<span class="low">⚠️ ${h(t('plan.overCap', { n: p.homeOverCap }))}</span>`;
  else if (p.fixedPlannedHome.length) verdict = `<span class="low">⚠️ ${h(t('alert.fixedPlannedHome', { list: p.fixedPlannedHome.map(fmtDM).join(', ') }))}</span>`;
  else if (p.neededAfterPlan === 0)
    verdict = `<span class="good">✅ ${h(p.credit > 0 ? t(p.unplanned ? 'plan.okCreditFree' : 'plan.okCredit', { n: p.credit, free: p.unplanned }) : t(p.unplanned ? 'plan.okFree' : 'plan.ok', { free: p.unplanned }))}</span>`;
  else if (p.neededAfterPlan <= p.unplanned) verdict = h(t('plan.missing', { n: p.neededAfterPlan, free: p.unplanned, home: p.homeFree }));
  else verdict = `<span class="low">❌ ${h(t('plan.notEnough', { n: p.neededAfterPlan, free: p.unplanned }))}</span>`;
  const short = p.homeOverCap
    ? `<span class="low">${h(t('plan.shortOverCap'))}</span>`
    : p.neededAfterPlan === 0
      ? `<span class="good">✅ ${h(r.rules.target === 'percent' ? t('plan.shortCredit', { n: p.credit > 0 ? `+${p.credit}` : '0' }) : t('plan.shortOk'))}</span>`
      : `<span class="low">${h(t('plan.shortMissing', { n: p.neededAfterPlan }))}</span>`;
  $('#plan-bar').innerHTML = `
    <div class="plan-head"><b>${h(t('plan.head', { pct: pct(p.projectedPct) }))}</b> <span class="hint">${h(t('plan.min', { rule: ruleText(r.rules), required: r.requiredOffice, base: tt.base }))}</span> ${short}</div>
    <div class="stack" role="img" aria-label="${h(t('plan.head', { pct: pct(p.projectedPct) }))}">
      ${seg(tt.office, 's-office', t('plan.segOffice'))}${seg(tt.plannedOffice, 's-office plan', t('plan.segOfficePlan'))}${seg(tt.home, 's-home', t('plan.segHome'))}${seg(tt.plannedHome, 's-home plan', t('plan.segHomePlan'))}${seg(p.unplanned - tt.pending, 's-free', t('plan.segFree'))}${seg(tt.pending, 's-free', t('cal.pending'))}
      <b class="min" style="left:${minPct}%" title="${h(t('plan.minimum'))}"></b>
    </div>`;
  $('#plan-detail').innerHTML = `
    <div class="plan-legend"><span><i class="s-office"></i>🏢 ${h(t('plan.legendOffice', { done: tt.office, planned: tt.plannedOffice }))} = <b>${p.officeWithPlan}</b></span>
      <span><i class="s-home"></i>🏠 ${tt.home} + ${tt.plannedHome} = <b>${p.homeWithPlan}</b></span>
      <span><i class="s-free"></i>${h(t('plan.legendFree', { n: p.unplanned - tt.pending }))}${tt.pending ? ` · ${h(t('sem.pending', { n: tt.pending }))}` : ''}</span>${tt.absence ? `<span>🌴 ${h(t('plan.outOfBase', { n: tt.absence }))}</span>` : ''}</div>
    <p class="verdict">${verdict}</p>`;
}

async function putPlans(dates, plan) {
  for (const d of dates) await api(`/api/days/${d}`, { method: 'PUT', body: { plan } });
}

async function setWeek(start, what) {
  const dates = weekDates(start).filter(editable);
  if (!dates.length) return;
  if (what === 'vacation') return openAbsence({ type: 'ferias', start: dates[0], end: dates[dates.length - 1] });
  await putPlans(dates, what === 'clear' ? null : what);
  await load();
}

async function clearPlan() {
  if (!confirm(t('plan.clearConfirm'))) return;
  const dates = Object.entries(S.days)
    .filter(([d, r]) => d >= S.now.date && !r.status && (r.plan === 'office' || r.plan === 'home'))
    .map(([d]) => d);
  await putPlans(dates, null);
  toast(t('plan.cleared', { n: dates.length }));
  await load();
}

async function cyclePlan(date) {
  // livre → escritório → casa → livre
  const cur = S.days[date]?.plan || null;
  const next = cur === null ? 'office' : cur === 'office' ? 'home' : null;
  await api(`/api/days/${date}`, { method: 'PUT', body: { plan: next } });
  await load();
}

/** Preenche os dias LIVRES com a sugestão (dias fixos primeiro, depois ter–qui). Não mexe no que já planejou. */
async function autoPlan() {
  const fixed = S.settings.rules.fixedDays || [];
  const prefer = [...fixed, 2, 3, 4, 1, 5, 6, 0];
  const writes = [];
  for (const w of S.report.weeks.filter((x) => !x.isPast)) {
    const free = weekDates(w.start)
      .filter((d) => editable(d) && !dayInfo(d).plan)
      .map((d) => ({ d, wd: dayInfo(d).wd }));
    free.sort((a, b) => prefer.indexOf(a.wd) - prefer.indexOf(b.wd));
    let need = w.suggestedOffice;
    for (const f of free) {
      writes.push({ d: f.d, plan: need > 0 ? 'office' : 'home' });
      if (need > 0) need--;
    }
  }
  for (const w of writes) await api(`/api/days/${w.d}`, { method: 'PUT', body: { plan: w.plan } });
  toast(t('plan.filled', { n: writes.length }));
  await load();
}

// ---------------------------------------------------------------- férias e ausências
const absenceOf = (date) => {
  const a = S.absences.find((x) => x.start <= date && date <= x.end);
  return a ? { id: a.id, type: a.type, justification: a.justification, start: a.start, end: a.end } : {};
};

function renderAbsences() {
  $('#absences').innerHTML =
    S.absences
      .map((a) => {
        const missing = a.type === 'nao_especificado' || (ABSENCE_TYPES[a.type]?.justificationRequired && !a.justification);
        const period = a.start === a.end ? fmtDM(a.start) : `${fmtDM(a.start)} – ${fmtDM(a.end)}`;
        return `<li><span>${ABSENCE_ICON(a.type)} <b>${h(ABSENCE_LABEL(a.type))}</b> · ${period} · ${h(t('abs.days', { n: a.days }))}<br>
          <small>${a.justification ? h(a.justification) : missing ? `<span class="warn-txt">⚠️ ${h(t('abs.missingJust'))}</span>` : h(t('abs.noJust'))}</small></span>
          <span class="actions"><button type="button" data-ab-edit="${a.id}">${h(t('ui.edit'))}</button><button type="button" data-ab-del="${a.id}" title="${h(t('ui.remove'))}">✖</button></span></li>`;
      })
      .join('') || `<li class="hint">${h(t('abs.none'))}</li>`;
  $$('[data-ab-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      const a = S.absences.find((x) => x.id === b.dataset.abEdit);
      openAbsence({ id: a.id, type: a.type, justification: a.justification, start: a.start, end: a.end });
    }),
  );
  $$('[data-ab-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(t('abs.removeConfirm'))) return;
      await api(`/api/absences/${b.dataset.abDel}`, { method: 'DELETE' });
      toast(t('abs.removed'));
      await load();
    }),
  );
}

let absenceEditId = null;
function openAbsence({ id = null, type = 'ferias', justification = '', start = S.now.date, end } = {}) {
  absenceEditId = id;
  const f = $('#absence-form');
  $('#ab-title').textContent = t(id ? 'abs.editTitle' : 'abs.newTitle');
  $('#ab-types').innerHTML =
    `<legend>${h(t('abs.type'))}</legend>` +
    Object.entries(ABSENCE_TYPES)
      .map(([k, ty]) => `<label><input type="radio" name="type" value="${k}" ${k === type ? 'checked' : ''}/> ${ty.icon} ${h(ty.label)}</label>`)
      .join('');
  if (!ABSENCE_TYPES[type]) f.querySelector('input[name=type]').checked = true;
  f.start.value = start;
  f.end.value = end || start;
  f.justification.value = justification || '';
  $('#ab-error').textContent = '';
  updateAbsenceHint();
  $$('input[name=type]', f).forEach((r) => r.addEventListener('change', updateAbsenceHint));
  $('#absence-dialog').showModal();
}

function updateAbsenceHint() {
  const f = $('#absence-form');
  const ty = ABSENCE_TYPES[f.querySelector('input[name=type]:checked').value];
  $('#ab-just-label').textContent = t(ty.justificationRequired ? 'abs.justRequired' : 'abs.justOptional');
  f.justification.required = ty.justificationRequired;
  f.justification.placeholder = ty.hint;
  $('#ab-hint').textContent = ty.hint;
}

$('#absence-form').start.addEventListener('change', (e) => {
  const f = e.target.form;
  if (!f.end.value || f.end.value < f.start.value) f.end.value = f.start.value;
});

async function saveAbsence(overwrite = false) {
  const f = $('#absence-form');
  const body = {
    type: f.querySelector('input[name=type]:checked').value,
    start: f.start.value,
    end: f.end.value,
    justification: f.justification.value.trim(),
    replaceId: absenceEditId,
    overwrite,
  };
  let data;
  try {
    data = await api('/api/absences', { method: 'POST', body });
  } catch (err) {
    if (err.status === 409) {
      const c = err.data.conflicts;
      const list = c.slice(0, 6).map(fmtDM).join(', ');
      if (confirm(t('abs.replaceConfirm', { msg: err.message, list: `${list}${c.length > 6 ? '…' : ''}` }))) return saveAbsence(true);
      return;
    }
    $('#ab-error').textContent = err.message;
    return;
  }
  $('#absence-dialog').close();
  toast(t('abs.saved', { label: data.label, n: data.days }));
  await load();
}
$('#ab-save').addEventListener('click', () => saveAbsence());
$('#absence-add').addEventListener('click', () => openAbsence());

function renderTrips() {
  const f = $('#trip-form');
  const keep = f.officeId.value;
  const opts = [...S.settings.offices].sort((a, b) => (a.id === S.settings.primaryOfficeId) - (b.id === S.settings.primaryOfficeId));
  f.officeId.innerHTML = opts.map((o) => `<option value="${o.id}">${h(o.name)}</option>`).join('');
  if (keep) f.officeId.value = keep;
  $('#trips').innerHTML =
    S.settings.trips
      .map(
        (x) => `<li><span>✈️ <b>${h(officeName(x.officeId))}</b> · ${fmtFull(x.start)} – ${fmtFull(x.end)}${x.note ? ` <small>${h(x.note)}</small>` : ''}</span>
          <span class="actions"><button type="button" data-trip-del="${x.id}" title="${h(t('ui.remove'))}">✖</button></span></li>`,
      )
      .join('') || `<li class="hint">${h(t('trip.none'))}${multiOffice() ? '' : ` ${h(t('trip.addOfficesFirst'))}`}</li>`;
  $$('[data-trip-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/api/trips/${b.dataset.tripDel}`, { method: 'DELETE' });
      await load();
    }),
  );
}

$('#trip-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/trips', { method: 'POST', body: { officeId: f.officeId.value, start: f.start.value, end: f.end.value, note: f.note.value } });
    f.reset();
    toast(t('trip.saved'));
    await load();
  } catch (err) {
    toast(err.message);
  }
});

// ---------------------------------------------------------------- ajustes
// Campos de hora em listas (o relógio nativo do Android corta o botão OK com letra grande).
const pad2 = (n) => String(n).padStart(2, '0');
function initTimeFields() {
  for (const el of $$('.time-field')) {
    const n = el.dataset.name;
    const hours = Array.from({ length: 24 }, (_, i) => `<option>${pad2(i)}</option>`).join('');
    const mins = Array.from({ length: 12 }, (_, i) => `<option>${pad2(i * 5)}</option>`).join('');
    el.innerHTML = `<select name="${n}H">${hours}</select><b>:</b><select name="${n}M">${mins}</select>`;
  }
}
function setTime(form, n, value) {
  const [hh, mm] = String(value || '09:00').split(':');
  form[`${n}H`].value = hh;
  const sel = form[`${n}M`];
  if (![...sel.options].some((o) => o.value === mm)) sel.add(new Option(mm, mm));
  sel.value = mm;
}
const getTime = (form, n) => `${form[`${n}H`].value}:${form[`${n}M`].value}`;
initTimeFields();

// Alterações por salvar nos Ajustes não se perdem quando a app recarrega os dados.
let settingsDirty = false;
for (const ev of ['input', 'change']) {
  $('#settings-form').addEventListener(ev, (e) => {
    if (!['backup-import', 'locale-select', 'stats-toggle'].includes(e.target.id)) settingsDirty = true;
  });
}

const checkboxes = (name, days, checked) =>
  days.map((d) => `<label><input type="checkbox" name="${name}" value="${d}" ${checked.includes(d) ? 'checked' : ''}/> ${h(DOW(d))}</label>`).join('');
const checkedValues = (name) => $$(`input[name=${name}]:checked`, $('#settings-form')).map((x) => Number(x.value));

function renderSettings() {
  const s = S.settings;
  const f = $('#settings-form');
  f.locale.innerHTML = langOptions(getLocale());
  renderOffices();
  if (LOCAL) {
    renderLocalCards();
    renderBackupInfo();
    renderBackupDue();
  } else renderPushStatus();
  if (settingsDirty) return;
  const r = s.rules;
  $('#rule-template').innerHTML =
    RULE_TEMPLATES.map((tp) => `<option value="${tp.id}">${h(t(`tpl.${tp.id}`))}</option>`).join('') + `<option value="custom">${h(t('tpl.custom'))}</option>`;
  $('#rule-template').value = matchTemplate(r);
  f.target.value = r.target || 'percent';
  f.officePct.value = r.officePct;
  f.daysPerWeek.value = r.daysPerWeek;
  f.daysPerMonth.value = r.daysPerMonth;
  f.period.value = r.period || 'semester';
  $('#fixed-days').innerHTML = `<legend>${h(t('rule.fixedDays'))}</legend>` + checkboxes('fixed', WEEK_ORDER.filter((d) => s.workdays.includes(d)), r.fixedDays || []);
  $('#workdays').innerHTML = `<legend>${h(t('rule.workdays'))}</legend>` + checkboxes('workday', WEEK_ORDER, s.workdays);
  f.startDate.value = r.startDate || '';
  f.maxHomeDays.value = r.maxHomeDays;
  f.enforceHomeCap.checked = Boolean(r.enforceHomeCap);
  f.maxHomeDays.disabled = !f.enforceHomeCap.checked;
  f.companyName.value = s.companyName || '';
  f.reminderEnabled.checked = s.reminder.enabled;
  setTime(f, 'reminderTime', s.reminder.time);
  f.repeatMinutes.value = s.reminder.repeatMinutes;
  setTime(f, 'reminderUntil', s.reminder.until);
  f.weekly.checked = s.summaries.weekly;
  f.monthly.checked = s.summaries.monthly;
  $('#reminder-days').innerHTML = `<legend>${h(t('rem.days'))}</legend>` + checkboxes('wd', WEEK_ORDER.filter((d) => s.workdays.includes(d)), s.reminder.weekdays);
  f.locationEnabled.checked = s.location.enabled;
  setTime(f, 'windowStart', s.location.windowStart);
  setTime(f, 'windowEnd', s.location.windowEnd);
  f.askOnTimezoneChange.checked = s.askOnTimezoneChange;
  f.backupFrequency.value = s.backup.frequency;
  f.backupUrl.value = s.backup.autoUrl;
  f.backupToken.value = s.backup.autoToken;
  f.backupEmail.checked = s.backup.email;
  updateRuleUi();
}

/** Mostra só os campos do tipo de meta escolhido e um resumo da regra. */
function updateRuleUi() {
  const f = $('#settings-form');
  $$('.rule-val', f).forEach((el) => (el.hidden = el.dataset.for !== f.target.value));
  $('#rule-summary').textContent = `${t('sem.rule')}: ${ruleText(formRules())}`;
}
function formRules() {
  const f = $('#settings-form');
  return {
    target: f.target.value,
    officePct: Number(f.officePct.value),
    daysPerWeek: Number(f.daysPerWeek.value),
    daysPerMonth: Number(f.daysPerMonth.value),
    period: f.period.value,
    fixedDays: checkedValues('fixed'),
    maxHomeDays: Number(f.maxHomeDays.value),
    enforceHomeCap: f.enforceHomeCap.checked,
    startDate: f.startDate.value || null,
  };
}
$('#rule-template').addEventListener('change', (e) => {
  const tp = RULE_TEMPLATES.find((x) => x.id === e.target.value);
  if (!tp) return;
  const f = $('#settings-form');
  const r = tp.rules;
  f.target.value = r.target;
  if (r.officePct) f.officePct.value = r.officePct;
  if (r.daysPerWeek) f.daysPerWeek.value = r.daysPerWeek;
  if (r.daysPerMonth) f.daysPerMonth.value = r.daysPerMonth;
  f.period.value = r.period;
  $$('input[name=fixed]', f).forEach((x) => (x.checked = r.fixedDays.includes(Number(x.value))));
  settingsDirty = true;
  updateRuleUi();
});
$('#settings-form').addEventListener('change', (e) => {
  if (['target', 'officePct', 'daysPerWeek', 'daysPerMonth', 'period', 'fixed'].includes(e.target.name)) {
    $('#rule-template').value = matchTemplate(formRules());
    updateRuleUi();
  }
});

// Idioma: aplica-se logo (sem precisar de "Salvar").
$('#locale-select').addEventListener('change', async (e) => {
  useLocale(e.target.value);
  await api('/api/settings', { method: 'PUT', body: { locale: e.target.value } });
  await load();
});

const countryName = (c) => {
  try {
    return new Intl.DisplayNames([intlLocale()], { type: 'region' }).of(c) || S.meta.countries[c] || c;
  } catch {
    return S.meta.countries[c] || c;
  }
};
function cityName(o) {
  for (const list of Object.values(S.meta.cityPresets || {})) {
    const p = list.find((x) => x.id === o.city);
    if (p) return p.name;
  }
  return o.city;
}
const countryOptions = (selected) => {
  const codes = Object.keys(S.meta.countries).sort((a, b) => countryName(a).localeCompare(countryName(b), intlLocale()));
  const top = ['PT', 'BR'];
  return [...top, ...codes.filter((c) => !top.includes(c))].map((c) => `<option value="${c}" ${c === selected ? 'selected' : ''}>${h(countryName(c))}</option>`).join('');
};

function renderOffices() {
  const s = S.settings;
  $('#offices').innerHTML = s.offices
    .map((o) => {
      const primary = o.id === s.primaryOfficeId;
      return `<li><span><b>${h(o.name)}</b>${primary ? ` ⭐ ${h(t('off.primary'))}` : ''}<br>
        <small>${h(countryName(o.country))}${o.region ? ` · ${h(o.regionName || o.region)}` : ''}${o.city ? ` · ${h(cityName(o))}` : ''} · ${h(o.timezone)} · ${h(t(o.location ? 'off.hasLocation' : 'off.noLocation'))}</small></span>
        <span class="actions"><button type="button" data-of-edit="${o.id}">${h(t('ui.edit'))}</button>${primary ? '' : `<button type="button" data-of-primary="${o.id}" title="${h(t('off.makePrimary'))}">⭐</button><button type="button" data-of-del="${o.id}" title="${h(t('ui.remove'))}">✖</button>`}</span></li>`;
    })
    .join('');
  $$('[data-of-edit]').forEach((b) => b.addEventListener('click', () => openOffice(b.dataset.ofEdit)));
  $$('[data-of-primary]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api('/api/settings', { method: 'PUT', body: { primaryOfficeId: b.dataset.ofPrimary } });
      toast(t('off.primaryChanged'));
      await load();
    }),
  );
  $$('[data-of-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(t('off.removeConfirm', { name: officeName(b.dataset.ofDel) }))) return;
      try {
        await api(`/api/offices/${b.dataset.ofDel}`, { method: 'DELETE' });
        await load();
      } catch (err) {
        toast(err.message);
      }
    }),
  );
}

// ---- diálogo de escritório -------------------------------------------------------
let officeEdit = null;
let countryMeta = null;

async function openOffice(id, preset = {}) {
  const primary = officeById(S.settings.primaryOfficeId);
  officeEdit = id
    ? structuredClone(officeById(id))
    : { name: '', country: primary?.country || 'PT', region: '', timezone: '', location: null, radiusM: 200, optionalHolidays: { carnaval: true, corpusChristi: true }, customHolidays: [], city: '', ...preset };
  const f = $('#office-form');
  $('#of-title').textContent = id ? t('of.editTitle', { name: officeEdit.name }) : t('of.newTitle');
  f.name.value = officeEdit.name;
  f.address.value = officeEdit.location?.label || '';
  f.radiusM.value = officeEdit.radiusM;
  f.primary.checked = id === S.settings.primaryOfficeId;
  f.country.innerHTML = countryOptions(officeEdit.country);
  await loadCountryMeta(officeEdit.country);
  $('#office-dialog').showModal();
}

async function loadCountryMeta(country) {
  countryMeta = await api(`/api/countries/${country}`);
  const f = $('#office-form');
  const regions = Object.entries(countryMeta.regions);
  f.region.innerHTML = `<option value="">${h(t(regions.length ? 'of.wholeCountry' : 'of.notApplicable'))}</option>` + regions.map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join('');
  f.region.value = officeEdit.region || '';
  f.region.disabled = regions.length === 0;
  const tzs = [...new Set([...(countryMeta.timezones || []), officeEdit.timezone].filter(Boolean))];
  if (!officeEdit.timezone) officeEdit.timezone = tzs[0] || 'UTC';
  f.timezone.innerHTML = (tzs.length ? tzs : ['UTC']).map((z) => `<option>${h(z)}</option>`).join('');
  f.timezone.value = officeEdit.timezone;
  $('#of-optional').innerHTML =
    `<legend>${h(t('of.optional'))}</legend>` +
    countryMeta.optional.map((o) => `<label><input type="checkbox" data-opt="${o.key}" ${officeEdit.optionalHolidays?.[o.key] ? 'checked' : ''}/> ${h(o.name)}</label>`).join('');
  if (!officeEdit.city) officeEdit.city = countryMeta.presets.find((p) => presetIn(p, officeEdit.customHolidays))?.id || '';
  $('#of-city-wrap').hidden = countryMeta.presets.length === 0;
  $('#of-city').innerHTML = `<option value="">${h(t('of.noCity'))}</option>` + countryMeta.presets.map((p) => `<option value="${p.id}">${h(p.name)}</option>`).join('');
  $('#of-city').value = officeEdit.city || '';
  renderOfficeLoc();
  renderOfficeCustom();
}

const sameHoliday = (a, b) => a.date === b.date && a.name === b.name;
const presetIn = (p, list) => p.holidays.every((hd) => list.some((c) => sameHoliday(c, hd)));
const cityPreset = () => countryMeta?.presets.find((p) => p.id === officeEdit.city) || null;
const fmtHol = (d) => (d.length === 5 ? fmtDM(`2026-${d}`) : fmtFull(d));

$('#of-city').addEventListener('change', (e) => {
  const prev = cityPreset();
  if (prev) officeEdit.customHolidays = officeEdit.customHolidays.filter((c) => !prev.holidays.some((hd) => sameHoliday(c, hd)));
  officeEdit.city = e.target.value;
  const p = cityPreset();
  if (p) {
    for (const hd of p.holidays) if (!officeEdit.customHolidays.some((c) => sameHoliday(c, hd))) officeEdit.customHolidays.push({ ...hd });
    if (!$('#office-form').name.value.trim()) $('#office-form').name.value = p.name;
  }
  renderOfficeCustom();
});

async function refreshHolidayPreview() {
  const box = $('#of-all-holidays');
  try {
    const { year, holidays } = await api('/api/holidays/preview', {
      method: 'POST',
      body: {
        country: officeEdit.country,
        region: officeEdit.region,
        optionalHolidays: Object.fromEntries((countryMeta?.optional || []).map((o) => [o.key, Boolean($(`#of-optional [data-opt="${o.key}"]`)?.checked)])),
        customHolidays: officeEdit.customHolidays,
        year: S.semester.year,
      },
    });
    const work = holidays.filter((x) => !x.weekend).length;
    box.querySelector('summary').textContent = `📅 ${t('of.allHolidays', { year, n: holidays.length, work })}`;
    box.querySelector('ul').innerHTML = holidays
      .map((x) => {
        const wd = DOW(new Date(x.date + 'T12:00:00Z').getUTCDay());
        return `<li class="${x.weekend ? 'weekend' : ''}"><span>${h(wd)} ${fmtDM(x.date)} — ${h(x.name)}${x.weekend ? ` <small>(${h(t('of.weekend'))})</small>` : ''}</span> <span class="tag">${h(t(`scope.${x.type}`))}</span></li>`;
      })
      .join('');
  } catch (err) {
    box.querySelector('summary').textContent = err.message;
  }
}
$('#of-optional').addEventListener('change', refreshHolidayPreview);

function renderOfficeLoc() {
  const l = officeEdit.location;
  $('#of-loc').textContent = l ? `📍 ${l.label || ''} (${l.lat.toFixed(5)}, ${l.lng.toFixed(5)})` : t('of.noLocation');
}

function renderOfficeCustom() {
  const p = cityPreset();
  $('#of-city-hint').textContent = p
    ? t('of.cityHolidays', { city: p.name, list: p.holidays.map((hd) => `${fmtHol(hd.date)} ${hd.name}`).join(', ') })
    : t(countryMeta?.presets.length ? 'of.cityNone' : 'of.cityNoList');
  const items = officeEdit.customHolidays.map((c, i) => ({ c, i })).filter(({ c }) => !p?.holidays.some((hd) => sameHoliday(c, hd)));
  $('#of-custom').innerHTML =
    items
      .map(({ c, i }) => `<li><span>${fmtHol(c.date)}${c.date.length === 5 ? ` (${h(t('of.everyYear'))})` : ''} — ${h(c.name)} <small>${h(t(`scope.${c.scope || 'municipal'}`))}</small></span><button type="button" data-rm="${i}">✖</button></li>`)
      .join('') || `<li class="hint">${h(t('ui.none'))}</li>`;
  $$('#of-custom [data-rm]').forEach((b) =>
    b.addEventListener('click', () => {
      officeEdit.customHolidays.splice(Number(b.dataset.rm), 1);
      renderOfficeCustom();
    }),
  );
  refreshHolidayPreview();
}

$('#office-form').country.addEventListener('change', async (e) => {
  officeEdit.country = e.target.value;
  officeEdit.region = '';
  officeEdit.timezone = '';
  if (officeEdit.customHolidays.length) {
    toast(t('of.removedLocal', { n: officeEdit.customHolidays.length }));
    officeEdit.customHolidays = [];
  }
  officeEdit.city = '';
  officeEdit.optionalHolidays = { carnaval: true, corpusChristi: true };
  await loadCountryMeta(officeEdit.country);
});
$('#office-form').region.addEventListener('change', (e) => {
  officeEdit.region = e.target.value;
  officeEdit.regionName = countryMeta.regions[e.target.value] || '';
  refreshHolidayPreview();
});
$('#office-form').timezone.addEventListener('change', (e) => (officeEdit.timezone = e.target.value));

$('#of-ch-add').addEventListener('click', () => {
  const raw = $('#of-ch-date').value.trim();
  const name = $('#of-ch-name').value.trim();
  const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}))?$/.exec(raw);
  if (!m || !name) return toast(t('of.dateFormat'));
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  officeEdit.customHolidays.push({ date: m[3] ? `${m[3]}-${mm}-${dd}` : `${mm}-${dd}`, name, scope: $('#of-ch-scope').value });
  $('#of-ch-date').value = $('#of-ch-name').value = '';
  renderOfficeCustom();
});

$('#of-geocode').addEventListener('click', async () => {
  const q = $('#office-form').address.value.trim();
  if (!q) return;
  try {
    // Procura de endereços gratuita via OpenStreetMap (Nominatim), feita no navegador.
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=${getLocale()}&q=${encodeURIComponent(q)}`);
    const [hit] = await res.json();
    if (!hit) return toast(t('of.notFound'));
    officeEdit.location = { lat: Number(hit.lat), lng: Number(hit.lon), label: q };
    renderOfficeLoc();
  } catch {
    toast(t('of.searchFailed'));
  }
});

$('#of-here').addEventListener('click', async () => {
  try {
    toast(t('of.gettingPosition'));
    const p = await getPosition((x) => toast(x));
    officeEdit.location = { lat: p.lat, lng: p.lng, label: $('#office-form').address.value.trim() || t('of.positionLabel') };
    if (p.accuracy > 100) toast(t('of.lowAccuracy', { acc: Math.round(p.accuracy) }));
    renderOfficeLoc();
  } catch (e) {
    toast(e.message);
  }
});

$('#of-save').addEventListener('click', async () => {
  const f = $('#office-form');
  if (!f.name.value.trim()) return toast(t('err.officeName'));
  const body = {
    ...officeEdit,
    name: f.name.value.trim(),
    radiusM: Number(f.radiusM.value) || 200,
    optionalHolidays: Object.fromEntries(countryMeta.optional.map((o) => [o.key, $(`#of-optional [data-opt="${o.key}"]`).checked])),
    primary: f.primary.checked,
  };
  try {
    await api('/api/offices', { method: 'POST', body });
    $('#office-dialog').close();
    toast(t('of.saved'));
    await load();
  } catch (err) {
    toast(err.message);
  }
});

$('#office-add').addEventListener('click', () => openOffice(null));
$('#start-clear').addEventListener('click', () => {
  $('#settings-form').startDate.value = '';
  settingsDirty = true;
  toast(t('rule.noDateToast'));
});
$('#settings-form').enforceHomeCap.addEventListener('change', (e) => (e.target.form.maxHomeDays.disabled = !e.target.checked));

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const wdays = checkedValues('workday');
  if (!wdays.length) return toast(t('err.workdays'));
  const patch = {
    rules: formRules(),
    workdays: wdays,
    companyName: f.companyName.value.trim(),
    reminder: {
      enabled: f.reminderEnabled.checked,
      time: getTime(f, 'reminderTime'),
      repeatMinutes: Number(f.repeatMinutes.value),
      until: getTime(f, 'reminderUntil'),
      weekdays: checkedValues('wd'),
    },
    summaries: { weekly: f.weekly.checked, monthly: f.monthly.checked },
    location: { enabled: f.locationEnabled.checked, windowStart: getTime(f, 'windowStart'), windowEnd: getTime(f, 'windowEnd') },
    askOnTimezoneChange: f.askOnTimezoneChange.checked,
    backup: { frequency: f.backupFrequency.value, autoUrl: f.backupUrl.value.trim(), autoToken: f.backupToken.value.trim(), email: f.backupEmail.checked },
  };
  // Dias fixos e de lembrete só podem ser dias de trabalho.
  patch.rules.fixedDays = patch.rules.fixedDays.filter((d) => wdays.includes(d));
  if (patch.location.enabled && !S.settings.offices.some((o) => o.location)) return toast(t('loc.needOffice'));
  if (patch.reminder.until <= patch.reminder.time) return toast(t('rem.untilAfter'));
  if (patch.location.windowEnd <= patch.location.windowStart) return toast(t('loc.windowOrder'));
  try {
    await api('/api/settings', { method: 'PUT', body: patch });
    settingsDirty = false;
    // Se mudou o tipo de período, volta ao período de hoje.
    if (patch.rules.period !== S.settings.rules.period) periodId = null;
    toast(t('set.saved'));
    await load();
  } catch (err) {
    toast(err.message);
  }
});

// ---------------------------------------------------------------- partilhar configuração
// A configuração da empresa (regra, país, cidade, feriados) vai num link. Nada de
// dados pessoais: sem dias, sem localização, sem data de admissão, sem cópias.
const b64url = {
  enc: (obj) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))),
};

// O nome padrão ("Escritório principal", "Main office"…) não vai no link: quem recebe usa o seu.
const isDefaultName = (name) => Object.values(DICTIONARIES).some((d) => d['office.defaultName'] === name);

function buildConfigLink() {
  const s = S.settings;
  const o = officeById(s.primaryOfficeId);
  const { target, officePct, daysPerWeek, daysPerMonth, period, fixedDays, maxHomeDays, enforceHomeCap } = s.rules;
  const cfg = {
    v: 1,
    company: s.companyName || '',
    rules: { target, officePct, daysPerWeek, daysPerMonth, period, fixedDays, maxHomeDays, enforceHomeCap },
    workdays: s.workdays,
    office: { name: isDefaultName(o.name) ? '' : o.name, country: o.country, region: o.region, regionName: o.regionName, city: o.city, timezone: o.timezone, optionalHolidays: o.optionalHolidays, customHolidays: o.customHolidays },
  };
  return `${location.origin}${location.pathname}#cfg=${b64url.enc(cfg)}`;
}

$('#share-config').addEventListener('click', async () => {
  if (settingsDirty) return toast(t('share.saveFirst'));
  const url = buildConfigLink();
  const title = t('share.shareTitle', { company: S.settings.companyName || t('share.ourCompany') });
  try {
    if (navigator.share) {
      await navigator.share({ title, text: title, url });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(t('share.copied'));
  } catch {
    prompt(t('share.copyManually'), url);
  }
});

let pendingConfig = null;
function readConfigFromHash() {
  const m = /^#cfg=([\w-]+)$/.exec(location.hash);
  if (!m) return null;
  try {
    const c = b64url.dec(m[1]);
    if (c?.v !== 1 || typeof c.rules !== 'object' || typeof c.office?.country !== 'string') return null;
    return c;
  } catch {
    return null;
  }
}
function checkConfigLink() {
  const c = readConfigFromHash();
  history.replaceState(null, '', location.pathname + location.search + '#painel');
  if (!c) {
    if (S) toast(t('share.invalid'));
    return;
  }
  pendingConfig = c;
  const r = { ...S.settings.rules, ...c.rules };
  $('#cfg-text').innerHTML = t('share.applyText', {
    company: `<b>${h(c.company || t('share.ourCompany'))}</b>`,
    rule: `<b>${h(ruleText(r))}</b>`,
    office: `${c.office.name ? `<b>${h(c.office.name)}</b> ` : ''}(${h(countryName(c.office.country))})`,
  });
  $('#cfg-dialog').showModal();
}
$('#cfg-apply').addEventListener('click', async () => {
  const c = pendingConfig;
  if (!c) return;
  try {
    const primary = officeById(S.settings.primaryOfficeId);
    const o = c.office;
    // Mantém a localização e o raio pessoais do escritório principal.
    await api('/api/offices', {
      method: 'POST',
      body: { id: primary.id, primary: true, name: o.name || primary.name, country: o.country, region: o.region || '', regionName: o.regionName || '', city: o.city || '', timezone: o.timezone || '', optionalHolidays: o.optionalHolidays || {}, customHolidays: Array.isArray(o.customHolidays) ? o.customHolidays : [] },
    });
    const rules = Object.fromEntries(Object.entries(c.rules).filter(([k]) => ['target', 'officePct', 'daysPerWeek', 'daysPerMonth', 'period', 'fixedDays', 'maxHomeDays', 'enforceHomeCap'].includes(k)));
    await api('/api/settings', { method: 'PUT', body: { rules, workdays: Array.isArray(c.workdays) && c.workdays.length ? c.workdays : S.settings.workdays, companyName: String(c.company || '').slice(0, 60), onboarded: true } });
    $('#cfg-dialog').close();
    $('#wizard').open && $('#wizard').close();
    periodId = null;
    settingsDirty = false;
    toast(t('share.applied'));
    await load();
  } catch (err) {
    toast(err.message);
  }
});

// ---------------------------------------------------------------- assistente inicial
let wizStep = 1;
let wizMeta = null;
async function openWizard() {
  const f = $('#wizard-form');
  const o = officeById(S.settings.primaryOfficeId);
  f.locale.innerHTML = langOptions(getLocale());
  f.country.innerHTML = countryOptions(o.country);
  f.startDate.value = S.settings.rules.startDate || '';
  const current = matchTemplate(S.settings.rules);
  $('#wiz-templates').innerHTML = [...RULE_TEMPLATES.map((tp) => tp.id), current === 'custom' ? 'custom' : null]
    .filter(Boolean)
    .map((id) => `<label><input type="radio" name="tpl" value="${id}" ${id === (current === 'custom' ? 'custom' : current) ? 'checked' : ''}/> ${h(t(`tpl.${id}`))}</label>`)
    .join('');
  await wizCountry(o.country, o.city, o.region);
  $('#wiz-stats').hidden = !shouldAsk(STATS_URL, S.settings.stats);
  $$('#wiz-stats input').forEach((x) => (x.checked = false));
  wizGo(1);
  $('#wizard').showModal();
}
async function wizCountry(country, city = '', region = '') {
  const f = $('#wizard-form');
  wizMeta = await api(`/api/countries/${country}`);
  $('#wiz-city-wrap').hidden = !wizMeta.presets.length;
  f.city.innerHTML = `<option value="">${h(t('of.noCity'))}</option>` + wizMeta.presets.map((p) => `<option value="${p.id}">${h(p.name)}</option>`).join('');
  f.city.value = city || '';
  const regions = Object.entries(wizMeta.regions);
  $('#wiz-region-wrap').hidden = !regions.length;
  f.region.innerHTML = `<option value="">${h(t('of.wholeCountry'))}</option>` + regions.map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join('');
  f.region.value = region || '';
}
function wizGo(n) {
  wizStep = n;
  $$('.wiz-step').forEach((el) => (el.hidden = Number(el.dataset.step) !== n));
  $('#wiz-back').hidden = n === 1;
  $('#wiz-skip').hidden = n === 3;
  $('#wiz-next').textContent = t(n === 3 ? 'wiz.finish' : 'wiz.next');
}
$('#wizard-form').locale.addEventListener('change', async (e) => {
  useLocale(e.target.value);
  await api('/api/settings', { method: 'PUT', body: { locale: e.target.value } });
  await load();
  const f = $('#wizard-form');
  const keep = { country: f.country.value, city: f.city.value, region: f.region.value, tpl: f.tpl?.value };
  f.country.innerHTML = countryOptions(keep.country);
  await wizCountry(keep.country, keep.city, keep.region);
  $$('#wiz-templates label').forEach((l) => {
    const id = l.querySelector('input').value;
    l.lastChild.textContent = ` ${t(`tpl.${id}`)}`;
  });
  wizGo(wizStep);
});
$('#wizard-form').country.addEventListener('change', (e) => wizCountry(e.target.value));
$('#wiz-back').addEventListener('click', () => wizGo(wizStep - 1));
$('#wiz-skip').addEventListener('click', async () => {
  $('#wizard').close();
  await api('/api/settings', { method: 'PUT', body: { onboarded: true } });
  await load();
});
$('#wiz-next').addEventListener('click', async () => {
  const f = $('#wizard-form');
  if (wizStep === 2) {
    const tpl = f.tpl?.value;
    const r = RULE_TEMPLATES.find((x) => x.id === tpl)?.rules || S.settings.rules;
    $('#wiz-summary').innerHTML = t('wiz.summary', {
      rule: `<b>${h(ruleText({ ...S.settings.rules, ...r }))}</b>`,
      place: `<b>${h([wizMeta.presets.find((p) => p.id === f.city.value)?.name, countryName(f.country.value)].filter(Boolean).join(', '))}</b>`,
    });
  }
  if (wizStep < 3) return wizGo(wizStep + 1);
  // Concluir: escritório principal (país/cidade/região) + regra + data de início.
  try {
    const primary = officeById(S.settings.primaryOfficeId);
    const city = wizMeta.presets.find((p) => p.id === f.city.value);
    const changedCountry = f.country.value !== primary.country;
    const custom = changedCountry ? [] : primary.customHolidays.filter((c) => !Object.values(S.meta.cityPresets).flat().some((p) => p.holidays.some((hd) => hd.date === c.date && hd.name === c.name)));
    await api('/api/offices', {
      method: 'POST',
      body: {
        id: primary.id,
        primary: true,
        name: city?.name || (changedCountry || !primary.name ? countryName(f.country.value) : primary.name),
        country: f.country.value,
        region: f.region.value,
        regionName: wizMeta.regions[f.region.value] || '',
        city: city?.id || '',
        timezone: changedCountry ? '' : primary.timezone,
        customHolidays: [...custom, ...(city ? city.holidays : [])],
        optionalHolidays: changedCountry ? { carnaval: true, corpusChristi: true } : primary.optionalHolidays,
      },
    });
    const tp = RULE_TEMPLATES.find((x) => x.id === f.tpl?.value);
    await api('/api/settings', { method: 'PUT', body: { rules: { ...(tp ? tp.rules : {}), startDate: f.startDate.value || null }, onboarded: true } });
    $('#wizard').close();
    periodId = null;
    settingsDirty = false;
    const statsChoice = $('#wiz-stats').hidden ? '' : f.stats.value;
    if (statsChoice) await setStatsConsent(statsChoice === 'yes', { quiet: true });
    toast(t('wiz.saved'));
    await load();
  } catch (err) {
    toast(err.message);
  }
});
$('#wizard-open').addEventListener('click', () => openWizard());

// ---------------------------------------------------------------- estatísticas anónimas
// Só com consentimento explícito (nada pré-marcado). No máximo um envio por dia para a
// planilha Google do dono da app; desligar pede o apagamento do que já foi enviado.
// Ver src/core/stats.js e integrations/google-stats.md.
function renderStats() {
  const st = S.settings.stats;
  $('#stats-ask').hidden = !(shouldAsk(STATS_URL, st) && S.settings.onboarded);
  $('#stats-settings').hidden = !STATS_URL;
  $('#stats-toggle').checked = st.consent === true;
  $('#stats-info').textContent = st.consent === true && st.id ? t('stats.code', { code: st.id.slice(0, 8) }) : '';
}

async function postStats(payload) {
  try {
    const res = await fetch(STATS_URL, { method: 'POST', body: JSON.stringify(payload), keepalive: true });
    return (await res.json()).ok === true;
  } catch {
    return false;
  }
}

async function saveStats(patch) {
  const r = await api('/api/settings', { method: 'PUT', body: { stats: patch } });
  S.settings = r.settings;
}

async function setStatsConsent(yes, { quiet = false } = {}) {
  const st = S.settings.stats;
  if (yes) {
    await saveStats({ consent: true, id: st.id || newDeviceId(), firstSeen: st.firstSeen || S.now.date, lastPing: null });
    if (!quiet) toast(t('stats.thanks'));
  } else {
    // Desligar: o código deixa de existir aqui e pede-se o apagamento do que foi enviado.
    await saveStats({ consent: false, id: null, firstSeen: null, lastPing: null, forgetPending: st.id || st.forgetPending || null });
    if (!quiet) toast(t('stats.off'));
  }
  renderStats();
  await statsTick();
}

let statsBusy = false;
async function statsTick() {
  if (!STATS_URL || !S || statsBusy) return;
  statsBusy = true;
  try {
    const st = S.settings.stats;
    if (st.forgetPending && (await postStats(buildForget(st.forgetPending)))) await saveStats({ forgetPending: null });
    if (shouldPing(STATS_URL, S.settings.stats, S.now.date)) {
      const payload = buildPing({
        settings: { ...S.settings, locale: getLocale() }, // idioma em uso (mesmo que nunca escolhido)
        today: S.now.date,
        version: APP_VERSION,
        ruleId: matchTemplate(S.settings.rules),
        platform: platformOf(navigator.userAgent),
        installed: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
      });
      if (await postStats(payload)) await saveStats({ lastPing: S.now.date });
    }
  } finally {
    statsBusy = false;
  }
}

$$('#stats-ask [data-stats]').forEach((b) => b.addEventListener('click', () => setStatsConsent(b.dataset.stats === 'yes')));
$('#stats-toggle').addEventListener('change', (e) => setStatsConsent(e.target.checked));

// ---------------------------------------------------------------- sobre
function openAbout() {
  $('#about-version').textContent = t('about.version', { v: APP_VERSION });
  $('#about-stats').hidden = !STATS_URL;
  $('#about-news').innerHTML = NEWS.map((k) => `<li>${h(t(k))}</li>`).join('');
  $('#about-dialog').showModal();
}
$('#about-open').addEventListener('click', openAbout);
$('#footer-about').addEventListener('click', (e) => {
  e.preventDefault();
  openAbout();
});

// ---------------------------------------------------------------- push (modo servidor)
function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function renderPushStatus() {
  const el = $('#push-status');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    el.textContent = t('push.unsupported');
    $('#push-enable').disabled = true;
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  el.textContent = sub ? t('push.on', { n: S.meta.subscriptions }) : t('push.off', { perm: Notification.permission });
  $('#push-enable').textContent = t(sub ? 'push.disable' : 'push.enable');
  $('#push-enable').dataset.on = sub ? '1' : '';
}

$('#push-enable').addEventListener('click', async () => {
  const reg = await navigator.serviceWorker.ready;
  if ($('#push-enable').dataset.on) {
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
  } else {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast(t('push.denied'));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(S.meta.vapidPublicKey) });
    await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
    toast(t('push.enabled'));
  }
  await load();
});

$('#push-test').addEventListener('click', async () => {
  const r = await api('/api/push/test', { method: 'POST' });
  toast(r.total ? t('push.sent', { ok: r.delivered, total: r.total }) : t('push.noDevices'));
});

$('#logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.reload();
});

navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'checked-in') load();
});

// ---------------------------------------------------------------- modo local
function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

async function shareOrDownload(filename, text, type) {
  try {
    const file = new File([text], filename, { type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  download(filename, text, type);
}

function renderLocalCards() {
  $$('.server-only').forEach((el) => (el.hidden = true));
  $$('.local-only').forEach((el) => (el.hidden = false));
  const r = S.settings.reminder;
  $('#cal-info').textContent = t('rem.calInfo', { time: r.time, repeat: r.repeatMinutes });
}

$('#cal-ics').addEventListener('click', async () => {
  const { ics, count, until } = (await localBackend).reminderIcs();
  if (!count) return toast(t('rem.noDays'));
  await shareOrDownload(`presenca-lembretes-${until}.ics`, ics, 'text/calendar');
  toast(t('rem.generated', { n: count }));
});
$('#cal-google').addEventListener('click', async () => {
  window.open((await localBackend).googleLink(), '_blank', 'noopener');
});
$('#backup-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!confirm(t('bk.importConfirm'))) return;
  try {
    const n = (await localBackend).importBackup(await file.text());
    toast(t('bk.restored', { n }));
    await load();
  } catch (err) {
    toast(err.message);
  }
});

// ---- cópias de segurança periódicas -------------------------------------------
let autoBackupFailed = null;

async function shareBackup() {
  const b = (await localBackend).backupBundle();
  const files = [new File([b.json], `${b.filename}.json`, { type: 'application/json' }), new File([b.csv], `${b.filename}.csv`, { type: 'text/csv' })];
  try {
    if (navigator.canShare?.({ files })) {
      await navigator.share({ files, title: t('bk.shareTitle'), text: b.summary });
      await markBackupDone();
      toast(t('bk.shared'));
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  download(`${b.filename}.json`, b.json, 'application/json');
  download(`${b.filename}.csv`, b.csv, 'text/csv');
  await markBackupDone();
  toast(t('bk.downloaded'));
}

async function sendAutoBackup({ url, token, email, silent = false }) {
  const b = (await localBackend).backupBundle();
  let res;
  try {
    const r = await fetch(url, { method: 'POST', body: JSON.stringify({ token, email, filename: b.filename, json: b.json, csv: b.csv, summary: b.summary }) });
    res = await r.json();
  } catch {
    res = { ok: false, error: t('bk.unreachable') };
  }
  if (res.ok) {
    autoBackupFailed = null;
    await markBackupDone();
    toast(t(res.emailed ? 'bk.autoOkEmail' : 'bk.autoOk'));
  } else {
    autoBackupFailed = res.error || t('ui.error');
    if (!silent) toast(t('bk.autoFailed', { error: autoBackupFailed }));
    renderBackupDue();
  }
  return res;
}

async function markBackupDone() {
  await api('/api/settings', { method: 'PUT', body: { backup: { lastAt: S.now.date } } });
  try {
    localStorage.removeItem('presenca:lastBackup');
  } catch {}
  await load();
}

function renderBackupInfo() {
  const bk = S.settings.backup;
  const auto = bk.autoUrl ? ` ${t('bk.autoOn')}` : '';
  $('#backup-info').textContent = bk.lastAt ? `${t('bk.last', { date: fmtFull(bk.lastAt) })}${isBackupDue(bk, S.now.date) ? ` ⚠️ ${t('bk.dueNow')}` : ''}${auto}` : `${t('bk.never')}${auto}`;
}

function renderBackupDue() {
  const el = $('#backup-due');
  if (!el || !LOCAL) return;
  const bk = S.settings.backup;
  if (!isBackupDue(bk, S.now.date) && !autoBackupFailed) {
    el.hidden = true;
    return;
  }
  const last = bk.lastAt ? t('bk.last', { date: fmtFull(bk.lastAt) }) : t('bk.never');
  el.hidden = false;
  el.innerHTML = `<div class="geo-result error-box">💾 <b>${h(autoBackupFailed ? t('bk.autoFailedTitle') : t(bk.frequency === 'monthly' ? 'bk.dueMonthly' : 'bk.dueWeekly'))}</b> ${h(last)}
      <br><small>${h(autoBackupFailed || t('bk.onlyHere'))}</small>
      <div class="row"><button id="backup-due-share" class="primary">${h(t('bk.sendNow'))}</button>${bk.autoUrl ? `<button id="backup-due-retry">☁️ ${h(t('bk.retryGoogle'))}</button>` : ''}</div></div>`;
  $('#backup-due-share').onclick = shareBackup;
  $('#backup-due-retry')?.addEventListener('click', () => sendAutoBackup({ url: bk.autoUrl, token: bk.autoToken, email: bk.email }));
}

$('#backup-export').addEventListener('click', shareBackup);
$('#backup-auto-now').addEventListener('click', async () => {
  const f = $('#settings-form');
  const url = f.backupUrl.value.trim();
  const token = f.backupToken.value.trim();
  if (!APPS_SCRIPT_URL_RE.test(url)) return toast(t('err.scriptUrl'));
  if (!token) return toast(t('bk.pasteToken'));
  $('#backup-auto-info').textContent = t('bk.sending');
  const r = await sendAutoBackup({ url, token, email: f.backupEmail.checked });
  $('#backup-auto-info').textContent = r.ok ? `✅ ${t(r.emailed ? 'bk.testOkEmail' : 'bk.testOk')}` : `❌ ${r.error}`;
});

$('#export-csv').addEventListener('click', async () => {
  if (LOCAL) await shareOrDownload(`presenca-${S.now.date}.csv`, (await localBackend).exportCsv(), 'text/csv');
  else location.href = `api/export.csv?lang=${getLocale()}`;
});

// ---------------------------------------------------------------- inicialização
async function boot() {
  if (LOCAL) navigator.storage?.persist?.().catch(() => {});
  const auth = await api('/api/auth');
  $('#logout').hidden = !auth.required;
  if (!auth.ok) return showLogin();
  await load();

  if (location.hash.startsWith('#cfg=')) checkConfigLink();
  else if (!S.settings.onboarded) openWizard();

  // Check-in por localização: ao abrir pelo lembrete, ou dentro da janela sem resposta.
  const params = new URLSearchParams(location.search);
  const loc = S.settings.location;
  const todayKey = `geo-asked-${S.now.date}`;
  let asked = false;
  try {
    asked = sessionStorage.getItem(todayKey) === '1';
  } catch {}
  const fromLink = params.get('checkin') === 'location';
  const beforeStart = S.settings.rules.startDate && S.now.date < S.settings.rules.startDate;
  const canCheck = loc.enabled && S.settings.offices.some((o) => o.location) && S.today.workingDay && !beforeStart && !S.today.record?.status;
  if (canCheck && (fromLink || !asked) && S.settings.onboarded) {
    try {
      sessionStorage.setItem(todayKey, '1');
    } catch {}
    if (!location.hash.startsWith('#cfg=')) location.hash = '#painel';
    window.scrollTo(0, 0);
    if (inLocationWindow()) locationCheckin({ fromLink });
    else if (fromLink) toast(t('geo.outsideLink', { from: loc.windowStart, to: loc.windowEnd }));
  }
  if (params.has('checkin')) history.replaceState(null, '', location.pathname + location.hash);
  if (LOCAL) await backupOnOpen();
  statsTick();
}

async function backupOnOpen() {
  let old = null;
  try {
    old = localStorage.getItem('presenca:lastBackup');
  } catch {}
  if (old && !S.settings.backup.lastAt) {
    await api('/api/settings', { method: 'PUT', body: { backup: { lastAt: old } } });
    await load();
  }
  const bk = S.settings.backup;
  if (bk.autoUrl && bk.autoToken && isBackupDue(bk, S.now.date) && navigator.onLine !== false) {
    await sendAutoBackup({ url: bk.autoUrl, token: bk.autoToken, email: bk.email, silent: true });
  }
}

useLocale(savedLocale());
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
boot().catch((e) => console.error(e));
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && S && load().then(statsTick).catch(() => {}));
