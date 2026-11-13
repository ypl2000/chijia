/* chijia v3 · 财富自由三口径模型
   v1 的完整模型原样移植：SWR 提取率 / 本金不动·CPI / 本金不动·个人账单通胀，
   含 π 四类加权推导、育儿 18 年折现、健康原值、重大投入折现、逐年模拟、敏感性曲线。
   v2 曾把 π 写死成 0.0233 并把三口径压成一口径三档，v3 全部恢复。 */
window.CJ = window.CJ || {};
(function (CJ) {
  'use strict';
  const F = CJ.fmt;

  const DEFAULTS = {
    spend: 10000, rent: 4000, income: 25000, p0: 0,
    foodPct: 25, medPct: 10, r: 4, cpi: 2, swr: 3.5,
    kids: 0, childCost: 108, health: 60, invest: 0, investYears: 0
  };
  const FIELDS = [
    { k: 'spend', label: '月支出', unit: '元/月', min: 500, max: 100000, step: 100, group: '现金流' },
    { k: 'rent', label: '其中房租', unit: '元/月', min: 0, max: 50000, step: 100, group: '现金流' },
    { k: 'income', label: '月收入（税后）', unit: '元/月', min: 0, max: 300000, step: 100, group: '现金流' },
    { k: 'p0', label: '现有可投资本金', unit: '元', min: 0, max: 20000000, step: 10000, group: '现金流' },
    { k: 'foodPct', label: '饮食占支出', unit: '%', min: 0, max: 60, step: 1, group: '账单结构' },
    { k: 'medPct', label: '医疗占支出', unit: '%', min: 0, max: 40, step: 1, group: '账单结构' },
    { k: 'r', label: '名义年化收益 r', unit: '%', min: 0, max: 15, step: 0.1, group: '假设' },
    { k: 'cpi', label: 'CPI 通胀', unit: '%', min: 0, max: 10, step: 0.1, group: '假设' },
    { k: 'swr', label: '安全提取率 SWR', unit: '%', min: 1, max: 8, step: 0.1, group: '假设' },
    { k: 'kids', label: '子女数', unit: '个', min: 0, max: 5, step: 1, group: '专项池' },
    { k: 'childCost', label: '每孩养育成本', unit: '万', min: 0, max: 500, step: 1, group: '专项池' },
    { k: 'health', label: '健康专项池', unit: '万', min: 0, max: 500, step: 5, group: '专项池' },
    { k: 'invest', label: '未来重大投入', unit: '万', min: 0, max: 1000, step: 10, group: '专项池' },
    { k: 'investYears', label: '距投入发生', unit: '年后', min: 0, max: 40, step: 1, group: '专项池' }
  ];
  const GROUPS = ['现金流', '账单结构', '假设', '专项池'];

  function annuity(n, rr) { return rr <= 1e-9 ? n : (1 - Math.pow(1 + rr, -n)) / rr; }

  function compute(p0) {
    const p = Object.assign({}, DEFAULTS, p0 || {});
    FIELDS.forEach(f => { p[f.k] = F.parse(p[f.k]); });
    if (p.spend < 500) p.spend = 500;

    /* 个人账单通胀 π：四类金额 × 各自通胀锚点加权 */
    const food = p.spend * p.foodPct / 100;
    const med = p.spend * p.medPct / 100;
    const other = Math.max(p.spend - p.rent - food - med, 0);
    const gRent = p.cpi + 0.5, gFood = p.cpi - 0.5, gMed = p.cpi + 2.5, gOther = p.cpi;
    const pi = (p.rent * gRent + food * gFood + med * gMed + other * gOther) / p.spend; // %
    const rReal = (1 + p.r / 100) / (1 + pi / 100) - 1;                                 // 小数
    const parts = [
      { key: 'rent', name: '房租', amt: p.rent, g: gRent, anchor: 'CPI + 0.5pp' },
      { key: 'food', name: '饮食', amt: food, g: gFood, anchor: 'CPI − 0.5pp' },
      { key: 'med', name: '医疗', amt: med, g: gMed, anchor: 'CPI + 2.5pp' },
      { key: 'other', name: '其他', amt: other, g: gOther, anchor: '≈ CPI' }
    ];
    parts.forEach(x => { x.w = p.spend ? x.amt / p.spend * 100 : 0; });

    /* 专项池（内部单位：万） */
    const ySpend = p.spend * 12 / 10000;
    const childPV = (p.childCost / 18) * annuity(18, rReal);
    const investPV = p.invest / Math.pow(1 + Math.max(rReal, 0), p.investYears);
    const pools = p.kids * childPV + p.health + investPV;

    const childExp = p.kids + ' 孩 × 每孩 ' + F.wan(childPV, 1);
    const healthExp = F.wan(p.health, 0) + '（原值）';
    const investExp = p.invest <= 0 ? '0' : p.investYears <= 0 ? F.wan(p.invest, 0) + '（当期）'
      : rReal <= 0 ? F.wan(p.invest, 0) + '（真实收益率≤0，不折现）'
        : F.wan(p.invest, 0) + ' ÷ (1+' + (rReal * 100).toFixed(2) + '%)^' + p.investYears;
    const lifeRes = v => isFinite(v) ? F.wan(v, 0) : '分母≤0';
    const childNote = rReal > 0
      ? '每孩 ' + F.wan(childPV, 1) + ' = (每孩成本÷18年) 摊到 18 年的年金现值，已按真实收益率 ' + (rReal * 100).toFixed(2) + '% 折现；健康池按原值不折现。'
      : '真实收益率 ≤ 0，育儿按原值 ' + F.wan(childPV, 1) + ' 计入；健康池按原值不折现。';

    const common = [
      ['育儿池', childExp, F.wan(p.kids * childPV, 0)],
      ['健康池', healthExp, F.wan(p.health, 0)],
      ['重大投入', investExp, F.wan(investPV, 0)]
    ];
    const t1life = p.swr > 0 ? ySpend / (p.swr / 100) : Infinity;
    const t2den = p.r / 100 - p.cpi / 100;
    const t2life = t2den > 1e-6 ? ySpend / t2den : Infinity;
    const t3life = rReal > 1e-6 ? ySpend / rReal : Infinity;
    const tiers = [
      {
        id: 't1', tag: 'T1', tone: 'blue', name: '提取率 ' + p.swr.toFixed(1) + '% · 本金允许慢慢花',
        short: '提取率档', life: t1life, total: t1life + pools,
        rows: [['生活池', F.wan(ySpend, 0) + ' ÷ ' + p.swr.toFixed(1) + '%', lifeRes(t1life)], ...common]
      },
      {
        id: 't2', tag: 'T2', tone: 'mint', name: '本金不动 · 物价按 CPI ' + p.cpi.toFixed(1) + '%',
        short: 'CPI 档', life: t2life, total: t2life + pools,
        rows: [['生活池', F.wan(ySpend, 0) + ' ÷ (' + p.r.toFixed(1) + '% − ' + p.cpi.toFixed(1) + '%)', lifeRes(t2life)], ...common]
      },
      {
        id: 't3', tag: 'T3', tone: 'amber', name: '本金不动 · 物价按个人账单 ' + pi.toFixed(1) + '%',
        short: '个人账单档', life: t3life, total: t3life + pools,
        rows: [
          ['账单通胀 π', parts.map(x => x.w.toFixed(0) + '%×' + x.g.toFixed(1) + '%').join(' + '), pi.toFixed(2) + '%'],
          ['真实收益率', '(1+' + p.r.toFixed(1) + '%) ÷ (1+' + pi.toFixed(2) + '%) − 1', (rReal * 100).toFixed(2) + '%'],
          ['生活池', F.wan(ySpend, 0) + ' ÷ ' + (rReal * 100).toFixed(2) + '%', lifeRes(t3life)], ...common
        ]
      }
    ];
    const maxTotal = Math.max(1, ...tiers.map(t => isFinite(t.total) ? t.total : 0));
    tiers.forEach(t => { t.bar = isFinite(t.total) ? t.total / maxTotal * 100 : 0; t.feasible = isFinite(t.total); });

    /* 逐年模拟：真实购买力口径，最多 99 年 */
    const Cw = Math.max(0, p.income - p.spend) * 12 / 10000;
    const P0w = p.p0 / 10000;
    const yearNow = new Date().getFullYear();
    tiers.forEach(t => {
      const T = t.total;
      if (!isFinite(T)) { t.years = '—'; t.yearNote = '分母 ≤ 0，这一档在当前假设下无法实现。'; t.progress = 0; return; }
      if (P0w >= T) { t.years = '已达成'; t.yearNote = '现有 ' + F.wan(P0w) + ' ≥ 目标 ' + F.wan(T) + '，富余 ' + F.wan(P0w - T); t.progress = 100; return; }
      if (Cw <= 0) { t.years = '无法积累'; t.yearNote = '月收入 ≤ 月支出——先降支出或增收入，否则本金只减不增。'; t.progress = Math.min(100, P0w / T * 100); return; }
      let P = P0w, n = 0;
      for (n = 1; n <= 99; n++) { P = P * (1 + rReal) + Cw; if (P >= T) break; }
      if (n > 99) { t.years = '99 年+'; t.yearNote = '按年投 ' + F.wan(Cw) + ' 追不上（真实收益 ' + (rReal * 100).toFixed(2) + '% 太低）。'; t.progress = Math.min(100, P / T * 100); return; }
      t.years = '约 ' + n + ' 年';
      t.yearNote = '预计 ' + (yearNow + n) + ' 年达成 ｜ 现有 ' + F.wan(P0w) + ' · 年投 ' + F.wan(Cw) + ' · 真实收益 ' + (rReal * 100).toFixed(2) + '%';
      t.progress = Math.min(100, Math.max(2, P0w / T * 100));
    });
    const done = tiers.filter(t => P0w >= t.total).length;
    const note = Cw <= 0 ? '当前收入覆盖不了支出：财富自由的前提是先有结余。'
      : '目标与收益均折算为今天的购买力（真实收益 ' + (rReal * 100).toFixed(2) + '% = 名义 ' + p.r + '% 对个人账单通胀 ' + pi.toFixed(2) + '%）；每年投入 ' + F.wan(Cw) + '；未计市场波动序列与一次性收支。已达标 ' + done + '/3 档。';

    /* 敏感性曲线：v = 年支出 / 真实收益率（万），rr 0.15%~4% */
    const chart = [];
    for (let rr = 0.0015; rr <= 0.0401; rr += 0.00025) chart.push({ rr, v: ySpend / rr });
    return { p, pi, rReal, parts, ySpend, childPV, investPV, pools, tiers, Cw, P0w, note, childNote, chart, done, yearNow };
  }

  CJ.fire = { DEFAULTS, FIELDS, GROUPS, annuity, compute };
})(window.CJ);
