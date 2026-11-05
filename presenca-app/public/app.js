// Frontend em JavaScript puro (sem framework nem build).
// Decisão: para uma app pessoal com 4 telas, um framework (React/Vue) traria
// um passo de build e dependências a manter sem ganho real. Tudo aqui é
// "render a partir do estado": cada ação chama a API e volta a desenhar.

import { isAtOffice } from '/core/geo.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LABEL = { office: 'Escritório', home: 'Casa', absence: 'Ausência' };
const ICON = { office: '🏢', home: '🏠', absence: '🌴' };
const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const STATUS_TXT = {
  ok: 'Em dia', atencao: 'Atenção', critico: 'Crítico', impossivel: 'Meta inalcançável', cumprido: 'Meta cumprida',
};
const fmtDM = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fmtLong = (iso) => {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC' });
};
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

let S = null; // último estado vindo do servidor
let semesterId = null;
let geoResult = null; // resultado do último check-in por localização (só em memória)

// ---------------------------------------------------------------- API
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  if (res.status === 401 && path !== '/api/login') {
    showLogin();
    throw new Error('Não autenticado');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
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

function renderToday() {
  const t = S.today;
  const el = $('#today-card');
  if (!t.workingDay) {
    el.innerHTML = `<div class="big">Hoje, ${h(fmtLong(t.date))}</div><p>${t.holiday ? `🎉 Feriado: <b>${h(t.holiday.name)}</b>` : 'Fim de semana — bom descanso! 😌'}</p>`;
    return;
  }
  const cur = t.record?.status;
  const loc = S.settings.location;
  const canGeo = loc.enabled && loc.office;
  el.innerHTML = `
    <div class="big">Hoje, ${h(fmtLong(t.date))}</div>
    <p class="hint">${cur ? `Registrado: <b>${ICON[cur]} ${LABEL[cur]}</b>${t.record.source === 'localizacao' ? ` (pela localização, a ${t.record.distance} m do escritório)` : ''}. Pode alterar abaixo.` : 'Onde você está trabalhando hoje?'}</p>
    <div class="choice">
      ${['office', 'home', 'absence'].map((s) => `<button data-checkin="${s}" class="${s} ${cur === s ? 'sel' : ''}">${ICON[s]} ${LABEL[s]}</button>`).join('')}
    </div>
    ${canGeo && !cur ? `<button id="geo-check">📍 Verificar pela localização</button>` : ''}
    <div id="geo-box"></div>`;
  $$('[data-checkin]', el).forEach((b) => b.addEventListener('click', () => checkin(b.dataset.checkin, 'manual')));
  $('#geo-check', el)?.addEventListener('click', () => locationCheckin());
  if (geoResult) renderGeoResult();
}

async function checkin(status, source, distance = null) {
  await api('/api/checkin', { method: 'POST', body: { status, source, distance } });
  geoResult = null;
  toast(`Registrado: ${LABEL[status]}`);
  await load();
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
    geoResult = isAtOffice(pos, loc.office, loc.radiusM); // pos é descartada aqui
    renderGeoResult();
  } catch (e) {
    if (box) box.innerHTML = `<p class="error">${h(e.message)}</p>`;
  }
}

function renderGeoResult() {
  const box = $('#geo-box');
  if (!box || !geoResult) return;
  const guess = geoResult.atOffice ? 'office' : 'home';
  const dist = geoResult.distance >= 1000 ? `${(geoResult.distance / 1000).toFixed(1)} km` : `${geoResult.distance} m`;
  box.innerHTML = `<div class="geo-result">
      📍 Você está a <b>${dist}</b> do escritório. Parece que está <b>${geoResult.atOffice ? 'no escritório' : 'em casa / fora do escritório'}</b>. Confirma?
      <div class="choice">
        <button class="${guess}" id="geo-yes">✔ Sim, ${LABEL[guess]}</button>
        <button id="geo-no">✖ Não, ${LABEL[guess === 'office' ? 'home' : 'office']}</button>
      </div></div>`;
  $('#geo-yes').onclick = () => checkin(guess, 'localizacao', geoResult.distance);
  $('#geo-no').onclick = () => checkin(guess === 'office' ? 'home' : 'office', 'manual', geoResult.distance);
}

// ---------------------------------------------------------------- semestre
function renderSemester() {
  const r = S.report;
  const t = r.totals;
  const donePct = r.requiredOffice ? Math.min(100, (t.office / r.requiredOffice) * 100) : 100;
  const planPct = r.requiredOffice ? Math.min(100, (r.plan.officeWithPlan / r.requiredOffice) * 100) : 100;
  $('#semester-card').innerHTML = `
    <h3>${h(r.semester.label)} <span class="badge ${r.status}">${STATUS_TXT[r.status]}</span></h3>
    <div class="bar" title="Escritório: feitos + planejados"><i class="plan" style="width:${planPct}%"></i><i style="width:${donePct}%"></i></div>
    <p class="hint">${t.office} de ${r.requiredOffice} dias obrigatórios no escritório${r.plan.officeWithPlan > t.office ? ` (+${r.plan.officeWithPlan - t.office} planejados)` : ''}.
      Regra que vale: <b>${r.bindingRule === 'teto' ? `teto de ${r.rules.maxHomeDays} dias em casa` : `${r.rules.officePct}% no escritório`}</b>.</p>
    <div class="stats">
      <div class="stat"><b>${t.base}</b><span>dias trabalhados no semestre (${t.working} úteis − ${t.absence} ausências)</span></div>
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
  return { hol, rec, weekend: wd === 0 || wd === 6, past: date < S.now.date, today: date === S.now.date, future: date > S.now.date };
}

function dayClasses(date) {
  const { hol, rec, weekend, past, today } = dayInfo(date);
  const c = ['day'];
  if (weekend) c.push('weekend');
  else if (hol) c.push('holiday');
  else if (rec.status) c.push(rec.status);
  else if (past) c.push('pending');
  if (!rec.status && rec.plan) c.push(`plan-${rec.plan}`);
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
      const { hol, rec } = dayInfo(iso);
      const title = hol ? hol.name : rec.note || '';
      cells += `<button class="${dayClasses(iso)}" data-day="${iso}" title="${h(title)}">${d}${rec.status ? `<small>${ICON[rec.status]}</small>` : ''}</button>`;
    }
    html += `<div class="month"><h3>${first.toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' })}
      <small>${mi ? `🏢 ${mi.office} · 🏠 ${mi.home} · ${pct(mi.officePct)}` : ''}</small></h3><div class="cal">${cells}</div></div>`;
  }
  $('#calendar').innerHTML = html;
  $$('#calendar [data-day]').forEach((b) => b.addEventListener('click', () => openDay(b.dataset.day)));
}

function openDay(date) {
  const { hol, rec, weekend, future } = dayInfo(date);
  if (weekend) return;
  if (hol) return toast(`Feriado: ${hol.name}`);
  const dlg = $('#day-dialog');
  $('#dd-title').textContent = fmtLong(date);
  $('#dd-sub').textContent = future
    ? 'Dia futuro: planeje onde vai trabalhar (ou marque férias/folga).'
    : rec.status
      ? `Registrado: ${LABEL[rec.status]}${rec.source ? ` (${rec.source})` : ''}`
      : 'Sem registro — onde trabalhou?';
  const field = future ? 'plan' : 'status';
  const cur = rec[field];
  $('#dd-buttons').innerHTML =
    ['office', 'home', 'absence'].map((s) => `<button type="button" class="${s} ${cur === s ? 'sel' : ''}" data-v="${s}">${ICON[s]} ${future ? 'Planejar ' : ''}${LABEL[s]}</button>`).join('') +
    `<button type="button" data-v="">Limpar</button>`;
  $('#dd-note').value = rec.note || '';
  $$('#dd-buttons button').forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/api/days/${date}`, { method: 'PUT', body: { [field]: b.dataset.v || null, note: $('#dd-note').value || null } });
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

  const weeks = r.weeks.filter((w) => !w.isPast);
  $('#weeks').innerHTML =
    weeks
      .map((w) => {
        const days = [0, 1, 2, 3, 4].map((i) => {
          const d = addDaysIso(w.start, i);
          const inSem = d >= S.semester.start && d <= S.semester.end;
          const { hol, rec, future, today } = dayInfo(d);
          const disabled = !inSem || hol || (!future && !today) || rec.status;
          const cls = rec.status || (rec.plan ? `plan-${rec.plan}` : '');
          const lbl = hol ? '🎉' : rec.status ? ICON[rec.status] : rec.plan ? ICON[rec.plan] : '·';
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
      const { hol, rec, future, today } = dayInfo(d);
      if (d < S.semester.start || d > S.semester.end || hol || rec.status || rec.plan || (!future && !today)) continue;
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
let customHolidays = [];

function renderSettings() {
  const s = S.settings;
  const f = $('#settings-form');
  f.officePct.value = s.rules.officePct;
  f.maxHomeDays.value = s.rules.maxHomeDays;
  f.reminderEnabled.checked = s.reminder.enabled;
  f.reminderTime.value = s.reminder.time;
  f.repeatMinutes.value = s.reminder.repeatMinutes;
  f.reminderUntil.value = s.reminder.until;
  f.weekly.checked = s.summaries.weekly;
  f.monthly.checked = s.summaries.monthly;
  $('.weekdays').innerHTML =
    '<legend>Dias</legend>' + [1, 2, 3, 4, 5].map((d) => `<label><input type="checkbox" name="wd" value="${d}" ${s.reminder.weekdays.includes(d) ? 'checked' : ''}/> ${DOW[d]}</label>`).join('');

  f.locationEnabled.checked = s.location.enabled;
  f.radiusM.value = s.location.radiusM;
  f.windowStart.value = s.location.windowStart;
  f.windowEnd.value = s.location.windowEnd;
  f.officeAddress.value = s.location.office?.label || '';
  officeDraft = s.location.office;
  renderOfficeInfo();

  f.country.innerHTML = Object.entries(S.meta.countries).map(([k, v]) => `<option value="${k}" ${k === s.country ? 'selected' : ''}>${v.name}</option>`).join('');
  f.timezone.value = s.timezone;
  $('#optional-holidays').innerHTML =
    '<legend>Pontos facultativos concedidos pela empresa</legend>' +
    S.meta.optionalHolidays[s.country].map((o) => `<label><input type="checkbox" name="opt" value="${o.key}" ${s.optionalHolidays[o.key] ? 'checked' : ''}/> ${o.name}</label>`).join('');
  $('#preset-select').innerHTML =
    '<option value="">Adicionar modelo de cidade…</option>' + S.meta.presets[s.country].map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  customHolidays = structuredClone(s.customHolidays);
  renderCustomHolidays();
  renderPushStatus();
}

let officeDraft = null;
function renderOfficeInfo() {
  $('#office-info').textContent = officeDraft
    ? `Escritório: ${officeDraft.label || ''} (${officeDraft.lat.toFixed(5)}, ${officeDraft.lng.toFixed(5)})`
    : 'Nenhum escritório definido.';
}

function renderCustomHolidays() {
  const fmt = (d) => (d.length === 5 ? `${d.slice(3)}/${d.slice(0, 2)} (todo ano)` : `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`);
  $('#custom-holidays').innerHTML =
    customHolidays.map((c, i) => `<li><span>${fmt(c.date)} — ${h(c.name)} <small class="hint">${c.scope}</small></span><button type="button" data-rm="${i}">✖</button></li>`).join('') ||
    '<li class="hint">Nenhum feriado local. Adicione os da sua cidade/estado.</li>';
  $$('#custom-holidays [data-rm]').forEach((b) =>
    b.addEventListener('click', () => {
      customHolidays.splice(Number(b.dataset.rm), 1);
      renderCustomHolidays();
    }),
  );
}

$('#preset-select').addEventListener('change', (e) => {
  const p = S.meta.presets[$('#settings-form').country.value]?.find((x) => x.id === e.target.value);
  if (!p) return;
  for (const hd of p.holidays) if (!customHolidays.some((c) => c.date === hd.date)) customHolidays.push({ ...hd });
  renderCustomHolidays();
  e.target.value = '';
  toast(`Adicionados feriados de ${p.name}. Salve para aplicar.`);
});

$('#ch-add').addEventListener('click', () => {
  const raw = $('#ch-date').value.trim();
  const name = $('#ch-name').value.trim();
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(raw);
  if (!m || !name) return toast('Use DD/MM ou DD/MM/AAAA e um nome.');
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  customHolidays.push({ date: m[3] ? `${m[3]}-${mm}-${dd}` : `${mm}-${dd}`, name, scope: $('#ch-scope').value });
  $('#ch-date').value = $('#ch-name').value = '';
  renderCustomHolidays();
});

$('#geocode').addEventListener('click', async () => {
  const q = $('#settings-form').officeAddress.value.trim();
  if (!q) return;
  try {
    // Geocodificação gratuita via OpenStreetMap (Nominatim), feita no navegador.
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
    const [hit] = await res.json();
    if (!hit) return toast('Endereço não encontrado. Tente ser mais específico ou use "Estou no escritório agora".');
    officeDraft = { lat: Number(hit.lat), lng: Number(hit.lon), label: q };
    renderOfficeInfo();
    toast('Endereço encontrado. Salve para aplicar.');
  } catch {
    toast('Falha ao procurar endereço.');
  }
});

$('#use-here').addEventListener('click', async () => {
  try {
    const p = await getPosition();
    officeDraft = { lat: p.lat, lng: p.lng, label: $('#settings-form').officeAddress.value.trim() || 'Posição registrada' };
    renderOfficeInfo();
    toast('Posição do escritório capturada. Salve para aplicar.');
  } catch (e) {
    toast(e.message);
  }
});

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const patch = {
    country: f.country.value,
    timezone: f.timezone.value.trim(),
    rules: { officePct: Number(f.officePct.value), maxHomeDays: Number(f.maxHomeDays.value) },
    reminder: {
      enabled: f.reminderEnabled.checked,
      time: f.reminderTime.value,
      repeatMinutes: Number(f.repeatMinutes.value),
      until: f.reminderUntil.value,
      weekdays: $$('input[name=wd]:checked', f).map((x) => Number(x.value)),
    },
    summaries: { weekly: f.weekly.checked, monthly: f.monthly.checked },
    location: {
      enabled: f.locationEnabled.checked,
      office: officeDraft,
      radiusM: Number(f.radiusM.value),
      windowStart: f.windowStart.value,
      windowEnd: f.windowEnd.value,
    },
    optionalHolidays: Object.fromEntries(S.meta.optionalHolidays[S.settings.country].map((o) => [o.key, $$('input[name=opt]:checked', f).some((x) => x.value === o.key)])),
    customHolidays,
  };
  if (patch.country !== S.settings.country) delete patch.timezone; // usa o fuso padrão do país
  if (patch.location.enabled && !patch.location.office) return toast('Defina o endereço do escritório primeiro.');
  try {
    await api('/api/settings', { method: 'PUT', body: patch });
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
    el.textContent = 'Este navegador não suporta notificações push. No iPhone, instale a app no tela de início (Compartilhar → Adicionar ao Tela de Início) e abra-a por lá.';
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

// ---------------------------------------------------------------- inicialização
async function boot() {
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
  if (loc.enabled && loc.office && S.today.workingDay && !S.today.record?.status && inLocationWindow() && (params.get('checkin') === 'location' || !asked)) {
    try {
      sessionStorage.setItem(todayKey, '1');
    } catch {}
    location.hash = '#painel';
    locationCheckin();
  }
  if (params.has('checkin')) history.replaceState(null, '', location.pathname + location.hash);
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
boot().catch((e) => console.error(e));
// Atualiza quando volta à app (ex.: respondeu pela notificação noutro momento)
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && S && load().catch(() => {}));
