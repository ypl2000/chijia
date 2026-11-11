/**
 * 持家 chijia v2 · sw.js（PWA Service Worker）
 * 策略（D21 修订：改版即见最新，离线可用兜底）：
 *   - /api/*                    → 永远走网络，不缓存（数据不出本机的边界在后端）
 *   - HTML 导航 / .js / .css    → network-first（离线回退缓存）——改版立即生效，
 *                                 断网时用最近一次成功缓存兜底
 *   - 图标等静态资源（图片/字体）→ cache-first + 后台更新（stale-while-revalidate）
 * 改版时递增 VERSION，并同步递增各页 <link app.css?v=>（D21 纪律）。
 */

/* eslint-disable no-restricted-globals */
const VERSION = 'v2.0.7';
const CACHE_NAME = `chijia-${VERSION}`;

/** 壳资源预缓存（与页面引用保持同一 ?v= 以精确命中；离线首启兜底） */
const SHELL_ASSETS = [
  './',
  './index.html',
  './plan.html',
  './analysis.html',
  './calculator.html',
  './portfolio.html',
  './settings.html',
  './report.html',
  './app.css?v=2.0.7',
  './manifest.json',
  './icons/icon.svg',
  './src/core.js',
  './src/data.js',
  './src/formats.js',
  './src/idb.js',
  './src/sync.js',
  // ⑪ pdf.js 本地化：vendor 组件纳入预缓存（断网解析 PDF 可用）
  './vendor/pdfjs/pdf.min.js',
  './vendor/pdfjs/pdf.worker.min.js',
];

/** 单条预缓存：fetch + put（等价 cache.add，可带 options）。
 *  {cache:'reload'} 绕过 HTTP 缓存（含 304 短路），保证拿到完整 200 实体。 */
async function precacheOne(cache, url) {
  const res = await fetch(new Request(url, { cache: 'reload' }));
  if (!res || !res.ok) throw new Error(`precache ${url} → ${res ? res.status : 'no response'}`);
  await cache.put(url, res.clone());
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        // 逐条预缓存 + Promise.allSettled 单条容错：任一资源失败（如 304/瞬时
        // 网络错）不整体 reject，剩余条目照常预缓存；缺口由运行期 networkFirst 自愈。
        Promise.allSettled(SHELL_ASSETS.map((url) => precacheOne(cache, url))),
      )
      .then((results) => {
        const failed = results.filter((r) => r.status === 'rejected');
        if (failed.length) {
          console.warn(`[sw] 首启预缓存 ${SHELL_ASSETS.length - failed.length}/${SHELL_ASSETS.length} 成功，${failed.length} 条失败（运行期 networkFirst 可自愈）`);
        }
        return self.skipWaiting();
      }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** 图标等 immutable 静态资源（cache-first） */
const CACHE_FIRST_RE = /\.(?:svg|png|jpe?g|gif|webp|ico|woff2?)$/i;
/** network-first 文本资源（D21：改版即见最新） */
const NETWORK_FIRST_RE = /\.(?:html|js|css|json|txt)$/i;

/** network-first：网络成功即回包并更新缓存，失败回退缓存。
 *  BUG-006/D30：fetch 加 {cache:'reload'} 绕过 HTTP 启发式缓存，
 *  与后端补的 Cache-Control: no-cache（D30 后端侧）双向保险。 */
function networkFirst(req) {
  return fetch(req, { cache: 'reload' })
    .then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      }
      return res;
    })
    .catch(() =>
      caches.match(req, { ignoreSearch: true }).then((cached) => cached || Response.error()),
    );
}

/** cache-first + 后台更新（stale-while-revalidate） */
function staleWhileRevalidate(req) {
  return caches.match(req).then((cached) => {
    const network = fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => cached);
    return cached || network;
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 只管同源（pdf.js 已本地化为 vendor 同源资源，纳入缓存）
  if (url.pathname.startsWith('/api/')) return; // API 永远走网络

  if (req.mode === 'navigate' || NETWORK_FIRST_RE.test(url.pathname)) {
    // D21：页面与 HTML/JS/CSS/JSON → network-first（离线回退缓存）
    event.respondWith(networkFirst(req));
    return;
  }

  // 图标等静态资源 → cache-first + 后台更新
  event.respondWith(staleWhileRevalidate(req));
});
