// Motor de cumprimento da regra de presença.
//
// A regra de cada empresa combina:
//   - período de apuração: mês, trimestre, semestre ou ano (ver dates.js);
//   - meta (rules.target):
//       'percent'      → pelo menos officePct% dos dias TRABALHÁVEIS do período
//                        (ex.: "50% por semestre");
//       'daysPerWeek'  → pelo menos N dias em cada semana (ex.: "3 dias por semana");
//       'daysPerMonth' → pelo menos N dias em cada mês (ex.: "8 dias por mês");
//   - dias fixos (rules.fixedDays): dias da semana sempre no escritório
//     (ex.: terça e quinta);
//   - dias de trabalho da pessoa (workdays): ex.: seg–qui numa semana de 4 dias.
//
//   dias úteis        = dias de trabalho do período − feriados (do local de trabalho)
//   dias trabalháveis = dias úteis − ausências (férias, doença, licenças, folgas…)
//
// Exemplo "50% por semestre", 2º semestre de 2026 em Lisboa (128 dias úteis):
//   sem ausências: 128 → 64 no escritório; com 13 dias de ausência: 115 → 58.
// Exemplo "3 dias por semana": semana normal → 3; semana com 1 feriado (4 dias)
//   → 3 (3×4/5 = 2,4, arredondado para cima); semana com 2 dias de férias → 2.
//
// Início da contagem (rules.startDate, ex.: data de admissão): os dias
// anteriores não contam. Teto opcional de dias em casa (enforceHomeCap).

import { eachDay, mondayOf, addDays, weekday, isWorkday } from './dates.js';
import { t, fmtDayMonth, fmtFull, monthLong } from './i18n.js';

export const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5];
export const monthName = (m) => monthLong(m);

const fmtList = (dates) => dates.slice(0, 5).map(fmtDayMonth).join(', ') + (dates.length > 5 ? '…' : '');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Classifica cada dia de trabalho do período.
 * kind:
 *   holiday                  → feriado do local de trabalho
 *   office | home | absence  → já registrado (ou ausência planejada, ex.: férias)
 *   pending                  → dia passado sem registro
 *   open                     → hoje/futuro ainda por decidir (pode ter plan office/home)
 */
export function classifyDays({ semester: period, today, days, holidays, defaultPlan, startDate, workdays = DEFAULT_WORKDAYS }) {
  const out = [];
  for (const date of eachDay(period.start, period.end)) {
    if (!isWorkday(date, workdays)) continue;
    if (startDate && date < startDate) continue; // antes do início da contagem (admissão)
    const holiday = holidays.get(date);
    if (holiday) {
      out.push({ date, kind: 'holiday', holiday });
      continue;
    }
    const rec = days.get(date) || {};
    let kind;
    let absenceType = null;
    if (rec.status) kind = rec.status;
    else if (rec.plan === 'absence') kind = 'absence';
    else if (date < today) kind = 'pending';
    else kind = 'open';
    if (kind === 'absence') absenceType = rec.absenceType || 'nao_especificado';
    // defaultPlan: ex.: dias de uma viagem de trabalho contam como "planejado escritório".
    const plan = rec.status ? null : rec.plan || (kind === 'open' ? defaultPlan?.(date) : null) || null;
    out.push({ date, kind, plan, planned: !rec.status && rec.plan === 'absence', absenceType, justification: rec.justification || null });
  }
  return out;
}

function emptyCounts() {
  return { working: 0, holidays: 0, office: 0, home: 0, absence: 0, absenceByType: {}, pending: 0, open: 0, plannedOffice: 0, plannedHome: 0 };
}

function count(bucket, d) {
  if (d.kind === 'holiday') {
    bucket.holidays++;
    return;
  }
  bucket.working++;
  bucket[d.kind]++;
  if (d.kind === 'absence') bucket.absenceByType[d.absenceType] = (bucket.absenceByType[d.absenceType] || 0) + 1;
  if (d.kind === 'open' && d.plan === 'office') bucket.plannedOffice++;
  if (d.kind === 'open' && d.plan === 'home') bucket.plannedHome++;
}

/**
 * Distribui `n` dias por "baldes" proporcionalmente à capacidade de cada um
 * (método do maior resto). Ex.: 10 dias por 4 semanas de 5 → 3, 3, 2, 2.
 */
export function allocate(n, capacities) {
  const total = capacities.reduce((a, b) => a + b, 0);
  if (total === 0 || n <= 0) return capacities.map(() => 0);
  const target = Math.min(n, total);
  const raw = capacities.map((c) => (target * c) / total);
  const result = raw.map((r, i) => Math.min(capacities[i], Math.floor(r)));
  let left = target - result.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  while (left > 0) {
    let progressed = false;
    for (const { i } of order) {
      if (left === 0) break;
      if (result[i] < capacities[i]) {
        result[i]++;
        left--;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return result;
}

export function computeSemester({ semester: period, today, days, holidays, rules, defaultPlan, workdays = DEFAULT_WORKDAYS }) {
  const target = rules.target || 'percent';
  const pct = (rules.officePct ?? 50) / 100;
  const fixedDays = (rules.fixedDays || []).filter((d) => workdays.includes(d));
  const startDate = rules.startDate && rules.startDate > period.start ? rules.startDate : null;
  const classified = classifyDays({ semester: period, today, days, holidays, defaultPlan, startDate, workdays });
  const totals = emptyCounts();
  for (const d of classified) count(totals, d);
  const notStarted = Boolean(startDate && startDate > period.end);
  const base = totals.working - totals.absence; // dias efetivamente trabalhados

  // ---- semanas e meses (necessários para as metas por semana/mês) -------------
  const weekMap = new Map();
  const monthMap = new Map();
  for (const d of classified) {
    const wk = mondayOf(d.date);
    if (!weekMap.has(wk)) weekMap.set(wk, { start: wk, end: addDays(wk, 6), ...emptyCounts(), holidayList: [] });
    const w = weekMap.get(wk);
    count(w, d);
    if (d.kind === 'holiday') w.holidayList.push({ date: d.date, name: d.holiday.name });
    const mKey = d.date.slice(0, 7);
    if (!monthMap.has(mKey)) {
      const m = Number(mKey.slice(5));
      monthMap.set(mKey, { key: mKey, month: m, name: monthName(m), lastWorkingDay: null, ...emptyCounts() });
    }
    const mo = monthMap.get(mKey);
    count(mo, d);
    if (d.kind !== 'holiday') mo.lastWorkingDay = d.date;
  }
  const weeks = [...weekMap.values()];
  const months = [...monthMap.values()];
  weeks.forEach((w) => {
    w.base = w.working - w.absence;
    w.isCurrent = today >= w.start && today <= w.end;
    w.isPast = w.end < today;
  });
  months.forEach((m) => {
    m.base = m.working - m.absence;
    m.closed = m.lastWorkingDay !== null && m.lastWorkingDay < today;
    m.isCurrent = today.slice(0, 7) === m.key;
  });

  // ---- meta do período ----------------------------------------------------------
  let requiredByRule;
  if (target === 'daysPerWeek') {
    // N por semana, proporcional aos dias disponíveis (feriados/ausências reduzem)
    const n = rules.daysPerWeek ?? 3;
    weeks.forEach((w) => (w.target = Math.min(w.base, Math.ceil((n * w.base) / workdays.length - 1e-9))));
    requiredByRule = weeks.reduce((a, w) => a + w.target, 0);
  } else if (target === 'daysPerMonth') {
    const n = rules.daysPerMonth ?? 8;
    months.forEach((m) => {
      const [y, mm] = m.key.split('-').map(Number);
      let possible = 0; // dias úteis do mês inteiro (para proporcionalizar meses cortados ou com ausências)
      for (const d of eachDay(`${m.key}-01`, `${m.key}-${new Date(Date.UTC(y, mm, 0)).getUTCDate()}`)) if (isWorkday(d, workdays) && !holidays.has(d)) possible++;
      m.target = possible ? Math.min(m.base, Math.ceil((n * m.base) / possible - 1e-9)) : 0;
    });
    requiredByRule = months.reduce((a, m) => a + m.target, 0);
  } else {
    requiredByRule = Math.ceil(base * pct - 1e-9);
  }
  const requiredByPct = requiredByRule; // nome antigo (compatibilidade)
  const isFixed = (d) => fixedDays.includes(weekday(d.date));
  const fixedAll = classified.filter((d) => d.kind !== 'holiday' && d.kind !== 'absence' && isFixed(d));
  const requiredByFixed = fixedAll.length;

  // Teto de dias em casa (opcional, só faz sentido com meta em %). Num período
  // incompleto (admissão a meio) o teto é proporcional.
  let homeCap = rules.maxHomeDays;
  if (startDate && !notStarted) {
    const full = classifyDays({ semester: period, today, days, holidays, workdays }).filter((d) => d.kind !== 'holiday').length;
    homeCap = full > 0 ? Math.floor((rules.maxHomeDays * totals.working) / full) : 0;
  }
  const requiredByCap = rules.enforceHomeCap && target === 'percent' ? Math.max(0, base - homeCap) : 0;
  const requiredOffice = Math.max(requiredByRule, requiredByCap, requiredByFixed);
  const bindingRule = requiredByCap > Math.max(requiredByRule, requiredByFixed) ? 'teto' : requiredByFixed > requiredByRule ? 'fixos' : 'percentual';
  const maxHome = base - requiredOffice;
  const baselinePace = base > 0 ? requiredOffice / base : 0;
  months.forEach((m) => {
    if (m.target === undefined) m.target = Math.ceil(m.base * baselinePace - 1e-9); // "cota" ao ritmo do período
  });

  // ---- grupos onde a meta se mede (o período todo, cada semana ou cada mês) ---
  // Numa meta por semana/mês, semanas/meses já passados não se recuperam depois:
  // ficam registados como "falhados" e não contam para o que falta.
  const groups =
    target === 'daysPerWeek'
      ? weeks.map((w) => ({ key: w.start, of: (d) => mondayOf(d.date) === w.start, target: w.target, past: w.isPast, ref: w }))
      : target === 'daysPerMonth'
        ? months.map((m) => ({ key: m.key, of: (d) => d.date.startsWith(m.key), target: m.target, past: m.closed, ref: m }))
        : [{ key: 'all', of: () => true, target: requiredOffice, past: false }];
  const missed = [];
  let officeNeeded = 0;
  let groupNeedAfterPlan = 0;
  const futureFixedNotOffice = [];
  for (const g of groups) {
    const ds = classified.filter(g.of);
    const office = ds.filter((d) => d.kind === 'office').length;
    const plannedOffice = ds.filter((d) => d.kind === 'open' && d.plan === 'office').length;
    g.need = Math.max(0, g.target - office);
    g.needAfterPlan = Math.max(0, g.target - office - plannedOffice);
    if (g.past) {
      if (g.need > 0) missed.push({ key: g.key, office, target: g.target });
      g.need = 0;
      g.needAfterPlan = 0;
    }
    if (g.ref) {
      g.ref.need = g.need;
      g.ref.met = g.past ? office >= g.target : null;
    }
    officeNeeded += g.need;
    groupNeedAfterPlan += g.needAfterPlan;
  }
  for (const d of fixedAll) if (d.kind === 'open' && d.plan !== 'office') futureFixedNotOffice.push(d.date);
  if (target === 'percent') officeNeeded = Math.max(0, requiredOffice - totals.office);

  const undecided = totals.pending + totals.open; // = base − office − home
  const homeLeft = maxHome - totals.home;
  const paceNeeded = undecided > 0 ? officeNeeded / undecided : officeNeeded > 0 ? Infinity : 0;

  let status;
  if (notStarted) status = 'sem_contagem';
  else if (officeNeeded === 0) status = missed.length ? 'atencao' : 'cumprido';
  else if (officeNeeded > undecided) status = 'impossivel';
  else if (paceNeeded <= baselinePace + 0.02) status = missed.length ? 'atencao' : 'ok';
  else if (paceNeeded <= baselinePace + 0.2) status = 'atencao';
  else status = 'critico';

  // ---- projeção com o planejamento ------------------------------------------
  // Projeção = feito + planejado. "Crédito" = dias de escritório acima do mínimo.
  const officeWithPlan = totals.office + totals.plannedOffice;
  const homeWithPlan = totals.home + totals.plannedHome;
  const unplanned = undecided - totals.plannedOffice - totals.plannedHome;
  const neededAfterPlan = Math.max(groupNeedAfterPlan, futureFixedNotOffice.filter((d) => !(days.get(d)?.plan === 'home')).length, 0);
  const fixedPlannedHome = futureFixedNotOffice.filter((d) => days.get(d)?.plan === 'home');
  const plan = {
    officeWithPlan,
    homeWithPlan,
    unplanned,
    neededAfterPlan,
    projectedPct: base > 0 ? officeWithPlan / base : null,
    // Crédito só existe com meta em %: com "N por semana/mês" um excesso numa
    // semana/mês não compensa outra.
    credit: target === 'percent' ? officeWithPlan - requiredOffice : 0,
    homeFree: Math.max(0, unplanned - neededAfterPlan),
    feasible: neededAfterPlan <= unplanned && homeWithPlan <= maxHome && fixedPlannedHome.length === 0,
    homeOverCap: Math.max(0, homeWithPlan - maxHome),
    fixedPlannedHome,
  };

  // ---- sugestão para os dias ainda livres -------------------------------------
  // Respeita o plano: só distribui o que falta, em cada grupo, pelos dias livres
  // desse grupo. Os dias fixos livres são sugeridos primeiro (são obrigatórios).
  const free = classified.filter((d) => d.kind === 'open' && !d.plan);
  weeks.forEach((w) => (w.suggestedOffice = 0));
  months.forEach((m) => (m.suggestedOffice = 0));
  const wIdx = new Map(weeks.map((w) => [w.start, w]));
  const mIdx = new Map(months.map((m) => [m.key, m]));
  const addSuggestion = (date, k) => {
    wIdx.get(mondayOf(date)).suggestedOffice += k;
    mIdx.get(date.slice(0, 7)).suggestedOffice += k;
  };
  for (const g of groups) {
    const gFree = free.filter(g.of);
    const fixedFree = gFree.filter(isFixed);
    fixedFree.forEach((d) => addSuggestion(d.date, 1));
    const rest = Math.max(0, (target === 'percent' ? neededAfterPlan : g.needAfterPlan) - fixedFree.length);
    const others = gFree.filter((d) => !isFixed(d));
    // células semana×mês, para a sugestão somar certo nas duas vistas
    const cells = new Map();
    for (const d of others) {
      const key = `${mondayOf(d.date)}|${d.date.slice(0, 7)}`;
      cells.set(key, (cells.get(key) || 0) + 1);
    }
    const keys = [...cells.keys()];
    allocate(rest, keys.map((k) => cells.get(k))).forEach((n, i) => {
      if (!n) return;
      const [wk, mk] = keys[i].split('|');
      wIdx.get(wk).suggestedOffice += n;
      mIdx.get(mk).suggestedOffice += n;
    });
  }

  let cumOffice = 0;
  let cumBase = 0;
  weeks.forEach((w) => {
    w.unplanned = w.open - w.plannedOffice - w.plannedHome;
    w.recommendedOffice = w.plannedOffice + w.suggestedOffice;
    cumOffice += w.office + w.plannedOffice;
    cumBase += w.base;
    w.cumOffice = cumOffice;
    w.cumBase = cumBase;
    w.cumPct = cumBase > 0 ? cumOffice / cumBase : null;
  });
  months.forEach((m) => {
    const decided = m.office + m.home;
    m.officePct = decided > 0 ? m.office / decided : null;
    m.recommendedOffice = m.plannedOffice + m.suggestedOffice;
    m.projectedPct = m.base > 0 ? (m.office + m.plannedOffice) / m.base : null;
    m.neededToHitTarget = Math.max(0, m.target - m.office);
  });

  const result = {
    semester: period,
    period,
    today,
    rules: { ...rules, target },
    workdays,
    totals: { ...totals, base, undecided },
    requiredOffice,
    requiredByPct,
    requiredByCap,
    requiredByFixed,
    bindingRule,
    maxHome,
    officeNeeded,
    homeLeft,
    baselinePace,
    paceNeeded: Number.isFinite(paceNeeded) ? paceNeeded : null,
    status,
    plan,
    startDate,
    notStarted,
    homeCap,
    missed,
    fixedMissed: fixedAll.filter((d) => d.kind === 'home').map((d) => d.date),
    pendingDates: classified.filter((d) => d.kind === 'pending').map((d) => d.date),
    unjustifiedAbsences: classified.filter((d) => d.kind === 'absence' && d.absenceType !== 'ferias' && !d.justification).map((d) => d.date),
    weeks,
    months,
  };
  result.alerts = buildAlerts(result);
  return result;
}

/** Mensagens em linguagem natural (no idioma atual). */
export function buildAlerts(r) {
  const alerts = [];
  const add = (level, text) => alerts.push({ level, text });
  const pctTxt = `${r.rules.officePct}%`;
  const target = r.rules.target;

  if (r.notStarted) {
    add('info', t('alert.notStarted', { date: fmtFull(r.startDate) }));
    return alerts;
  }
  if (r.startDate) add('info', t('alert.startDate', { date: fmtFull(r.startDate), n: r.totals.working }));

  if (r.status === 'impossivel') {
    add('danger', t('alert.impossible', { undecided: r.totals.undecided, short: r.officeNeeded - r.totals.undecided, required: r.requiredOffice }));
  }
  if (r.pendingDates.length) add('warn', t('alert.pending', { n: r.pendingDates.length, list: fmtList(r.pendingDates) }));
  if (r.unjustifiedAbsences.length) add('warn', t('alert.unjustified', { n: r.unjustifiedAbsences.length, list: fmtList(r.unjustifiedAbsences) }));

  // Metas por semana/mês: semanas ou meses já passados abaixo da meta.
  if (r.missed.length) {
    const last = r.missed.slice(-3);
    const txt = last
      .map((m) => (target === 'daysPerWeek' ? t('alert.weekItem', { date: fmtDayMonth(m.key), office: m.office, target: m.target }) : t('alert.monthItem', { month: cap(monthLong(Number(m.key.slice(5)))), office: m.office, target: m.target })))
      .join('; ');
    add('warn', t(target === 'daysPerWeek' ? 'alert.weeksMissed' : 'alert.monthsMissed', { n: r.missed.length, list: txt }));
  }
  if (r.fixedMissed.length) add('warn', t('alert.fixedMissed', { n: r.fixedMissed.length, list: fmtList(r.fixedMissed) }));
  if (r.plan.fixedPlannedHome.length) add('warn', t('alert.fixedPlannedHome', { list: fmtList(r.plan.fixedPlannedHome) }));

  // A regra é do PERÍODO: se o planejamento já cumpre, um mês abaixo é só informação.
  const planCovers = r.officeNeeded > 0 && r.plan.neededAfterPlan === 0 && r.plan.homeOverCap === 0 && !r.plan.fixedPlannedHome.length;
  if (planCovers) {
    const credit = r.plan.credit > 0 ? t('alert.planCredit', { n: r.plan.credit }) : '';
    add('ok', t('alert.planCovers', { pct: Math.round(r.plan.projectedPct * 100), office: r.plan.officeWithPlan, base: r.totals.base, required: r.requiredOffice, credit }));
  }

  if (target === 'percent') {
    for (const m of r.months) {
      if (m.closed && m.officePct !== null && m.officePct < r.rules.officePct / 100) {
        add(planCovers ? 'info' : 'warn', t(planCovers ? 'alert.monthBelowCovered' : 'alert.monthBelow', { month: cap(m.name), pct: Math.round(m.officePct * 100), office: m.office, decided: m.office + m.home, target: pctTxt }));
      }
    }
  }

  // Aviso com antecedência para o mês corrente (ou a semana, na meta semanal)
  if (target === 'daysPerWeek') {
    const w = r.weeks.find((x) => x.isCurrent);
    if (w && w.need > 0 && !planCovers) {
      const open = w.open;
      add(w.need > open ? 'danger' : 'info', t(w.need > open ? 'alert.weekLost' : 'alert.weekNeed', { office: w.office, target: w.target, need: w.need, open }));
    }
  } else {
    const cur = r.months.find((m) => m.isCurrent);
    if (cur && cur.open > 0 && r.status !== 'cumprido' && !planCovers) {
      const need = cur.neededToHitTarget;
      if (need > cur.open) {
        add('danger', t('alert.monthLost', { month: cap(cur.name), target: cur.target, open: cur.open, short: need - cur.open }));
      } else if (need > 0) {
        const ideal = Math.max(need, cur.recommendedOffice);
        const level = ideal / cur.open > r.baselinePace + 0.1 ? 'warn' : 'info';
        const catchUp = ideal > need && target === 'percent' ? t('alert.monthCatchUp', { ideal }) : '';
        add(level, t('alert.monthNeed', { month: cur.name, target: cur.target, need, open: cur.open, catchUp }));
      } else {
        add('ok', t('alert.monthDone', { month: cap(cur.name), office: cur.office, target: cur.target }));
      }
    }
    const curIdx = r.months.findIndex((m) => m.isCurrent);
    const next = r.months[curIdx + 1] || (curIdx === -1 ? r.months.find((m) => !m.closed) : null);
    if (next && next.open > 0 && r.officeNeeded > 0 && !planCovers) {
      const planned = next.plannedOffice ? t('alert.nextPlanned', { n: next.plannedOffice }) : '';
      add('info', t('alert.nextMonth', { month: next.name, rec: next.recommendedOffice, open: next.open, planned }));
    }
  }

  if (r.homeLeft < 0) add('danger', t('alert.homeOver', { n: -r.homeLeft }));
  else if (target === 'percent' && r.homeLeft <= 10 && r.totals.undecided > 0) add('warn', t('alert.homeLeft', { n: r.homeLeft }));

  if (!r.plan.feasible && r.status !== 'impossivel' && (r.totals.plannedOffice || r.totals.plannedHome) && !r.plan.fixedPlannedHome.length) {
    add('warn', t('alert.planShort', { need: r.plan.neededAfterPlan, free: r.plan.unplanned }));
  }

  if (r.bindingRule === 'teto') {
    const prop = r.homeCap !== r.rules.maxHomeDays ? t('alert.capProp', { max: r.rules.maxHomeDays }) : '';
    add('info', t('alert.cap', { cap: r.homeCap, prop, pct: pctTxt, required: r.requiredOffice, byPct: r.requiredByPct }));
  }
  if (r.bindingRule === 'fixos') add('info', t('alert.fixedBinding', { n: r.requiredByFixed }));

  if (r.totals.absence > 0) {
    const parts = Object.entries(r.totals.absenceByType).map(([k, n]) => t(`abs.count.${k}`, { n }));
    add('info', t('alert.absences', { parts: parts.join(', '), working: r.totals.working, absence: r.totals.absence, base: r.totals.base, required: r.requiredOffice }));
  }

  if (r.status === 'cumprido') add('ok', t('alert.done', { office: r.totals.office, required: r.requiredOffice }));
  return alerts;
}
