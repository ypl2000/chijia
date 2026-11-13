/* chijia v3 · 资金计划四池月度推演（v1 引擎原样移植 + 期末构成动态化） */
window.CJ = window.CJ || {};
(function (CJ) {
  'use strict';
  const F = CJ.fmt;

  const DEFAULT_PLAN = {
    start: '2026-11', months: 8, income: 21000, spend: 6000,
    invest: 4000, cushion: 3000, cushionCap: 24000, esop: 5000,
    fundsBase: 30000, bankKeep: 6000, depreciation: 10000,
    oneoffIn: [
      { m: 1, label: '年终奖', amt: 60000 },
      { m: 4, label: '退税', amt: 8000 }
    ],
    oneoffOut: [
      { m: 0, label: '车险', amt: 6000, pool: '现金' },
      { m: 5, label: 'ESOP 认购', amt: 40000, pool: '预备' }
    ]
  };
  const POOLS = [
    { key: 'spend', label: '消费', cls: 'consume', note: '房租 + 饮食 + 其他日常' },
    { key: 'invest', label: '定投', cls: 'invest', note: '宽基指数 + 红利低波，按月自动扣' },
    { key: 'cushion', label: '安全垫', cls: 'cushion', note: '存到上限为止，货币 / T+0 锁定不动' },
    { key: 'esop', label: 'ESOP 预备', cls: 'esop', note: '下次认购窗口的弹药' }
  ];

  function computePlan(p) {
    const rows = [];
    let cCum = 0, eCum = 0;
    for (let m = 0; m < p.months; m++) {
      const ym = F.ymOf(p.start, m);
      const cLeft = Math.max(0, p.cushionCap - cCum);
      const cM = Math.min(p.cushion, cLeft);
      const eM = p.esop + (p.cushion - cM);          // 安全垫存满后溢出自动并入预备
      cCum += cM; eCum += eM;
      const evs = (p.oneoffOut || []).filter(o => o.m === m);
      const cut = evs.filter(o => o.pool === '预备').reduce((a, o) => a + o.amt, 0);
      eCum = Math.max(0, eCum - cut);                 // 一次性支出按池扣减，不为负
      rows.push({ m, ym, cM, cCum, eM, eCum, invest: p.invest, evs });
    }
    const funds = p.fundsBase + p.invest * p.months;
    const oneoffInTotal = (p.oneoffIn || []).reduce((a, o) => a + o.amt, 0);
    return {
      rows, funds, cushionFinal: cCum, esopFinal: eCum,
      liquid: cCum + funds + eCum + p.bankKeep, oneoffInTotal,
      disposable: p.income - p.spend,
      pools: p.invest + p.cushion + p.esop,
      feasible: (p.income - p.spend) >= (p.invest + p.cushion + p.esop)
    };
  }

  /* 期末七项资产：现值平移 + 计划推演值；占比用最大余额法保证合计 100% */
  function expectedAssets(state, eng) {
    const now = state.overview.now, p = state.plan;
    const rows = now.rows;
    const val = kw => { const r = rows.find(x => kw.test(x.name)); return r ? F.parse(r.amt) : 0; };
    const esopNow = val(/ESOP|虚拟股/), carNow = val(/固定资产|车/), gjj = val(/公积金/);
    const items = [
      { key: 'esop', kw: /ESOP|虚拟股/, name: '公司虚拟股 ESOP', amt: esopNow, color: '#f0a637', note: '按成本现值平移' },
      { key: 'car', kw: /固定资产|车/, name: '固定资产（汽车）', amt: Math.max(0, carNow - p.depreciation), color: '#8f6bd6', note: '扣除期间折旧 ' + F.money(p.depreciation) },
      { key: 'gjj', kw: /公积金/, name: '住房公积金', amt: gjj, color: '#14b8a6', note: '限用途，按余额' },
      { key: 'funds', kw: /基金/, name: '基金持仓', amt: eng.funds, color: '#3b6ef6', note: '存量 ' + F.money(p.fundsBase) + ' + 定投 ' + F.money(p.invest) + '×' + p.months },
      { key: 'reserve', kw: /预备/, name: 'ESOP 预备金', amt: eng.esopFinal, color: '#7c8cf8', note: '含安全垫溢出转入' },
      { key: 'cushion', kw: /安全垫/, name: '安全垫', amt: eng.cushionFinal, color: '#16b47f', note: '上限 ' + F.money(p.cushionCap) },
      { key: 'bank', kw: /银行|活期|现金/, name: '银行活期', amt: p.bankKeep, color: '#9aa6bb', note: '保留余额' }
    ];
    const total = items.reduce((a, x) => a + x.amt, 0);
    const pcs = F.largestRemainderPct(items.map(x => x.amt), total);
    items.forEach((x, i) => { x.pc = pcs[i]; });
    return { items, total, nowTotal: rows.reduce((a, r) => a + (r.muted || r.neg ? 0 : F.parse(r.amt)), 0), endYM: F.ymOf(p.start, p.months) };
  }

  function applyBalance(state, balance) {
    if (!isFinite(balance) || balance < 0) return null;
    const bank = state.overview.now.rows.find(r => /银行|活期|现金/.test(r.name) && !r.muted);
    const old = bank ? F.parse(bank.amt) : 0;
    if (bank) bank.amt = F.money2(balance);
    state.overview.now.bank = balance;
    return { delta: balance - old, total: state.overview.now.rows.reduce((a, r) => a + (r.muted || r.neg ? 0 : F.parse(r.amt)), 0) };
  }

  CJ.plan = { DEFAULT_PLAN, POOLS, computePlan, expectedAssets, applyBalance };
})(window.CJ);
