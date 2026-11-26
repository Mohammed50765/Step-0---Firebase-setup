/**
 * ميدان 6v6 — Service Worker آمن وخفيف (Static Shell Only)
 * - يخزن الأصول الثابتة فقط (HTML/Icons/Manifest).
 * - لا يخزن أبداً طلبات Firestore أو Google Auth أو أي بيانات خاصة.
 * - يدعم التحديث الفوري ومسح الكاش الكامل عند تسجيل الخروج.
 */
const CACHE_VERSION = 'maydan-static-v2';
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon-32x32.png'
];

const NEVER_CACHE_PATTERNS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'googleapis.com',
  'accounts.google.com',
  'apis.google.com',
  'firebaseinstallations',
  'firebaseio.com',
  '/__/',
  '/api/'
];

function isSensitiveOrDynamicRequest(request) {
  if (!request || request.method !== 'GET') return true;
  try {
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return true;
    const full = url.href.toLowerCase();
    for (let i = 0; i < NEVER_CACHE_PATTERNS.length; i++) {
      if (full.indexOf(NEVER_CACHE_PATTERNS[i]) !== -1) return true;
    }
    if (url.search && (url.search.indexOf('join=') !== -1 || url.search.indexOf('token=') !== -1)) {
      return true;
    }
    return false;
  } catch (_) {
    return true;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.map((key) => (key !== CACHE_VERSION ? caches.delete(key) : Promise.resolve(false)))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const data = event && event.data ? event.data : {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'CLEAR_ALL_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (isSensitiveOrDynamicRequest(request)) {
    return;
  }

  const url = new URL(request.url);

  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(request).catch(() => new Response(
        '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>ميدان 6v6 — بدون اتصال</title><body style="background:#08090c;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;"><div><h1 style="color:#FACC15;">📡 لا يوجد اتصال بالإنترنت</h1><p>تحقّق من الاتصال ثم أعد تحميل الصفحة للمتابعة في ميدان 6v6.</p></div></body></html>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      ))
    );
    return;
  }

  const isStaticFile = /\.(?:png|svg|ico|webmanifest|css|js|woff2?)$/i.test(url.pathname);
  if (!isStaticFile) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
