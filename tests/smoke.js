#!/usr/bin/env node
/* chijia v3 · 纯逻辑冒烟测试（零依赖，node tests/smoke.js）
   覆盖：格式化工具、流水解析、四池推演、FIRE 三口径、双口径健康度、
   组合体检、备份格式兼容、六个视图 render 不抛错。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const WEB = path.join(__dirname, '..', 'web');
global.window = global;
const load = f => vm.runInThisContext(fs.readFileSync(path.join(WEB, f), 'utf8'), { filename: f });
[
  'js/core/fmt.js', 'js/core/formats.js', 'js/core/statement.js',
  'js/core/plan.js', 'js/core/fire.js', 'js/core/health.js', 'js/core/portfolio.js',
  'js/data.js', 'js/store.js', 'js/sync.js', 'js/pdf.js',
  'js/ocr.js', 'js/ui.js',
  'js/views/home.js', 'js/views/plan.js', 'js/views/analysis.js',
  'js/views/calculator.js', 'js/views/portfolio.js', 'js/views/settings.js'
].forEach(load);

const CJ = global.CJ;
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  PASS  ' + name); };

console.log('chijia v3 · smoke test\n');

ok('最大余额法占比合计恒 100%', () => {
  [ [[1,1,1],3], [[33.3,33.3,33.4],100], [[0,0,7],7], [[1,2,3,4,5],15] ].forEach(([a,t]) => {
    const r = CJ.fmt.largestRemainderPct(a, t);
    assert.strictEqual(r.reduce((x,y)=>x+y,0), 100);
  });
});

ok('流水正则 + 折行合并 + 去重', () => {
  const line = '1 2026-11-01 09:12:33 工资 C 21,000.00 41,000.00 622202 某公司 工资';
  const t = CJ.statement.parseStmtText(line);
  assert.strictEqual(t.length, 1);
  assert.strictEqual(t[0].dc, 'C');
  assert.strictEqual(t[0].amt, 21000);
  const dup = CJ.statement.parseStmtText(line + '\n' + line);
  assert.strictEqual(dup.length, 1, '重复行应去重');
  const csv = CJ.statement.parseStmtText('2026-11-02,D,128.50,40,871.50,餐饮消费');
  assert.strictEqual(csv.length, 1);
  assert.strictEqual(csv[0].rest, '餐饮消费');
});

ok('真实 fixture 可解析并聚合', () => {
  const p = path.join(__dirname, '..', '..', 'chijia_v2', 'tests', 'sample-bocom.txt');
  if (!fs.existsSync(p)) return;
  const txt = fs.readFileSync(p, 'utf8');
  const txns = CJ.statement.parseStmtText(txt);
  assert.ok(txns.length > 0, 'fixture 应能解析出交易');
  const ag = CJ.statement.aggregate(txns, CJ.data.defaultState().importer);
  assert.ok(ag.months >= 1 && ag.count === txns.length);
  const prof = CJ.statement.profile(ag, txns, CJ.data.defaultState().importer);
  assert.strictEqual(prof.cards.length, 4);
});

ok('四池推演：封顶溢出 / 按池扣减 / 可行性', () => {
  const p = CJ.data.defaultState().plan;
  const e = CJ.plan.computePlan(p);
  assert.strictEqual(e.feasible, true);
  assert.strictEqual(e.cushionFinal, 24000);
  assert.strictEqual(e.esopFinal, 10000, '预备应被一次性认购扣减');
  assert.strictEqual(e.funds, 62000);
  assert.strictEqual(e.liquid, 102000);
  const capped = CJ.plan.computePlan(Object.assign({}, p, { months: 12, cushionCap: 6000 }));
  assert.strictEqual(capped.cushionFinal, 6000);
  assert.ok(capped.rows[3].eM > p.esop, '垫满后月投应溢出到预备');
});

ok('期末构成：占比合计 100%', () => {
  const s = CJ.data.defaultState();
  const exp = CJ.plan.expectedAssets(s, CJ.plan.computePlan(s.plan));
  assert.strictEqual(exp.items.reduce((a,x)=>a+x.pc,0), 100);
  assert.strictEqual(exp.items.length, 7);
  assert.ok(exp.total > 0);
});

ok('FIRE 三口径并列 + π 四类加权', () => {
  const r = CJ.fire.compute();
  assert.ok(Math.abs(r.pi - 2.325) < 0.01, 'π 应为 2.325%，实际 ' + r.pi);
  assert.ok(Math.abs(r.rReal * 100 - 1.6366) < 0.02);
  assert.strictEqual(r.tiers.length, 3);
  assert.ok(r.tiers[0].total < r.tiers[1].total && r.tiers[1].total < r.tiers[2].total,
    'SWR < CPI < 个人账单，三档应递增');
  assert.ok(Math.abs(r.tiers[0].life - 12 / 0.035) < 0.001);
  assert.ok(r.chart.length > 100);
  assert.ok(r.tiers.every(t => typeof t.years === 'string'));
  const bad = CJ.fire.compute({ r: 2, cpi: 3 });
  assert.strictEqual(bad.tiers[1].feasible, false, 'r−CPI ≤ 0 应判为无法实现');
});

ok('健康度双口径：14 维全部实算', () => {
  const s = CJ.data.defaultState();
  const h = CJ.health.compute(s, null);
  assert.strictEqual(h.inv.length, 7);
  assert.strictEqual(h.asset.length, 7);
  assert.ok(h.invScore >= 0 && h.invScore <= 100 && h.assetScore >= 0 && h.assetScore <= 100);
  assert.ok(h.readout.indexOf('总资产') >= 0);
  assert.ok(h.inv.every(r => r.score >= 1 && r.score <= 5));
  /* 导入流水后评分应改变（v2 的 3.x 不会重算，这里必须变） */
  const txns = CJ.statement.parseStmtText(
    '1 2026-01-05 09:00:00 工资 C 21,000.00 21,000.00 622202 某公司 工资\n' +
    '2 2026-02-05 09:00:00 工资 C 21,000.00 30,000.00 622202 某公司 工资\n' +
    '3 2026-03-05 09:00:00 消费 D 12,000.00 18,000.00 622202 商场');
  const ag = CJ.statement.aggregate(txns, s.importer);
  ag.profile = CJ.statement.profile(ag, txns, s.importer);
  const h2 = CJ.health.compute(s, ag);
  assert.notStrictEqual(h.invScore, h2.invScore, '导入流水后健康度必须重算');
});

ok('组合体检：五灯 + 金额化建议', () => {
  const c = CJ.portfolio.compute();
  assert.ok(Math.abs(c.rEff * 100 - 4.02) < 0.05, 'ESOP×0.6 打折后的有效收益 ≈4.02%');
  assert.strictEqual(CJ.portfolio.lights(c).length, 5);
  const sug = CJ.portfolio.suggestions(c);
  assert.ok(Array.isArray(sug));
  assert.ok(CJ.portfolio.exclusion(c).length > 0);
});

ok('备份兼容 v1 包装格式', () => {
  const v1 = {
    app: 'chijia', version: 1, exportedAt: new Date().toISOString(),
    data: { plan: { start: '2027-01', months: 12, spend: 8000, income: 25000 },
            meta: { importer: { employer: 'ACME', bonusMin: 40000 }, calculator: { fields: { spend: 8000 } } },
            overview: { now: { rows: [{ name: '银行卡活期', amt: '12,000', c: '#999' }] } } },
    txns: [{ d: '2026-11-01', t: '', dc: 'D', amt: 100, bal: 12000, rest: '测试' }]
  };
  const s = CJ.data.normalize(v1);
  assert.strictEqual(s.version, 3);
  assert.strictEqual(s.plan.months, 12);
  assert.strictEqual(s.importer.employer, 'ACME');
  assert.strictEqual(s.txns.length, 1);
  assert.strictEqual(s.overview.now.bank, 12000);
  assert.strictEqual(s.calculator.spend, 8000);
});

ok('OCR 恒等式校验 + 同名去重 + 顺序无关加载', () => {
  assert.ok(CJ.ocr && typeof CJ.ocr.validate === 'function',
    'ocr.js 故意排在 ui.js 之前加载，仍应正常注册（回归：点击截图识别无反应）');
  const rows = [
    { name: '沪深300ETF', code: '510300', shares: 10000, cost: 38000, market: 40000 },
    { name: '沪深300ETF', code: '510300', shares: 10000, cost: 38000, market: 39000 },
    { name: '活期现金', code: '', shares: 0, cost: 0, market: 5000 }
  ];
  const d = CJ.ocr.dedupe(rows.map(r => Object.assign({}, r)));
  assert.strictEqual(d.length, 2, '同名同代码应去重');
  assert.strictEqual(d[0].market, 40000, '应保留市值较大的一条');
  const v = CJ.ocr.validate(rows, 84000);
  assert.strictEqual(v.items.length, 3);
  assert.ok(Math.abs(v.items[0].nav - 4) < 1e-9, '单位净值 = 市值 ÷ 份额');
  assert.strictEqual(v.checks[2].ok, 1, '分项合计与截图总市值一致应通过');
  assert.strictEqual(CJ.ocr.validate(rows, 45000).checks[2].ok, 0, '总市值不符应被标出');
  const weird = CJ.ocr.validate([{ name: '异常', shares: 1, cost: 10, market: 1000 }], 0);
  assert.ok(weird.items[0].flags.length >= 2, '净值/盈亏双异常应被标记');
  assert.strictEqual(weird.items[0].level, 'bad');
});

ok('六个视图 render 均产出有效 HTML', () => {
  global.CJ.app = { netLog: [] };
  const s = CJ.data.defaultState();
  ['home','plan','analysis','calculator','portfolio','settings'].forEach(k => {
    const html = CJ.views[k].render(s);
    assert.ok(typeof html === 'string' && html.length > 300, k + ' 输出过短');
    assert.ok(html.indexOf('undefined') < 0, k + ' 含 undefined（可能有未定义变量）');
    assert.ok(html.indexOf('NaN') < 0, k + ' 含 NaN');
  });
});

console.log('\n全部 ' + n + ' 组通过 ✓');
