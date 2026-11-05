// Service worker: recebe as notificações push e trata os botões
// "🏢 Escritório" / "🏠 Casa" SEM precisar abrir a app.

const CACHE = 'presenca-v3';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/core/geo.js', '/core/absences.js', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Rede primeiro (dados sempre frescos); cache só como plano B offline para a "casca" da app.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/'))),
  );
});

self.addEventListener('push', (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: 'Presença', body: e.data?.text() };
  }
  e.waitUntil(
    self.registration.showNotification(data.title || 'Presença', {
      body: data.body,
      tag: data.tag, // mesma tag → o lembrete repetido SUBSTITUI o anterior (não acumula)
      renotify: Boolean(data.tag),
      requireInteraction: Boolean(data.requireInteraction),
      icon: '/icon.svg',
      badge: '/icon.svg',
      actions: data.actions || [],
      data: { url: data.url || '/', date: data.date, officeId: data.officeId },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  const n = e.notification;
  n.close();
  const { url, date, officeId } = n.data || {};

  if (e.action === 'office' || e.action === 'home') {
    // Resposta direta pelo botão da notificação.
    e.waitUntil(
      fetch('/api/checkin', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: e.action, source: 'lembrete', date, officeId: e.action === 'office' ? officeId : undefined }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(res.status);
          const clients = await self.clients.matchAll({ type: 'window' });
          clients.forEach((c) => c.postMessage({ type: 'checked-in' }));
          return self.registration.showNotification('Registrado ✔', {
            body: e.action === 'office' ? '🏢 Escritório' : '🏠 Casa',
            tag: 'confirm',
            icon: '/icon.svg',
          });
        })
        .catch(() => self.clients.openWindow('/?checkin=1')),
    );
    return;
  }

  // Toque no corpo da notificação → abre (ou foca) a app.
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
