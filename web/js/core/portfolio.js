/* chijia v3 · 组合体检：v1 四维红绿灯 + 金额化建议 + v2 分散度（第五灯） */
window.CJ = window.CJ || {};
(function (CJ) {
  'use strict';
  const F = CJ.fmt;

  const BUCKETS = [
    { key: 'equity', label: '权益类', color: '#3b6ef6', note: '指数基金 / 股票' },
    { key: 'bond', label: '稳健类', color: '#16b47f', note: '债券 / 固收' },
    { key: 'cash', label: '现金类', color: '#9aa6bb', note: '活期 / 货币' },
    { key: 'esop', label: '公司股权', color: '#f0a637', note: 'ESOP / 虚拟股' },
    { key: 'consumer', label: '消费资产', color: '#8f6bd6', note: '车等，不产生收益' },
    { key: 'restricted', label: '限用途', color: '#14b8a6', note: '公积金等，不可调仓' }
  ];
  const DEFAULTS = {
    equity: 30000, bond: 0, cash: 20000, esop: 180000, consumer: 150000, restricted: 60000,
    equityR: 8, bondR: 3.5, cashR: 1.8, esopR: 6,
    years: 10, modelR: 4, monthlyExpense: 6000, monthlyInvest: 6000
  };

  function compute(s0) {
    const s = Object.assign({}, DEFAULTS, s0 || {});
    BUCKETS.forEach(b => { s[b.key] = F.parse(s[b.key]); });
    const income = s.equity + s.bond + s.cash + s.esop;
    const gross = income > 0
      ? (s.equity * s.equityR + s.bond * s.bondR + s.cash * s.cashR + s.esop * s.esopR) / income
      : null;
    const rEff = income > 0
      ? (s.equity * s.equityR + s.bond * s.bondR + s.cash * s.cashR + s.esop * s.esopR * 0.6) / income / 100
      : null;                                   // ESOP 收益 ×0.6：与工资同源，打折计
    const rNominal = gross === null ? null : gross / 100;
    const esopShare = income > 0 ? s.esop / income : 0;
    const equityShare = income > 0 ? (s.equity + s.esop) / income : 0;
    const liq = s.bond + s.cash;
    const liqMonths = s.monthlyExpense > 0 ? liq / s.monthlyExpense : null;
    let band;
    if (s.years > 15) band = [70, 90]; else if (s.years > 10) band = [50, 70];
    else if (s.years > 5) band = [30, 50]; else band = [20, 40];
    const parts = [s.equity, s.bond, s.cash, s.esop].map(v => income > 0 ? v / income : 0);
    const hhi = parts.reduce((a, x) => a + x * x, 0);   // 0.25 = 完全均分，1 = 全集中
    return { s, income, rNominal, rEff, esopShare, equityShare, liq, liqMonths, band, hhi };
  }

  const L = (level, verdict, detail) => ({ level, verdict, detail });
  function lights(c) {
    const s = c.s, p = x => F.pct(x);
    const out = [];
    /* 1 收益达标 —— v2 明确留白、v1 有的那一维 */
    if (c.rEff === null) out.push({ key: 'yield', name: '收益达标', ...L('bad', '无生息资产', '四个生息桶都是 0——先让钱进入组合。') });
    else {
      const diff = (c.rEff - s.modelR / 100) * 100;
      if (diff >= 0) out.push({ key: 'yield', name: '收益达标', ...L('good', '达标', '有效收益 ' + p(c.rEff) + ' ≥ 模型假设 ' + s.modelR + '%，组合撑得起这个假设。') });
      else if (diff >= -1) out.push({ key: 'yield', name: '收益达标', ...L('warn', '勉强', '比模型假设低 ' + Math.abs(diff).toFixed(2) + 'pp——调仓或微调假设二选一。') });
      else out.push({ key: 'yield', name: '收益达标', ...L('bad', '不达标', '有效收益 ' + p(c.rEff) + ' < 假设 ' + s.modelR + '%：据此测算的本金需求被低估了。') });
    }
    /* 2 单一集中度 */
    if (s.esop === 0) out.push({ key: 'concentration', name: '单一集中度', ...L('good', '无公司股权', '不持有与工资同源的公司股权——此项无风险。') });
    else if (c.esopShare <= 0.2) out.push({ key: 'concentration', name: '单一集中度', ...L('good', '健康', '占生息组合 ' + p(c.esopShare) + '（上限 20%）。') });
    else if (c.esopShare <= 0.4) out.push({ key: 'concentration', name: '单一集中度', ...L('warn', '偏高', '占生息组合 ' + p(c.esopShare) + '——收入与股权同源，回撤会同时打击两头。') });
    else out.push({ key: 'concentration', name: '单一集中度', ...L('bad', '过度集中', '占生息组合 ' + p(c.esopShare) + '——身家和职业押在同一雇主。') });
    /* 3 权益配比 */
    if (c.income === 0) out.push({ key: 'equity', name: '权益配比', ...L('bad', '无组合', '无生息资产，无配比可言。') });
    else {
      const [lo, hi] = c.band, share = c.equityShare * 100;
      if (share >= lo && share <= hi) out.push({ key: 'equity', name: '权益配比', ...L('good', '在目标区间', '权益 ' + p(c.equityShare) + '，目标 ' + lo + '~' + hi + '%（距提取 ' + s.years + ' 年）。') });
      else {
        const off = share < lo ? lo - share : share - hi;
        out.push({ key: 'equity', name: '权益配比', ...L(off <= 10 ? 'warn' : 'bad', (share < lo ? '低于' : '高于') + '目标区间', '权益 ' + p(c.equityShare) + '，目标 ' + lo + '~' + hi + '%，偏离 ' + off.toFixed(0) + 'pp。') });
      }
    }
    /* 4 流动性 / 应急覆盖 */
    if (s.monthlyExpense === 0) out.push({ key: 'liquidity', name: '流动性', ...L('warn', '未评估', '填写月支出后检查（现金 + 稳健 ≥ 6 个月支出）。') });
    else if (c.liqMonths >= 6) out.push({ key: 'liquidity', name: '流动性', ...L('good', '充足', '现金+稳健 ' + F.money(c.liq) + ' 元 ≈ ' + c.liqMonths.toFixed(1) + ' 个月支出。') });
    else if (c.liqMonths >= 3) out.push({ key: 'liquidity', name: '流动性', ...L('warn', '偏薄', '仅 ' + c.liqMonths.toFixed(1) + ' 个月支出，建议 ≥ 6。') });
    else out.push({ key: 'liquidity', name: '流动性', ...L('bad', '不足', '仅 ' + c.liqMonths.toFixed(1) + ' 个月支出——一次急用就要被迫卖权益。') });
    /* 5 分散度（v2 新增，v3 保留） */
    if (c.income === 0) out.push({ key: 'diversity', name: '分散度', ...L('warn', '未评估', '先生息资产入表。') });
    else if (c.hhi <= 0.35) out.push({ key: 'diversity', name: '分散度', ...L('good', '分散', '四类生息资产 HHI ' + c.hhi.toFixed(2) + '（越低越分散）。') });
    else if (c.hhi <= 0.6) out.push({ key: 'diversity', name: '分散度', ...L('warn', '略集中', 'HHI ' + c.hhi.toFixed(2) + '，某一类资产权重偏高。') });
    else out.push({ key: 'diversity', name: '分散度', ...L('bad', '高度集中', 'HHI ' + c.hhi.toFixed(2) + '，组合几乎压在一类资产上。') });
    return out;
  }

  function suggestions(c) {
    const s = c.s, p = x => F.pct(x), sug = [];
    const offLevel = (share, band) => (share < band[0] ? band[0] - share : share - band[1]) > 10 ? 0 : 1;
    if (c.esopShare > 0.2) {
      const excess = s.esop - 0.2 * c.income;
      sug.push({ lv: c.esopShare > 0.4 ? 0 : 1, title: '公司股份（ESOP）建议停止配置', html: '现在占生息组合 <b>' + p(c.esopShare) + '</b>（安全线 20%），多出约 <b>' + F.money(excess) + ' 元</b>。今年认购不再买，分红和奖金到账后直接买指数基金。' });
    }
    if (s.monthlyExpense > 0 && c.liqMonths < 6) {
      const gap = 6 * s.monthlyExpense - c.liq;
      sug.push({ lv: c.liqMonths < 3 ? 0 : 1, title: c.liqMonths < 3 ? '先把应急钱补够' : '建议补应急钱', html: '现金 + 稳健类要够 6 个月生活费（约 <b>' + F.money(6 * s.monthlyExpense) + ' 元</b>），现在 ' + F.money(c.liq) + ' 元，还差 <b>' + F.money(gap) + ' 元</b>——放货币基金或活期理财。' });
    }
    if (c.income > 0) {
      const [lo, hi] = c.band, share = c.equityShare * 100;
      if (share < lo) {
        const gap = lo / 100 * c.income - (s.equity + s.esop);
        const months = s.monthlyInvest > 0 ? Math.ceil(gap / s.monthlyInvest) : null;
        sug.push({ lv: offLevel(share, c.band), title: '权益类建议加配宽基指数基金', html: '距目标下限还差约 <b>' + F.money(gap) + ' 元</b>' + (months ? '，按每月投 ' + F.money(s.monthlyInvest) + ' 元，大约 <b>' + months + ' 个月</b>补齐。' : '。') });
      } else if (share > hi) {
        const excess = (s.equity + s.esop) - hi / 100 * c.income;
        sug.push({ lv: offLevel(share, c.band), title: '权益类建议暂停配置', html: '指数基金 + 公司股份合计超出目标上限约 <b>' + F.money(excess) + ' 元</b>：定投先停，新钱转货币基金。' });
      }
    }
    if (c.rEff !== null && c.rEff < s.modelR / 100) {
      sug.push({ lv: (s.modelR / 100 - c.rEff) * 100 > 1 ? 0 : 1, title: '这套组合撑不起 ' + s.modelR + '% 的假设', html: '有效收益只有 <b>' + p(c.rEff) + '</b>。二选一：按上面调整持仓；或把计算器里的「收益率 r」改成 <b>' + (c.rEff * 100).toFixed(1) + '%</b> 重算本金需求。' });
    }
    if (c.hhi > 0.6 && c.income > 0) {
      sug.push({ lv: 1, title: '生息资产过度集中', html: 'HHI <b>' + c.hhi.toFixed(2) + '</b>，把新增资金优先配给权重最低的 1~2 类，先把结构摊开再谈收益。' });
    }
    sug.sort((a, b) => a.lv - b.lv);
    return sug.slice(0, 5);
  }

  function exclusion(c) {
    const s = c.s, out = [];
    if (s.consumer > 0) out.push('消费资产 ' + F.money(s.consumer) + ' 元（折旧中，不计入组合）');
    if (s.restricted > 0) out.push('限用途资产 ' + F.money(s.restricted) + ' 元（公积金等，不可自由调仓）');
    return out.length ? '不计入组合：' + out.join('；') + '。它们影响总资产观感，但不产生可自由使用的 4%。' : '没有消费类 / 限用途资产需要排除。';
  }

  CJ.portfolio = { BUCKETS, DEFAULTS, compute, lights, suggestions, exclusion };
})(window.CJ);
