#!/usr/bin/env node
/* chijia v3 · 交互链路检查（零依赖，node tests/interaction-check.js）
   用 CDP 在真实浏览器里操作 DOM，验证：Tab 切换、主题切换、
   计划/计算器/体检参数实时重算、流水导入→分析页重算、备份导出结构。
   需先启动服务：python serve.py --port 8412 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const BASE = process.env.BASE || 'http://127.0.0.1:8412';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? ' → ' + extra : '')); }
};

async function main() {
  const profile = path.join(os.tmpdir(), 'chijia-it-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-allow-origins=*', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.some(t => t.type === 'page')) break; } catch (e) {}
    await sleep(250);
  }
  if (!targets) throw new Error('无法连接 Chrome CDP');
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const evalJS = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const go = async tab => { await send('Page.navigate', { url: BASE + '/#/' + tab }); await sleep(850); };

  console.log('chijia v3 · interaction test\n');
  await go('home');

  /* 1. 六 Tab 切换 */
  check('六 Tab 导航渲染完整', await evalJS(`document.querySelectorAll('.tab').length`) === 6);
  await evalJS(`document.querySelector('[data-tab="plan"]').click()`); await sleep(400);
  check('点击 Tab 切到计划页', await evalJS(`document.getElementById('page-title').textContent`) === '计划');

  /* 2. 主题切换 */
  await evalJS(`document.getElementById('theme-btn').click()`); await sleep(300);
  check('主题切换到深色', await evalJS(`document.documentElement.dataset.theme`) === 'dark');
  await evalJS(`document.getElementById('theme-btn').click()`); await sleep(300);
  check('主题切回浅色', await evalJS(`document.documentElement.dataset.theme`) === 'light');

  /* 3. 计划参数实时重算（不刷新页面、不丢焦点） */
  const before = await evalJS(`document.getElementById('plan-live').innerText.includes('62,000')`);
  await evalJS(`(()=>{const e=document.querySelector('[data-k="invest"]');e.focus();e.value='8000';e.dispatchEvent(new Event('input',{bubbles:true}));return document.activeElement===e;})()`);
  await sleep(250);
  const after = await evalJS(`document.getElementById('plan-live').innerText.includes('94,000')`);
  check('计划页定投 4000→8000 后基金推演变 94,000', before && after, `before=${before} after=${after}`);
  check('输入过程中焦点未被重渲染抢走', await evalJS(`document.activeElement.getAttribute('data-k')`) === 'invest');

  /* 4. 计算器参数实时重算 */
  await go('calculator');
  const c1 = await evalJS(`[...document.querySelectorAll('#calc-live .tier-total')].map(e=>e.textContent).join('|')`);
  await evalJS(`(()=>{const e=document.querySelector('.card-hero input[data-k="r"]');e.value='6';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(250);
  const c2 = await evalJS(`[...document.querySelectorAll('#calc-live .tier-total')].map(e=>e.textContent).join('|')`);
  check('计算器 r 4%→6% 后 CPI 档/账单档本金实时变化', c1 !== c2, `${c1} → ${c2}`);
  check('滑块与数字框双向同步', await evalJS(`(()=>{const r=document.querySelector('input[data-range="1"][data-k="r"]');return r && r.value==='6';})()`));

  /* 5. 体检实时重算 */
  await go('portfolio');
  const p1 = await evalJS(`document.getElementById('pf-live').innerText.includes('过度集中')`);
  await evalJS(`(()=>{const e=document.querySelector('.card-hero input[data-k="esop"]');e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(250);
  const p2 = await evalJS(`document.getElementById('pf-live').innerText.includes('无公司股权')`);
  check('体检 ESOP 清零后集中度灯实时变绿', p1 && p2, `before=${p1} after=${p2}`);

  /* 5b. 截图识别：零后端下也必须「点了有反应」
     历史 bug：ocr.js 早于 ui.js 加载，CJ.ui 为 undefined，异常被 async onclick 吞掉 */
  await evalJS(`(()=>{window.__errs=[];addEventListener('error',e=>window.__errs.push(String(e.message)));addEventListener('unhandledrejection',e=>window.__errs.push(String(e.reason)));return true;})()`);
  await evalJS(`document.querySelector('[data-act="ocr"]').click()`);
  await sleep(350);
  check('点击截图识别弹出说明窗口', await evalJS(`!!document.querySelector('#modal-host .modal')`));
  check('零后端模式给出明确提示', await evalJS(`document.getElementById('modal-host').innerText.includes('零后端模式')`));
  check('点击过程无 JS 异常', (await evalJS(`JSON.stringify(window.__errs)`)) === '[]');
  await evalJS(`document.querySelector('#modal-host [data-act="modal-close"]').click()`);
  await sleep(150);
  check('弹窗可正常关闭', await evalJS(`!document.querySelector('#modal-host .modal')`));

  /* 6. 流水导入 → 分析页真实重算 */
  await go('settings');
  const sample = [
    '1 2026-01-05 09:00:00 工资 C 21,000.00 21,000.00 622202 某公司 工资',
    '2 2026-02-05 09:00:00 工资 C 21,000.00 30,000.00 622202 某公司 工资',
    '3 2026-02-08 12:00:00 消费 D 12,000.00 18,000.00 622202 商场 购物',
    '4 2026-03-05 09:00:00 工资 C 21,000.00 28,000.00 622202 某公司 工资',
    '5 2026-03-09 12:00:00 报销 C 800.00 28,800.00 622202 公司 Employee Payment',
    '6 2026-04-05 09:00:00 工资 C 21,000.00 40,000.00 622202 某公司 工资',
    '7 2026-04-09 12:00:00 消费 D 9,000.00 31,000.00 622202 商场 购物',
    '8 2026-05-05 09:00:00 工资 C 21,000.00 45,000.00 622202 某公司 工资'
  ].join('\n');
  await evalJS(`(()=>{document.getElementById('paste-text').value=${JSON.stringify(sample)};document.querySelector('[data-act="parse"]').click();})()`);
  await sleep(300);
  check('解析预览显示 8 笔', await evalJS(`document.getElementById('import-preview').innerText.includes('预览：8 笔')`));
  await evalJS(`document.querySelector('#import-preview [data-act="apply-txns"]').click()`);
  await sleep(900);
  check('应用后自动跳到分析页', await evalJS(`document.getElementById('page-title').textContent`) === '分析');
  const aText = await evalJS(`document.getElementById('view').innerText`);
  check('分析页出现 2.1 收入结构与季度统计', aText.includes('2.1') && aText.includes('补贴 / 报销季度统计'));
  check('分析页出现大额支出与消费画像', aText.includes('2.2') && aText.includes('2.4'));
  check('洞察引擎产出可解释结论', aText.includes('洞察') && aText.includes('查看计算式'));
  check('双口径健康度 14 维评分存在', aText.includes('3.3') && aText.includes('3.4') && aText.includes('★'));
  check('统计维度切换为真实流水', (await evalJS(`CJ.store.state.meta.statsDim`)).includes('8 笔'));

  /* 7. 导出备份结构 */
  const backup = await evalJS(`JSON.stringify(CJ.store.exportJson())`);
  const obj = JSON.parse(backup);
  check('导出备份含 state / txns / version 3', obj.version === 3 && !!obj.state && obj.state.txns.length === 8);

  /* 8. 刷新后数据仍在（本地持久化） */
  await go('home');
  check('刷新后流水数据仍在本机', await evalJS(`CJ.store.state.txns.length`) === 8);

  /* 清理测试 profile 的数据，避免影响用户后续查看 */
  await evalJS(`localStorage.clear();`);
  ws.close(); chrome.kill();
  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
