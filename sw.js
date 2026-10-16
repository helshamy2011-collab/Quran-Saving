// عامل الخدمة: يحفظ ملفات البرنامج والمصحف ليعمل بدون إنترنت
const CACHE = 'hifz-v16'; // نفس APP_VERSION في js/app.js
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
  'js/mushaf.js',
  'js/audio.js',
  'js/voicefix.js',
  'js/quiz.js',
  'data/quran.json',
  'data/layout.json',
  'data/similar.json',
  'data/lines.json',
  'icons/icon.svg',
  'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' حتى لا نحفظ نسخة قديمة من ذاكرة المتصفح
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// التفسير ومعاني الكلمات (data/tafsir، data/gharib) لا يُحمَّلان مسبقاً لحجمهما، ويُحفظان أول ما تفتح سورة
// ملفات البرنامج: الشبكة أولاً ثم النسخة المحفوظة (حتى تصل التحديثات)
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com');
  if (!sameOrigin && !isFont) return;
  // ملفات البرنامج نسأل عنها الموقع كل مرة (no-cache) بدل نسخة المتصفح، حتى يظهر التحديث فوراً
  const req = sameOrigin ? fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(e.request);
  e.respondWith(
    req
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
