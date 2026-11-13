/* chijia v3 · 格式化与数值工具（纯函数，无 DOM） */
window.CJ = window.CJ || {};
(function (CJ) {
  'use strict';

  function parse(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    return parseFloat(String(v == null ? '' : v).replace(/[≈,\s￥¥%]/g, '')) || 0;
  }
  function num(n, dec) {
    dec = dec === undefined ? 0 : dec;
    if (!isFinite(n)) return '—';
    return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function money(n, dec) { return num(n, dec === undefined ? 0 : dec); }
  function money2(n) { return num(n, 2); }
  function pct(x, dec) { return isFinite(x) ? Number(x).toFixed(dec === undefined ? 1 : dec) + '%' : '—'; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  /* 万 / 亿自动换算；输入单位「万」 */
  function wan(x, dec) {
    if (!isFinite(x)) return null;
    if (Math.abs(x) >= 10000) return (x / 10000).toFixed(2) + '亿';
    if (dec === undefined) dec = x >= 100 ? 0 : 1;
    return x.toFixed(dec).replace(/\.0$/, '') + '万';
  }
  /* 最大余额法：占比合计恒为 100.0%（来自 v2，v1 缺） */
  function largestRemainderPct(amounts, total) {
    if (!total || total <= 0) return amounts.map(() => 0);
    const raw = amounts.map(a => Math.max(0, a) / total * 100);
    const floor = raw.map(Math.floor);
    let rest = 100 - floor.reduce((a, b) => a + b, 0);
    const order = raw.map((v, i) => ({ i, r: v - floor[i] })).sort((a, b) => b.r - a.r || a.i - b.i);
    for (let k = 0; k < order.length && rest > 0; k++, rest--) floor[order[k].i] += 1;
    return floor;
  }
  function ymOf(start, m) {
    const sy = parseInt(String(start).slice(0, 4), 10);
    const sm = parseInt(String(start).slice(5, 7), 10);
    const mi = sm - 1 + m;
    return (sy + Math.floor(mi / 12)) + '-' + String(mi % 12 + 1).padStart(2, '0');
  }
  function monthSpan(dMin, dMax) {
    if (!dMin || !dMax) return 1;
    const a = String(dMin).slice(0, 7).split('-').map(Number);
    const b = String(dMax).slice(0, 7).split('-').map(Number);
    return Math.max(1, (b[0] - a[0]) * 12 + (b[1] - a[1]) + 1);
  }
  function todayYM() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  CJ.fmt = {
    parse, num, money, money2, pct, clamp, esc, wan,
    largestRemainderPct, ymOf, monthSpan, todayYM, deepClone
  };
})(window.CJ);
