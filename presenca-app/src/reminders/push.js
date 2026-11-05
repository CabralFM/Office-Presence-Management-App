// Envio de notificações Web Push (padrão W3C, funciona em Chrome, Edge,
// Firefox, Android e iPhone com iOS 16.4+ quando a app é instalada no tela de início).
//
// Decisão: Web Push em vez de e-mail/SMS porque é gratuito, não precisa de
// conta em serviços terceiros e permite BOTÕES na notificação
// ("🏢 Escritório" / "🏠 Casa") — você responde sem abrir a app.

import webpush from 'web-push';

export function setupPush(repo, { subject }) {
  let keys = repo.getKV('vapid');
  if (!keys) {
    // Chaves VAPID geradas uma única vez e salvas no banco: identificam o
    // seu servidor junto do serviço de push do navegador.
    keys = webpush.generateVAPIDKeys();
    repo.setKV('vapid', keys);
  }
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);

  async function sendToAll(payload) {
    const subs = repo.listSubscriptions();
    let delivered = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 60 * 60 * 4, urgency: 'high' });
        delivered++;
      } catch (err) {
        // 404/410 = a inscrição expirou ou foi revogada (ex.: limpou dados do navegador)
        if (err.statusCode === 404 || err.statusCode === 410) repo.removeSubscription(sub.endpoint);
        else console.error('[push] falha ao enviar:', err.statusCode || err.message);
      }
    }
    return { delivered, total: subs.length };
  }

  return { publicKey: keys.publicKey, sendToAll };
}
