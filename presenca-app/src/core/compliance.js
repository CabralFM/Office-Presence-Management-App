// Motor de cumprimento da regra de presença.
//
// REGRA MÃE: no semestre, pelo menos `officePct` (50%) dos dias úteis
// TRABALHÁVEIS têm de ser no escritório.
//
//   dias úteis      = seg–sex do semestre − feriados (do local de trabalho)
//   dias trabalháveis = dias úteis − ausências (férias, doença, licenças, folgas…)
//   mínimo no escritório = arredondar para cima(dias trabalháveis × 50%)
//
// Exemplo, 2º semestre de 2026 em Lisboa (128 dias úteis):
//   sem ausências:                 128 trabalháveis → 64 no escritório
//   com 10 férias + 3 doença:      115 trabalháveis → 58 no escritório (57,5 arredondado para cima)
// Ou seja: as ausências reduzem a base, mas a percentagem mantém-se.
//
// Início da contagem (`startDate`, ex.: data de admissão): os dias anteriores
// não contam para nada. Ex.: admissão em 02/11/2026 → no 2º semestre de 2026
// só contam 02/11–31/12 (41 dias úteis em Lisboa → mínimo 21 no escritório).
//
// Regra opcional (desligada por padrão): `enforceHomeCap` aplica também um
// teto ABSOLUTO de `maxHomeDays` (60) em casa. Só faz diferença em semestres
// com mais de 120 dias trabalháveis (128 − 60 = 68 > 64). Ligue-a apenas se a
// empresa contar os 60 dias de forma rígida, além dos 50%.

import { eachDay, isWeekend, mondayOf, addDays } from './dates.js';

const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export const monthName = (m) => MONTH_NAMES[m - 1];

const ABSENCE_SHORT = { ferias: 'de férias', doenca: 'de doença', licenca: 'de licença', folga: 'de folga', outro: 'outra(s)', nao_especificado: 'sem tipo' };
const fmtDM = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

/**
 * Classifica cada dia útil do semestre.
 * kind:
 *   office | home | absence  → já registrado (ou ausência planejada, ex.: férias)
 *   pending                  → dia passado sem registro (precisa de ser preenchido)
 *   open                     → hoje/futuro ainda por decidir (pode ter plan office/home)
 */
export function classifyDays({ semester, today, days, holidays, defaultPlan, startDate }) {
  const out = [];
  for (const date of eachDay(semester.start, semester.end)) {
    if (isWeekend(date)) continue;
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
    // defaultPlan: ex.: dias de uma viagem de trabalho contam como "planejado escritório"
    // sem precisar marcar dia a dia (e deixam de contar se apagar a viagem).
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

export function computeSemester({ semester, today, days, holidays, rules, defaultPlan }) {
  const pct = rules.officePct / 100;
  // Início da contagem dentro (ou depois) deste semestre?
  const startDate = rules.startDate && rules.startDate > semester.start ? rules.startDate : null;
  const classified = classifyDays({ semester, today, days, holidays, defaultPlan, startDate });
  const totals = emptyCounts();
  for (const d of classified) count(totals, d);
  const notStarted = Boolean(startDate && startDate > semester.end);

  // ---- metas do semestre --------------------------------------------------
  const base = totals.working - totals.absence; // dias efetivamente trabalhados
  const requiredByPct = Math.ceil(base * pct - 1e-9);
  // Teto de dias em casa (opcional). Num semestre incompleto (admissão a meio),
  // o teto é proporcional: 60 × (dias úteis contados ÷ dias úteis do semestre).
  let homeCap = rules.maxHomeDays;
  if (startDate && !notStarted) {
    const full = classifyDays({ semester, today, days, holidays }).filter((d) => d.kind !== 'holiday').length;
    homeCap = full > 0 ? Math.floor((rules.maxHomeDays * totals.working) / full) : 0;
  }
  const requiredByCap = rules.enforceHomeCap ? Math.max(0, base - homeCap) : 0;
  const requiredOffice = Math.max(requiredByPct, requiredByCap);
  const bindingRule = requiredByCap > requiredByPct ? 'teto' : 'percentual';
  const maxHome = base - requiredOffice;

  const undecided = totals.pending + totals.open; // = base − office − home
  const officeNeeded = Math.max(0, requiredOffice - totals.office);
  const homeLeft = maxHome - totals.home;
  const baselinePace = base > 0 ? requiredOffice / base : 0;
  const paceNeeded = undecided > 0 ? officeNeeded / undecided : officeNeeded > 0 ? Infinity : 0;

  let status;
  if (notStarted) status = 'sem_contagem';
  else if (officeNeeded === 0) status = 'cumprido';
  else if (officeNeeded > undecided) status = 'impossivel';
  else if (paceNeeded <= baselinePace + 0.02) status = 'ok';
  else if (paceNeeded <= baselinePace + 0.2) status = 'atencao';
  else status = 'critico';

  // ---- projeção com o planejamento ------------------------------------------
  const officeWithPlan = totals.office + totals.plannedOffice;
  const homeWithPlan = totals.home + totals.plannedHome;
  const unplanned = undecided - totals.plannedOffice - totals.plannedHome;
  const neededAfterPlan = Math.max(0, requiredOffice - officeWithPlan);
  // Projeção = o que já fez + o que planejou. O "crédito" é quantos dias de
  // escritório tem a mais do que o mínimo: são dias que pode passar em casa
  // mais à frente. Ex.: mínimo 21; feitos 8 + planejados 17 = 25 → crédito +4.
  const plan = {
    officeWithPlan,
    homeWithPlan,
    unplanned,
    neededAfterPlan,
    projectedPct: base > 0 ? officeWithPlan / base : null,
    credit: officeWithPlan - requiredOffice,
    // dos dias ainda sem plano, quantos podem ser em casa sem quebrar a regra
    homeFree: Math.max(0, unplanned - neededAfterPlan),
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

  // A sugestão respeita o SEU planejamento: só distribui o que ainda falta
  // (depois do que já fez e planejou) pelos dias que ainda não planejou.
  // Ex.: planeja 5 dias de escritório numa semana → as outras pedem menos.
  const unplannedOf = (b) => b.open - b.plannedOffice - b.plannedHome;
  const weekAlloc = allocate(neededAfterPlan, weeks.map(unplannedOf));
  let cumOffice = 0;
  let cumBase = 0;
  weeks.forEach((w, i) => {
    w.unplanned = unplannedOf(w);
    w.suggestedOffice = weekAlloc[i]; // sugestão para os dias ainda sem plano
    w.recommendedOffice = w.plannedOffice + w.suggestedOffice;
    w.isCurrent = today >= w.start && today <= addDays(w.start, 6);
    w.isPast = addDays(w.start, 6) < today;
    // Acumulado até ao fim desta semana (feito + planejado): é aqui que se vê
    // o "crédito" a crescer quando concentra dias no escritório.
    cumOffice += w.office + w.plannedOffice;
    cumBase += w.working - w.absence;
    w.cumOffice = cumOffice;
    w.cumBase = cumBase;
    w.cumPct = cumBase > 0 ? cumOffice / cumBase : null;
  });
  const monthAlloc = allocate(neededAfterPlan, months.map(unplannedOf));
  months.forEach((m, i) => {
    const decided = m.office + m.home;
    const mBase = m.working - m.absence;
    m.base = mBase;
    m.officePct = decided > 0 ? m.office / decided : null;
    m.closed = m.lastWorkingDay !== null && m.lastWorkingDay < today;
    m.isCurrent = today.slice(0, 7) === m.key;
    m.target = Math.ceil(mBase * baselinePace - 1e-9); // "cota" do mês ao ritmo do semestre
    m.suggestedOffice = monthAlloc[i];
    m.recommendedOffice = m.plannedOffice + m.suggestedOffice;
    m.projectedPct = mBase > 0 ? (m.office + m.plannedOffice) / mBase : null;
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
    startDate, // início da contagem dentro deste semestre (null = semestre inteiro)
    notStarted, // o semestre é todo anterior ao início da contagem
    homeCap,
    pendingDates: classified.filter((d) => d.kind === 'pending').map((d) => d.date),
    // Ausências de tipo que exige justificação e que ficaram sem ela
    unjustifiedAbsences: classified
      .filter((d) => d.kind === 'absence' && d.absenceType !== 'ferias' && !d.justification)
      .map((d) => d.date),
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
  const fmtFull = (iso) => `${fmtDM(iso)}/${iso.slice(0, 4)}`;

  if (r.notStarted) {
    add('info', `Este semestre é anterior ao início da contagem (${fmtFull(r.startDate)}): não há metas a cumprir.`);
    return alerts;
  }
  if (r.startDate) {
    add('info', `Contagem a partir de ${fmtFull(r.startDate)}: neste semestre contam ${r.totals.working} dias úteis (e não o semestre inteiro).`);
  }

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

  if (r.unjustifiedAbsences.length) {
    const list = r.unjustifiedAbsences.slice(0, 5).map(fmtDM).join(', ');
    add('warn', `${plural(r.unjustifiedAbsences.length, 'ausência sem justificação', 'ausências sem justificação')} (ou sem tipo): ${list}${r.unjustifiedAbsences.length > 5 ? '…' : ''}. Complete em Planejamento → Férias e ausências.`);
  }

  // A regra é do PERÍODO, não do mês: se o planejamento já cumpre o período,
  // um mês abaixo de 50% é só informação (foi compensado), não um problema.
  const planCovers = r.officeNeeded > 0 && r.plan.neededAfterPlan === 0 && r.plan.homeOverCap === 0;
  if (planCovers) {
    add(
      'ok',
      `Com o seu planejamento, o período fecha com ${Math.round(r.plan.projectedPct * 100)}% no escritório (${r.plan.officeWithPlan} de ${r.totals.base} dias; mínimo ${r.requiredOffice})${
        r.plan.credit > 0 ? ` — crédito de ${plural(r.plan.credit, 'dia', 'dias')} que pode passar em casa` : ''
      }.`,
    );
  }

  // Meses fechados abaixo da percentagem
  for (const m of r.months) {
    if (m.closed && m.officePct !== null && m.officePct < r.rules.officePct / 100) {
      add(
        planCovers ? 'info' : 'warn',
        `${cap(m.name)} fechou com ${Math.round(m.officePct * 100)}% no escritório (${m.office} de ${m.office + m.home} dias), abaixo de ${pctTxt}${planCovers ? ' — compensado pelo planejamento' : ''}.`,
      );
    }
  }

  // Mês corrente: aviso com antecedência (desnecessário se o plano já cumpre o período)
  const cur = r.months.find((m) => m.isCurrent);
  if (cur && cur.open > 0 && r.status !== 'cumprido' && !planCovers) {
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
  if (next && next.open > 0 && r.officeNeeded > 0 && !planCovers) {
    add('info', `Para ${next.name}: ${next.recommendedOffice} de ${next.open} dias úteis no escritório${next.plannedOffice ? ` (${next.plannedOffice} já planejados)` : ''} mantêm o período em dia.`);
  }

  // Dias de casa ainda possíveis sem quebrar a regra
  if (r.homeLeft < 0) {
    add('danger', `Você já tem ${-r.homeLeft} dia(s) de casa a mais do que a regra permite neste semestre.`);
  } else if (r.homeLeft <= 10 && r.totals.undecided > 0) {
    add('warn', `Restam apenas ${plural(r.homeLeft, 'dia', 'dias')} de home office neste semestre.`);
  }

  if (!r.plan.feasible && r.status !== 'impossivel' && (r.totals.plannedOffice || r.totals.plannedHome)) {
    add('warn', `Seu planejamento não chega: faltam ${r.plan.neededAfterPlan} dias de escritório e só há ${r.plan.unplanned} dias por planejar.`);
  }

  if (r.bindingRule === 'teto') {
    add('info', `Neste semestre o teto de ${r.homeCap} dias em casa${r.homeCap !== r.rules.maxHomeDays ? ` (proporcional aos ${r.rules.maxHomeDays})` : ''} é mais exigente do que os ${pctTxt}: precisa de ${r.requiredOffice} dias no escritório (e não ${r.requiredByPct}).`);
  }

  // Resumo das ausências: mostra como a base foi reduzida
  if (r.totals.absence > 0) {
    const parts = Object.entries(r.totals.absenceByType).map(([t, n]) => `${n} ${ABSENCE_SHORT[t] || 'outra(s)'}`);
    add(
      'info',
      `Ausências no semestre: ${parts.join(', ')}. Base: ${r.totals.working} dias úteis − ${r.totals.absence} = ${r.totals.base} dias trabalháveis → mínimo ${r.requiredOffice} no escritório (${pctTxt}).`,
    );
  }

  if (r.status === 'cumprido') add('ok', `Meta do semestre cumprida: ${r.totals.office} dias no escritório (mínimo ${r.requiredOffice}).`);
  return alerts;
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
