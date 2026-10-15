// sw.js — "עובד שירות": שומר את קבצי המשחק בטלפון, כך שהאפליקציה מהמסך הבית
// נפתחת מהר ועובדת גם בלי אינטרנט (אחרי הפעם הראשונה).
// קבצים שלנו: קודם מנסים מהאינטרנט (כדי לקבל עדכונים), ואם אין — מהזיכרון.
// ספריות מה-CDN (גרסה קבועה): קודם מהזיכרון, כי הן לא משתנות.
const CACHE = 'skimode-v1';
const CORE = [
  './',
  './index.html',
  './css/style.css',
  './js/main.js',
  './js/terrain.js',
  './js/noise.js',
  './js/trees.js',
  './js/sky.js',
  './js/player.js',
  './js/skier.js',
  './js/input.js',
  './js/snow.js',
  './js/effects.js',
  './js/audio.js',
  './js/install.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './powder-line/',
  './powder-line/index.html',
  './powder-line/styles.css',
  './powder-line/game.js',
  './powder-line/manifest.webmanifest',
  './powder-line/icons/icon-192.png',
  './powder-line/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(CORE.map((url) => cache.add(url)))),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) {
    // CDN / פונטים: מהזיכרון אם יש, אחרת מהרשת ושומרים
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })),
    );
    return;
  }

  // הקבצים שלנו: מהרשת קודם, ואם אין אינטרנט — מהזיכרון
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => {
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const base = url.pathname.includes('/powder-line/') ? './powder-line/index.html' : './index.html';
          return caches.match(base);
        }
        return Response.error();
      })),
  );
});
