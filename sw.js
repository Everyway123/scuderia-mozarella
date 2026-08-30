// Service worker: гра працює офлайн після першого відкриття.
//
// Стратегія навмисно проста і без залежностей: усе, що успішно завантажилось
// (index, css, js, іконки), кладеться в кеш; без мережі — віддається з кешу.
// Імена ассетів хешовані збіркою, тож нова версія просто докладає нові файли,
// а активація підчищає старий кеш цілком.

const CACHE = 'scuderia-mozarella-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(['.', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // Мережа перша (щоб оновлення долітали), кеш — страховка офлайну
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ?? caches.match('.'))),
  );
});
