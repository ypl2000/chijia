/* chijia v3 · UI 组件（返回 HTML 字符串 + 非阻塞弹窗）
   统一约定：所有金额格式化走 CJ.fmt；表格外层 .table-wrap 负责横向滚动；
   输入框统一 data-k 作为字段键，view 用事件委托绑定，避免整体重渲染抢焦点。 */
window.CJ = window.CJ || {};
(function (CJ) {
  'use strict';
  const F = CJ.fmt;

  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-7h5v7"/>',
    plan: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/><path d="M8 15h3M8 18h6"/>',
    analysis: '<path d="M3 20h18"/><path d="M6 16v-5M11 16V6M16 16v-8M21 16v-3"/>',
    calculator: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h2M14 10h2M8 14h2M14 14h2M8 18h8"/>',
    portfolio: '<path d="M12 2 3 7v6c0 5 3.8 8.3 9 9 5.2-.7 9-4 9-9V7z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3.4-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V22h-4v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2-3.4.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H4v-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2-3.4.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V2h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2 3.4-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1.1H20v4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 9v5M12 17.5v.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    shield: '<path d="M12 2 3 7v6c0 5 3.8 8.3 9 9 5.2-.7 9-4 9-9V7z"/><path d="M9 12h6M12 9v6"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/>',
    arrow: '<path d="M4 12h16M14 6l6 6-6 6"/>',
    spark: '<path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5 19 19M19 5l-3.5 3.5M8.5 15.5 5 19"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2 6.5"/><path d="M20 4v7h-7"/>',
    utensils: '<path d="M5 3v8a3 3 0 0 0 6 0V3M8 3v18M17 3c-1.5 2-2 4-2 7v11"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    chart: '<path d="M3 3v18h18"/><path d="m6 16 4-5 3 2 5-7"/>',
    file: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/>',
    wifi: '<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 16a6 6 0 0 1 7 0"/><circle cx="12" cy="20" r="1"/>',
    camera: '<path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="3.5"/>'
  };
  function icon(name, size) {
    return '<svg class="ic" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.info) + '</svg>';
  }

  function tag(text, tone) { return '<span class="tag tag-' + (tone || 'gray') + '">' + text + '</span>'; }
  function bar(pct, tone) {
    return '<div class="bar"><i class="bar-fill bar-' + (tone || 'blue') + '" style="width:' + F.clamp(pct, 0, 100) + '%"></i></div>';
  }
  function stack(items) {
    const sum = items.reduce((a, x) => a + Math.max(0, x.pct || 0), 0) || 1;
    return '<div class="stack">' + items.map(x =>
      '<i style="width:' + (Math.max(0, x.pct || 0) / sum * 100) + '%;background:' + (x.color || '#3b6ef6') + '" title="' + F.esc(x.label) + ' ' + F.pct(x.pct) + '"></i>'
    ).join('') + '</div>' +
      '<div class="stack-legend">' + items.map(x =>
        '<span><i style="background:' + (x.color || '#3b6ef6') + '"></i>' + F.esc(x.label) + ' <b>' + F.pct(x.pct) + '</b></span>'
      ).join('') + '</div>';
  }
  function kpi(o) {
    return '<div class="kpi' + (o.tone ? ' kpi-' + o.tone : '') + (o.wide ? ' kpi-wide' : '') + '">' +
      (o.label ? '<div class="kpi-label">' + F.esc(o.label) + '</div>' : '') +
      '<div class="kpi-value">' + (o.unit === '万' || o.unit === '%' || o.unit === '年' || o.unit === '月' ? '' : '<span class="kpi-cur">¥</span>') + o.value + (o.unit ? '<small>' + o.unit + '</small>' : '') + '</div>' +
      (o.note ? '<div class="kpi-note">' + o.note + '</div>' : '') +
      (o.bar !== undefined ? bar(o.bar, o.tone) : '') +
      '</div>';
  }
  function card(o) {
    const collapsed = o.collapsed ? '' : ' open';
    const inner = '<div class="card' + (o.tone ? ' card-' + o.tone : '') + (o.cls ? ' ' + o.cls : '') + '"' + (o.id ? ' id="' + o.id + '"' : '') + '>' +
      (o.title ? '<div class="card-head">' +
        (o.icon ? '<span class="card-ico">' + icon(o.icon, 18) + '</span>' : '') +
        '<div class="card-titles"><h3>' + F.esc(o.title) + '</h3>' + (o.sub ? '<p>' + o.sub + '</p>' : '') + '</div>' +
        (o.actions ? '<div class="card-actions">' + o.actions + '</div>' : '') + '</div>' : '') +
      (o.body !== undefined ? '<div class="card-body">' + o.body + '</div>' : '') + '</div>';
    if (o.collapsible) {
      return '<details class="fold' + collapsed + '"' + (o.id ? ' id="' + o.id + '"' : '') + '>' +
        '<summary>' + (o.icon ? icon(o.icon, 18) : '') + '<span>' + F.esc(o.title || '') + '</span>' + (o.badge ? tag(o.badge, o.badgeTone) : '') + icon('chevron', 16) + '</summary>' +
        '<div class="fold-body">' + (o.body || '') + '</div></details>';
    }
    return inner;
  }
  function table(o) {
    const head = (o.head || []).map(h => {
      const x = typeof h === 'string' ? { t: h } : h;
      return '<th' + (x.num ? ' class="num"' : '') + (x.w ? ' style="width:' + x.w + '"' : '') + '>' + x.t + '</th>';
    }).join('');
    const rows = (o.rows || []).map(r => {
      const cells = Array.isArray(r) ? r : r.cells;
      const cls = Array.isArray(r) ? '' : (r.cls || '');
      return '<tr class="' + cls + '">' + cells.map((c, i) => {
        const x = typeof c === 'object' && c !== null && !Array.isArray(c) ? c : { t: c };
        let inner = x.t === undefined ? '' : x.t;
        if (x.bar !== undefined) inner = '<div class="cell-bar"><i style="width:' + F.clamp(x.bar, 0, 100) + '%"></i></div>';
        const numCls = (x.num || (typeof c === 'number')) ? ' class="num"' : '';
        return '<td' + numCls + '>' + inner + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="table-wrap' + (o.cls ? ' ' + o.cls : '') + '"><table class="tbl">' +
      (head ? '<thead><tr>' + head + '</tr></thead>' : '') + '<tbody>' + rows + '</tbody></table></div>';
  }
  function empty(text, sub) {
    return '<div class="empty"><span class="empty-ic">' + icon('file', 26) + '</span><b>' + F.esc(text) + '</b>' + (sub ? '<p>' + F.esc(sub) + '</p>' : '') + '</div>';
  }
  function field(o) {
    const id = 'f-' + o.k;
    const input = '<input id="' + id + '" data-k="' + o.k + '" type="' + (o.type || 'number') + '" value="' + F.esc(o.value) + '"' +
      (o.type === 'text' ? '' : ' min="' + (o.min === undefined ? 0 : o.min) + '" max="' + (o.max === undefined ? 999999999 : o.max) + '" step="' + (o.step === undefined ? 1 : o.step) + '"') +
      (o.placeholder ? ' placeholder="' + F.esc(o.placeholder) + '"' : '') + '>';
    return '<label class="field" for="' + id + '"><span class="field-label">' + F.esc(o.label) + '</span>' +
      '<span class="field-input">' + input + (o.unit ? '<em>' + F.esc(o.unit) + '</em>' : '') + '</span>' +
      (o.hint ? '<span class="field-hint">' + F.esc(o.hint) + '</span>' : '') + '</label>';
  }
  function slider(o) {
    return '<div class="slider-row" data-slider="' + o.k + '">' +
      '<div class="slider-top"><span>' + F.esc(o.label) + '</span><b id="sv-' + o.k + '">' + F.esc(o.value) + (o.unit || '') + '</b></div>' +
      '<input type="range" data-k="' + o.k + '" data-range="1" min="' + o.min + '" max="' + o.max + '" step="' + o.step + '" value="' + o.value + '">' +
      '</div>';
  }
  function sparkline(values, opts) {
    opts = opts || {};
    const w = opts.w || 600, h = opts.h || 120, pad = 6;
    if (!values || !values.length) return '';
    const max = Math.max(...values, 1), min = Math.min(...values, 0);
    const span = max - min || 1;
    const pts = values.map((v, i) => [pad + i / Math.max(1, values.length - 1) * (w - pad * 2), h - pad - (v - min) / span * (h - pad * 2)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = d + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + h + ' L' + pad + ' ' + h + ' Z';
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      '<defs><linearGradient id="spg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b6ef6" stop-opacity=".22"/><stop offset="1" stop-color="#3b6ef6" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#spg)"/><path d="' + d + '" fill="none" stroke="#3b6ef6" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '</svg>';
  }
  function callout(text, tone) {
    return '<div class="callout callout-' + (tone || 'info') + '">' + icon(tone === 'warn' || tone === 'bad' ? 'alert' : 'info', 17) + '<div>' + text + '</div></div>';
  }
  function btn(text, opts) {
    opts = opts || {};
    return '<button type="button" class="btn btn-' + (opts.tone || 'primary') + (opts.small ? ' btn-sm' : '') + (opts.ghost ? ' btn-ghost' : '') + '"' +
      (opts.act ? ' data-act="' + opts.act + '"' : '') + (opts.id ? ' id="' + opts.id + '"' : '') + (opts.attrs || '') + '>' +
      (opts.icon ? icon(opts.icon, 16) : '') + F.esc(text) + '</button>';
  }
  function sectionTitle(no, title, note) {
    return '<div class="sec-title"><span class="sec-no">' + no + '</span><div><h2>' + F.esc(title) + '</h2>' + (note ? '<p>' + note + '</p>' : '') + '</div></div>';
  }
  function lights(list) {
    return '<div class="lights">' + list.map(l =>
      '<div class="light light-' + l.level + '"><span class="bulb"></span><div class="light-body"><b>' + F.esc(l.name) + '</b>' +
      '<span class="light-verdict">' + F.esc(l.verdict) + '</span><p>' + F.esc(l.detail) + '</p></div></div>'
    ).join('') + '</div>';
  }

  /* ---- 非阻塞 toast / confirm / modal（替代 v2 的原生 alert/confirm） ---- */
  let toastTimer = null;
  function toast(msg, tone) {
    const host = document.getElementById('toast-host');
    if (!host) return;
    host.innerHTML = '<div class="toast toast-' + (tone || 'ok') + '">' + icon(tone === 'bad' ? 'alert' : 'check', 18) + '<span>' + F.esc(msg) + '</span></div>';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { host.innerHTML = ''; }, 3200);
  }
  function confirm(msg, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const host = document.getElementById('modal-host');
      if (!host) return resolve(window.confirm(msg));
      host.innerHTML = '<div class="modal-mask"><div class="modal"><h3>' + F.esc(opts.title || '请确认') + '</h3>' +
        '<p>' + F.esc(msg) + '</p><div class="modal-actions">' + btn(opts.cancelText || '取消', { tone: 'quiet', act: 'modal-cancel' }) +
        btn(opts.okText || '确定', { tone: opts.danger ? 'danger' : 'primary', act: 'modal-ok' }) + '</div></div></div>';
      const close = v => { host.innerHTML = ''; resolve(v); };
      host.querySelector('[data-act="modal-ok"]').onclick = () => close(true);
      host.querySelector('[data-act="modal-cancel"]').onclick = () => close(false);
      host.querySelector('.modal-mask').onclick = e => { if (e.target.classList.contains('modal-mask')) close(false); };
    });
  }
  function modal(o) {
    const host = document.getElementById('modal-host');
    host.innerHTML = '<div class="modal-mask"><div class="modal modal-lg"><div class="modal-head"><h3>' + F.esc(o.title || '') + '</h3><button class="icon-btn" data-act="modal-close" aria-label="关闭">✕</button></div>' +
      '<div class="modal-body">' + (o.body || '') + '</div>' +
      '<div class="modal-actions">' + btn('关闭', { tone: 'quiet', act: 'modal-close' }) + (o.actions || '') + '</div></div></div>';
    host.querySelectorAll('[data-act="modal-close"]').forEach(b => b.onclick = () => { host.innerHTML = ''; });
    return host;
  }

  CJ.ui = {
    ICONS, icon, tag, bar, stack, kpi, card, table, empty, field, slider,
    sparkline, callout, btn, sectionTitle, lights, toast, confirm, modal
  };
})(window.CJ);
