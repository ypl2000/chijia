/* chijia v3 · 流水解析 / 聚合 / 消费画像（纯函数） */
window.CJ = window.CJ || {};
(function (CJ) {
  'use strict';
  const F = CJ.fmt;

  /* PDF 抽取常把户名/摘要折到下一行：以「序号+日期」开头却没匹配上的行，向后拼接再试 */
  function mergeWrappedLines(lines) {
    const keys = Object.keys(CJ.formats);
    const startRe = /^\s*\d+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/;
    const matched = ln => keys.some(k => CJ.formats[k].re.test(ln));
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      let ln = lines[i];
      if (startRe.test(ln) && !matched(ln)) {
        let j = i + 1;
        while (!matched(ln) && j < lines.length && !startRe.test(lines[j])) { ln += ' ' + lines[j]; j++; }
        i = j - 1;
      }
      out.push(ln);
    }
    return out;
  }

  function parseStmtText(text) {
    const keys = Object.keys(CJ.formats);
    const out = [];
    mergeWrappedLines(String(text || '').split(/\r?\n/)).forEach(ln => {
      for (const k of keys) {
        const f = CJ.formats[k], m = f.re.exec(ln);
        if (m) { const t = f.map(m); if (t.d && isFinite(t.amt) && t.amt > 0) { t.fmt = k; out.push(t); } return; }
      }
    });
    /* 多份流水重叠区间去重（v2 已有能力，v3 保留） */
    const seen = new Set();
    return out.filter(t => {
      const k = [t.d, t.t, t.dc, t.amt, t.bal, t.rest].join('|');
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }

  function classifyTxn(t, r) {
    if ((r.skipTypes || []).some(k => (t.t || '').includes(k) || (t.rest || '').includes(k))) return null;
    if (r.employer && !(t.rest || '').includes(r.employer)) return null;
    if ((r.subsidyKeywords || []).some(k => (t.rest || '').includes(k))) return 'sub';
    if ((t.rest || '').includes(r.salaryAbstract || '工资')) return t.amt >= (r.bonusMin || 50000) ? 'bonus' : 'salary';
    return 'other';
  }

  const CATS = [
    { k: '餐饮', re: /餐饮|饭店|美食|外卖|咖啡|奶茶|食堂|food|meal/i },
    { k: '交通', re: /交通|地铁|公交|打车|加油|停车|高铁|机票|出行|滴滴/i },
    { k: '购物', re: /购物|商场|超市|电商|淘宝|京东|拼多多|服饰|数码/i },
    { k: '居住', re: /房租|租金|物业|水电|燃气|宽带|房贷/i },
    { k: '医疗', re: /医院|药|体检|医疗|诊所/i },
    { k: '娱乐', re: /电影|游戏|会员|订阅|视频|音乐|健身|旅游|酒店/i },
    { k: '金融', re: /理财|基金|证券|转证|赎回|申购|利息|还款|信用卡/i },
    { k: '转账', re: /转账|汇款|收款|付款|红包|零钱/i }
  ];
  function guessCat(rest) {
    for (const c of CATS) if (c.re.test(rest || '')) return c.k;
    return '其他';
  }

  function aggregate(txns, rules) {
    if (!txns || !txns.length) return null;
    const dates = txns.map(t => t.d).sort();
    const dMin = dates[0], dMax = dates[dates.length - 1];
    const months = F.monthSpan(dMin, dMax);
    const byYear = {}, byMonth = {}, quarters = {}, byCat = {}, counterparts = {};
    const emp = { salary: {}, bonus: {}, sub: {}, other: {} };
    let totalIn = 0, totalOut = 0, nIn = 0, nOut = 0;

    txns.forEach(t => {
      const y = t.d.slice(0, 4), ym = t.d.slice(0, 7);
      byYear[y] = byYear[y] || { n: 0, d: 0, c: 0 };
      byMonth[ym] = byMonth[ym] || { n: 0, d: 0, c: 0 };
      byYear[y].n++; byMonth[ym].n++;
      if (t.dc === 'D') {
        totalOut += t.amt; nOut++; byYear[y].d += t.amt; byMonth[ym].d += t.amt;
        const c = guessCat(t.rest);
        byCat[c] = byCat[c] || { n: 0, sum: 0 }; byCat[c].n++; byCat[c].sum += t.amt;
        const cp = String(t.rest || '—').split(/交易流水号|订单编号|\|/)[0].trim().slice(0, 18) || '—';
        counterparts[cp] = counterparts[cp] || { n: 0, sum: 0 }; counterparts[cp].n++; counterparts[cp].sum += t.amt;
      } else {
        totalIn += t.amt; nIn++; byYear[y].c += t.amt; byMonth[ym].c += t.amt;
        const c = classifyTxn(t, rules);
        if (c && c !== 'other') { emp[c][y] = emp[c][y] || []; emp[c][y].push(t); }
        if (c === 'sub') {
          const q = Math.floor((+t.d.slice(5, 7) - 1) / 3) + 1, k = y + ' Q' + q;
          quarters[k] = quarters[k] || { n: 0, sum: 0, min: Infinity, max: -Infinity };
          quarters[k].n++; quarters[k].sum += t.amt;
          quarters[k].min = Math.min(quarters[k].min, t.amt);
          quarters[k].max = Math.max(quarters[k].max, t.amt);
        }
      }
    });
    const big = txns.filter(t => t.dc === 'D' && t.amt >= (rules.bigExpenseMin || 5000))
      .sort((a, b) => b.amt - a.amt).slice(0, 20);
    const monthly = Object.keys(byMonth).sort().map(k => ({
      ym: k, out: byMonth[k].d, in: byMonth[k].c, net: byMonth[k].c - byMonth[k].d, n: byMonth[k].n
    }));
    return {
      dMin, dMax, months, byYear, byMonth, monthly, emp, quarters, big, byCat, counterparts,
      totalIn, totalOut, nIn, nOut, count: txns.length,
      net: totalIn - totalOut, avgOut: totalOut / months, avgIn: totalIn / months
    };
  }

  /* 近 12 个月收入口径（v1 口径，修正 cutoff 与跨度为真实日期比较） */
  function income12m(txns, rules) {
    if (!txns || !txns.length) return null;
    const cats = txns.filter(t => t.dc === 'C')
      .map(t => ({ d: t.d, amt: t.amt, cat: classifyTxn(t, rules) }))
      .filter(x => x.cat === 'salary' || x.cat === 'bonus' || x.cat === 'sub');
    if (!cats.length) return null;
    const dMax = cats.reduce((m, x) => x.d > m ? x.d : m, '');
    const cut = new Date(dMax + 'T00:00:00'); cut.setFullYear(cut.getFullYear() - 1);
    const cutoff = cut.toISOString().slice(0, 10);
    const win = cats.filter(x => x.d > cutoff);
    if (!win.length) return null;
    const sum = c => win.filter(x => x.cat === c).reduce((a, x) => a + x.amt, 0);
    const salary = sum('salary'), bonus = sum('bonus'), subsidy = sum('sub');
    const total = salary + bonus + subsidy;
    const span = Math.max(1, Math.min(12, F.monthSpan(win.reduce((m, x) => x.d < m ? x.d : m, '9999'), dMax)));
    return { window: cutoff + ' ~ ' + dMax, salary, bonus, subsidy, total, monthlyAvg: total / span, span };
  }

  /* 消费画像：从真实流水动态推导（v1 是静态示例，v2 直接删掉） */
  function profile(ag, txns, rules) {
    if (!ag) return null;
    const outs = txns.filter(t => t.dc === 'D');
    const small = outs.filter(t => t.amt < 200);
    const subs = outs.filter(t => /会员|订阅|自动扣款|连续包月|月付|自动续费|VIP/i.test(t.rest || ''));
    const refunds = txns.filter(t => t.dc === 'C' && /退款|退回|冲正|退货/.test(t.rest || ''));
    const danger = outs.filter(t => /博彩|彩票|赌博|高利贷|现金分期|逾期|罚息/.test(t.rest || ''));
    const cats = Object.keys(ag.byCat).map(k => ({ name: k, ...ag.byCat[k], share: ag.totalOut ? ag.byCat[k].sum / ag.totalOut * 100 : 0 }))
      .sort((a, b) => b.sum - a.sum);
    const cps = Object.keys(ag.counterparts).map(k => ({ name: k, ...ag.counterparts[k] }))
      .sort((a, b) => b.sum - a.sum).slice(0, 8);
    const top3 = cats.slice(0, 3).reduce((a, c) => a + c.share, 0);
    return {
      smallN: small.length, smallShare: outs.length ? small.length / outs.length * 100 : 0,
      smallSum: small.reduce((a, t) => a + t.amt, 0),
      subsN: subs.length, subsSum: subs.reduce((a, t) => a + t.amt, 0),
      refundN: refunds.length, refundSum: refunds.reduce((a, t) => a + t.amt, 0),
      dangerN: danger.length, dangerSum: danger.reduce((a, t) => a + t.amt, 0),
      cats, cps, top3,
      avgTicket: outs.length ? ag.totalOut / outs.length : 0,
      savingRate: ag.totalIn > 0 ? (ag.totalIn - ag.totalOut) / ag.totalIn * 100 : 0,
      cards: [
        { icon: 'utensils', tone: 'blue', title: '高频小额', value: F.pct(ag.nOut ? small.length / ag.nOut * 100 : 0),
          desc: '< 200 元的支出 ' + F.money(small.length) + ' 笔，合计 ' + F.money(small.reduce((a, t) => a + t.amt, 0)) + ' 元；笔均 ' + F.money2(ag.avgTicket) + ' 元。' },
        { icon: 'refresh', tone: 'green', title: '订阅与自动扣款', value: F.money(subs.length) + ' 笔',
          desc: subs.length ? '合计 ' + F.money(subs.reduce((a, t) => a + t.amt, 0)) + ' 元 / ' + ag.months + ' 个月，折合月均 ' + F.money(subs.reduce((a, t) => a + t.amt, 0) / ag.months) + ' 元。' : '未识别到订阅/自动续费类关键词，或摘要信息不足。' },
        { icon: 'shield', tone: refunds.length ? 'mint' : 'gray', title: '退款与冲正', value: F.money(refunds.length) + ' 笔',
          desc: refunds.length ? '回款 ' + F.money(refunds.reduce((a, t) => a + t.amt, 0)) + ' 元，比价/退货习惯可从这里读数。' : '统计区间内没有退款入账记录。' },
        { icon: 'alert', tone: danger.length ? 'coral' : 'mint', title: '危险信号', value: danger.length ? F.money(danger.length) + ' 笔' : '无',
          desc: danger.length ? '命中博彩/借贷/逾期类关键词 ' + F.money(danger.reduce((a, t) => a + t.amt, 0)) + ' 元，建议人工核对。' : '未命中博彩、高利贷、逾期等高风险关键词。' }
      ]
    };
  }

  /* 资金管理习惯：现金流闭环 + 理财梯队（由流水推导，不再写死） */
  function habits(ag, state) {
    if (!ag) return null;
    const inc = state.income && state.income.monthlyAvg ? state.income.monthlyAvg : ag.avgIn;
    const months = ag.liqMonths = state.settings.monthlyExpense > 0
      ? F.parse(state.overview.now.bank) / state.settings.monthlyExpense : 0;
    const tiers = [
      { label: 'L1 · 随取随用', name: '银行活期 / 安全垫', w: Math.min(100, months * 16), note: months.toFixed(1) + ' 个月支出' },
      { label: 'L2 · 稳健增值', name: '基金 / 债券持仓', w: 62, note: '按计划逐月定投' },
      { label: 'L3 · 长期锁定', name: 'ESOP / 公积金', w: 78, note: '不可自由调度' }
    ];
    return {
      months, savingRate: ag.savingRate, inc,
      flow: [
        { t: '工资入账', d: '月均 ' + F.money(inc) + ' 元 · ' + F.money(ag.nIn) + ' 笔入账' },
        { t: '自动归集', d: '月均支出 ' + F.money(ag.avgOut) + ' 元，结余率 ' + F.pct(ag.savingRate) },
        { t: '按需赎回', d: '识别 ' + F.money(ag.byCat['金融'] ? ag.byCat['金融'].n : 0) + ' 笔金融类往来' },
        { t: '余额归零', d: '期末银行余额 ' + F.money(state.overview.now.bank) + ' 元' }
      ],
      tiers
    };
  }

  CJ.statement = { mergeWrappedLines, parseStmtText, classifyTxn, aggregate, income12m, profile, habits, guessCat };
})(window.CJ);
