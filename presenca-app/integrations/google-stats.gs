/**
 * @OnlyCurrentDoc
 * ↑ Esta anotação limita a autorização do script a ESTA planilha: mesmo que alguém
 *   chamasse o endereço /exec, o script não tem permissão para abrir outros arquivos
 *   do seu Drive, o Gmail ou o resto da conta Google.
 */
/**
 * Presença — estatísticas anónimas de uso, numa planilha Google SUA (grátis).
 *
 * Cole este código em Extensões → Apps Script de uma planilha Google nova.
 * A app Presença (só nos aparelhos de quem ACEITOU partilhar estatísticas)
 * envia, no máximo uma vez por dia, um "sinal de vida" com:
 *   código aleatório do aparelho, dia, versão, idioma, país do escritório,
 *   tipo de regra/período, tipo de aparelho (android/ios/desktop), se a app está
 *   instalada na tela inicial e se concluiu o assistente.
 * Nunca recebe nomes, e-mails, presenças, ausências, localização nem o IP.
 *
 * Abas criadas:
 *   Resumo      números principais, frequência de uso, retenção, gráfico
 *   Aparelhos   uma linha por aparelho (primeiro/último dia, dias ativos…)
 *   Atividade   uma linha por aparelho e por dia em que a app foi aberta
 *
 * Dados com mais de ~13 meses são apagados automaticamente no resumo diário.
 *
 * Instruções passo a passo: integrations/google-stats.md
 */

const MAX_NEW_PER_DAY = 500; // trava contra abuso: aparelhos novos aceites por dia
const MAX_REQUESTS_PER_DAY = 20000; // trava contra abuso: pedidos aceites por dia (todos os tipos)
const MAX_DEVICES = 20000; // trava contra abuso: total de aparelhos
const KEEP_DAYS = 400; // ~13 meses: dados mais antigos são apagados (boa prática do RGPD)
const SHEETS = {
  devices: ['Aparelhos', ['id', 'primeiro dia', 'último dia', 'dias ativos', 'versão', 'idioma', 'país', 'regra', 'período', 'aparelho', 'instalada', 'concluiu assistente']],
  activity: ['Atividade', ['dia', 'id']],
};

/** Corra UMA vez (▶ Executar): cria as abas, o resumo diário automático e pede as autorizações. */
function configurar() {
  sheet_('devices');
  sheet_('activity');
  ScriptApp.getProjectTriggers().forEach((t) => t.getHandlerFunction() === 'atualizarResumo' && ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('atualizarResumo').timeBased().everyDays(1).atHour(6).create();
  atualizarResumo();
  Logger.log('Pronto. Agora: Implantar → Nova implantação → App da Web (ver instruções).');
}

/** Menu na planilha. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('📊 Presença').addItem('Atualizar resumo agora', 'atualizarResumo').addToUi();
}

function doGet() {
  return ContentService.createTextOutput('Presença — estatísticas: ativo.');
}

/** Recebe o sinal da app (POST com JSON como texto). */
function doPost(e) {
  let data;
  try {
    data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return reply_({ ok: false, error: 'json' });
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return reply_({ ok: false, error: 'busy' });
  try {
    if (!countRequest_()) return reply_({ ok: false, error: 'limit' });
    if (data.type === 'forget') return reply_(forget_(data));
    if (data.type === 'ping') return reply_(ping_(data));
    return reply_({ ok: false, error: 'type' });
  } catch (err) {
    return reply_({ ok: false, error: String(err && err.message) });
  } finally {
    lock.releaseLock();
  }
}

// ---- validação: lista fechada de campos e formatos -------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pick = (v, re, max) => (typeof v === 'string' && v.length <= max && re.test(v) ? v : '');

function clean_(d) {
  if (!UUID.test(d.id || '') || !DAY.test(d.day || '')) return null;
  // O dia tem de ser hoje (± 1 dia por causa dos fusos): impede "encher" o passado.
  const diff = Math.abs(new Date(d.day + 'T12:00:00Z') - new Date()) / 864e5;
  if (diff > 1.6) return null;
  return {
    id: d.id,
    day: d.day,
    firstSeen: DAY.test(d.firstSeen || '') && d.firstSeen <= d.day ? d.firstSeen : d.day,
    version: pick(d.version, /^[\w.-]+$/, 10),
    lang: pick(d.lang, /^[a-zA-Z-]+$/, 8),
    country: pick(d.country, /^[A-Z]{2}$/, 2),
    rule: pick(d.rule, /^[a-z0-9-]+$/, 20),
    period: pick(d.period, /^(month|quarter|semester|year)$/, 10),
    platform: pick(d.platform, /^(android|ios|desktop|other)$/, 10),
    installed: d.installed === true,
    onboarded: d.onboarded === true,
  };
}

function ping_(raw) {
  const d = clean_(raw);
  if (!d) return { ok: false, error: 'invalid' };
  const sh = sheet_('devices');
  const row = findRow_(sh, d.id);
  const meta = [d.version, d.lang, d.country, d.rule, d.period, d.platform, d.installed ? 'sim' : 'não', d.onboarded ? 'sim' : 'não'];
  if (!row) {
    const props = PropertiesService.getScriptProperties();
    const key = 'new:' + d.day;
    const n = Number(props.getProperty(key) || 0);
    if (n >= MAX_NEW_PER_DAY || sh.getLastRow() - 1 >= MAX_DEVICES) return { ok: false, error: 'limit' };
    props.setProperty(key, String(n + 1));
    sh.appendRow([d.id, d.firstSeen, d.day, 1].concat(meta));
    sheet_('activity').appendRow([d.day, d.id]);
    return { ok: true, new: true };
  }
  const cur = sh.getRange(row, 1, 1, 4).getValues()[0];
  const last = asDay_(cur[2]);
  if (d.day > last) {
    sh.getRange(row, 3, 1, 2).setValues([[d.day, Number(cur[3] || 0) + 1]]);
    sheet_('activity').appendRow([d.day, d.id]);
  }
  sh.getRange(row, 5, 1, meta.length).setValues([meta]);
  return { ok: true };
}

/** Conta o pedido de hoje; false se já passou o teto diário. */
function countRequest_() {
  const props = PropertiesService.getScriptProperties();
  const key = 'req:' + Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
  const n = Number(props.getProperty(key) || 0);
  if (n >= MAX_REQUESTS_PER_DAY) return false;
  props.setProperty(key, String(n + 1));
  return true;
}

/** Apagar tudo deste aparelho (a pessoa desligou as estatísticas). */
function forget_(raw) {
  if (!UUID.test(raw.id || '')) return { ok: false, error: 'invalid' };
  const dev = sheet_('devices');
  const row = findRow_(dev, raw.id);
  if (row) dev.deleteRow(row);
  const act = sheet_('activity');
  const n = act.getLastRow() - 1;
  if (n > 0) {
    const ids = act.getRange(2, 2, n, 1).getValues();
    for (let i = ids.length - 1; i >= 0; i--) if (ids[i][0] === raw.id) act.deleteRow(i + 2);
  }
  return { ok: true };
}

// ---- resumo ------------------------------------------------------------------------------
function atualizarResumo() {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const daysAgo = (n) => Utilities.formatDate(new Date(Date.now() - n * 864e5), tz, 'yyyy-MM-dd');
  const d7 = daysAgo(6);
  const d30 = daysAgo(29);

  purgeOld_(daysAgo(KEEP_DAYS));
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach((k) => /^(new|req):/.test(k) && k.slice(4) < daysAgo(2) && props.deleteProperty(k));
  const devRows = rows_(sheet_('devices'));
  const actRows = rows_(sheet_('activity')).map((r) => [asDay_(r[0]), r[1]]);
  const devices = devRows.map((r) => ({ id: r[0], first: asDay_(r[1]), last: asDay_(r[2]), days: Number(r[3]) || 0, lang: r[5], country: r[6], rule: r[7], platform: r[9], installed: r[10] === 'sim', onboarded: r[11] === 'sim' }));
  const days30 = {};
  const byDay = {};
  for (const [day, id] of actRows) {
    if (day >= d30) days30[id] = (days30[id] || 0) + 1;
    (byDay[day] = byDay[day] || new Set()).add(id);
  }
  const count = (f) => devices.filter(f).length;
  const total = devices.length;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  const old7 = devices.filter((x) => x.first <= daysAgo(7));
  const old30 = devices.filter((x) => x.first <= daysAgo(30));

  const main = [
    ['Presença — estatísticas de uso', ''],
    ['Atualizado em', Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm')],
    ['', ''],
    ['Aparelhos registados (aceitaram estatísticas)', total],
    ['Concluíram o assistente inicial', count((x) => x.onboarded)],
    ['Instalaram na tela inicial', count((x) => x.installed)],
    ['Ativos hoje', count((x) => x.last === today)],
    ['Ativos nos últimos 7 dias', count((x) => x.last >= d7)],
    ['Ativos nos últimos 30 dias', count((x) => x.last >= d30)],
    ['Novos nos últimos 7 dias', count((x) => x.first >= d7)],
    ['', ''],
    ['Frequência (dias com a app aberta nos últimos 30 dias)', ''],
    ['Quase todos os dias úteis (16 ou mais)', count((x) => (days30[x.id] || 0) >= 16)],
    ['Regular (6 a 15 dias)', count((x) => (days30[x.id] || 0) >= 6 && (days30[x.id] || 0) <= 15)],
    ['Ocasional (2 a 5 dias)', count((x) => (days30[x.id] || 0) >= 2 && (days30[x.id] || 0) <= 5)],
    ['Só 1 dia', count((x) => (days30[x.id] || 0) === 1)],
    ['Sem uso há mais de 30 dias', count((x) => x.last < d30)],
    ['Usaram só uma vez e não voltaram', count((x) => x.days === 1 && x.last < today)],
    ['', ''],
    ['Retenção', ''],
    ['Começaram há 7+ dias e usaram na última semana', pct(old7.filter((x) => x.last >= d7).length, old7.length)],
    ['Começaram há 30+ dias e usaram no último mês', pct(old30.filter((x) => x.last >= d30).length, old30.length)],
  ];

  const breakdown = (label, key) => {
    const m = {};
    for (const x of devices) {
      const k = x[key] || '(vazio)';
      m[k] = m[k] || [0, 0];
      m[k][0]++;
      if (x.last >= d30) m[k][1]++;
    }
    return [[label, 'total', 'ativos 30 d']].concat(Object.keys(m).sort((a, b) => m[b][0] - m[a][0]).map((k) => [k, m[k][0], m[k][1]]));
  };
  const blocks = [breakdown('País do escritório', 'country'), breakdown('Idioma', 'lang'), breakdown('Regra', 'rule'), breakdown('Aparelho', 'platform')];

  const firstByDay = {};
  for (const x of devices) firstByDay[x.first] = (firstByDay[x.first] || 0) + 1;
  const series = [['dia', 'ativos', 'novos']];
  for (let i = 59; i >= 0; i--) {
    const d = daysAgo(i);
    series.push([d, byDay[d] ? byDay[d].size : 0, firstByDay[d] || 0]);
  }

  let sh = ss.getSheetByName('Resumo');
  if (!sh) sh = ss.insertSheet('Resumo', 0);
  sh.clear();
  sh.getCharts().forEach((c) => sh.removeChart(c));
  sh.getRange(1, 1, main.length, 2).setValues(main);
  sh.getRange('A1').setFontWeight('bold').setFontSize(14);
  [4, 12, 20].forEach((r) => sh.getRange(r, 1).setFontWeight('bold'));
  let r = 1;
  for (const b of blocks) {
    sh.getRange(r, 4, b.length, 3).setValues(b);
    sh.getRange(r, 4, 1, 3).setFontWeight('bold');
    r += b.length + 1;
  }
  sh.getRange(1, 8, series.length, 3).setValues(series);
  sh.getRange(1, 8, 1, 3).setFontWeight('bold');
  sh.autoResizeColumns(1, 10);
  const chart = sh
    .newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(sh.getRange(1, 8, series.length, 3))
    .setPosition(main.length + 2, 1, 0, 0)
    .setOption('title', 'Aparelhos ativos e novos por dia (últimos 60 dias)')
    .setOption('width', 640)
    .setOption('height', 300)
    .build();
  sh.insertChart(chart);
}

/** Apaga a atividade anterior a `limit` e os aparelhos sem uso desde então. */
function purgeOld_(limit) {
  const keep = (sh, col) => {
    const rows = rows_(sh);
    const kept = rows.filter((r) => asDay_(r[col]) >= limit);
    if (kept.length === rows.length) return;
    sh.getRange(2, 1, rows.length, sh.getLastColumn()).clearContent();
    if (kept.length) sh.getRange(2, 1, kept.length, kept[0].length).setValues(kept);
    if (sh.getLastRow() > kept.length + 1) sh.deleteRows(kept.length + 2, sh.getLastRow() - kept.length - 1);
  };
  keep(sheet_('activity'), 0);
  keep(sheet_('devices'), 2);
}

// ---- utilitários -----------------------------------------------------------------------------
function sheet_(kind) {
  const [name, header] = SHEETS[kind];
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
    // Datas guardadas como texto AAAA-MM-DD (sem conversões de fuso).
    sh.getRange('A:C').setNumberFormat('@');
  }
  return sh;
}

function findRow_(sh, id) {
  if (sh.getLastRow() < 2) return 0;
  const cell = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  return cell ? cell.getRow() : 0;
}

function rows_(sh) {
  const n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, sh.getLastColumn()).getValues() : [];
}

function asDay_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  return String(v || '');
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
