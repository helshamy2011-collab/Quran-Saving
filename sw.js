// عامل الخدمة: يحفظ ملفات البرنامج والمصحف ليعمل بدون إنترنت
const CACHE = 'hifz-v6';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/quran.js',
  'js/matcher.js',
  'js/speech.js',
  'js/store.js',
  'js/plan.js',
  'js/icons.js',
  'js/recitation.js',
  'js/guided.js',
  'data/quran.json',
  'data/layout.json',
  'icons/icon.svg',
  'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ملفات البرنامج: الشبكة أولاً ثم النسخة المحفوظة (حتى تصل التحديثات)
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com');
  if (!sameOrigin && !isFont) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      if (list.length) return list[0].focus();
      return self.clients.openWindow('./');
    }),
  );
});
