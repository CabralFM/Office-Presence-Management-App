// Modelos de regra de presença mais comuns. Escolher um modelo só preenche os
// campos: o usuário pode ajustar tudo depois (ou escolher "Personalizada").

export const RULE_TARGETS = ['percent', 'daysPerWeek', 'daysPerMonth'];

export const RULE_TEMPLATES = [
  { id: 'pct50-semester', rules: { target: 'percent', officePct: 50, period: 'semester', fixedDays: [] } },
  { id: 'pct50-month', rules: { target: 'percent', officePct: 50, period: 'month', fixedDays: [] } },
  { id: 'pct60-quarter', rules: { target: 'percent', officePct: 60, period: 'quarter', fixedDays: [] } },
  { id: 'week3', rules: { target: 'daysPerWeek', daysPerWeek: 3, period: 'month', fixedDays: [] } },
  { id: 'week2', rules: { target: 'daysPerWeek', daysPerWeek: 2, period: 'month', fixedDays: [] } },
  { id: 'fixed-tue-thu', rules: { target: 'daysPerWeek', daysPerWeek: 2, period: 'month', fixedDays: [2, 4] } },
  { id: 'month8', rules: { target: 'daysPerMonth', daysPerMonth: 8, period: 'month', fixedDays: [] } },
];

/** Qual modelo corresponde às regras atuais (ou 'custom'). */
export function matchTemplate(rules) {
  const same = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
  for (const tp of RULE_TEMPLATES) {
    const r = tp.rules;
    if (r.target !== (rules.target || 'percent') || r.period !== (rules.period || 'semester') || !same(r.fixedDays, rules.fixedDays)) continue;
    if (r.target === 'percent' && r.officePct !== rules.officePct) continue;
    if (r.target === 'daysPerWeek' && r.daysPerWeek !== rules.daysPerWeek) continue;
    if (r.target === 'daysPerMonth' && r.daysPerMonth !== rules.daysPerMonth) continue;
    return tp.id;
  }
  return 'custom';
}
