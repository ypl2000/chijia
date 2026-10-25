/* 持家 chijia Service Worker：缓存应用壳，离线可用 */
const VER = "chijia-v1.1.0";
const ASSETS = [
  "./",
  "./index.html",
  "./plan.html",
  "./analysis.html",
  "./settings.html",
  "./calculator.html",
  "./portfolio.html",
  "./app.css",
  "./data.js",
  "./core.js",
  "./formats.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 缓存优先 + 网络回填；离线时回退到首页 */
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(hit =>
      hit ||
      fetch(e.request).then(r => {
        const cp = r.clone();
        caches.open(VER).then(c => c.put(e.request, cp));
        return r;
      }).catch(() => caches.match("./index.html"))
    )
  );
});
