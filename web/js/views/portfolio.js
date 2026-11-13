/* chijia v3 · 组合体检（v1 四维 + v2 分散度 = 五灯，含金额化调仓建议） */
window.CJ = window.CJ || {};
window.CJ.views = window.CJ.views || {};
(function (CJ) {
  'use strict';
  const U = CJ.ui, F = CJ.fmt, P = CJ.portfolio;

  const PARAMS = [
    { k: 'equityR', label: '权益年化', unit: '%', step: 0.1 },
    { k: 'bondR', label: '稳健年化', unit: '%', step: 0.1 },
    { k: 'cashR', label: '现金年化', unit: '%', step: 0.1 },
    { k: 'esopR', label: 'ESOP 年化', unit: '%', step: 0.1 },
    { k: 'years', label: '距提取年数', unit: '年' },
    { k: 'modelR', label: '模型假设收益', unit: '%', step: 0.1 },
    { k: 'monthlyExpense', label: '月支出', unit: '元', step: 100 },
    { k: 'monthlyInvest', label: '月可投', unit: '元', step: 100 }
  ];

  function liveHtml(s) {
    const c = P.compute(s.holdings), lights = P.lights(c), sug = P.suggestions(c);
    const allTotal = P.BUCKETS.reduce((a, b) => a + c.s[b.key], 0) || 1;
    const reds = lights.filter(l => l.level === 'bad').length, yellows = lights.filter(l => l.level === 'warn').length;
    const verdict = reds === 0 && yellows === 0 ? '组合合格：五个维度全部达标，撑得起模型假设。'
      : reds === 0 ? '大体合格，' + yellows + ' 处值得优化（见下方建议）。'
        : '组合不合格：' + reds + ' 项红灯' + (yellows ? '、' + yellows + ' 项黄灯' : '') + '——按建议调整后再用本假设测算。';
    let h = '';
    h += U.card({
      cls: 'card-hero', title: '有效收益 vs 模型假设', icon: 'chart',
      body: '<div class="kpi-grid k3">' +
        U.kpi({ label: '有效收益 rEff', value: c.rEff === null ? '—' : F.pct(c.rEff * 100, 2), note: 'ESOP 收益按 0.6 打折（与工资同源）', tone: 'blue' }) +
        U.kpi({ label: '名义收益', value: c.rNominal === null ? '—' : F.pct(c.rNominal * 100, 2), note: '未打折口径', tone: 'amber' }) +
        U.kpi({ label: '生息组合', value: F.money(c.income), note: '排除消费 / 限用途资产', tone: 'mint' }) +
        '</div>' +
        '<div class="slider-top" style="margin-top:14px"><span>0%</span><span>模型假设 ' + c.s.modelR + '%</span><span>10%</span></div>' +
        '<div class="bar" style="height:12px;position:relative"><i class="bar-fill" style="width:' + F.clamp((c.rEff || 0) * 100 / 10 * 100, 0, 100) + '%"></i>' +
        '<i style="position:absolute;left:' + F.clamp(c.s.modelR / 10 * 100, 0, 100) + '%;top:-3px;width:3px;height:18px;background:var(--amber);border-radius:2px"></i></div>' +
        '<div class="muted-sm" style="margin-top:8px">橙色竖线是模型假设，蓝条是组合实际有效收益。</div>'
    });
    h += U.sectionTitle('◎', '五维红绿灯', '收益达标 / 单一集中度 / 权益配比 / 流动性 / 分散度');
    h += U.card({ body: U.lights(lights) + U.callout('<b>总评：</b>' + verdict, reds ? 'bad' : yellows ? 'warn' : 'good') });

    h += U.sectionTitle('→', '金额化调仓建议', '按红灯优先排序，每条都给具体金额与补齐月数');
    h += U.card({
      body: sug.length ? sug.map((x, i) =>
        '<div class="light light-' + (x.lv === 0 ? 'bad' : 'warn') + '" style="margin-bottom:9px"><span class="bulb"></span>' +
        '<div class="light-body"><b>' + (i + 1) + '. ' + F.esc(x.title) + '</b><p>' + x.html + '</p></div></div>').join('')
        : U.callout('✅ 没有需要调整的——五个维度全部合格。保持纪律即可。', 'good')
    });
    h += U.card({
      title: '持仓构成与排除项', icon: 'info',
      body: U.stack(P.BUCKETS.filter(b => c.s[b.key] > 0).map(b => ({ label: b.label, pct: c.s[b.key] / Math.max(1, P.BUCKETS.reduce((a, x) => a + c.s[x.key], 0)) * 100, color: b.color }))) +
        U.callout(F.esc(P.exclusion(c)), 'info') +
        U.table({ head: ['桶', { t: '金额', num: true }, { t: '占全部持仓', num: true }, '属性'], rows: P.BUCKETS.map(b => [F.esc(b.label), { t: F.money(c.s[b.key]), num: true }, { t: F.pct(c.s[b.key] / allTotal * 100), num: true }, F.esc(b.note)]) })
    });
    return h;
  }

  CJ.views.portfolio = {
    title: '体检', sub: '持仓五维红绿灯 · 金额化调仓建议',
    render(s) {
      const v = s.holdings;
      let h = U.card({
        cls: 'card-hero', title: '持仓与假设', icon: 'portfolio',
        sub: '改动任一数字，五盏灯与调仓建议立即重算（不刷新页面、不丢焦点）',
        actions: U.btn('从账本预填', { tone: 'quiet', small: true, icon: 'refresh', act: 'prefill' }) +
          U.btn('截图识别', { tone: 'quiet', small: true, icon: 'camera', act: 'ocr' }) +
          U.btn('清空', { tone: 'ghost', small: true, icon: 'trash', act: 'clear' }) +
          U.btn('写入计算器 r', { tone: 'primary', small: true, icon: 'calculator', act: 'to-calc' }),
        body: '<h4 style="font-size:12px;color:var(--muted);margin:0 0 8px">六个持仓桶（元）</h4>' +
          '<div class="field-grid">' + P.BUCKETS.map(b => U.field({ k: b.key, label: b.label + ' · ' + b.note, value: v[b.key], unit: '元', step: 1000 })).join('') + '</div>' +
          '<div class="divider"></div><h4 style="font-size:12px;color:var(--muted);margin:0 0 8px">年化与参数</h4>' +
          '<div class="field-grid">' + PARAMS.map(p => U.field({ k: p.k, label: p.label, value: v[p.k], unit: p.unit, step: p.step, min: 0 })).join('') + '</div>'
      });
      h += '<div id="pf-live" data-live>' + liveHtml(s) + '</div>';
      return h;
    },
    live: liveHtml,
    mount(root, s) {
      root.querySelectorAll('.card-hero input[data-k]').forEach(el => el.addEventListener('input', () => {
        const k = el.dataset.k, v = F.parse(el.value);
        if (!isFinite(v)) return;
        CJ.store.commit(st => { st.holdings[k] = v; if (k === 'monthlyExpense') st.settings.monthlyExpense = v; }, { silent: true });
        const live = root.querySelector('#pf-live'); if (live) live.innerHTML = liveHtml(CJ.store.state);
      }));
      root.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
        const a = b.dataset.act;
        if (a === 'prefill') {
          CJ.store.commit(st => {
            const rows = st.overview.now.rows || [];
            const pick = re => rows.filter(r => re.test(r.name) && !r.muted).reduce((x, r) => x + F.parse(r.amt), 0);
            st.holdings.equity = pick(/基金/); st.holdings.esop = pick(/ESOP|虚拟股/);
            st.holdings.cash = pick(/银行|活期|现金|安全垫/); st.holdings.consumer = pick(/固定资产|车/);
            st.holdings.restricted = pick(/公积金/);
            st.holdings.monthlyExpense = st.settings.monthlyExpense || st.plan.spend;
            st.holdings.monthlyInvest = st.plan.invest;
          }, { reason: 'pf-prefill' });
          U.toast('已按账本资产带入持仓');
        } else if (a === 'clear') {
          if (await U.confirm('清空全部持仓与参数？', { title: '清空持仓' })) {
            CJ.store.commit(st => { st.holdings = F.deepClone(P.DEFAULTS); }, { reason: 'pf-clear' });
            U.toast('已恢复默认持仓');
          }
        } else if (a === 'ocr') {
          try { CJ.ocr.open(s); }
          catch (e) { U.toast('截图识别打开失败：' + (e && e.message ? e.message : e), 'bad'); }
        } else if (a === 'to-calc') {
          const c = P.compute(CJ.store.state.holdings);
          if (c.rEff === null) return U.toast('没有生息资产，无法写入', 'bad');
          CJ.store.commit(st => { st.calculator.r = +(c.rEff * 100).toFixed(2); }, { reason: 'pf-to-calc' });
          U.toast('已把有效收益 ' + F.pct(c.rEff * 100, 2) + ' 写入计算器');
          CJ.app.go('calculator');
        }
      });
    }
  };
})(window.CJ);
