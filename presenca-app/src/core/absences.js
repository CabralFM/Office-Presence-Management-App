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

import { t } from './i18n.js';

// Rótulos e dicas vêm do idioma atual (getters: são lidos no momento do uso).
const type = (key, icon, justificationRequired) => ({
  icon,
  justificationRequired,
  get label() {
    return t(`abs.${key}`);
  },
  get hint() {
    return t(`abs.${key}.hint`);
  },
});

export const ABSENCE_TYPES = {
  ferias: type('ferias', '🌴', false),
  doenca: type('doenca', '🤒', true),
  licenca: type('licenca', '📄', true),
  folga: type('folga', '🛌', true),
  outro: type('outro', '📝', true),
};

/** Registros antigos (antes dos tipos) ficam como "não especificado". */
export const UNSPECIFIED = 'nao_especificado';
export const ABSENCE_LABEL = (k) => ABSENCE_TYPES[k]?.label || t('abs.nao_especificado');
export const ABSENCE_ICON = (k) => ABSENCE_TYPES[k]?.icon || '🚫';

export function validateAbsence({ type: k, justification }) {
  const ty = ABSENCE_TYPES[k];
  if (!ty) return t('err.absType');
  const j = String(justification || '').trim();
  if (ty.justificationRequired && j.length < 3) return t('err.justRequired', { label: ty.label });
  if (j.length > 500) return t('err.justTooLong');
  return null;
}
