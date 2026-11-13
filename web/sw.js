/* chijia v3 · Service Worker
   network-first（HTML/JS/CSS 走 cache:'reload' 绕开启发式缓存）+ 离线兜底；
   /api/* 永不缓存。所有资源本地化，运行期不请求任何第三方域名。
   改版请同步递增 VERSION / manifest version / index.html ?v= / app.css 头注释。 */
const VERSION = 'v3.0.1';
const CACHE = 'chijia-' + VERSION;
const ASSETS = [
  './', './index.html', './app.css', './manifest.json',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './favicon.ico',
  './js/core/fmt.js', './js/core/formats.js', './js/core/statement.js',
  './js/core/plan.js', './js/core/fire.js', './js/core/health.js', './js/core/portfolio.js',
  './js/data.js', './js/store.js', './js/sync.js', './js/pdf.js', './js/ocr.js', './js/ui.js',
  './js/views/home.js', './js/views/plan.js', './js/views/analysis.js',
  './js/views/calculator.js', './js/views/portfolio.js', './js/views/settings.js',
  './js/app.js',
  './vendor/pdfjs/pdf.min.js', './vendor/pdfjs/pdf.worker.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.allSettled(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' }))))
  ).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('chijia-') && k !== CACHE).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const r = await fetch(new Request(req, { cache: 'reload' }));
    if (r && r.ok) c.put(req, r.clone());
    return r;
  } catch (e) {
    const hit = await c.match(req);
    if (hit) return hit;
    if (req.mode === 'navigate') return (await c.match('./index.html')) || Response.error();
    return Response.error();
  }
}
async function swr(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  const net = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
  return hit || net;
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;         // 第三方域名一律不拦
  if (url.pathname.indexOf('/api/') >= 0) return;          // 同步接口永不缓存
  const isDoc = req.mode === 'navigate' || /\.(html|js|css|json|txt)$/i.test(url.pathname) || url.pathname.endsWith('/');
  e.respondWith(isDoc ? networkFirst(req) : swr(req));
});
