/* chijia v3 · 应用壳：单页路由 / 主题 / 锁定 / 网络审计 / PWA
   无 iframe —— v2 里 focusWithRetries、隐藏页广播自愈、输入焦点被重渲染打断
   这三类补丁的根因在这里被整体消除。 */
window.CJ = window.CJ || {};
(function (CJ) {
  'use strict';
  const U = CJ.ui;
  const NAV = [
    { k: 'home', t: '首页', i: 'home' },
    { k: 'plan', t: '计划', i: 'plan' },
    { k: 'analysis', t: '分析', i: 'analysis' },
    { k: 'calculator', t: '计算器', i: 'calculator' },
    { k: 'portfolio', t: '体检', i: 'portfolio' },
    { k: 'settings', t: '设置', i: 'settings' }
  ];
  let current = 'home';
  const app = { netLog: [], current: () => current };

  /* 统一网络出口审计：只记录，不外发；设置页可核对本会话所有请求 */
  const origFetch = window.fetch;
  window.fetch = function (url, opts) {
    try {
      app.netLog.unshift({ t: Date.now(), url: String(url), method: (opts && opts.method) || 'GET' });
      app.netLog = app.netLog.slice(0, 60);
    } catch (e) {}
    return origFetch.apply(this, arguments);
  };

  function renderNav() {
    const side = document.getElementById('side-nav'), tab = document.getElementById('tabbar');
    side.innerHTML = NAV.map(n => '<button class="side-item' + (n.k === current ? ' on' : '') + '" data-tab="' + n.k + '">' +
      U.icon(n.i, 19) + '<span>' + n.t + '</span></button>').join('');
    tab.innerHTML = NAV.map(n => '<button class="tab' + (n.k === current ? ' on' : '') + '" data-tab="' + n.k + '" aria-current="' + (n.k === current ? 'page' : 'false') + '">' +
      U.icon(n.i, 21) + '<span>' + n.t + '</span></button>').join('');
    document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => app.go(b.dataset.tab));
  }

  function render() {
    const v = CJ.views[current] || CJ.views.home, s = CJ.store.state;
    document.getElementById('page-title').textContent = v.title;
    document.getElementById('page-sub').textContent = v.sub || '';
    const root = document.getElementById('view');
    root.innerHTML = v.render(s);
    if (v.mount) { try { v.mount(root, s); } catch (e) { console.error('[chijia] mount ' + current, e); } }
    renderNav();
  }

  app.refresh = function () {
    const y = window.scrollY;
    render();
    try { window.scrollTo(0, y); } catch (e) {}
  };
  app.go = function (tab, opts) {
    if (!NAV.some(n => n.k === tab)) tab = 'home';
    current = tab;
    try { history.replaceState(null, '', location.pathname + '#/' + tab); } catch (e) {}
    render();
    try { window.scrollTo(0, 0); } catch (e) {}
    const hook = opts && opts.hook;
    if (hook) {
      setTimeout(() => {
        const el = hook === 'params' ? document.querySelector('#view .card-hero') : document.getElementById('sec-' + hook);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 90);
    }
    return current;
  };

  function applyTheme() {
    const t = CJ.store.state.settings.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#10151e' : '#f5f7fb';
    document.getElementById('theme-btn').innerHTML = U.icon(t === 'dark' ? 'sun' : 'moon', 18);
    document.getElementById('lock-btn').innerHTML = U.icon('lock', 18);
  }
  app.lock = function () { document.getElementById('lock-screen').hidden = false; };

  function boot() {
    /* 1. 状态（init 同步部分先把 localStorage 镜像读进来） */
    CJ.store.init().then(() => {
      if (CJ.sync.available) try { CJ.sync.pull(); } catch (e) {}
    });
    applyTheme();

    /* 2. 首屏 */
    const fromHash = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    if (NAV.some(n => n.k === fromHash)) current = fromHash;
    render();

    /* 3. 状态变更 → 重渲染（输入类改动是 silent，不会触发，焦点不丢） */
    CJ.store.subscribe((s, reason) => {
      if (reason === 'init' || reason === 'activity' || reason === 'sync-push') return;
      app.refresh();
    });

    /* 4. 顶栏动作 */
    document.getElementById('theme-btn').onclick = () => {
      CJ.store.commit(st => { st.settings.theme = st.settings.theme === 'dark' ? 'light' : 'dark'; }, { reason: 'theme' });
      applyTheme();
    };
    document.getElementById('lock-btn').onclick = app.lock;
    document.getElementById('unlock-btn').onclick = () => { document.getElementById('lock-screen').hidden = true; };
    window.addEventListener('hashchange', () => {
      const t = (location.hash || '').replace(/^#\/?/, '');
      if (NAV.some(n => n.k === t) && t !== current) { current = t; render(); window.scrollTo(0, 0); }
    });

    /* 5. 离屏自动锁定（可选，默认关） */
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && CJ.store.state.settings.autoLock && Date.now() - hiddenAt > 120000) app.lock();
    });

    /* 6. 打印：展开全部折叠（v1 的硬性要求，v3 保留） */
    window.addEventListener('beforeprint', () => document.querySelectorAll('details.fold').forEach(d => d.open = true));

    /* 7. 可选后端探测 */
    CJ.sync.probe().then(ok => {
      const pill = document.getElementById('sync-pill');
      if (ok) { pill.hidden = false; pill.textContent = '本机同步已连接'; }
      if (ok && CJ.sync.getToken()) CJ.sync.pull().catch(() => {});
      if (current === 'settings') app.refresh();
    });

    /* 8. PWA（file:// 下自动跳过） */
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('[chijia] SW 注册失败', e));
    }
    window.addEventListener('online', () => { if (CJ.sync.available) CJ.sync.push().catch(() => {}); });
  }

  CJ.app = app;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.CJ);
