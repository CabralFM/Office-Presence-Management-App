// MODO SERVIDOR (opcional): API HTTP + notificações push + arquivos da PWA.
//
// A app também funciona SEM servidor (modo local: tudo no celular, publicada
// como site estático gratuito — ver README). Este servidor só é necessário para
// notificações push "até responder", que exigem algo ligado 24 h.
//
// As regras da API estão em core/api.js (as mesmas do modo local); aqui fica só
// o que é próprio de um servidor: login, push, exportação e arquivos estáticos.

import express from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './db.js';
import { setupPush } from './reminders/push.js';
import { startScheduler } from './reminders/runner.js';
import { createApi } from './core/api.js';
import { buildCsv } from './core/export.js';
import { localNow } from './core/report.js';

export { validateSettingsPatch, validateOffice } from './core/api.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function createApp({ repo, push, password = process.env.APP_PASSWORD }) {
  const app = express();
  // Atrás do HTTPS do provedor (Railway, Fly, Nginx…): confia no cabeçalho
  // X-Forwarded-Proto, para o cookie de login sair com a flag Secure.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '200kb' }));

  // A app no navegador lê o modo daqui (no site estático, config.js diz "local").
  app.get('/config.js', (_req, res) => res.type('application/javascript').send("export const MODE = 'server';\n"));

  // ---- autenticação opcional --------------------------------------------------
  // Se APP_PASSWORD estiver definida, a API exige login. Indispensável se
  // publicar a app na internet (os seus dados de presença são pessoais).
  let secret = repo.getKV('secret');
  if (!secret) repo.setKV('secret', (secret = randomBytes(32).toString('hex')));
  const token = password ? createHmac('sha256', secret).update(password).digest('hex') : null;
  const cookieName = 'presenca_sid';
  const readCookie = (req) =>
    Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)))[cookieName];
  const authed = (req) => {
    if (!token) return true;
    const c = readCookie(req) || '';
    return c.length === token.length && timingSafeEqual(Buffer.from(c), Buffer.from(token));
  };

  app.get('/api/auth', (req, res) => res.json({ required: Boolean(token), ok: authed(req) }));
  app.post('/api/login', (req, res) => {
    if (!token) return res.json({ ok: true });
    const given = createHmac('sha256', secret).update(String(req.body?.password || '')).digest('hex');
    if (given !== token) return res.status(401).json({ error: 'Senha incorreta' });
    res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${req.secure ? '; Secure' : ''}`);
    res.json({ ok: true });
  });
  app.post('/api/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; Max-Age=0`);
    res.json({ ok: true });
  });
  app.use('/api', (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: 'Não autenticado' })));

  // ---- rotas comuns (core/api.js) ---------------------------------------------------
  const api = createApi({
    repo,
    extraMeta: () => ({ mode: 'server', vapidPublicKey: push.publicKey, subscriptions: repo.listSubscriptions().length }),
  });
  app.use('/api', (req, res, next) => {
    const r = api.handle(req.method, req.originalUrl, req.body);
    if (!r) return next();
    res.status(r.status).json(r.data);
  });

  // ---- notificações push (só existem no modo servidor) -----------------------------
  app.post('/api/push/subscribe', (req, res) => {
    const sub = req.body;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return res.status(400).json({ error: 'Inscrição inválida' });
    repo.addSubscription(sub);
    res.json({ ok: true });
  });
  app.post('/api/push/unsubscribe', (req, res) => {
    if (req.body?.endpoint) repo.removeSubscription(req.body.endpoint);
    res.json({ ok: true });
  });
  app.post('/api/push/test', async (_req, res) => {
    const today = localNow(repo).date;
    const r = await push.sendToAll({
      title: 'Teste de notificação ✔',
      body: 'Se você está lendo isto, os lembretes vão funcionar. Você pode testar os botões.',
      tag: 'test',
      url: '/',
      date: today,
      actions: [
        { action: 'office', title: '🏢 Escritório' },
        { action: 'home', title: '🏠 Casa' },
      ],
    });
    res.json(r);
  });

  // ---- exportação (para enviar ao RH ou guardar) -------------------------------------
  app.get('/api/export.csv', (_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="presenca.csv"');
    res.send(buildCsv(repo.allDays(), repo.getSettings().offices));
  });

  // ---- arquivos estáticos ----------------------------------------------------------------
  app.use('/core', express.static(join(ROOT, 'src/core'))); // módulos partilhados com o navegador
  app.use(express.static(join(ROOT, 'public')));
  return app;
}

// ---- inicialização ---------------------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repo = openDb(process.env.DB_FILE || join(ROOT, 'data/presenca.db'));
  const push = setupPush(repo, { subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com' });
  const app = createApp({ repo, push });
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`Presença: http://localhost:${port}`));
  startScheduler(repo, push);
}
