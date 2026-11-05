// Tipos de ausência. Partilhado entre servidor e navegador (sem dependências).
//
// Regra mãe: o mínimo de 50% no escritório é calculado sobre os dias úteis
// TRABALHÁVEIS do semestre. Qualquer ausência (férias, doença, licença…) sai
// da base. Exemplo, 2º semestre de 2026 em Lisboa:
//   dias úteis do semestre (132 seg–sex − 4 feriados)  128
//   − 10 dias de férias − 3 dias de doença             −13
//   = dias trabalháveis                                115  → mínimo 58 no escritório
//
// Decisão: só as férias dispensam justificação (já estão aprovadas no mapa de
// férias da empresa). Doença, licenças, folgas e outras exigem uma justificação
// — é o que o RH vai pedir se a percentagem for questionada.

export const ABSENCE_TYPES = {
  ferias: {
    label: 'Férias',
    icon: '🌴',
    justificationRequired: false,
    hint: 'Opcional. Ex.: férias aprovadas no mapa de férias.',
  },
  doenca: {
    label: 'Doença',
    icon: '🤒',
    justificationRequired: true,
    hint: 'Ex.: atestado médico / baixa médica nº 123, de 03/11 a 05/11.',
  },
  licenca: {
    label: 'Licença (parental, casamento, luto…)',
    icon: '📄',
    justificationRequired: true,
    hint: 'Ex.: licença parental; falecimento de familiar (certidão entregue ao RH).',
  },
  folga: {
    label: 'Folga / compensação',
    icon: '🛌',
    justificationRequired: true,
    hint: 'Ex.: compensação de horas extra do projeto X, aprovada por Y.',
  },
  outro: {
    label: 'Outra ausência',
    icon: '📝',
    justificationRequired: true,
    hint: 'Descreva o motivo (ex.: doação de sangue, tribunal, formação externa).',
  },
};

/** Registros antigos (antes dos tipos) ficam como "não especificado". */
export const UNSPECIFIED = 'nao_especificado';
export const ABSENCE_LABEL = (type) => ABSENCE_TYPES[type]?.label || 'Ausência (tipo não indicado)';
export const ABSENCE_ICON = (type) => ABSENCE_TYPES[type]?.icon || '🚫';

export function validateAbsence({ type, justification }) {
  const t = ABSENCE_TYPES[type];
  if (!t) return 'Tipo de ausência inválido.';
  const j = String(justification || '').trim();
  if (t.justificationRequired && j.length < 3) return `${t.label}: a justificação é obrigatória.`;
  if (j.length > 500) return 'Justificação demasiado longa (máx. 500 caracteres).';
  return null;
}
