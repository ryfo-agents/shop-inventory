/* Public shell only. Bump SHELL_VERSION and both HTML asset queries together.
 * API requests must never consult Cache Storage or use an HTML fallback.
 */
var SHELL_VERSION = '10';
var CACHE = 'shop-inv-shell-v' + SHELL_VERSION;
var CORE = [
  '/index.html',
  '/greenfield/index.html',
  '/greenfield/styles.css?v=' + SHELL_VERSION,
  '/greenfield/app.js?v=' + SHELL_VERSION,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];
var STATIC = new Set(CORE.map(function (path) { return new URL(path, self.location.origin).href; }));
var SHELL_ROUTES = ['/', '/index.html', '/greenfield/', '/greenfield/index.html'];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(CORE.map(function (path) { return new Request(path, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (name) {
      if (name.indexOf('shop-inv-') === 0 && name !== CACHE) return caches.delete(name);
      if (name !== CACHE) return null;
      return caches.open(name).then(function (cache) {
        return cache.keys().then(function (requests) {
          return Promise.all(requests.map(function (request) {
            return STATIC.has(request.url) ? null : cache.delete(request);
          }));
        });
      });
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.indexOf('/api/') === 0) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }
  if (request.method !== 'GET') return;
  if (request.mode === 'navigate' && SHELL_ROUTES.indexOf(url.pathname) !== -1) {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(function (error) {
      var fallback = url.pathname.indexOf('/greenfield/') === 0 ? '/greenfield/index.html' : '/index.html';
      return caches.open(CACHE).then(function (cache) { return cache.match(fallback); }).then(function (hit) {
        if (hit) return hit;
        throw error;
      });
    }));
    return;
  }
  if (!STATIC.has(url.href)) return;
  event.respondWith(caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (response) {
        if (response.ok && !response.redirected && response.type !== 'opaque') {
          event.waitUntil(cache.put(request, response.clone()));
        }
        return response;
      });
    });
  }));
});
