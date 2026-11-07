/**
 * Presença — cópia de segurança automática para o Google Drive + e-mail.
 *
 * Corre na SUA conta Google (Google Apps Script, grátis). Recebe a cópia
 * enviada pela app Presença e:
 *   1. grava dois arquivos (.json para restaurar e .csv para abrir no Excel/
 *      Sheets) na pasta "Presença — cópias de segurança" do seu Google Drive;
 *   2. (opcional) envia-lhe um e-mail com os dois arquivos em anexo.
 *
 * Só aceita pedidos com a chave secreta criada pela função configurar().
 * Não lê nem altera nenhum outro arquivo do seu Drive: só cria/limpa arquivos
 * dentro desta pasta.
 *
 * Instruções passo a passo: integrations/google-backup.md
 */

const FOLDER_NAME = 'Presença — cópias de segurança';
const KEEP_COPIES = 60; // guarda as 60 cópias mais recentes (mais de 1 ano se semanal)

/** Corra UMA vez no editor (botão ▶ Executar) para criar a chave secreta. */
function configurar() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid();
    props.setProperty('TOKEN', token);
  }
  getFolder_(); // cria a pasta já agora (e pede as autorizações)
  Logger.log('Chave secreta (copie para a app, em Ajustes → Cópia de segurança): ' + token);
  return token;
}

/** A app envia a cópia por POST (corpo JSON enviado como texto). */
function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || data.token !== token) return reply_({ ok: false, error: 'Chave secreta inválida. Confira-a na app.' });
    if (!data.json || !data.filename) return reply_({ ok: false, error: 'Pedido incompleto.' });

    const name = String(data.filename).replace(/[^\w.-]/g, '_').slice(0, 80);
    const folder = getFolder_();
    const json = folder.createFile(name + '.json', String(data.json), 'application/json');
    const csv = data.csv ? folder.createFile(name + '.csv', String(data.csv), 'text/csv') : null;
    cleanup_(folder);

    let emailed = false;
    if (data.email) {
      const to = Session.getEffectiveUser().getEmail();
      MailApp.sendEmail({
        to: to,
        subject: 'Presença — cópia de segurança ' + name.replace('presenca-copia-', ''),
        body: String(data.summary || '') + '\n\nPasta no Google Drive: ' + folder.getUrl(),
        attachments: [json.getBlob()].concat(csv ? [csv.getBlob()] : []),
      });
      emailed = true;
    }
    return reply_({ ok: true, file: json.getName(), folderUrl: folder.getUrl(), emailed: emailed });
  } catch (err) {
    return reply_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** Abrir o endereço no navegador mostra se o script está ativo. */
function doGet() {
  return reply_({ ok: true, app: 'presenca-backup' });
}

function getFolder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

/** Mantém só as cópias mais recentes (cada cópia = .json + .csv). */
function cleanup_(folder) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(KEEP_COPIES * 2).forEach(function (f) { f.setTrashed(true); });
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
