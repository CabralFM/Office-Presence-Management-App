// Exportação CSV (para o RH ou para guardar). Usada pelo servidor e pelo modo local.

import { ABSENCE_LABEL } from './absences.js';

const LABEL = { office: 'Escritório', home: 'Casa', absence: 'Ausência' };
// ";" separa colunas: dentro do texto vira vírgula; quebras de linha viram espaço.
const clean = (x) => String(x ?? '').replace(/;/g, ',').replace(/[\n\r]+/g, ' ');

/** @param days [{date, status, plan, ...}] por ordem de data */
export function buildCsv(days, offices) {
  const lines = ['data;situacao;tipo_ausencia;justificacao;escritorio;planejado;origem;distancia_m;nota'];
  for (const d of days) {
    lines.push(
      [
        d.date,
        LABEL[d.status] || '',
        d.status === 'absence' || d.plan === 'absence' ? ABSENCE_LABEL(d.absenceType) : '',
        clean(d.justification),
        clean(offices.find((o) => o.id === d.officeId)?.name),
        LABEL[d.plan] || '',
        d.source || '',
        d.distance ?? '',
        clean(d.note),
      ].join(';'),
    );
  }
  // BOM: o Excel abre os acentos corretamente
  return '﻿' + lines.join('\n');
}
