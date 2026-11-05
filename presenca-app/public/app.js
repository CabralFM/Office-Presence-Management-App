// Frontend em JavaScript puro (sem framework nem build).
// Decisão: para uma app pessoal com 4 telas, um framework (React/Vue) traria
// um passo de build e dependências a manter sem ganho real. Tudo aqui é
// "render a partir do estado": cada ação chama a API e volta a desenhar.

// Caminhos relativos: a app funciona tanto na raiz de um servidor como numa
// subpasta de um site estático (ex.: https://usuario.github.io/Office-Presence-Management-App/).
import { nearestOffice } from './core/geo.js';
import { ABSENCE_TYPES, ABSENCE_LABEL, ABSENCE_ICON } from './core/absences.js';
import { MODE } from './config.js';

const LOCAL = MODE === 'local';
// No modo local o "backend" corre dentro do celular (carregado só neste modo).
const localBackend = LOCAL ? import('./local-backend.js') : null;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LABEL = { office: 'Escritório', home: 'Casa', absence: 'Ausência' };
const ICON = { office: '🏢', home: '🏠', absence: '🌴' };
const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const STATUS_TXT = {
  ok: 'Em dia', atencao: 'Atenção', critico: 'Crítico', impossivel: 'Meta inalcançável', cumprido: 'Meta cumprida', sem_contagem: 'Antes da admissão',
};
const fmtDM = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fmtLong = (iso) => {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC' });
};
// Ícone do dia: nas ausências, o do tipo (🌴 férias, 🤒 doença…)
const dayIcon = (rec) => (rec?.status === 'absence' ? ABSENCE_ICON(rec.absenceType) : ICON[rec?.status] || '');
const dayLabel = (rec) => (rec?.status === 'absence' ? ABSENCE_LABEL(rec.absenceType) : LABEL[rec?.status] || '');
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

let S = null; // último estado vindo do servidor
let semesterId = null;
let geoResult = null; // resultado do último check-in por localização (só em memória)

// ---------------------------------------------------------------- API
class ApiError extends Error {
  constructor(status, data) {
    super(data.error || `Erro ${status}`);
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
    const res = await fetch(path.replace(/^\//, ''), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    status = res.status;
    data = await res.json().catch(() => ({}));
  }
  if (status === 401 && path !== '/api/login') {
    showLogin();
    throw new ApiError(401, { error: 'Não autenticado' });
  }
  if (status >= 400) throw new ApiError(status, data);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

async function load() {
  S = await api(`/api/state${semesterId ? `?semester=${semesterId}` : ''}`);
  semesterId = S.semester.id;
  render();
}

// ---------------------------------------------------------------- navegação
function showTab() {
  const id = (location.hash || '#painel').slice(1);
  $$('.tab').forEach((s) => (s.hidden = s.id !== id));
  $$('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === id));
  $(`.tabs a[data-tab="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
window.addEventListener('hashchange', showTab);

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
  renderSemesterSelect();
  renderToday();
  renderSemester();
  renderAlerts();
  renderMonths();
  renderCalendar();
  renderPlanning();
  renderSettings();
  showTab();
}

function renderSemesterSelect() {
  const sel = $('#semester-select');
  const y = Number(S.now.date.slice(0, 4));
  const opts = [];
  for (let yr = y - 1; yr <= y + 1; yr++) for (const half of [1, 2]) opts.push(`${yr}-${half}`);
  sel.innerHTML = opts.map((id) => `<option value="${id}" ${id === semesterId ? 'selected' : ''}>${id.replace('-', ' · ')}º sem.</option>`).join('');
}
$('#semester-select').addEventListener('change', (e) => {
  semesterId = e.target.value;
  load();
});

const officeById = (id) => S.settings.offices.find((o) => o.id === id);
const officeName = (id) => officeById(id)?.name || '?';
const multiOffice = () => S.settings.offices.length > 1;
const tripFor = (date) => S.settings.trips.find((t) => t.start <= date && date <= t.end) || null;
const fmtDist = (m) => (m == null ? '?' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

function renderToday() {
  const t = S.today;
  const el = $('#today-card');
  const expected = t.expectedOfficeId;
  const where = t.trip
    ? `✈️ Em viagem: <b>${h(officeName(t.trip.officeId))}</b> (${fmtDM(t.trip.start)}–${fmtDM(t.trip.end)}) — valem os feriados e o fuso deste escritório.`
    : multiOffice()
      ? `Escritório de referência hoje: <b>${h(officeName(expected))}</b> (feriados deste local).`
      : '';
  const head = `<div class="big">Hoje, ${h(fmtLong(t.date))}</div>${where ? `<p class="hint">${where}</p>` : ''}<div id="tz-banner"></div>`;
  const start = S.settings.rules.startDate;
  if (start && t.date < start) {
    el.innerHTML = `${head}<p>⏳ A contagem de presença começa em <b>${fmtDM(start)}/${start.slice(0, 4)}</b> (início da contagem, em Ajustes). Até lá não há nada a registrar.</p>`;
    renderTzBanner();
    return;
  }
  if (!t.workingDay) {
    el.innerHTML = `${head}<p>${t.holiday ? `🎉 Feriado: <b>${h(t.holiday.name)}</b> (${h(t.holiday.officeName)})` : 'Fim de semana — bom descanso! 😌'}</p>`;
    renderTzBanner();
    return;
  }
  const rec = t.record;
  const cur = rec?.status;
  const canGeo = S.settings.location.enabled && S.settings.offices.some((o) => o.location);
  const officeSel = multiOffice()
    ? `<label class="inline">🏢 Em que escritório? <select id="office-pick">${S.settings.offices
        .map((o) => `<option value="${o.id}" ${o.id === (rec?.officeId || expected) ? 'selected' : ''}>${h(o.name)}</option>`)
        .join('')}</select></label>`
    : '';
  el.innerHTML = `${head}
    <p class="hint">${
      cur
        ? `Registrado: <b>${dayIcon(rec)} ${dayLabel(rec)}${cur === 'office' && multiOffice() ? ` · ${h(officeName(rec.officeId))}` : ''}</b>${rec.source === 'localizacao' ? ` (pela localização, a ${fmtDist(rec.distance)})` : ''}${cur === 'absence' ? ` — ${rec.justification ? h(rec.justification) : 'sem justificação'}` : ''}. Pode alterar abaixo.`
        : 'Onde você está trabalhando hoje?'
    }</p>
    <div class="choice">
      ${['office', 'home', 'absence'].map((s) => `<button data-checkin="${s}" class="${s} ${cur === s ? 'sel' : ''}">${ICON[s]} ${LABEL[s]}</button>`).join('')}
    </div>
    ${officeSel}
    ${canGeo && !cur ? `<button id="geo-check">📍 Verificar pela localização</button>` : ''}
    <div id="geo-box"></div>`;
  $$('[data-checkin]', el).forEach((b) =>
    b.addEventListener('click', () =>
      b.dataset.checkin === 'absence'
        ? openAbsence({ start: t.date, end: t.date, ...(cur === 'absence' ? absenceOf(t.date) : {}) })
        : checkin(b.dataset.checkin, 'manual', null, b.dataset.checkin === 'office' ? $('#office-pick')?.value : undefined),
    ),
  );
  // Trocar o escritório depois de já ter registrado "Escritório" corrige o registro.
  $('#office-pick')?.addEventListener('change', (e) => cur === 'office' && checkin('office', 'manual', null, e.target.value));
  $('#geo-check', el)?.addEventListener('click', () => locationCheckin());
  renderTzBanner();
  if (geoResult) renderGeoResult();
}

async function checkin(status, source, distance = null, officeId) {
  await api('/api/checkin', { method: 'POST', body: { status, source, distance, officeId } });
  geoResult = null;
  toast(`Registrado: ${LABEL[status]}${status === 'office' && multiOffice() && officeId ? ` · ${officeName(officeId)}` : ''}`);
  await load();
}

// ---------------------------------------------------------------- fuso horário
// Sinal barato e sem GPS: se o fuso do aparelho for diferente do fuso do
// escritório previsto, é provável que esteja em outro país → perguntamos.
function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

const currentSemesterId = () => `${S.now.date.slice(0, 4)}-${Number(S.now.date.slice(5, 7)) <= 6 ? 1 : 2}`;

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
  box.innerHTML = `<div class="geo-result">🌍 Seu aparelho está no fuso <b>${h(tz)}</b>, mas o escritório previsto para hoje (${h(exp.name)}) usa <b>${h(exp.timezone)}</b>. Você está trabalhando em outro local?
    <div class="row"><button id="tz-trip" class="primary">✈️ Sim, registrar viagem${match ? ` a ${h(match.name)}` : ''}</button><button id="tz-no">Não, ignorar hoje</button></div></div>`;
  $('#tz-no').onclick = () => {
    try {
      localStorage.setItem(key, '1');
    } catch {}
    box.innerHTML = '';
  };
  $('#tz-trip').onclick = () => {
    if (!match) {
      toast('Cadastre primeiro o escritório de destino.');
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
function inLocationWindow() {
  const loc = S.settings.location;
  const m = S.now.minutes;
  const toMin = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
  return m >= toMin(loc.windowStart) && m <= toMin(loc.windowEnd);
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Este navegador não suporta localização.'));
    // getCurrentPosition = leitura ÚNICA. Nunca usamos watchPosition (rastreio contínuo).
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => reject(new Error(err.code === 1 ? 'Permissão de localização negada.' : 'Não foi possível obter a localização.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}

async function locationCheckin() {
  const loc = S.settings.location;
  if (!inLocationWindow()) {
    toast(`A localização só é usada entre ${loc.windowStart} e ${loc.windowEnd}.`);
    return;
  }
  const box = $('#geo-box');
  if (box) box.innerHTML = '<p class="hint">Obtendo localização…</p>';
  try {
    const pos = await getPosition();
    geoResult = nearestOffice(pos, S.settings.offices); // pos é descartada aqui
    renderGeoResult();
  } catch (e) {
    if (box) box.innerHTML = `<p class="error">${h(e.message)}</p>`;
  }
}

function renderGeoResult() {
  const box = $('#geo-box');
  const g = geoResult;
  if (!box || !g) return;
  const expected = S.today.expectedOfficeId;
  let text;
  let yes;
  let no;
  if (g.atOffice) {
    const other = g.office.id !== expected;
    text = `📍 Você está a <b>${fmtDist(g.distance)}</b> do escritório <b>${h(g.office.name)}</b>.${
      other ? ` ⚠️ O previsto para hoje era <b>${h(officeName(expected))}</b>: se confirmar, valem os feriados de ${h(g.office.name)} neste dia.` : ''
    } Confirma que está no escritório?`;
    yes = { label: `✔ Sim, ${h(g.office.name)}`, cls: 'office', go: () => checkin('office', 'localizacao', g.distance, g.office.id) };
    no = { label: '✖ Não, estou em casa', go: () => checkin('home', 'manual', g.distance) };
  } else {
    text = `📍 Você está a <b>${fmtDist(g.distance)}</b> do escritório mais próximo (${h(g.office.name)}). Parece que está <b>em casa / fora do escritório</b>. Confirma?`;
    yes = { label: '✔ Sim, Casa', cls: 'home', go: () => checkin('home', 'localizacao', g.distance) };
    no = { label: '✖ Não, estou no escritório', go: () => checkin('office', 'manual', g.distance, $('#office-pick')?.value || expected) };
  }
  box.innerHTML = `<div class="geo-result">${text}
      <div class="choice"><button class="${yes.cls}" id="geo-yes">${yes.label}</button><button id="geo-no">${no.label}</button></div></div>`;
  $('#geo-yes').onclick = yes.go;
  $('#geo-no').onclick = no.go;
}

// ---------------------------------------------------------------- semestre
function renderSemester() {
  const r = S.report;
  const t = r.totals;
  if (r.notStarted) {
    $('#semester-card').innerHTML = `<h3>${h(r.semester.label)} <span class="badge sem_contagem">${STATUS_TXT.sem_contagem}</span></h3>
      <p class="hint">Este semestre é anterior ao início da contagem (${fmtDM(r.startDate)}/${r.startDate.slice(0, 4)}). Não há metas a cumprir.</p>`;
    return;
  }
  const donePct = r.requiredOffice ? Math.min(100, (t.office / r.requiredOffice) * 100) : 100;
  const planPct = r.requiredOffice ? Math.min(100, (r.plan.officeWithPlan / r.requiredOffice) * 100) : 100;
  $('#semester-card').innerHTML = `
    <h3>${h(r.semester.label)} <span class="badge ${r.status}">${STATUS_TXT[r.status]}</span></h3>
    ${r.startDate ? `<p class="hint">📌 Contagem a partir de <b>${fmtDM(r.startDate)}/${r.startDate.slice(0, 4)}</b> (data de início).</p>` : ''}
    <div class="bar" title="Escritório: feitos + planejados"><i class="plan" style="width:${planPct}%"></i><i style="width:${donePct}%"></i></div>
    <p class="hint">${t.office} de ${r.requiredOffice} dias obrigatórios no escritório${r.plan.officeWithPlan > t.office ? ` (+${r.plan.officeWithPlan - t.office} planejados)` : ''}.
      Regra: <b>${r.rules.officePct}% de ${t.base} dias trabalháveis = ${r.requiredByPct}</b>${
        r.bindingRule === 'teto' ? ` — mas o teto de ${r.homeCap} dias em casa (ativo) exige <b>${r.requiredOffice}</b>` : ''
      }.</p>
    <div class="stats">
      <div class="stat"><b>${t.base}</b><span>dias trabalháveis = ${t.working} úteis − ${t.absence} ausência(s)${
        t.absence ? ` (${Object.entries(t.absenceByType).map(([k, n]) => `${ABSENCE_ICON(k)} ${n}`).join(' ')})` : ''
      }</span></div>
      <div class="stat"><b>${r.officeNeeded}</b><span>dias de escritório que faltam</span></div>
      <div class="stat"><b>${Math.max(0, r.homeLeft)}</b><span>dias de casa ainda disponíveis (de ${r.maxHome})</span></div>
      <div class="stat"><b>${t.undecided}</b><span>dias úteis por decidir${t.pending ? ` (${t.pending} sem registro)` : ''}</span></div>
      <div class="stat"><b>${pct(r.paceNeeded)}</b><span>ritmo necessário no escritório (≈ ${r.paceNeeded == null ? '—' : (r.paceNeeded * 5).toFixed(1)} dias/semana)</span></div>
      <div class="stat"><b>${t.office + t.home ? pct(t.office / (t.office + t.home)) : '—'}</b><span>% no escritório até agora</span></div>
    </div>`;
}

function renderAlerts() {
  $('#alerts').innerHTML = S.report.alerts.map((a) => `<li class="${a.level}">${h(a.text)}</li>`).join('') || '<li class="ok">Nada a destacar. 👍</li>';
}

function renderMonths() {
  const target = S.report.rules.officePct / 100;
  $('#months-table').innerHTML = `
    <thead><tr><th>Mês</th><th>Úteis</th><th>🏢</th><th>🏠</th><th>🌴</th><th>% esc.</th><th>Cota</th><th>Recomendado (restantes)</th></tr></thead>
    <tbody>${S.report.months
      .map(
        (m) => `<tr class="${m.isCurrent ? 'current' : ''}">
          <td style="text-transform:capitalize">${m.name}</td><td>${m.working}</td><td>${m.office}</td><td>${m.home}</td><td>${m.absence}</td>
          <td class="${m.officePct == null ? '' : m.officePct < target ? 'low' : 'good'}">${pct(m.officePct)}</td>
          <td>${m.target}</td><td>${m.open ? `${m.recommendedOffice} de ${m.open}` : '—'}</td></tr>`,
      )
      .join('')}</tbody>`;
}

// ---------------------------------------------------------------- calendário
function dayInfo(date) {
  const hol = S.holidays[date];
  const rec = S.days[date] || {};
  const wd = new Date(date + 'T12:00:00Z').getUTCDay();
  const trip = tripFor(date);
  // Dias de viagem sem plano explícito contam como "planejado escritório" (igual ao servidor).
  const plan = rec.status ? null : rec.plan || (trip && date >= S.now.date ? 'office' : null);
  const beforeStart = Boolean(S.settings.rules.startDate && date < S.settings.rules.startDate);
  return { hol, rec, trip, plan, beforeStart, weekend: wd === 0 || wd === 6, past: date < S.now.date, today: date === S.now.date, future: date > S.now.date };
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
  const { start } = S.semester;
  const y = Number(start.slice(0, 4));
  const m0 = Number(start.slice(5, 7));
  let html = '';
  for (let m = m0; m < m0 + 6; m++) {
    const first = new Date(Date.UTC(y, m - 1, 1));
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const mi = S.report.months.find((x) => x.month === m);
    const lead = (first.getUTCDay() + 6) % 7; // semana começa na segunda
    let cells = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => `<div class="dow">${d}</div>`).join('');
    cells += '<div class="day empty"></div>'.repeat(lead);
    for (let d = 1; d <= days; d++) {
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const { hol, rec, trip } = dayInfo(iso);
      const title = [
        hol && `${hol.name} (${hol.officeName})`,
        rec.status === 'absence' && `${dayLabel(rec)}${rec.justification ? `: ${rec.justification}` : ' (sem justificação)'}`,
        trip && `Viagem: ${officeName(trip.officeId)}`,
        rec.note,
      ].filter(Boolean).join(' · ');
      cells += `<button class="${dayClasses(iso)}" data-day="${iso}" title="${h(title)}">${trip ? '<span class="trip">✈️</span>' : ''}${d}${rec.status ? `<small>${dayIcon(rec)}</small>` : ''}</button>`;
    }
    html += `<div class="month"><h3>${first.toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' })}
      <small>${mi ? `🏢 ${mi.office} · 🏠 ${mi.home} · ${pct(mi.officePct)}` : ''}</small></h3><div class="cal">${cells}</div></div>`;
  }
  $('#calendar').innerHTML = html;
  $$('#calendar [data-day]').forEach((b) => b.addEventListener('click', () => openDay(b.dataset.day)));

  // Lista de feriados — útil para conferir (ex.: 13/06 Lisboa sim, 24/06 Almada não).
  const scopeTxt = { nacional: 'nacional', facultativo: 'facultativo', municipal: 'municipal', estadual: 'estadual/regional', empresa: 'empresa' };
  $('#holiday-list').innerHTML =
    Object.entries(S.holidays)
      .filter(([d]) => !S.settings.rules.startDate || d >= S.settings.rules.startDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, x]) => {
        const wd = new Date(d + 'T12:00:00Z').getUTCDay();
        const weekend = wd === 0 || wd === 6;
        return `<li${weekend ? ' class="hint"' : ''}><span>${DOW[wd]} ${fmtDM(d)} — ${h(x.name)} <small>${scopeTxt[x.type] || x.type} · ${h(x.officeName)}${weekend ? ' · cai no fim de semana' : ''}</small></span></li>`;
      })
      .join('') || '<li class="hint">Nenhum feriado neste semestre.</li>';
}

function openDay(date) {
  const { hol, rec, weekend, future } = dayInfo(date);
  if (weekend) return;
  if (dayInfo(date).beforeStart) return toast('Antes do início da contagem (data de admissão).');
  if (hol) return toast(`Feriado: ${hol.name} (${hol.officeName})`);
  const dlg = $('#day-dialog');
  $('#dd-title').textContent = fmtLong(date);
  $('#dd-sub').textContent = future
    ? 'Dia futuro: planeje onde vai trabalhar (ou marque férias/folga).'
    : rec.status
      ? `Registrado: ${dayLabel(rec)}${rec.status === 'absence' ? (rec.justification ? ` — ${rec.justification}` : ' — sem justificação') : rec.source ? ` (${rec.source})` : ''}`
      : 'Sem registro — onde trabalhou?';
  const trip = tripFor(date);
  if (trip) $('#dd-sub').textContent += ` ✈️ Viagem: ${officeName(trip.officeId)}.`;
  const field = future ? 'plan' : 'status';
  // Dia passado com vários escritórios: em qual esteve? (define os feriados desse dia)
  const showOffice = !future && multiOffice();
  $('#dd-office-wrap').hidden = !showOffice;
  if (showOffice) {
    const sel = rec.officeId || trip?.officeId || S.settings.primaryOfficeId;
    $('#dd-office').innerHTML = S.settings.offices.map((o) => `<option value="${o.id}" ${o.id === sel ? 'selected' : ''}>${h(o.name)}</option>`).join('');
  }
  const cur = rec[field];
  $('#dd-buttons').innerHTML =
    ['office', 'home'].map((s) => `<button type="button" class="${s} ${cur === s ? 'sel' : ''}" data-v="${s}">${ICON[s]} ${future ? 'Planejar ' : ''}${LABEL[s]}</button>`).join('') +
    `<button type="button" class="absence ${rec.status === 'absence' ? 'sel' : ''}" data-v="absence">${rec.status === 'absence' ? `${dayIcon(rec)} Editar ausência` : '🌴 Férias / ausência'}</button>` +
    `<button type="button" data-v="">Limpar</button>`;
  $('#dd-note').value = rec.note || '';
  $$('#dd-buttons button').forEach((b) =>
    b.addEventListener('click', async () => {
      if (b.dataset.v === 'absence') {
        // Ausência tem tipo, período e justificação → diálogo próprio.
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
function renderPlanning() {
  const r = S.report;
  $('#plan-summary').innerHTML = `
    <h3>Projeção do semestre</h3>
    <p>Feitos: <b>${r.totals.office}</b> no escritório · Planejados: <b>${r.totals.plannedOffice}</b> · Meta: <b>${r.requiredOffice}</b></p>
    <p>${
      r.plan.neededAfterPlan === 0
        ? '✅ Com o que já fez e planejou, a meta do semestre fica cumprida.'
        : `Ainda precisa planejar <b>${r.plan.neededAfterPlan}</b> dia(s) de escritório entre os <b>${r.plan.unplanned}</b> dias úteis sem plano.`
    }${r.plan.homeOverCap ? ` ⚠️ O plano excede o limite de casa em ${r.plan.homeOverCap} dia(s).` : ''}</p>
    <div class="row"><button id="auto-plan">✨ Sugerir plano automático para as próximas 4 semanas</button></div>`;
  $('#auto-plan').onclick = autoPlan;
  renderTrips();
  renderAbsences();

  const weeks = r.weeks.filter((w) => !w.isPast);
  $('#weeks').innerHTML =
    weeks
      .map((w) => {
        const days = [0, 1, 2, 3, 4].map((i) => {
          const d = addDaysIso(w.start, i);
          const inSem = d >= S.semester.start && d <= S.semester.end;
          const { hol, rec, plan, trip, future, today } = dayInfo(d);
          const disabled = !inSem || hol || (!future && !today) || rec.status || dayInfo(d).beforeStart;
          const cls = rec.status || (plan ? `plan-${plan}` : '');
          const lbl = hol ? '🎉' : rec.status ? dayIcon(rec) : plan ? ICON[plan] + (trip ? '✈️' : '') : '·';
          return `<button data-plan="${d}" class="${cls}" ${disabled ? 'disabled' : ''} title="${h(hol?.name || '')}">${DOW[i + 1]} ${fmtDM(d)}<br>${lbl}</button>`;
        });
        const planned = w.plannedOffice + w.office;
        return `<div class="week ${w.isCurrent ? 'current' : ''}">
          <header><b>${w.isCurrent ? 'Esta semana' : `Semana de ${fmtDM(w.start)}`}</b>
            <span>Recomendado: <b>${w.recommendedOffice}</b> ${w.recommendedOffice === 1 ? 'dia' : 'dias'} 🏢 · planejado/feito: ${planned}${w.holidayList.length ? ` · feriado: ${h(w.holidayList.map((x) => x.name).join(', '))}` : ''}</span></header>
          <div class="days">${days.join('')}</div></div>`;
      })
      .join('') || '<p class="hint">Semestre encerrado.</p>';
  $$('#weeks [data-plan]').forEach((b) => b.addEventListener('click', () => cyclePlan(b.dataset.plan)));
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
        const period = a.start === a.end ? `${fmtDM(a.start)}` : `${fmtDM(a.start)} – ${fmtDM(a.end)}`;
        return `<li><span>${ABSENCE_ICON(a.type)} <b>${h(ABSENCE_LABEL(a.type))}</b> · ${period} · ${a.days} dia(s) útil(eis)<br>
          <small>${a.justification ? h(a.justification) : missing ? '<span class="warn-txt">⚠️ falta justificação / tipo</span>' : 'sem justificação'}</small></span>
          <span class="actions"><button type="button" data-ab-edit="${a.id}">Editar</button><button type="button" data-ab-del="${a.id}" title="Remover">✖</button></span></li>`;
      })
      .join('') || '<li class="hint">Nenhuma ausência neste semestre.</li>';
  $$('[data-ab-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      const a = S.absences.find((x) => x.id === b.dataset.abEdit);
      openAbsence({ id: a.id, type: a.type, justification: a.justification, start: a.start, end: a.end });
    }),
  );
  $$('[data-ab-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Remover esta ausência? Os dias voltam a ficar sem registro.')) return;
      await api(`/api/absences/${b.dataset.abDel}`, { method: 'DELETE' });
      toast('Ausência removida');
      await load();
    }),
  );
}

let absenceEditId = null;
function openAbsence({ id = null, type = 'ferias', justification = '', start = S.now.date, end } = {}) {
  absenceEditId = id;
  const f = $('#absence-form');
  $('#ab-title').textContent = id ? 'Editar ausência' : 'Registrar férias / ausência';
  $('#ab-types').innerHTML =
    '<legend>Tipo</legend>' +
    Object.entries(ABSENCE_TYPES)
      .map(([k, t]) => `<label><input type="radio" name="type" value="${k}" ${k === type ? 'checked' : ''}/> ${t.icon} ${h(t.label)}</label>`)
      .join('');
  if (!ABSENCE_TYPES[type]) f.querySelector('input[name=type]').checked = true; // registros antigos sem tipo
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
  const t = ABSENCE_TYPES[f.querySelector('input[name=type]:checked').value];
  $('#ab-just-label').textContent = t.justificationRequired ? 'Justificação (obrigatória)' : 'Justificação (opcional)';
  f.justification.required = t.justificationRequired;
  f.justification.placeholder = t.hint;
  $('#ab-hint').textContent = t.hint;
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
      if (confirm(`${err.message} (${list}${c.length > 6 ? '…' : ''}). Substituir por ausência?`)) return saveAbsence(true);
      return;
    }
    $('#ab-error').textContent = err.message;
    return;
  }
  $('#absence-dialog').close();
  toast(`${data.label}: ${data.days} dia(s) útil(eis) registrado(s)`);
  await load();
}
$('#ab-save').addEventListener('click', () => saveAbsence());
$('#absence-add').addEventListener('click', () => openAbsence());

function renderTrips() {
  const f = $('#trip-form');
  const keep = f.officeId.value;
  // Escritórios não principais primeiro (são os destinos típicos de viagem).
  const opts = [...S.settings.offices].sort((a, b) => (a.id === S.settings.primaryOfficeId) - (b.id === S.settings.primaryOfficeId));
  f.officeId.innerHTML = opts.map((o) => `<option value="${o.id}">${h(o.name)}</option>`).join('');
  if (keep) f.officeId.value = keep;
  $('#trips').innerHTML =
    S.settings.trips
      .map(
        (t) => `<li><span>✈️ <b>${h(officeName(t.officeId))}</b> · ${fmtDM(t.start)}/${t.start.slice(0, 4)} – ${fmtDM(t.end)}/${t.end.slice(0, 4)}${t.note ? ` <small>${h(t.note)}</small>` : ''}</span>
          <span class="actions"><button type="button" data-trip-del="${t.id}">✖</button></span></li>`,
      )
      .join('') || `<li class="hint">Nenhuma viagem registrada.${multiOffice() ? '' : ' Cadastre primeiro os escritórios de destino em Ajustes.'}</li>`;
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
    toast('Viagem registrada');
    await load();
  } catch (err) {
    toast(err.message);
  }
});

function addDaysIso(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function cyclePlan(date) {
  // nenhum → escritório → casa → nenhum
  const cur = S.days[date]?.plan || null;
  const next = cur === null ? 'office' : cur === 'office' ? 'home' : null;
  await api(`/api/days/${date}`, { method: 'PUT', body: { plan: next } });
  await load();
}

/** Preenche as próximas 4 semanas com a recomendação, preferindo terça a quinta. */
async function autoPlan() {
  const prefer = [2, 3, 4, 1, 5]; // ter, qua, qui, seg, sex
  const writes = [];
  for (const w of S.report.weeks.filter((x) => !x.isPast).slice(0, 4)) {
    const free = [];
    for (let i = 0; i < 5; i++) {
      const d = addDaysIso(w.start, i);
      const { hol, rec, plan, future, today } = dayInfo(d);
      if (d < S.semester.start || d > S.semester.end || hol || rec.status || plan || (!future && !today)) continue;
      free.push({ d, wd: i + 1 });
    }
    free.sort((a, b) => prefer.indexOf(a.wd) - prefer.indexOf(b.wd));
    let need = Math.max(0, w.recommendedOffice - w.plannedOffice);
    for (const f of free) {
      writes.push({ d: f.d, plan: need > 0 ? 'office' : 'home' });
      if (need > 0) need--;
    }
  }
  for (const w of writes) await api(`/api/days/${w.d}`, { method: 'PUT', body: { plan: w.plan } });
  toast(`${writes.length} dia(s) planejados`);
  await load();
}

// ---------------------------------------------------------------- configurações
// ---- campos de hora (listas em vez do relógio nativo) -------------------------
const pad2 = (n) => String(n).padStart(2, '0');
function initTimeFields() {
  for (const el of $$('.time-field')) {
    const n = el.dataset.name;
    const hours = Array.from({ length: 24 }, (_, i) => `<option>${pad2(i)}</option>`).join('');
    const mins = Array.from({ length: 12 }, (_, i) => `<option>${pad2(i * 5)}</option>`).join('');
    el.innerHTML = `<select name="${n}H" aria-label="Hora">${hours}</select><b>:</b><select name="${n}M" aria-label="Minutos">${mins}</select>`;
  }
}
function setTime(form, n, value) {
  const [hh, mm] = String(value || '09:00').split(':');
  form[`${n}H`].value = hh;
  const sel = form[`${n}M`];
  // Valor antigo fora dos múltiplos de 5 (ex.: 09:07): acrescenta-o para não o perder.
  if (![...sel.options].some((o) => o.value === mm)) sel.add(new Option(mm, mm));
  sel.value = mm;
}
const getTime = (form, n) => `${form[`${n}H`].value}:${form[`${n}M`].value}`;
initTimeFields();

// Alterações por salvar nos Ajustes: não as apagar quando a app recarrega os
// dados (ex.: ao voltar de outra app). Só se repõem depois de salvar.
let settingsDirty = false;
for (const ev of ['input', 'change']) {
  $('#settings-form').addEventListener(ev, (e) => {
    if (e.target.id !== 'backup-import') settingsDirty = true;
  });
}

function renderSettings() {
  const s = S.settings;
  const f = $('#settings-form');
  renderOffices();
  if (LOCAL) renderLocalCards();
  else renderPushStatus();
  if (settingsDirty) return;
  f.officePct.value = s.rules.officePct;
  f.startDate.value = s.rules.startDate || '';
  f.maxHomeDays.value = s.rules.maxHomeDays;
  f.enforceHomeCap.checked = Boolean(s.rules.enforceHomeCap);
  f.maxHomeDays.disabled = !f.enforceHomeCap.checked;
  f.reminderEnabled.checked = s.reminder.enabled;
  setTime(f, 'reminderTime', s.reminder.time);
  f.repeatMinutes.value = s.reminder.repeatMinutes;
  setTime(f, 'reminderUntil', s.reminder.until);
  f.weekly.checked = s.summaries.weekly;
  f.monthly.checked = s.summaries.monthly;
  $('.weekdays').innerHTML =
    '<legend>Dias</legend>' + [1, 2, 3, 4, 5].map((d) => `<label><input type="checkbox" name="wd" value="${d}" ${s.reminder.weekdays.includes(d) ? 'checked' : ''}/> ${DOW[d]}</label>`).join('');
  f.locationEnabled.checked = s.location.enabled;
  setTime(f, 'windowStart', s.location.windowStart);
  setTime(f, 'windowEnd', s.location.windowEnd);
  f.askOnTimezoneChange.checked = s.askOnTimezoneChange;
}

let regionNames = null;
try {
  regionNames = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
} catch {}
const countryName = (c) => {
  try {
    return regionNames?.of(c) || S.meta.countries[c] || c;
  } catch {
    return S.meta.countries[c] || c;
  }
};

function renderOffices() {
  const s = S.settings;
  $('#offices').innerHTML = s.offices
    .map((o) => {
      const primary = o.id === s.primaryOfficeId;
      return `<li><span><b>${h(o.name)}</b>${primary ? ' ⭐ principal' : ''}<br>
        <small>${h(countryName(o.country))}${o.region ? ` · ${h(o.regionName || o.region)}` : ''}${o.city ? ` · ${h(cityName(o))}` : ''} · ${h(o.timezone)} · ${o.location ? '📍 localização definida' : 'sem localização'}</small></span>
        <span class="actions"><button type="button" data-of-edit="${o.id}">Editar</button>${primary ? '' : `<button type="button" data-of-primary="${o.id}" title="Tornar principal">⭐</button><button type="button" data-of-del="${o.id}" title="Remover">✖</button>`}</span></li>`;
    })
    .join('');
  $$('[data-of-edit]').forEach((b) => b.addEventListener('click', () => openOffice(b.dataset.ofEdit)));
  $$('[data-of-primary]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api('/api/settings', { method: 'PUT', body: { primaryOfficeId: b.dataset.ofPrimary } });
      toast('Escritório principal alterado');
      await load();
    }),
  );
  $$('[data-of-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(`Remover o escritório "${officeName(b.dataset.ofDel)}" (e as viagens associadas)?`)) return;
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
let officeEdit = null; // rascunho em edição
let countryMeta = null; // regiões, fusos, facultativos e modelos do país escolhido

async function openOffice(id, preset = {}) {
  const primary = officeById(S.settings.primaryOfficeId);
  officeEdit = id
    ? structuredClone(officeById(id))
    : {
        name: '',
        country: primary?.country || 'PT',
        region: '',
        timezone: '',
        location: null,
        radiusM: 200,
        optionalHolidays: { carnaval: true, corpusChristi: true },
        customHolidays: [],
        city: '',
        ...preset,
      };
  const f = $('#office-form');
  $('#of-title').textContent = id ? `Editar: ${officeEdit.name}` : 'Novo escritório';
  f.name.value = officeEdit.name;
  f.address.value = officeEdit.location?.label || '';
  f.radiusM.value = officeEdit.radiusM;
  f.primary.checked = id === S.settings.primaryOfficeId;
  const codes = Object.keys(S.meta.countries).sort((a, b) => countryName(a).localeCompare(countryName(b), 'pt'));
  const top = ['PT', 'BR'];
  f.country.innerHTML = [...top, ...codes.filter((c) => !top.includes(c))].map((c) => `<option value="${c}">${h(countryName(c))}</option>`).join('');
  f.country.value = officeEdit.country;
  await loadCountryMeta(officeEdit.country);
  $('#office-dialog').showModal();
}

async function loadCountryMeta(country) {
  countryMeta = await api(`/api/countries/${country}`);
  const f = $('#office-form');
  const regions = Object.entries(countryMeta.regions);
  f.region.innerHTML = `<option value="">${regions.length ? '— todo o país —' : '— (não se aplica) —'}</option>` + regions.map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join('');
  f.region.value = officeEdit.region || '';
  f.region.disabled = regions.length === 0;
  const tzs = [...new Set([...(countryMeta.timezones || []), officeEdit.timezone].filter(Boolean))];
  if (!officeEdit.timezone) officeEdit.timezone = tzs[0] || 'UTC';
  f.timezone.innerHTML = (tzs.length ? tzs : ['UTC']).map((z) => `<option>${h(z)}</option>`).join('');
  f.timezone.value = officeEdit.timezone;
  $('#of-optional').innerHTML =
    '<legend>Pontos facultativos concedidos</legend>' +
    countryMeta.optional.map((o) => `<label><input type="checkbox" data-opt="${o.key}" ${officeEdit.optionalHolidays?.[o.key] ? 'checked' : ''}/> ${h(o.name)}</label>`).join('');
  // Escritórios antigos não tinham "city": deduz-se dos feriados já guardados.
  if (!officeEdit.city) officeEdit.city = countryMeta.presets.find((p) => presetIn(p, officeEdit.customHolidays))?.id || '';
  const hasCities = countryMeta.presets.length > 0;
  $('#of-city-wrap').hidden = !hasCities;
  $('#of-city').innerHTML =
    '<option value="">— Nenhuma / outra cidade —</option>' + countryMeta.presets.map((p) => `<option value="${p.id}">${h(p.name)}</option>`).join('');
  $('#of-city').value = officeEdit.city || '';
  renderOfficeLoc();
  renderOfficeCustom();
}

// ---- cidade (feriado municipal) e lista completa de feriados ---------------------
const sameHoliday = (a, b) => a.date === b.date && a.name === b.name;
const presetIn = (p, list) => p.holidays.every((hd) => list.some((c) => sameHoliday(c, hd)));
const cityPreset = () => countryMeta?.presets.find((p) => p.id === officeEdit.city) || null;
function cityName(o) {
  for (const list of Object.values(S.meta.cityPresets || {})) {
    const p = list.find((x) => x.id === o.city);
    if (p) return p.name;
  }
  return o.city;
}
const fmtHol = (d) => (d.length === 5 ? `${d.slice(3)}/${d.slice(0, 2)}` : `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`);

$('#of-city').addEventListener('change', (e) => {
  const prev = cityPreset();
  // Troca de cidade: saem os feriados da cidade anterior, entram os da nova.
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
    const workdays = holidays.filter((x) => !x.weekend).length;
    box.querySelector('summary').textContent = `📅 Ver todos os feriados de ${year} deste escritório (${holidays.length}; ${workdays} em dias úteis)`;
    const TYPE = { nacional: 'nacional', facultativo: 'facultativo', municipal: 'municipal', estadual: 'regional', empresa: 'empresa' };
    box.querySelector('ul').innerHTML = holidays
      .map((x) => {
        const wd = DOW[new Date(x.date + 'T12:00:00Z').getUTCDay()];
        return `<li class="${x.weekend ? 'weekend' : ''}"><span>${wd} ${fmtDM(x.date)} — ${h(x.name)}${x.weekend ? ' <small>(fim de semana)</small>' : ''}</span> <span class="tag">${TYPE[x.type] || x.type}</span></li>`;
      })
      .join('');
  } catch (err) {
    box.querySelector('summary').textContent = `Não foi possível calcular os feriados: ${err.message}`;
  }
}
$('#of-optional').addEventListener('change', refreshHolidayPreview);

function renderOfficeLoc() {
  const l = officeEdit.location;
  $('#of-loc').textContent = l ? `📍 ${l.label || ''} (${l.lat.toFixed(5)}, ${l.lng.toFixed(5)})` : 'Sem localização (necessária só para o check-in por localização).';
}

function renderOfficeCustom() {
  const p = cityPreset();
  $('#of-city-hint').textContent = p
    ? `Feriado(s) municipal(is) de ${p.name}: ${p.holidays.map((hd) => `${fmtHol(hd.date)} ${hd.name}`).join(', ')}.`
    : countryMeta?.presets.length
      ? 'Sem cidade escolhida: se a sua não estiver na lista, adicione o feriado municipal em "Outros feriados locais".'
      : 'Não há lista de cidades para este país: adicione o feriado municipal em "Outros feriados locais".';
  const fmt = (d) => (d.length === 5 ? `${fmtHol(d)} (todo ano)` : fmtHol(d));
  const items = officeEdit.customHolidays.map((c, i) => ({ c, i })).filter(({ c }) => !p?.holidays.some((hd) => sameHoliday(c, hd)));
  $('#of-custom').innerHTML =
    items.map(({ c, i }) => `<li><span>${fmt(c.date)} — ${h(c.name)} <small>${c.scope}</small></span><button type="button" data-rm="${i}">✖</button></li>`).join('') ||
    '<li class="hint">Nenhum.</li>';
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
  // Feriados locais pertencem a uma cidade de um país: ao trocar de país, saem.
  if (officeEdit.customHolidays.length) {
    toast(`${officeEdit.customHolidays.length} feriado(s) local(is) do país anterior removido(s).`);
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
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(raw);
  if (!m || !name) return toast('Use DD/MM ou DD/MM/AAAA e um nome.');
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
    // Geocodificação gratuita via OpenStreetMap (Nominatim), feita no navegador.
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
    const [hit] = await res.json();
    if (!hit) return toast('Endereço não encontrado. Tente ser mais específico ou use a posição atual.');
    officeEdit.location = { lat: Number(hit.lat), lng: Number(hit.lon), label: q };
    renderOfficeLoc();
  } catch {
    toast('Falha ao procurar endereço.');
  }
});

$('#of-here').addEventListener('click', async () => {
  try {
    const p = await getPosition();
    officeEdit.location = { lat: p.lat, lng: p.lng, label: $('#office-form').address.value.trim() || 'Posição registrada' };
    renderOfficeLoc();
  } catch (e) {
    toast(e.message);
  }
});

$('#of-save').addEventListener('click', async () => {
  const f = $('#office-form');
  if (!f.name.value.trim()) return toast('Dê um nome ao escritório.');
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
    toast('Escritório salvo');
    await load();
  } catch (err) {
    toast(err.message);
  }
});

$('#office-add').addEventListener('click', () => openOffice(null));
$('#start-clear').addEventListener('click', () => {
  const f = $('#settings-form');
  f.startDate.value = '';
  settingsDirty = true;
  toast('Sem data de início: conta o semestre inteiro. Salve para aplicar.');
});
$('#settings-form').enforceHomeCap.addEventListener('change', (e) => (e.target.form.maxHomeDays.disabled = !e.target.checked));

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const patch = {
    rules: {
      officePct: Number(f.officePct.value),
      maxHomeDays: Number(f.maxHomeDays.value),
      enforceHomeCap: f.enforceHomeCap.checked,
      startDate: f.startDate.value || null,
    },
    reminder: {
      enabled: f.reminderEnabled.checked,
      time: getTime(f, 'reminderTime'),
      repeatMinutes: Number(f.repeatMinutes.value),
      until: getTime(f, 'reminderUntil'),
      weekdays: $$('input[name=wd]:checked', f).map((x) => Number(x.value)),
    },
    summaries: { weekly: f.weekly.checked, monthly: f.monthly.checked },
    location: { enabled: f.locationEnabled.checked, windowStart: getTime(f, 'windowStart'), windowEnd: getTime(f, 'windowEnd') },
    askOnTimezoneChange: f.askOnTimezoneChange.checked,
  };
  if (patch.location.enabled && !S.settings.offices.some((o) => o.location)) return toast('Defina a localização de pelo menos um escritório primeiro.');
  if (patch.reminder.until <= patch.reminder.time) return toast('"Parar às" tem de ser depois do primeiro lembrete.');
  if (patch.location.windowEnd <= patch.location.windowStart) return toast('O fim da janela de localização tem de ser depois do início.');
  try {
    await api('/api/settings', { method: 'PUT', body: patch });
    settingsDirty = false;
    toast('Configurações salvas');
    await load();
  } catch (err) {
    toast(err.message);
  }
});

// ---------------------------------------------------------------- push
function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function renderPushStatus() {
  const el = $('#push-status');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    el.textContent = 'Este navegador não suporta notificações push. No iPhone, instale a app na Tela de Início (Compartilhar → Adicionar à Tela de Início) e abra-a por lá.';
    $('#push-enable').disabled = true;
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  el.textContent = sub
    ? `✅ Notificações ativas neste dispositivo (${S.meta.subscriptions} dispositivo(s) no total).`
    : `Notificações desativadas neste dispositivo. Permissão do navegador: ${Notification.permission}.`;
  $('#push-enable').textContent = sub ? 'Desativar neste dispositivo' : 'Ativar notificações neste dispositivo';
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
    if (perm !== 'granted') return toast('Permissão de notificação negada.');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(S.meta.vapidPublicKey) });
    await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
    toast('Notificações ativadas!');
  }
  await load();
});

$('#push-test').addEventListener('click', async () => {
  const r = await api('/api/push/test', { method: 'POST' });
  toast(r.total ? `Enviado para ${r.delivered}/${r.total} dispositivo(s)` : 'Nenhum dispositivo inscrito ainda.');
});

$('#logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.reload();
});

// O service worker avisa quando você responde pelos botões da notificação.
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'checked-in') load();
});

// ---------------------------------------------------------------- modo local
// Sem servidor: lembretes pelo calendário do celular + cópia de segurança.
function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Partilha um arquivo (folha de partilha do celular) ou, se não der, descarrega-o. */
async function shareOrDownload(filename, text, type) {
  try {
    const file = new File([text], filename, { type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return; // utilizador cancelou
  }
  download(filename, text, type);
}

function renderLocalCards() {
  $$('.server-only').forEach((el) => (el.hidden = true));
  $$('.local-only').forEach((el) => (el.hidden = false));
  const r = S.settings.reminder;
  $('#cal-info').textContent = `Lembretes às ${r.time}${r.repeatMinutes ? `, repetidos a cada ${r.repeatMinutes} min (até 3 alertas)` : ''}, nos dias úteis de hoje até ao fim do semestre — sem feriados, férias e dias já registrados.`;
}

$('#cal-ics').addEventListener('click', async () => {
  const { ics, count, until } = (await localBackend).reminderIcs();
  if (!count) return toast('Não há dias úteis por registrar até ao fim do semestre.');
  await shareOrDownload(`presenca-lembretes-ate-${until}.ics`, ics, 'text/calendar');
  toast(`${count} lembretes gerados. Abra o arquivo para adicioná-los ao calendário.`);
});
$('#cal-google').addEventListener('click', async () => {
  window.open((await localBackend).googleLink(), '_blank', 'noopener');
});
$('#backup-export').addEventListener('click', async () => {
  const text = (await localBackend).exportBackup();
  await shareOrDownload(`presenca-copia-${S.now.date}.json`, text, 'application/json');
  try {
    localStorage.setItem('presenca:lastBackup', S.now.date);
  } catch {}
  renderBackupInfo();
});
$('#backup-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!confirm('Importar esta cópia SUBSTITUI todos os dados atuais deste aparelho. Continuar?')) return;
  try {
    const n = (await localBackend).importBackup(await file.text());
    toast(`Cópia restaurada: ${n} dia(s).`);
    await load();
  } catch (err) {
    toast(err.message);
  }
});

function renderBackupInfo() {
  let last = null;
  try {
    last = localStorage.getItem('presenca:lastBackup');
  } catch {}
  $('#backup-info').textContent = last ? `Última cópia: ${fmtDM(last)}/${last.slice(0, 4)}.` : 'Ainda não fez nenhuma cópia de segurança.';
}

$('#export-csv').addEventListener('click', async () => {
  if (LOCAL) await shareOrDownload(`presenca-${S.now.date}.csv`, (await localBackend).exportCsv(), 'text/csv');
  else location.href = 'api/export.csv';
});

// ---------------------------------------------------------------- inicialização
async function boot() {
  if (LOCAL) {
    // Pede ao navegador para não apagar os dados por falta de espaço/uso.
    navigator.storage?.persist?.().catch(() => {});
  }
  const auth = await api('/api/auth');
  $('#logout').hidden = !auth.required;
  if (!auth.ok) return showLogin();
  await load();

  // Check-in automático por localização: ao abrir pela notificação, ou se a
  // app for aberta dentro da janela e hoje ainda não houver resposta.
  const params = new URLSearchParams(location.search);
  const loc = S.settings.location;
  const todayKey = `geo-asked-${S.now.date}`;
  let asked = false;
  try {
    asked = sessionStorage.getItem(todayKey) === '1';
  } catch {}
  if (loc.enabled && S.settings.offices.some((o) => o.location) && S.today.workingDay && !S.today.record?.status && inLocationWindow() && (params.get('checkin') === 'location' || !asked)) {
    try {
      sessionStorage.setItem(todayKey, '1');
    } catch {}
    location.hash = '#painel';
    locationCheckin();
  }
  if (params.has('checkin')) history.replaceState(null, '', location.pathname + location.hash);
  if (LOCAL) renderBackupInfo();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
boot().catch((e) => console.error(e));
// Atualiza quando volta à app (ex.: respondeu pela notificação em outro momento)
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && S && load().catch(() => {}));
