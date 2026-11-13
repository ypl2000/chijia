#!/usr/bin/env node
/* chijia v3 · 真实浏览器检查（零依赖，node tests/browser-check.js）
   通过 CDP 强制设置设备视口，避免 Windows 无头 Chrome 的最小窗口宽度干扰：
   - 检查六页 JS 运行时异常
   - 检查横向溢出（scrollWidth > innerWidth）
   - 输出 390 / 1440 两个视口的截图到 tests/shots/
   需先启动服务：python serve.py --port 8412 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const BASE = process.env.BASE || 'http://127.0.0.1:8412';
const OUT = path.join(__dirname, 'shots');
const TABS = ['home', 'plan', 'analysis', 'calculator', 'portfolio', 'settings'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.join(os.tmpdir(), 'chijia-cdp-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-allow-origins=*', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await r.json();
      if (targets.some(t => t.type === 'page')) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!targets) throw new Error('无法连接 Chrome CDP');
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception || {}).description || '');
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value || a.description).join(' '));
  };
  const send = (method, params) => new Promise(res => {
    const id = ++seq; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

  for (const [name, width, height, mobile] of [['m', 390, 844, true], ['d', 1440, 900, false]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    console.log(`\n=== ${name} (${width}×${height}) ===`);
    for (const tab of TABS) {
      errors.length = 0;
      await send('Page.navigate', { url: BASE + '/#/' + tab });
      await sleep(900);
      const ev = await send('Runtime.evaluate', {
        expression: `JSON.stringify({w:innerWidth,sw:document.documentElement.scrollWidth,title:document.getElementById('page-title').textContent,cards:document.querySelectorAll('.card,.fold').length,tabs:document.querySelectorAll('.tab').length,viewLen:document.getElementById('view').innerText.length})`,
        returnByValue: true
      });
      let o = {}; try { o = JSON.parse(ev.result.result.value); } catch (e) {}
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      if (shot.result && shot.result.data) fs.writeFileSync(path.join(OUT, `${name}-${tab}.png`), Buffer.from(shot.result.data, 'base64'));
      const overflow = o.sw > o.w + 2 ? `溢出 ${o.sw - o.w}px` : '无溢出';
      console.log(`  ${tab.padEnd(11)} 视口${o.w} 内容${o.sw} ${overflow.padEnd(12)} 卡片${String(o.cards).padStart(2)} Tab${o.tabs} 文本${o.viewLen} 错误${errors.length}`);
      if (errors.length) errors.slice(0, 3).forEach(e => console.log('    ! ' + e.slice(0, 180)));
    }
  }
  ws.close(); chrome.kill();
  console.log('\n截图输出：' + OUT);
}
main().catch(e => { console.error(e); process.exit(1); });
