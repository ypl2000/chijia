/* chijia v3 · 分析页
   v1 的 2.x + 双口径 3.x 全量恢复，且全部由真实流水 / 资产动态计算；
   新增「可解释洞察」：确定性规则引擎，每条结论带数值依据，不使用生成式模型。 */
window.CJ = window.CJ || {};
window.CJ.views = window.CJ.views || {};
(function (CJ) {
  'use strict';
  const U = CJ.ui, F = CJ.fmt;

  /* 确定性洞察：可复现、可解释、无幻觉；不做云上 AI 摘要 */
  function insights(s, ag, prof) {
    const out = [];
    if (!ag) return out;
    const txns = s.txns || [];
    const outs = txns.filter(t => t.dc === 'D');
    /* ① 周期性订阅 */
    const subMap = {};
    outs.filter(t => /会员|订阅|自动扣款|连续包月|月付|自动续费|VIP/i.test(t.rest || '')).forEach(t => {
      const key = (t.rest || '').split(/交易流水号|订单编号|\|/)[0].trim().slice(0, 18);
      subMap[key] = subMap[key] || { n: 0, sum: 0, months: {} };
      subMap[key].n++; subMap[key].sum += t.amt; subMap[key].months[t.d.slice(0, 7)] = 1;
    });
    const subs = Object.keys(subMap).map(k => ({ name: k, ...subMap[k], m: Object.keys(subMap[k].months).length })).filter(x => x.m >= 2);
    if (subs.length) {
      const total = subs.reduce((a, x) => a + x.sum, 0);
      out.push({ tone: 'info', title: '周期性订阅 ' + subs.length + ' 项', value: F.money(total / ag.months) + ' 元/月',
        body: '识别到跨月重复扣款：' + subs.slice(0, 4).map(x => F.esc(x.name) + '（' + x.m + ' 个月 / ' + F.money(x.sum) + ' 元）').join('、') + '。合计 ' + F.money(total) + ' 元 ÷ ' + ag.months + ' 个月 = 月均 ' + F.money(total / ag.months) + ' 元。',
        formula: '按摘要关键词命中 + 同一对手出现在 ≥2 个自然月 → 判为周期性；月均 = 命中金额合计 ÷ 流水跨度月数' });
    }
    /* ② 疑似涨价 */
    const byCp = {};
    outs.forEach(t => {
      const k = (t.rest || '').split(/交易流水号|订单编号|\|/)[0].trim().slice(0, 18);
      if (!k) return; byCp[k] = byCp[k] || []; byCp[k].push({ d: t.d, amt: t.amt });
    });
    const rises = Object.keys(byCp).map(k => {
      const a = byCp[k].sort((x, y) => x.d < y.d ? -1 : 1);
      return a.length >= 2 && a[a.length - 1].amt > a[0].amt * 1.15 ? { k, first: a[0], last: a[a.length - 1] } : null;
    }).filter(Boolean).slice(0, 3);
    rises.forEach(x => out.push({ tone: 'warn', title: '疑似涨价：' + F.esc(x.k), value: '+' + F.pct((x.last.amt / x.first.amt - 1) * 100),
      body: '首次 ' + x.first.d + ' 为 ' + F.money2(x.first.amt) + ' 元，最近 ' + x.last.d + ' 为 ' + F.money2(x.last.amt) + ' 元，涨幅 ' + F.pct((x.last.amt / x.first.amt - 1) * 100) + '。',
      formula: '同一对手出现 ≥2 笔且末笔金额 > 首笔 ×1.15 → 提示；涨幅 = (末笔 ÷ 首笔 − 1) × 100%' }));
    /* ③ 大额异常（3σ） */
    if (outs.length > 5) {
      const mean = ag.totalOut / outs.length;
      const sd = Math.sqrt(outs.reduce((a, t) => a + Math.pow(t.amt - mean, 2), 0) / outs.length);
      const anomalies = outs.filter(t => t.amt > mean + 3 * sd).sort((a, b) => b.amt - a.amt).slice(0, 3);
      if (anomalies.length) out.push({ tone: 'warn', title: '偏离常态的大额支出 ' + anomalies.length + ' 笔', value: F.money(anomalies.reduce((a, t) => a + t.amt, 0)) + ' 元',
        body: anomalies.map(t => t.d + ' ' + F.money2(t.amt) + ' 元 ' + F.esc((t.rest || '').slice(0, 22))).join('；') + '。',
        formula: '笔均 ' + F.money2(mean) + ' 元，标准差 ' + F.money2(sd) + ' 元；阈值 = 均值 + 3σ = ' + F.money2(mean + 3 * sd) + ' 元' });
    }
    /* ④ 结余率趋势 */
    if (ag.monthly.length >= 4) {
      const half = Math.floor(ag.monthly.length / 2);
      const a = ag.monthly.slice(0, half), b = ag.monthly.slice(-half);
      const rate = arr => { const i = arr.reduce((x, m) => x + m.in, 0), o = arr.reduce((x, m) => x + m.out, 0); return i > 0 ? (i - o) / i * 100 : 0; };
      const r1 = rate(a), r2 = rate(b), d = r2 - r1;
      out.push({ tone: d >= 0 ? 'good' : 'warn', title: '结余率' + (d >= 0 ? '改善' : '走弱'), value: (d >= 0 ? '+' : '') + d.toFixed(1) + 'pp',
        body: '前半段 ' + F.pct(r1) + ' → 最近 ' + half + ' 个月 ' + F.pct(r2) + '，变化 ' + (d >= 0 ? '+' : '') + d.toFixed(1) + ' 个百分点。',
        formula: '结余率 = (区间入账 − 区间支出) ÷ 区间入账；按流水月份前后各半分段比较' });
    }
    /* ⑤ 计划偏离 */
    const planSpend = s.plan.spend;
    if (planSpend > 0 && ag.avgOut > 0) {
      const dev = (ag.avgOut / planSpend - 1) * 100;
      if (Math.abs(dev) > 15) out.push({ tone: Math.abs(dev) > 40 ? 'bad' : 'warn', title: '实际支出与计划偏离 ' + (dev > 0 ? '+' : '') + dev.toFixed(0) + '%', value: F.money(ag.avgOut) + ' 元/月',
        body: '流水实算月均支出 ' + F.money(ag.avgOut) + ' 元，计划参数填的是 ' + F.money(planSpend) + ' 元。建议回「计划」页把月消费改成真实值，否则逐月执行表会失真。',
        formula: '偏离 = (流水月均支出 ÷ 计划月消费 − 1) × 100%；流水月均 = 支出合计 ÷ 跨度月数' });
    }
    /* ⑥ 应急垫 */
    const hb = CJ.health.breakdown(s, ag);
    if (hb.liqMonths < 6) out.push({ tone: hb.liqMonths < 3 ? 'bad' : 'warn', title: '应急垫仅 ' + hb.liqMonths.toFixed(1) + ' 个月', value: '建议 ≥ 6',
      body: '可随时调度 ' + F.money(hb.liquid) + ' 元 ÷ 月支出 ' + F.money(hb.monthlyExpense) + ' 元 = ' + hb.liqMonths.toFixed(1) + ' 个月，还差 ' + F.money(Math.max(0, 6 * hb.monthlyExpense - hb.liquid)) + ' 元。',
      formula: '应急月数 = (基金 + 安全垫 + 预备 + 银行活期) ÷ 月支出；目标 6 个月' });
    return out;
  }

  function insightCard(list) {
    if (!list.length) return U.card({ title: '检查结果', icon: 'spark', body: U.empty('暂无可提示的异常', '导入流水后，规则引擎会自动检查订阅、异常支出与计划偏离') });
    return U.card({
      title: '洞察 · 可解释规则引擎', icon: 'spark',
      sub: '全部由本机确定性规则计算，每条附数值依据与计算式；不调用任何云端模型',
      body: list.map(x => '<div class="light light-' + (x.tone === 'bad' ? 'bad' : x.tone === 'warn' ? 'warn' : 'good') + '" style="margin-bottom:9px">' +
        '<span class="bulb"></span><div class="light-body"><b>' + x.title + '</b><span class="light-verdict">' + F.esc(x.value) + '</span>' +
        '<p>' + x.body + '</p>' + U.foldNote(x.formula) + '</div></div>').join('')
    });
  }
  U.foldNote = t => '<details class="fold" style="margin:8px 0 0;box-shadow:none"><summary style="padding:8px 11px;min-height:36px;font-size:11.5px;font-weight:600">查看计算式</summary><div class="fold-body" style="padding:8px 11px"><span class="muted-sm">' + F.esc(t) + '</span></div></details>';

  CJ.views.analysis = {
    title: '分析', sub: '流水统计 · 消费画像 · 双口径健康度',
    render(s) {
      const txns = s.txns || [];
      const ag = txns.length ? CJ.statement.aggregate(txns, s.importer) : null;
      const prof = ag ? CJ.statement.profile(ag, txns, s.importer) : null;
      if (ag) ag.profile = prof;
      const habits = ag ? CJ.statement.habits(ag, s) : null;
      const health = CJ.health.compute(s, ag);
      let h = '';

      /* 概况 */
      h += U.card({
        cls: 'card-hero', title: '流水概况', icon: 'analysis',
        sub: s.meta.statsDim + (ag ? ' · ' + ag.dMin + ' ~ ' + ag.dMax : ''),
        actions: U.btn('导入流水', { tone: 'primary', small: true, icon: 'upload', act: 'go-import' }),
        body: ag ? '<div class="kpi-grid">' +
          U.kpi({ label: '解析笔数', value: F.money(ag.count), note: ag.months + ' 个自然月', tone: 'blue' }) +
          U.kpi({ label: '入账合计', value: F.money(ag.totalIn), note: F.money(ag.nIn) + ' 笔 · 月均 ' + F.money(ag.avgIn), tone: 'mint' }) +
          U.kpi({ label: '支出合计', value: F.money(ag.totalOut), note: F.money(ag.nOut) + ' 笔 · 月均 ' + F.money(ag.avgOut), tone: 'amber' }) +
          U.kpi({ label: '净流入', value: F.money(ag.net), note: '结余率 ' + F.pct(ag.savingRate), tone: ag.net >= 0 ? 'mint' : 'coral' }) +
          '</div>' : U.empty('还没有导入流水', '导入后 2.1~2.5 会由真实交易实时生成；3.x 健康度仍可基于账本资产评分')
      });

      if (ag) {
        /* 2.1 收入构成 + 季度 */
        const label = { salary: '月薪工资', bonus: '年终奖 / 激励', sub: '补贴 / 报销' };
        const tone = { salary: 'blue', bonus: 'amber', sub: 'mint' };
        const incRows = ['salary', 'bonus', 'sub'].map(c => {
          const ys = Object.keys(ag.emp[c]).sort();
          if (!ys.length) return null;
          const n = ys.reduce((a, y) => a + ag.emp[c][y].length, 0);
          const sum = ys.reduce((a, y) => a + ag.emp[c][y].reduce((x, t) => x + t.amt, 0), 0);
          return [U.tag(label[c], tone[c]), { t: F.money(n), num: true }, { t: F.money(sum), num: true },
            ys.map(y => y + '（' + ag.emp[c][y].length + ' 笔 / ' + F.money(ag.emp[c][y].reduce((x, t) => x + t.amt, 0)) + '）').join('；')];
        }).filter(Boolean);
        const qk = Object.keys(ag.quarters).sort();
        const maxQ = qk.length ? Math.max(...qk.map(k => ag.quarters[k].sum)) : 1;
        h += U.sectionTitle('2.1', '收入结构', '按雇主关键词 + 摘要关键词自动分类');
        h += U.card({ body: U.table({ head: ['类别', { t: '笔数', num: true }, { t: '合计（元）', num: true }, '分年明细'], rows: incRows }) +
          (qk.length ? '<h4 style="font-size:13px;margin:16px 0 4px">补贴 / 报销季度统计</h4>' +
            U.table({ head: ['季度', { t: '笔数', num: true }, { t: '合计（元）', num: true }, { t: '单笔区间', num: true }, { t: '季度分布', w: '150px' }],
              rows: qk.map(k => { const q = ag.quarters[k]; return [k, { t: F.money(q.n), num: true }, { t: F.money(q.sum), num: true }, { t: q.n > 1 ? F.money2(q.min) + '~' + F.money2(q.max) : F.money2(q.min), num: true }, { bar: Math.round(q.sum / maxQ * 100) }]; })
                .concat([{ cls: 'total', cells: ['合计', { t: F.money(qk.reduce((a, k) => a + ag.quarters[k].n, 0)), num: true }, { t: F.money(qk.reduce((a, k) => a + ag.quarters[k].sum, 0)), num: true }, { t: '—', num: true }, '月均 ≈' + F.money(qk.reduce((a, k) => a + ag.quarters[k].sum, 0) / ag.months)] }]) }) +
            U.callout('<b>读数：</b>补贴 / 报销多为脉冲式小额入账——只能当缓冲，不进收入基本盘。', 'info') : U.callout('统计区间内未识别到补贴 / 报销类入账。', 'info'))
        });

        /* 2.2 大额支出 */
        h += U.sectionTitle('2.2', '大额支出 Top ' + ag.big.length, '金额 ≥ ' + F.money(s.importer.bigExpenseMin) + ' 元，按金额降序');
        h += U.card({ body: ag.big.length ? U.table({ head: [{ t: '#', num: true }, '日期', { t: '类别', num: false }, { t: '金额（元）', num: true }, '对方户名 / 摘要'], rows: ag.big.map((t, i) => [i + 1, t.d, U.tag(CJ.statement.guessCat(t.rest), 'gray'), { t: F.money2(t.amt), num: true }, F.esc(t.rest.split(/交易流水号|订单编号|\|/)[0].trim().slice(0, 56) || '—')]) }) : U.empty('没有超过阈值的大额支出') });

        /* 2.3 月度趋势 */
        h += U.sectionTitle('2.3', '月度趋势', '按流水自然月汇总，净额 = 入账 − 支出');
        h += U.card({ body: U.sparkline(ag.monthly.map(m => m.out), { h: 110 }) +
          '<div class="muted-sm" style="margin-bottom:6px">支出走势（' + ag.monthly.length + ' 个月）</div>' +
          U.table({ head: ['月份', { t: '入账', num: true }, { t: '支出', num: true }, { t: '净额', num: true }, { t: '笔数', num: true }, '走势'], rows: ag.monthly.map(m => [m.ym, { t: F.money(m.in), num: true }, { t: F.money(m.out), num: true }, { t: '<span class="' + (m.net >= 0 ? '' : 'neg') + '">' + F.money(m.net) + '</span>', num: true }, { t: F.money(m.n), num: true }, { bar: Math.round(m.out / Math.max(1, Math.max(...ag.monthly.map(x => x.out))) * 100) }]) }) });

        /* 2.4 消费画像 */
        h += U.sectionTitle('2.4', '消费画像', '由真实流水推导，不再是写死的示例卡片');
        h += U.card({ body: '<div class="kpi-grid">' + prof.cards.map(c => U.kpi({ label: c.title, value: c.value, note: c.desc, tone: c.tone === 'coral' ? 'coral' : c.tone === 'mint' ? 'mint' : c.tone === 'green' ? 'mint' : c.tone === 'gray' ? undefined : 'blue' })).join('') + '</div>' +
          '<h4 style="font-size:13px;margin:14px 0 4px">支出类别分布</h4>' +
          U.stack(prof.cats.slice(0, 7).map((c, i) => ({ label: c.name, pct: c.share, color: ['#3b6ef6', '#16b47f', '#f0a637', '#8f6bd6', '#14b8a6', '#ef6b6b', '#9aa6bb'][i] }))) +
          U.table({ head: ['类别', { t: '笔数', num: true }, { t: '金额', num: true }, { t: '占比', num: true }], rows: prof.cats.map(c => [F.esc(c.name), { t: F.money(c.n), num: true }, { t: F.money(c.sum), num: true }, { t: F.pct(c.share), num: true }]) }) +
          '<h4 style="font-size:13px;margin:14px 0 4px">往来对手 Top ' + prof.cps.length + '</h4>' +
          U.table({ cls: 'compact', head: ['对手 / 摘要', { t: '笔数', num: true }, { t: '金额', num: true }], rows: prof.cps.map(c => [F.esc(c.name), { t: F.money(c.n), num: true }, { t: F.money(c.sum), num: true }]) })
        });

        /* 2.5 资金管理习惯 */
        h += U.sectionTitle('2.5', '资金管理习惯', '现金流闭环与理财梯队，按当前账本与流水实算');
        h += U.card({ body: '<div class="step-list">' + habits.flow.map((x, i) => '<div class="step" style="cursor:default"><span class="step-no">' + (i + 1) + '</span><span><b>' + F.esc(x.t) + '</b><p>' + F.esc(x.d) + '</p></span></div>').join('') + '</div>' +
          '<h4 style="font-size:13px;margin:16px 0 8px">理财梯队</h4>' +
          habits.tiers.map(t => '<div style="margin-bottom:10px"><div class="slider-top"><span>' + F.esc(t.label) + ' · ' + F.esc(t.name) + '</span><b>' + F.esc(t.note) + '</b></div>' + U.bar(t.w, 'blue') + '</div>').join('')
        });
      }

      /* 洞察 */
      h += U.sectionTitle('◎', '洞察', '本机规则引擎 · 无云端推理 · 结论可复现');
      h += insightCard(insights(s, ag, prof));

      /* 3.x 双口径健康度 */
      h += U.sectionTitle('3', '健康度双口径评估', '由资产 + 流水 + 计划实算；导入流水后本区自动重算');
      h += U.card({
        cls: 'card-hero', title: '结构读数', icon: 'shield',
        body: U.callout(health.readout, 'info') +
          '<div class="kv"><span>可投资产口径</span><b>' + health.invScore + ' / 100 · ' + health.invVerdict + '</b></div>' +
          '<div class="kv"><span>总资产口径</span><b>' + health.assetScore + ' / 100 · ' + health.assetVerdict + '</b></div>' +
          '<div class="kv"><span>折扣读数</span><b style="font-weight:500;max-width:70%;text-align:right">' + F.esc(health.discount) + '</b></div>'
      });
      const scoreTable = rows => U.table({
        head: ['维度', { t: '评价', w: '120px' }, { t: '分值', num: true }, '依据（实算）'],
        rows: rows.map(r => [F.esc(r.name), { t: '<span class="stars">' + r.stars + '</span>' }, { t: Math.round(r.v), num: true }, F.esc(r.note)])
      });
      h += U.card({
        title: '3.3 可投资产口径 · 7 维评分', icon: 'chart',
        sub: '仅统计可随时调度的金融资产与过程管理',
        body: scoreTable(health.inv) + U.callout('<b>一句话总结：</b>' + health.invVerdict + '。总资产口径的完整再评价见下。', 'info')
      });
      h += U.card({
        title: '3.4 总资产口径 · 7 维再评价', icon: 'shield',
        sub: '车按残值、股权按成本、公积金按余额（限住房用途，不计后续缴存）',
        body: scoreTable(health.asset) +
          U.callout('<b>总评：</b>' + health.assetVerdict + '。把金融流动资产占比从 ' + F.pct(health.b.liquidRatio) + ' 做到 ' + F.pct(health.futRatio) + ' 是这一期的主线。', 'good') +
          U.callout('<b>执行期纪律：</b>不再新增不可变现资产，让结构自己修复。', 'warn')
      });
      return h;
    },
    mount(root) {
      root.querySelectorAll('[data-act="go-import"]').forEach(b => b.onclick = () => CJ.app.go('settings', { hook: 'import' }));
    }
  };
})(window.CJ);
