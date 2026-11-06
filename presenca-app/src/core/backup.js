// Cópias de segurança periódicas (modo local: os dados só existem no celular).
//
// Duas formas, à escolha:
//  1. Manual assistida (sem configurar nada): quando a cópia está atrasada, a app
//     avisa no Painel e, com um toque, abre a folha de partilha do celular para
//     enviar os arquivos para o Google Drive, Gmail, etc.
//  2. Automática (Google Apps Script na conta do usuário, grátis): quando a cópia
//     está atrasada e a app é aberta, envia os dados para um script do próprio
//     usuário, que grava os arquivos numa pasta do Google Drive e envia um e-mail
//     com eles em anexo. Ver integrations/google-backup.md.
//
// Porquê "quando a app é aberta"? Sem servidor, nada corre com a app fechada.
// Como a app é aberta quase todos os dias úteis (para registrar a presença), na
// prática a cópia sai no primeiro acesso depois de vencer o prazo.

import { parseISO } from './dates.js';

export const BACKUP_FREQUENCIES = { weekly: 'Semanal', monthly: 'Mensal', off: 'Desligada' };

/** Endereço de um "App da Web" do Google Apps Script. */
export const APPS_SCRIPT_URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86_400_000);

/**
 * A cópia está atrasada?
 *  - semanal: 7 dias ou mais desde a última;
 *  - mensal:  a última é de um mês anterior (sai no 1º acesso de cada mês);
 *  - nunca feita: sim (exceto se desligada).
 */
export function isBackupDue(backup, today) {
  const freq = backup?.frequency || 'weekly';
  if (freq === 'off') return false;
  const last = backup?.lastAt;
  if (!last) return true;
  if (freq === 'monthly') return last.slice(0, 7) < today.slice(0, 7);
  return daysBetween(last, today) >= 7;
}

/** Texto curto para o e-mail / mensagem da cópia. */
export function backupSummary(report, today) {
  const dm = `${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)}`;
  const t = report.totals;
  return [
    `Cópia de segurança da app Presença — ${dm}`,
    `${report.semester.label}: ${t.office} dia(s) no escritório de ${report.requiredOffice} obrigatório(s); ${t.home} em casa; ${t.absence} ausência(s).`,
    `Dias trabalháveis: ${t.base}. Faltam ${report.officeNeeded} dia(s) de escritório.`,
    'Para restaurar: app Presença → Ajustes → Cópia de segurança → Restaurar cópia (arquivo .json).',
  ].join('\n');
}
