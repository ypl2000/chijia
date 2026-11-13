/* chijia v3 · 财富自由计算器（v1 三口径并列模型完整恢复） */
window.CJ = window.CJ || {};
window.CJ.views = window.CJ.views || {};
(function (CJ) {
  'use strict';
  const U = CJ.ui, F = CJ.fmt, M = CJ.fire;

  const SLIDERS = [
    { k: 'spend', label: '月支出', min: 500, max: 60000, step: 100, unit: ' 元' },
    { k: 'r', label: '名义收益率 r', min: 0, max: 12, step: 0.1, unit: '%' },
    { k: 'cpi', label: 'CPI 通胀', min: 0, max: 8, step: 0.1, unit: '%' },
    { k: 'swr', label: '安全提取率', min: 1, max: 8, step: 0.1, unit: '%' }
  ];

  function chartSvg(res) {
    const W = 640, H = 230, L = 54, R = 14, T = 12, B = 30;
    const YMAX = Math.max(1600, Math.ceil((res.ySpend / 0.0015 > 1600 ? 1600 : res.ySpend / 0.02) / 400) * 400);
    const pw = W - L - R, ph = H - T - B;
    const X = rr => L + rr / 0.04 * pw;
    const Y = v => T + (1 - F.clamp(v / YMAX, 0, 1)) * ph;
    const grid = [0, 400, 800, 1200, 1600].filter(v => v <= YMAX);
    const pts = res.chart.filter(p => p.v <= YMAX);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p.rr).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ');
    const cur = F.clamp(res.rReal, 0, 0.04), cv = cur > 0 ? res.ySpend / cur : YMAX;
    return '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="本金需求对真实收益率的敏感性曲线">' +
      grid.map(v => '<line x1="' + L + '" y1="' + Y(v) + '" x2="' + (W - R) + '" y2="' + Y(v) + '" stroke="var(--line)" stroke-width="1"/>' +
        '<text x="' + (L - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end" font-size="10" fill="var(--muted)">' + v + '</text>').join('') +
      [0, 1, 2, 3, 4].map(v => '<line x1="' + X(v / 100) + '" y1="' + T + '" x2="' + X(v / 100) + '" y2="' + (H - B) + '" stroke="var(--line)" stroke-width="1"/>' +
        '<text x="' + X(v / 100) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="10" fill="var(--muted)">' + v + '%</text>').join('') +
      '<path d="' + d + '" fill="none" stroke="var(--brand)" stroke-width="2.4" stroke-linejoin="round"/>' +
      (cur > 0 && cv <= YMAX ? '<line x1="' + X(cur) + '" y1="' + T + '" x2="' + X(cur) + '" y2="' + (H - B) + '" stroke="var(--amber)" stroke-width="1.5" stroke-dasharray="4 4"/>' +
        '<circle cx="' + X(cur) + '" cy="' + Y(cv) + '" r="5" fill="var(--amber)" stroke="var(--surface)" stroke-width="2"/>' +
        '<text x="' + (X(cur) + 9) + '" y="' + (Y(cv) - 8) + '" font-size="11" fill="var(--amber)" font-weight="700">当前 ' + (cur * 100).toFixed(2) + '%</text>' : '') +
      '<text x="' + L + '" y="' + (T + 4) + '" font-size="10" fill="var(--muted)">本金（万）</text></svg>';
  }

  function liveHtml(s) {
    const res = M.compute(s.calculator);
    let h = '';
    /* 账单通胀 */
    h += U.sectionTitle('π', '我的账单通胀', '四类支出按不同锚点加权，而不是拍一个常数');
    h += U.card({
      title: '个人账单通胀 π = ' + F.pct(res.pi, 2), icon: 'chart',
      sub: '真实收益率 rReal = (1 + r) ÷ (1 + π) − 1 = ' + F.pct(res.rReal * 100, 2),
      body: U.table({
        head: ['类别', { t: '金额', num: true }, { t: '权重', num: true }, '通胀锚点', { t: '锚点值', num: true }],
        rows: res.parts.map(x => [F.esc(x.name), { t: F.money(x.amt), num: true }, { t: F.pct(x.w), num: true }, F.esc(x.anchor), { t: F.pct(x.g), num: true }])
          .concat([{ cls: 'total', cells: ['合计 / 加权', { t: F.money(res.p.spend), num: true }, { t: '100%', num: true }, 'π = Σ(金额 × 锚点) ÷ 月支出', { t: F.pct(res.pi, 2), num: true }] }])
      }) + U.callout('<b>为什么不用 CPI 直接代替：</b>房租、饮食、医疗的长期涨幅并不同步，医疗通常显著高于 CPI。按自己的账单结构加权，得到的才是你真正要跑赢的通胀。', 'info')
    });

    /* 三口径 */
    h += U.sectionTitle('3', '三档本金需求', '三种互不替代的口径并列，分母各不相同');
    h += '<div class="tier-grid">' + res.tiers.map(t =>
      '<div class="tier"><div class="tier-head"><span class="tier-num">' + t.tag + '</span>' + U.tag(t.short, t.tone) + '</div>' +
      '<div class="tier-name">' + F.esc(t.name) + '</div>' +
      '<div class="tier-total' + (t.feasible ? '' : ' impossible') + '">' + (t.feasible ? F.wan(t.total, 0) : '无法实现') + '</div>' +
      '<small>生活池 ' + (t.feasible ? F.wan(t.life, 0) : '—') + ' + 专项池 ' + F.wan(res.pools, 0) + '</small>' +
      U.bar(t.bar, t.tone === 'amber' ? 'amber' : t.tone === 'mint' ? 'mint' : 'blue') +
      '<div class="tier-years"><b>' + F.esc(t.years) + '</b><p>' + F.esc(t.yearNote) + '</p></div>' +
      '<details class="fold" style="margin-top:10px;box-shadow:none"><summary style="padding:9px 11px;min-height:38px;font-size:11.5px">逐行计算式</summary><div class="fold-body" style="padding:8px 11px">' +
      t.rows.map(r => '<div class="frow"><span class="flab">' + F.esc(r[0]) + '</span><span class="fexp">' + F.esc(r[1]) + ' = <b>' + F.esc(r[2]) + '</b></span></div>').join('') +
      (t.feasible ? '<div class="frow grand"><span class="flab">合计</span><span class="fexp">= <b>' + F.wan(t.total, 0) + '</b></span></div>' : '') +
      '<div class="muted-sm" style="margin-top:8px">' + F.esc(res.childNote) + '</div></div></details>' +
      '</div>').join('') + '</div>';
    h += U.card({ body: U.callout('<b>口径说明：</b>' + F.esc(res.note), 'info') });

    /* 敏感性 */
    h += U.sectionTitle('∿', '敏感性曲线', '生活池本金 = 年支出 ÷ 真实收益率；分母越小，需求越陡');
    h += U.card({ body: '<div class="chart-box">' + chartSvg(res) + '</div>' +
      U.callout('当前名义收益 <b>' + res.p.r + '%</b>、个人账单通胀 <b>' + F.pct(res.pi, 2) + '</b>、真实收益 <b>' + F.pct(res.rReal * 100, 2) + '</b>。收益率每降 0.5pp，本金需求就会大幅上升——这也是为什么体检页要检查组合撑不撑得住 4% 假设。', 'warn') });

    /* 模型说明 */
    h += U.sectionTitle('?', '模型说明与数据来源', '展开可看每一条口径的依据');
    const glos = [
      ['4% 法则与安全提取率', 'Trinity Study 的 4% 初始提取率对应 30 年、股债混合组合。国内因波动与寿命预期，实务常用 3~3.5%。T1 允许本金慢慢花，用 ySpend ÷ SWR 直接算。'],
      ['本金不动 · CPI 档', '要求组合收益覆盖 CPI 后仍有剩余，分母 = r − CPI。对 r − CPI 极度敏感：r=4%、CPI=2% 时生活池 = 年支出 ÷ 2% = 50 倍年支出；CPI 升到 4% 时分母归零，公式失效。'],
      ['个人账单通胀 π 的锚点', '房租取 CPI+0.5pp（租约重签滞后但长期偏紧）、饮食 CPI−0.5pp、医疗 CPI+2.5pp（医疗价格长期跑赢一般物价）、其他 ≈CPI。四类按你的实际金额加权，不是固定常数。'],
      ['育儿池为什么折现、健康池为什么不折', '育儿成本按 18 年摊平，用真实收益率做年金现值折现；健康支出时点不可预测且不该被投资收益打折，按原值全额计入，属于保守处理。'],
      ['逐年模拟', 'P(n+1) = P(n) × (1 + rReal) + 年结余，全部折算为今天的购买力；未计市场波动序列与一次性收支。最多模拟 99 年。'],
      ['数据来源', '育儿成本量级参考《中国生育成本报告》（上海约 108 万/孩）；CPI 长期量级参考 1980~2025 约 7 倍、2000 年后年均约 2.0%。均为可调参数，请按自己的判断覆盖。']
    ];
    h += glos.map(g => U.card({ collapsible: true, collapsed: true, title: g[0], body: '<p class="muted-sm">' + F.esc(g[1]) + '</p>' })).join('');
    return h;
  }

  CJ.views.calculator = {
    title: '计算器', sub: 'FIRE 三口径 · 真实收益率 · 逐年模拟',
    render(s) {
      const c = s.calculator;
      let h = U.card({
        cls: 'card-hero', title: '模型参数', icon: 'calculator',
        sub: '数字框与滑块双向联动；内部金额统一按「万」计算，UI 单位已标注',
        actions: U.btn('恢复默认', { tone: 'ghost', small: true, icon: 'refresh', act: 'reset-calc' }),
        body: M.GROUPS.map(g =>
          '<h4 style="font-size:12px;color:var(--muted);margin:14px 0 8px">' + g + '</h4>' +
          '<div class="field-grid">' + M.FIELDS.filter(f => f.group === g).map(f => U.field({
            k: f.k, label: f.label, value: c[f.k], unit: f.unit, min: f.min, max: f.max, step: f.step
          })).join('') + '</div>').join('') +
          '<div class="divider"></div><h4 style="font-size:12px;color:var(--muted);margin:0 0 4px">快速微调</h4>' +
          SLIDERS.map(x => U.slider({ k: x.k, label: x.label, min: x.min, max: x.max, step: x.step, value: c[x.k], unit: x.unit })).join('')
      });
      h += '<div id="calc-live" data-live>' + liveHtml(s) + '</div>';
      return h;
    },
    live: liveHtml,
    mount(root, s) {
      const inputs = root.querySelectorAll('.card-hero input[data-k]');
      inputs.forEach(el => el.addEventListener('input', () => {
        const k = el.dataset.k, v = F.parse(el.value);
        if (!isFinite(v)) return;
        CJ.store.commit(st => { st.calculator[k] = v; }, { silent: true });
        /* 同步另一半控件（数字 ↔ 滑块） */
        root.querySelectorAll('.card-hero input[data-k="' + k + '"]').forEach(other => { if (other !== el) other.value = v; });
        const sl = SLIDERS.find(x => x.k === k), sv = root.querySelector('#sv-' + k);
        if (sv) sv.textContent = String(v) + (sl && sl.unit ? sl.unit : '');
        const live = root.querySelector('#calc-live'); if (live) live.innerHTML = liveHtml(CJ.store.state);
      }));
      root.querySelector('[data-act="reset-calc"]').onclick = async () => {
        if (await U.confirm('把 15 个模型参数恢复为默认值？', { title: '恢复默认' })) {
          CJ.store.commit(st => { st.calculator = F.deepClone(M.DEFAULTS); }, { reason: 'calc-reset' });
          U.toast('已恢复默认参数');
        }
      };
    }
  };
})(window.CJ);
