/* chijia v3 · 计划页（v1 的 1.1~1.5 全量恢复 + 参数实时联动） */
window.CJ = window.CJ || {};
window.CJ.views = window.CJ.views || {};
(function (CJ) {
  'use strict';
  const U = CJ.ui, F = CJ.fmt;

  const FIELDS = [
    { k: 'start', label: '起始月份', type: 'text', hint: 'YYYY-MM' },
    { k: 'months', label: '推演月数', unit: '月', min: 1, max: 360 },
    { k: 'income', label: '月收入', unit: '元', min: 0, step: 100 },
    { k: 'spend', label: '月消费', unit: '元', min: 0, step: 100 },
    { k: 'invest', label: '月定投', unit: '元', min: 0, step: 100 },
    { k: 'cushion', label: '安全垫月投', unit: '元', min: 0, step: 100 },
    { k: 'cushionCap', label: '安全垫上限', unit: '元', min: 0, step: 1000 },
    { k: 'esop', label: 'ESOP 预备月投', unit: '元', min: 0, step: 100 },
    { k: 'fundsBase', label: '基金存量', unit: '元', min: 0, step: 1000 },
    { k: 'bankKeep', label: '保留银行余额', unit: '元', min: 0, step: 1000 },
    { k: 'depreciation', label: '期间折旧', unit: '元', min: 0, step: 1000 }
  ];

  function liveHtml(s) {
    const p = s.plan, eng = CJ.plan.computePlan(p), exp = CJ.plan.expectedAssets(s, eng);
    let h = '';
    /* 1.1 */
    const alloc = [
      { label: '消费', v: p.spend, color: '#9aa6bb' }, { label: '定投', v: p.invest, color: '#3b6ef6' },
      { label: '安全垫', v: p.cushion, color: '#16b47f' }, { label: 'ESOP 预备', v: p.esop, color: '#f0a637' }
    ];
    const pcs = F.largestRemainderPct(alloc.map(x => x.v), p.income || 1);
    alloc.forEach((x, i) => x.pct = pcs[i]);
    h += U.sectionTitle('1.1', '每月资金使用计划', '每月可支配切为四份，改参数即整块重算');
    h += U.card({
      title: '四池分配', icon: 'chart',
      body: '<div class="kpi-grid">' +
        U.kpi({ label: '月收入', value: F.money(p.income), tone: 'blue', note: '税前/到手按你的口径' }) +
        U.kpi({ label: '可支配', value: F.money(eng.disposable), note: '收入 − 消费', tone: 'mint' }) +
        U.kpi({ label: '三池合计', value: F.money(eng.pools), note: '定投 + 安全垫 + 预备', tone: 'amber' }) +
        U.kpi({ label: '结余校验', value: F.money(eng.disposable - eng.pools), note: eng.feasible ? '计划可行' : '参数不可行', tone: eng.feasible ? 'mint' : 'coral' }) +
        '</div>' +
        U.stack(alloc.map(x => ({ label: x.label, pct: x.pct, color: x.color }))) +
        U.table({
          head: ['池子', { t: '金额/月', num: true }, { t: '占收入', num: true }, '说明'],
          rows: alloc.map((x, i) => ({ cells: [U.tag(x.label, ['gray', 'blue', 'mint', 'amber'][i]), { t: F.money(x.v), num: true }, { t: F.pct(x.pct), num: true }, CJ.plan.POOLS.find(q => q.label === x.label) ? CJ.plan.POOLS.find(q => q.label === x.label).note : '日常开销'] }))
        }) +
        U.callout(eng.feasible
          ? '<b>校验通过：</b>三池合计 ' + F.money(eng.pools) + ' ≤ 可支配 ' + F.money(eng.disposable) + '，计划可行。'
          : '<b>参数不可行：</b>三池合计 ' + F.money(eng.pools) + ' &gt; 可支配 ' + F.money(eng.disposable) + '——请降低消费或削减某个池子。', eng.feasible ? 'good' : 'bad')
    });

    /* 1.2 逐月执行表 */
    let capHit = false;
    const rows12 = eng.rows.map(r => {
      const ev = []; let cls = '';
      (p.oneoffOut || []).filter(o => o.m === r.m).forEach(o => {
        if (o.pool === '现金') { cls = 'hl-bad'; ev.push(U.tag('支出', 'coral') + ' ' + F.esc(o.label) + ' ' + F.money(o.amt) + '（余额扣，不动模板）'); }
        else ev.push(U.tag(F.esc(o.label), 'coral') + ' ' + F.money(o.amt) + '（从预备扣）');
      });
      (p.oneoffIn || []).filter(o => o.m === r.m).forEach(o => ev.push(U.tag(F.esc(o.label), 'blue') + ' 若到账 +' + F.money(o.amt)));
      if (!capHit && r.cCum >= p.cushionCap) { capHit = true; cls = 'hl-good'; ev.push(U.tag('垫满', 'mint') + ' 后续月投并入预备'); }
      return { cls, cells: [r.ym, { t: F.money(r.invest), num: true }, { t: F.money(r.cM), num: true }, { t: F.money(r.cCum), num: true }, { t: F.money(r.eM), num: true }, { t: F.money(r.eCum), num: true }, ev.length ? ev.join(' ') : '<span class="muted">—</span>'] };
    });
    h += U.sectionTitle('1.2', '逐月执行表', '安全垫存满后，其月投自动并入 ESOP 预备（共 ' + p.months + ' 个月）');
    h += U.card({ body: U.table({ head: ['月份', { t: '定投', num: true }, { t: '垫月投', num: true }, { t: '垫累计', num: true }, { t: '预备月投', num: true }, { t: '预备累计', num: true }, '当月特殊事项'], rows: rows12 }) });

    /* 1.3 一次性收支 */
    const ymOf = m => m < eng.rows.length ? eng.rows[m].ym : '计划期后首月';
    h += U.sectionTitle('1.3', '一次性收入 & 支出规划', '均不计入基本盘；落地即超额完成');
    h += U.card({
      body:         U.table({ head: ['预计时点', '可能的大额收入', { t: '金额', num: true }, '去向'], rows: (p.oneoffIn || []).map(o => [ymOf(o.m), F.esc(o.label), { t: '+' + F.money(o.amt), num: true }, '按既定规则分配（退税 / 奖金 → 定投与预备）']) }) +
        ((p.oneoffIn || []).length ? '' : U.empty('暂无大额收入规划', '在参数面板里添加')) +
        '<div class="divider"></div>' +
        U.table({ head: ['预计时点', '可能的大额支出', { t: '金额', num: true }, '扣减来源'], rows: (p.oneoffOut || []).map(o => [ymOf(o.m), F.esc(o.label), { t: F.money(o.amt), num: true }, o.pool === '预备' ? '从 ESOP 预备扣，顺延目标' : '从银行余额扣，不动模板']) })
    });

    /* 1.4 期末预期 */
    h += U.sectionTitle('1.4', '期末预期仓位', '基本盘口径：不含一次性收入 / 市场涨跌');
    h += U.card({
      body: '<div class="kpi-grid">' +
        U.kpi({ label: '安全垫', value: F.money(eng.cushionFinal), note: '上限 ' + F.money(p.cushionCap), tone: 'mint' }) +
        U.kpi({ label: '基金持仓', value: F.money(eng.funds), note: '存量 + 定投 × ' + p.months, tone: 'blue' }) +
        U.kpi({ label: 'ESOP 预备金', value: F.money(eng.esopFinal), note: '含垫满溢出转入', tone: 'amber' }) +
        U.kpi({ label: '流动资产合计', value: F.money(eng.liquid), note: p.oneoffInTotal ? '一次性收入到账可再 +' + F.money(p.oneoffInTotal) : '不含一次性收入', tone: 'mint' }) +
        '</div>' +
        '<h4 style="font-size:13px;margin:14px 0 4px">期末资产构成 · ' + exp.endYM + '</h4>' +
        U.stack(exp.items.map(x => ({ label: x.name, pct: x.pc, color: x.color }))) +
        U.table({
          head: ['资产', { t: '现在', num: true }, { t: '期末', num: true }, { t: '占比', num: true }, '口径'],
          rows: exp.items.map(x => {
            const cur = s.overview.now.rows.find(r => x.kw.test(r.name));
            return [F.esc(x.name), { t: cur ? F.money(F.parse(cur.amt)) : '—', num: true }, { t: F.money(x.amt), num: true }, { t: F.pct(x.pc), num: true }, F.esc(x.note)];
          }).concat([{ cls: 'total', cells: ['合计', { t: F.money(exp.nowTotal), num: true }, { t: F.money(exp.total), num: true }, { t: '100%', num: true }, '占比按最大余额法，合计恒 100%'] }])
        })
    });

    /* 1.5 保护规则 */
    h += U.sectionTitle('1.5', '执行期保护规则', '写清边界，比多算一个月更重要');
    h += U.card({
      body: U.callout('<b>① 不挪垫：</b>安全垫存到 ' + F.money(p.cushionCap) + ' 即锁定，只用于失业 / 医疗 / 急用，不因为行情好就转去定投。', 'info') +
        U.callout('<b>② 不加杠杆：</b>不用信用卡分期、消费贷补定投；一次性支出优先从 ESOP 预备扣，扣不动就顺延目标，不破坏月度节奏。', 'info') +
        U.callout('<b>③ 不追涨：</b>基金按固定金额月投，收益假设只用于测算，不因为短期涨跌调整投入；每季复核一次参数即可。', 'info')
    });
    return h;
  }

  CJ.views.plan = {
    title: '计划', sub: '四池推演 · 逐月执行表 · 期末预期',
    render(s) {
      const p = s.plan;
      let h = U.card({
        cls: 'card-hero', title: '推演参数', icon: 'plan',
        sub: '改动任一参数，1.1~1.4 与期末构成立即重算（不刷新页面、不丢输入焦点）',
        actions: U.btn('编辑一次性收支', { tone: 'quiet', small: true, icon: 'plus', act: 'edit-oneoff' }) +
          U.btn('恢复默认', { tone: 'ghost', small: true, icon: 'refresh', act: 'reset-plan' }) +
          U.btn('发送到计算器', { tone: 'primary', small: true, icon: 'calculator', act: 'send-calc' }),
        body: '<div class="field-grid">' + FIELDS.map(f => U.field({
          k: f.k, label: f.label, value: p[f.k], type: f.type, unit: f.unit,
          min: f.min, max: f.max, step: f.step, hint: f.hint
        })).join('') + '</div>'
      });
      h += '<div id="plan-live" data-live>' + liveHtml(s) + '</div>';
      return h;
    },
    live: liveHtml,
    mount(root, s) {
      const inputs = root.querySelectorAll('.card-hero input[data-k]');
      inputs.forEach(el => el.addEventListener('input', () => {
        const k = el.dataset.k;
        const v = el.type === 'text' ? el.value : F.parse(el.value);
        if (el.type === 'number' && !isFinite(v)) return;
        CJ.store.commit(st => { st.plan[k] = v; if (k === 'spend') st.settings.monthlyExpense = v; }, { silent: true });
        const live = root.querySelector('#plan-live');
        if (live) live.innerHTML = liveHtml(CJ.store.state);
      }));
      root.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
        const a = b.dataset.act;
        if (a === 'reset-plan') {
          if (await U.confirm('恢复模板默认的计划参数？一次性收支也会一并重置。', { title: '恢复默认' })) {
            CJ.store.commit(st => { st.plan = F.deepClone(CJ.plan.DEFAULT_PLAN); }, { reason: 'plan-reset' });
            U.toast('已恢复默认参数');
          }
        } else if (a === 'send-calc') {
          CJ.store.commit(st => {
            const rows = st.overview.now.rows || [];
            st.calculator.p0 = rows.filter(r => !r.muted && /基金|银行|活期|现金|安全垫|预备/.test(r.name)).reduce((x, r) => x + F.parse(r.amt), 0);
            st.calculator.spend = st.settings.monthlyExpense || st.plan.spend;
            st.calculator.income = st.income.monthlyAvg || st.plan.income;
          }, { reason: 'prefill' });
          U.toast('已带入计算器'); CJ.app.go('calculator');
        } else if (a === 'edit-oneoff') openOneoff(s);
      });
    }
  };

  function openOneoff(s) {
    const p = s.plan;
    const row = (o, kind, i) => '<tr><td>' + (i + 1) + '</td><td>' + F.esc(o.label) + '</td><td class="num">' + F.money(o.amt) +
      '</td><td class="num">第 ' + (o.m + 1) + ' 月</td><td>' + (kind === 'out' ? F.esc(o.pool || '现金') : '—') +
      '</td><td><button class="btn btn-sm btn-ghost" data-del="' + kind + ':' + i + '">删除</button></td></tr>';
    const body = '<h4 style="font-size:13px;margin:0 0 6px">大额收入</h4>' +
      U.table({ cls: 'compact', head: ['#', '项目', { t: '金额', num: true }, '时点', '池', ''], rows: (p.oneoffIn || []).map((o, i) => row(o, 'in', i)) }) +
      '<div class="field-grid" style="margin-top:10px">' +
      U.field({ k: 'in-label', label: '项目名称', value: '', type: 'text', placeholder: '如：年终奖' }) +
      U.field({ k: 'in-amt', label: '金额', value: 0 }) +
      U.field({ k: 'in-m', label: '第几月', value: 1, min: 1 }) + '</div>' +
      U.btn('添加收入', { tone: 'quiet', small: true, act: 'add-in' }) +
      '<div class="divider"></div><h4 style="font-size:13px;margin:0 0 6px">大额支出</h4>' +
      U.table({ cls: 'compact', head: ['#', '项目', { t: '金额', num: true }, '时点', '扣减池', ''], rows: (p.oneoffOut || []).map((o, i) => row(o, 'out', i)) }) +
      '<div class="field-grid" style="margin-top:10px">' +
      U.field({ k: 'out-label', label: '项目名称', value: '', type: 'text', placeholder: '如：车险' }) +
      U.field({ k: 'out-amt', label: '金额', value: 0 }) +
      U.field({ k: 'out-m', label: '第几月', value: 1, min: 1 }) + '</div>' +
      '<label class="check-row">扣减来源 <select data-k="out-pool" style="width:auto;margin-left:8px"><option value="现金">银行现金</option><option value="预备">ESOP 预备</option></select></label>' +
      U.btn('添加支出', { tone: 'quiet', small: true, act: 'add-out' });
    const host = U.modal({ title: '编辑一次性收支', body });
    const val = k => { const e = host.querySelector('[data-k="' + k + '"]'); return e ? e.value : ''; };
    const refresh = () => { host.innerHTML = ''; openOneoff(CJ.store.state); };
    host.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const [kind, i] = b.dataset.del.split(':');
      CJ.store.commit(st => { st.plan[kind === 'in' ? 'oneoffIn' : 'oneoffOut'].splice(+i, 1); }, { silent: true });
      refresh();
    });
    host.querySelector('[data-act="add-in"]').onclick = () => {
      const label = val('in-label').trim(); if (!label) return U.toast('请填写项目名称', 'bad');
      CJ.store.commit(st => { st.plan.oneoffIn.push({ m: Math.max(0, F.parse(val('in-m')) - 1), label, amt: F.parse(val('in-amt')) }); }, { silent: true });
      refresh();
    };
    host.querySelector('[data-act="add-out"]').onclick = () => {
      const label = val('out-label').trim(); if (!label) return U.toast('请填写项目名称', 'bad');
      CJ.store.commit(st => { st.plan.oneoffOut.push({ m: Math.max(0, F.parse(val('out-m')) - 1), label, amt: F.parse(val('out-amt')), pool: val('out-pool') }); }, { silent: true });
      refresh();
    };
    const closeBtn = host.querySelector('.modal-actions .btn-quiet');
    if (closeBtn) closeBtn.onclick = () => { host.innerHTML = ''; CJ.app.refresh(); };
  }
})(window.CJ);
