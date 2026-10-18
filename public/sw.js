// Keeps the app shell available offline so the installed app opens instantly.
// API calls and downloads always go to the network.
var CACHE = 'shell-v2';
var SHELL = ['/', '/css/style.css', '/js/app.js', '/js/theme.js', '/img/logo.svg', '/img/app-icon.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.indexOf('/api/') === 0) return;
  e.respondWith(
    fetch(req)
      .then(function (res) {
        if (res.ok && SHELL.indexOf(url.pathname) >= 0) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(url.pathname, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(url.pathname).then(function (hit) {
          return hit || (req.mode === 'navigate' ? caches.match('/') : Response.error());
        });
      })
  );
});
