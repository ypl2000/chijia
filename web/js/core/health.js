/* chijia v3 · 健康度双口径评分（真正动态计算）
   v1 的 3.3/3.4 是写死星级示例，v2 把 14 维压成 4 节静态文字且导入流水后不重算；
   v3 按资产 + 流水 + 计划 + 保障标记实算，两套口径各 7 维。 */
window.CJ = window.CJ || {};
(function (CJ) {
  'use strict';
  const F = CJ.fmt;

  const star = n => '★'.repeat(n) + '<span class="star-off">' + '★'.repeat(5 - n) + '</span>';
  const grade = v => v >= 85 ? 5 : v >= 70 ? 4 : v >= 50 ? 3 : v >= 30 ? 2 : 1;

  function breakdown(state, ag) {
    const rows = state.overview.now.rows || [];
    const num = kw => rows.filter(r => kw.test(r.name) && !r.muted && !r.neg).reduce((a, r) => a + F.parse(r.amt), 0);
    const debt = rows.filter(r => r.muted || r.neg).reduce((a, r) => a + Math.abs(F.parse(r.amt)), 0);
    const esop = num(/ESOP|虚拟股/), car = num(/固定资产|车/), gjj = num(/公积金/);
    const fund = num(/基金/), bank = num(/银行|活期|现金|安全垫/), reserve = num(/预备/);
    const total = rows.filter(r => !r.muted && !r.neg).reduce((a, r) => a + F.parse(r.amt), 0);
    const liquid = bank + fund + reserve;
    const investable = fund + reserve + bank + esop;
    const net = total - debt;
    const monthlyExpense = state.settings.monthlyExpense || 6000;
    const monthlyIncome = state.income.monthlyAvg || state.plan.income || 21000;
    return {
      total, net, debt, liquid, investable, esop, car, gjj, fund, bank, reserve,
      monthlyExpense, monthlyIncome,
      liqMonths: monthlyExpense > 0 ? liquid / monthlyExpense : 0,
      debtRatio: total > 0 ? debt / total * 100 : 0,
      liquidRatio: total > 0 ? liquid / total * 100 : 0,
      esopRatio: total > 0 ? esop / total * 100 : 0,
      carRatio: total > 0 ? car / total * 100 : 0,
      restrictedRatio: total > 0 ? (gjj + car) / total * 100 : 0,
      netMonths: monthlyIncome > 0 ? net / monthlyIncome : 0,
      savingRate: monthlyIncome > 0 ? (monthlyIncome - monthlyExpense) / monthlyIncome * 100 : 0,
      maxSingle: total > 0 ? Math.max(...rows.filter(r => !r.muted && !r.neg).map(r => F.parse(r.amt))) / total * 100 : 0
    };
  }

  function compute(state, ag) {
    const b = breakdown(state, ag);
    const eng = CJ.plan.computePlan(state.plan);
    const exp = CJ.plan.expectedAssets(state, eng);
    const hasFlow = !!ag;
    const insured = !!state.settings.hasInsurance;
    const saving = b.savingRate;
    const goodMonths = hasFlow ? ag.monthly.filter(m => m.net >= 0).length / Math.max(1, ag.monthly.length) * 100 : (saving > 0 ? 80 : 30);

    /* 3.3 可投资产口径：只评可随时调度的金融资产与过程管理 */
    const invRows = [
      { name: '储蓄率', v: F.clamp(saving / 0.6 * 100, 0, 100), note: '月结余 ' + F.money(Math.max(0, b.monthlyIncome - b.monthlyExpense)) + ' 元 / 月收入 ' + F.money(b.monthlyIncome) + ' 元，储蓄率 ' + F.pct(saving) },
      { name: '现金流纪律', v: F.clamp(goodMonths, 0, 100), note: hasFlow ? '有流水的 ' + ag.monthly.length + ' 个月里，' + ag.monthly.filter(m => m.net >= 0).length + ' 个月当月结余为正（' + F.pct(goodMonths) + '）。' : '未导入流水，按当前收支参数估算为 ' + F.pct(goodMonths) + '；导入后自动实算。' },
      { name: '信用使用', v: F.clamp(100 - b.debtRatio * 4, 0, 100), note: '负债 ' + F.money(b.debt) + ' 元，负债率 ' + F.pct(b.debtRatio) + (b.debt === 0 ? '，无坏债。' : '，建议优先压降。') },
      { name: '消费结构', v: F.clamp(100 - Math.max(0, (hasFlow && ag.profile ? ag.profile.top3 : 60) - 55) * 1.6, 0, 100), note: hasFlow && ag.profile ? '支出前三类中占 ' + F.pct(ag.profile.top3) + '；笔均 ' + F.money2(ag.profile.avgTicket) + ' 元。' : '未导入流水，暂按收支参数与计划消费额读数：月支出 ' + F.money(b.monthlyExpense) + ' 元。' },
      { name: '资产分散度', v: F.clamp(100 - Math.max(0, b.maxSingle - 25) * 2, 0, 100), note: '最大单一资产占总资产 ' + F.pct(b.maxSingle) + '，公司股权（与工资同源）占 ' + F.pct(b.esopRatio) + '。' },
      { name: '风险保障', v: insured ? 90 : 35, note: insured ? '已标记持有重疾 / 医疗 / 意外险——收入中断时组合不会被迫变现。' : '未标记个人保障险；建议补重疾 + 医疗 + 意外，再去谈长期收益。' },
      { name: '应急垫', v: F.clamp(b.liqMonths / 6 * 100, 0, 100), note: '可随时调度 ' + F.money(b.liquid) + ' 元 ≈ ' + b.liqMonths.toFixed(1) + ' 个月支出（目标 ≥ 6 个月）。' }
    ];
    /* 3.4 总资产口径：把固定资产/股权/公积金都计入后的完整资产负债表 */
    const futLiquid = exp.items.filter(x => ['funds', 'reserve', 'cushion', 'bank'].includes(x.key)).reduce((a, x) => a + x.amt, 0);
    const futRatio = exp.total > 0 ? futLiquid / exp.total * 100 : 0;
    const assetRows = [
      { name: '净资产总量', v: F.clamp(b.netMonths / 24 * 100, 0, 100), note: '净资产 ' + F.money(b.net) + ' 元 ≈ ' + b.netMonths.toFixed(1) + ' 个月收入。' },
      { name: '负债管理', v: F.clamp(100 - b.debtRatio * 5, 0, 100), note: '负债 ' + F.money(b.debt) + ' 元 / 总资产 ' + F.money(b.total) + ' 元 = ' + F.pct(b.debtRatio) + '。' },
      { name: '流动性占比', v: F.clamp(b.liquidRatio / 40 * 100, 0, 100), note: '金融流动资产 ' + F.money(b.liquid) + ' 元，占总资产 ' + F.pct(b.liquidRatio) + '（公积金等限用途不计入）。' },
      { name: '资产集中度', v: F.clamp(100 - Math.max(0, b.esopRatio - 15) * 2.4, 0, 100), note: '公司股权 ' + F.pct(b.esopRatio) + '，与工资同源；两者同时受雇主经营状况影响。' },
      { name: '贬值性资产', v: F.clamp(100 - Math.max(0, b.carRatio - 10) * 2.2, 0, 100), note: '汽车等折旧资产占 ' + F.pct(b.carRatio) + '，计划期内再折 ' + F.money(state.plan.depreciation) + ' 元。' },
      { name: '压力测试', v: F.clamp(b.liqMonths / 6 * 100, 0, 100), note: '收入中断后可撑 ' + b.liqMonths.toFixed(1) + ' 个月；' + (hasFlow ? '统计区间内最大单月净流出 ' + F.money(Math.abs(Math.min(0, ...ag.monthly.map(m => m.net)))) + ' 元。' : '导入流水后可核对脉冲式大额支出。') },
      { name: '结构修复路径', v: F.clamp(futRatio / 35 * 100, 0, 100), note: '按当前计划推演至 ' + exp.endYM + '，流动资产占比将从 ' + F.pct(b.liquidRatio) + ' 升至 ' + F.pct(futRatio) + '。' }
    ];
    const finish = rows => {
      rows.forEach(r => { r.score = grade(r.v); r.stars = star(r.score); r.level = r.score >= 4 ? 'good' : r.score === 3 ? 'warn' : 'bad'; });
      return rows;
    };
    const inv = finish(invRows), asset = finish(assetRows);
    const avg = rows => Math.round(rows.reduce((a, r) => a + r.v, 0) / rows.length);
    const invScore = avg(inv), assetScore = avg(asset);
    const gap = assetScore - invScore;
    return {
      b, inv, asset, invScore, assetScore, exp, futRatio,
      invVerdict: invScore >= 75 ? '过程管理扎实' : invScore >= 50 ? '过程管理尚可，结构有短板' : '需要先补基础：应急垫、保障与结余纪律',
      assetVerdict: assetScore >= 75 ? '总量与结构都健康' : assetScore >= 50 ? '账面总量不错，但可自由调度的钱偏少' : '账面富裕、现金紧张，优先修复结构',
      readout: '总资产 ' + F.money(b.total) + ' 元中，不可随时变现 / 限用途资产占 ' + F.pct(100 - b.liquidRatio) +
        '；真正可调度 ' + F.money(b.liquid) + ' 元（' + F.pct(b.liquidRatio) + '）。' +
        '可投资产口径 ' + invScore + ' 分，总资产口径 ' + assetScore + ' 分，' +
        (gap > 0 ? '差额 ' + gap + ' 分说明「账面好看」主要来自固定资产与股权，' : '') +
        '按计划推演到 ' + exp.endYM + '，流动资产占比可升至 ' + F.pct(futRatio) + '。',
      discount: '总资产 ≈ 沉没的消费（' + F.money(b.car) + '） + 绑定雇主的权益（' + F.money(b.esop) + '） + 限用途资产（' + F.money(b.gjj) + '） + 真正可用的钱（' + F.money(b.liquid) + '）。'
    };
  }

  CJ.health = { compute, breakdown, star };
})(window.CJ);
