// Motor de cumprimento da regra de presença.
//
// Regras (configuráveis):
//   1. officePct   — % mínima dos dias trabalhados que têm de ser no escritório (50%).
//   2. maxHomeDays — teto absoluto de dias em casa por semestre (60).
//
// "Dias trabalhados" (a base do cálculo) = dias úteis do semestre
//   (seg–sex, excluindo feriados nacionais/facultativos ativos/locais)
//   menos ausências (férias, atestado, folgas).
//
// As duas regras podem não coincidir! Exemplo real, 2º semestre de 2026 no Brasil:
//   132 dias de seg–sex − 5 feriados em dia útil = 127 dias úteis.
//   Pela regra dos 50%: ceil(127 × 50%) = 64 dias no escritório.
//   Pelo teto de 60 em casa: 127 − 60 = 67 dias no escritório.
// Como a empresa exige as duas, vale a mais restritiva (67). A app mostra
// qual das regras está valendo para não haver surpresas no fim do semestre.

import { eachDay, isWeekend, mondayOf, addDays } from './dates.js';

const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export const monthName = (m) => MONTH_NAMES[m - 1];

const fmtDM = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

/**
 * Classifica cada dia útil do semestre.
 * kind:
 *   office | home | absence  → já registrado (ou ausência planejada, ex.: férias)
 *   pending                  → dia passado sem registro (precisa de ser preenchido)
 *   open                     → hoje/futuro ainda por decidir (pode ter plan office/home)
 */
export function classifyDays({ semester, today, days, holidays }) {
  const out = [];
  for (const date of eachDay(semester.start, semester.end)) {
    if (isWeekend(date)) continue;
    const holiday = holidays.get(date);
    if (holiday) {
      out.push({ date, kind: 'holiday', holiday });
      continue;
    }
    const rec = days.get(date) || {};
    let kind;
    if (rec.status) kind = rec.status;
    else if (rec.plan === 'absence') kind = 'absence';
    else if (date < today) kind = 'pending';
    else kind = 'open';
    out.push({ date, kind, plan: rec.status ? null : rec.plan || null, planned: !rec.status && rec.plan === 'absence' });
  }
  return out;
}

function emptyCounts() {
  return { working: 0, holidays: 0, office: 0, home: 0, absence: 0, pending: 0, open: 0, plannedOffice: 0, plannedHome: 0 };
}

function count(bucket, d) {
  if (d.kind === 'holiday') {
    bucket.holidays++;
    return;
  }
  bucket.working++;
  bucket[d.kind]++;
  if (d.kind === 'open' && d.plan === 'office') bucket.plannedOffice++;
  if (d.kind === 'open' && d.plan === 'home') bucket.plannedHome++;
}

/**
 * Distribui `n` dias de escritório por "baldes" (semanas ou meses) de forma
 * proporcional à capacidade (dias úteis em aberto) de cada um — método do maior
 * resto. Ex.: faltam 30 dias e há 60 dias úteis em aberto → cada semana de 5 dias
 * recebe 2,5 → umas ficam com 3, outras com 2, somando exatamente 30.
 */
export function allocate(n, capacities) {
  const total = capacities.reduce((a, b) => a + b, 0);
  if (total === 0 || n <= 0) return capacities.map(() => 0);
  const target = Math.min(n, total);
  const raw = capacities.map((c) => (target * c) / total);
  const result = raw.map((r, i) => Math.min(capacities[i], Math.floor(r)));
  let left = target - result.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
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

export function computeSemester({ semester, today, days, holidays, rules }) {
  const pct = rules.officePct / 100;
  const classified = classifyDays({ semester, today, days, holidays });
  const totals = emptyCounts();
  for (const d of classified) count(totals, d);

  // ---- metas do semestre --------------------------------------------------
  const base = totals.working - totals.absence; // dias efetivamente trabalhados
  const requiredByPct = Math.ceil(base * pct - 1e-9);
  const requiredByCap = Math.max(0, base - rules.maxHomeDays);
  const requiredOffice = Math.max(requiredByPct, requiredByCap);
  const bindingRule = requiredByCap > requiredByPct ? 'teto' : 'percentual';
  const maxHome = base - requiredOffice;

  const undecided = totals.pending + totals.open; // = base − office − home
  const officeNeeded = Math.max(0, requiredOffice - totals.office);
  const homeLeft = maxHome - totals.home;
  const baselinePace = base > 0 ? requiredOffice / base : 0;
  const paceNeeded = undecided > 0 ? officeNeeded / undecided : officeNeeded > 0 ? Infinity : 0;

  let status;
  if (officeNeeded === 0) status = 'cumprido';
  else if (officeNeeded > undecided) status = 'impossivel';
  else if (paceNeeded <= baselinePace + 0.02) status = 'ok';
  else if (paceNeeded <= baselinePace + 0.2) status = 'atencao';
  else status = 'critico';

  // ---- projeção com o planejamento ------------------------------------------
  const officeWithPlan = totals.office + totals.plannedOffice;
  const homeWithPlan = totals.home + totals.plannedHome;
  const unplanned = undecided - totals.plannedOffice - totals.plannedHome;
  const neededAfterPlan = Math.max(0, requiredOffice - officeWithPlan);
  const plan = {
    officeWithPlan,
    homeWithPlan,
    unplanned,
    neededAfterPlan,
    feasible: neededAfterPlan <= unplanned && homeWithPlan <= maxHome,
    homeOverCap: Math.max(0, homeWithPlan - maxHome),
  };

  // ---- semanas e meses ------------------------------------------------------
  const weekMap = new Map();
  const monthMap = new Map();
  for (const d of classified) {
    const wk = mondayOf(d.date);
    if (!weekMap.has(wk)) weekMap.set(wk, { start: wk, end: addDays(wk, 4), ...emptyCounts(), holidayList: [] });
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

  // Só se distribui pelos dias de hoje em diante (não faz sentido recomendar o passado).
  const weekAlloc = allocate(officeNeeded, weeks.map((w) => w.open));
  weeks.forEach((w, i) => {
    w.recommendedOffice = weekAlloc[i];
    w.isCurrent = today >= w.start && today <= addDays(w.start, 6);
    w.isPast = addDays(w.start, 6) < today;
  });
  const monthAlloc = allocate(officeNeeded, months.map((m) => m.open));
  months.forEach((m, i) => {
    const decided = m.office + m.home;
    const mBase = m.working - m.absence;
    m.base = mBase;
    m.officePct = decided > 0 ? m.office / decided : null;
    m.closed = m.lastWorkingDay !== null && m.lastWorkingDay < today;
    m.isCurrent = today.slice(0, 7) === m.key;
    m.target = Math.ceil(mBase * baselinePace - 1e-9); // "cota" do mês ao ritmo do semestre
    m.recommendedOffice = monthAlloc[i];
    m.neededToHitTarget = Math.max(0, m.target - m.office);
  });

  const result = {
    semester,
    today,
    rules,
    totals: { ...totals, base, undecided },
    requiredOffice,
    requiredByPct,
    requiredByCap,
    bindingRule,
    maxHome,
    officeNeeded,
    homeLeft,
    baselinePace,
    paceNeeded: Number.isFinite(paceNeeded) ? paceNeeded : null,
    status,
    plan,
    pendingDates: classified.filter((d) => d.kind === 'pending').map((d) => d.date),
    weeks,
    months,
  };
  result.alerts = buildAlerts(result);
  return result;
}

/** Mensagens em linguagem natural — são as mesmas que vão nas notificações. */
export function buildAlerts(r) {
  const alerts = [];
  const pctTxt = `${r.rules.officePct}%`;
  const add = (level, text) => alerts.push({ level, text });

  if (r.status === 'impossivel') {
    add(
      'danger',
      `Mesmo indo ao escritório em todos os ${r.totals.undecided} dias úteis que faltam, ainda faltam ${r.officeNeeded - r.totals.undecided} dias para a meta de ${r.requiredOffice}. Fale com sua chefia/RH.`,
    );
  }

  if (r.pendingDates.length) {
    const list = r.pendingDates.slice(0, 5).map(fmtDM).join(', ');
    add('warn', `${plural(r.pendingDates.length, 'dia útil sem registro', 'dias úteis sem registro')}: ${list}${r.pendingDates.length > 5 ? '…' : ''}. Preencha para os cálculos ficarem corretos.`);
  }

  // Meses fechados abaixo da percentagem
  for (const m of r.months) {
    if (m.closed && m.officePct !== null && m.officePct < r.rules.officePct / 100) {
      add('warn', `${cap(m.name)} fechou com ${Math.round(m.officePct * 100)}% no escritório (${m.office} de ${m.office + m.home} dias), abaixo de ${pctTxt}.`);
    }
  }

  // Mês corrente: aviso com antecedência
  const cur = r.months.find((m) => m.isCurrent);
  if (cur && cur.open > 0 && r.status !== 'cumprido') {
    const need = cur.neededToHitTarget;
    if (need > cur.open) {
      add('danger', `${cap(cur.name)} já não fecha na meta (${cur.target} dias): mesmo indo nos ${cur.open} dias restantes, faltam ${need - cur.open}. Compense nos próximos meses.`);
    } else if (need > 0) {
      const ideal = Math.max(need, cur.recommendedOffice);
      const level = ideal / cur.open > r.baselinePace + 0.1 ? 'warn' : 'info';
      const catchUp = ideal > need ? ` Para também recuperar o atraso dos meses anteriores, o ideal são ${ideal}.` : '';
      add(level, `Para ${cur.name} cumprir a própria cota (${cur.target} dias), vá ao escritório em mais ${need} dos ${cur.open} dias úteis que faltam no mês.${catchUp}`);
    } else {
      add('ok', `${cap(cur.name)} já atingiu a cota do mês (${cur.office}/${cur.target} dias no escritório).`);
    }
  }

  // Próximo mês: planejamento antecipado
  const curIdx = r.months.findIndex((m) => m.isCurrent);
  const next = r.months[curIdx + 1] || (curIdx === -1 ? r.months.find((m) => !m.closed) : null);
  if (next && next.open > 0 && r.officeNeeded > 0) {
    add('info', `Planejamento de ${next.name}: ${next.recommendedOffice} de ${next.open} dias úteis no escritório para manter o semestre em dia.`);
  }

  // Teto de home office
  if (r.homeLeft < 0) {
    add('danger', `Você ultrapassou o limite de home office do semestre em ${-r.homeLeft} dia(s).`);
  } else if (r.homeLeft <= 10 && r.totals.undecided > 0) {
    add('warn', `Restam apenas ${plural(r.homeLeft, 'dia', 'dias')} de home office neste semestre.`);
  }

  if (!r.plan.feasible && r.status !== 'impossivel' && (r.totals.plannedOffice || r.totals.plannedHome)) {
    add('warn', `Seu planejamento atual não chega: faltam ${r.plan.neededAfterPlan} dias de escritório para ${r.plan.unplanned} dias ainda não planejados.`);
  }

  if (r.bindingRule === 'teto') {
    add('info', `Neste semestre o teto de ${r.rules.maxHomeDays} dias em casa é mais exigente do que os ${pctTxt}: precisa de ${r.requiredOffice} dias no escritório (e não ${r.requiredByPct}).`);
  }

  if (r.status === 'cumprido') add('ok', `Meta do semestre cumprida: ${r.totals.office} dias no escritório (mínimo ${r.requiredOffice}).`);
  return alerts;
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
