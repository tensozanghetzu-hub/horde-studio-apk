/* Horde Studio — offline app shell */
/* Bumped for the 1.6.0 upstream-18.1.0 alignment. This worker is
   cache-first (`return hit || net`), so without a new cache name a phone
   keeps running the previous vhuman.js, views.js and app.js from disk even
   after the web channel has replaced them. */
var CACHE = 'horde-studio-v11';
var SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css',
  './js/idb.js', './js/ui.js', './js/store.js', './js/api.js', './js/horde.js', './js/vhuman.js', './js/views.js', './js/update.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(SHELL).catch(function () {});
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never cache provider / Horde traffic

  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
