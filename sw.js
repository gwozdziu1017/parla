const CACHE_NAME = 'parla-v1';
const ASSETS = [
  '/parla/',
  '/parla/index.html',
  '/parla/styles.css',
  '/parla/app.js',
  '/parla/manifest.json',
  '/parla/icon-192.png',
  '/parla/icon-512.png',
  '/parla/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
});

self.addEventListener('fetch', event => {
  // Never cache API calls
  if (event.request.url.includes('anthropic.com') ||
      event.request.url.includes('openai.com') ||
      event.request.url.includes('open.er-api.com')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
