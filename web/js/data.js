/* chijia v3 · 默认账本与备份格式兼容 */
window.CJ = window.CJ || {};
(function (CJ) {
  'use strict';
  const F = CJ.fmt;

  function defaultState() {
    return {
      version: 3,
      updatedAt: Date.now(),
      deviceId: Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2),
      meta: {
        title: '持家', subtitle: '账本 · 计划推演 · 流水分析 · 财富自由',
        statsDim: '示例账本 · 未导入流水', importedAt: null, lastBackup: null
      },
      overview: {
        now: {
          bank: 20000, total: 440000,
          sub: '净资产 ≈420,000（欠款 20,000）',
          rows: [
            { name: '固定资产（汽车·残值估值）', amt: '150,000', c: '#8f6bd6', note: '非金融 / 贬值中' },
            { name: '公司虚拟股 ESOP（成本）', amt: '180,000', c: '#f0a637', note: '单一雇主，不可随时变现' },
            { name: '住房公积金（限用途）', amt: '60,000', c: '#14b8a6', note: '限住房用途' },
            { name: '基金组合', amt: '30,000', c: '#3b6ef6', note: '可投资产' },
            { name: '银行卡活期', amt: '20,000', c: '#9aa6bb', note: '现金' },
            { name: '信用卡欠款', amt: '-20,000', c: '#ef6b6b', note: '负债', muted: true, neg: true }
          ]
        }
      },
      plan: F.deepClone(CJ.plan.DEFAULT_PLAN),
      income: {
        window: '2025-11 ~ 2026-10', salary: 240000, bonus: 60000, subsidy: 16800,
        total: 316800, monthlyAvg: 21000, span: 12, src: '示例账本'
      },
      importer: {
        employer: '', salaryAbstract: '工资',
        subsidyKeywords: ['Employee Payment', '报销'],
        skipTypes: ['活期盈', '退款', '利息', '赎回', '理财', '证转银', '银转证'],
        bonusMin: 50000, bigExpenseMin: 5000
      },
      calculator: F.deepClone(CJ.fire.DEFAULTS),
      holdings: F.deepClone(CJ.portfolio.DEFAULTS),
      settings: { theme: 'light', monthlyExpense: 6000, hasInsurance: false, autoSync: true },
      txns: [],
      txnsRules: {},
      activity: []
    };
  }

  /* 兼容三种来源：v3 备份 / v1 备份 {data,txns,txnsRules} / v2 五实体 {data:{...}} */
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('不是有效的 JSON 对象');
    const base = defaultState();
    if (raw.state && raw.state.version === 3) {
      return merge(base, raw.state);
    }
    const d = raw.data || (raw.entities && raw.entities.data && raw.entities.data.value) || null;
    if (!d) throw new Error('文件里找不到账本数据（缺少 data / state 字段）');
    /* v1 DATA：字段名与 v3 大体对应，逐块尽力迁移 */
    if (d.plan) mergePlan(base, d.plan);
    if (d.meta && d.meta.importer) Object.assign(base.importer, d.meta.importer);
    if (d.meta && d.meta.calculator && d.meta.calculator.fields) Object.assign(base.calculator, d.meta.calculator.fields);
    if (d.income) Object.assign(base.income, pick(d.income, ['window', 'salary', 'bonus', 'subsidy', 'total', 'monthlyAvg', 'span']));
    if (d.overview && d.overview.now && Array.isArray(d.overview.now.rows)) {
      base.overview.now.rows = d.overview.now.rows.map(r => ({
        name: r.name, amt: r.amt, c: r.c || '#9aa6bb', note: r.note || '',
        muted: !!r.muted, neg: !!r.neg
      }));
      const bank = base.overview.now.rows.find(r => /银行|活期|现金/.test(r.name) && !r.muted);
      base.overview.now.bank = bank ? F.parse(bank.amt) : 0;
      base.overview.now.total = base.overview.now.rows.filter(r => !r.muted && !r.neg).reduce((a, r) => a + F.parse(r.amt), 0);
    }
    if (d.plan && d.plan.spend) base.settings.monthlyExpense = F.parse(d.plan.spend);
    if (d.holdings) Object.assign(base.holdings, d.holdings);
    if (d.calculator) Object.assign(base.calculator, d.calculator);
    if (d.settings) Object.assign(base.settings, d.settings);
    if (d.importer) Object.assign(base.importer, d.importer);
    const txns = raw.txns || d.txns || (raw.entities && raw.entities.txns && raw.entities.txns.value && raw.entities.txns.value.txns) || [];
    if (Array.isArray(txns) && txns.length) {
      base.txns = txns;
      base.txnsRules = raw.txnsRules || d.txnsRules || base.importer;
      base.meta.importedAt = raw.exportedAt || new Date().toISOString();
      base.meta.statsDim = '已导入 ' + txns.length.toLocaleString() + ' 笔流水';
    }
    base.version = 3;
    return base;
  }

  function mergePlan(base, p) {
    const keys = Object.keys(CJ.plan.DEFAULT_PLAN);
    keys.forEach(k => { if (p[k] !== undefined) base.plan[k] = p[k]; });
  }
  function pick(o, keys) { const r = {}; keys.forEach(k => { if (o[k] !== undefined) r[k] = o[k]; }); return r; }
  function merge(base, s) {
    Object.keys(s).forEach(k => {
      if (k === 'version' || k === 'updatedAt' || k === 'deviceId') return;
      if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) && base[k] && typeof base[k] === 'object') {
        Object.assign(base[k], s[k]);
      } else base[k] = s[k];
    });
    return base;
  }

  CJ.data = { defaultState, normalize };
})(window.CJ);
