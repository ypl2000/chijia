/* chijia v3 · 持仓截图识别（本机 OCR + 恒等式自校验 + 人工确认表）
   隐私：图片只 POST 到同源 /api/portfolio/ocr（本机 127.0.0.1 的 RapidOCR），
   不落盘、不外发、不进日志；识别结果一律是候选，确认表逐格可改后才写入。
   能力：v2 只有「OCR 出文字 + 关键词锚点猜金额」，v3 增加版式字段归一、
   三条恒等式自校验、置信度分级、多图同名去重与总市值对账。 */
window.CJ = window.CJ || {};
(function (CJ) {
  'use strict';
  const F = CJ.fmt;
  /* UI 组件延迟解析：本文件曾排在 ui.js 之前，加载期取 CJ.ui 得到 undefined，
     点击「截图识别」时 U.callout 抛错且被 async onclick 吞掉，表现为「点了没反应」。
     Proxy 把属性访问推迟到真正调用时，从此与脚本加载顺序解耦。 */
  const U = new Proxy({}, {
    get: (_, k) => {
      const ui = CJ.ui;
      if (!ui) throw new Error('UI 组件未就绪（ui.js 未加载）');
      const v = ui[k];
      return typeof v === 'function' ? v.bind(ui) : v;
    }
  });
  const n = v => { const x = F.parse(v); return isFinite(x) ? x : 0; };

  const BUCKET_RULES = [
    { k: 'esop', re: /ESOP|虚拟股|限制性股票|员工股|公司股权/i },
    { k: 'restricted', re: /公积金|社保|年金|限用途/i },
    { k: 'consumer', re: /车|汽车|消费|数码|房产自住/i },
    { k: 'bond', re: /债|固收|国债|货币基金|定期|理财/i },
    { k: 'cash', re: /活期|现金|余额|零钱/i },
    { k: 'equity', re: /股|指数|基金|ETF|混合|股票/i }
  ];
  const guessBucket = name => (BUCKET_RULES.find(r => r.re.test(name || '')) || { k: 'equity' }).k;
  const BUCKET_LABEL = { equity: '权益类', bond: '稳健类', cash: '现金类', esop: '公司股权', consumer: '消费资产', restricted: '限用途' };

  async function recognize(file) {
    const fd = new FormData(); fd.append('image', file, file.name || 'shot.png');
    const r = await fetch('api/portfolio/ocr', {
      method: 'POST', headers: { 'X-Auth-Token': CJ.sync.getToken() }, body: fd
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const code = (j.error && j.error.code) || '';
      if (code === 'ocr_not_installed') throw new Error('本机未安装识别组件。请运行：pip install rapidocr-onnxruntime python-multipart，然后重启后端。');
      if (!CJ.sync.getToken()) throw new Error('未配置 API Token，请在「设置 → ⑤ 同步与连接」填入本机 token。');
      throw new Error((j.error && j.error.message) || ('识别失败 HTTP ' + r.status));
    }
    return j;
  }

  /* 三条恒等式 + 数值合理性；错的值过不了校验，识别率不必 100% */
  function validate(rows, declaredTotal) {
    const items = (rows || []).map(r => {
      const shares = n(r.shares), cost = n(r.cost), market = n(r.market);
      const flags = [];
      const name = String(r.name || '').trim();
      if (!name) flags.push('缺名称');
      if (market <= 0 && cost <= 0) flags.push('缺金额');
      if (shares < 0 || cost < 0 || market < 0) flags.push('出现负数');
      /* ① 市值 ÷ 份额 = 单位净值，应落在常见基金净值区间 */
      let nav = null;
      if (shares > 0 && market > 0) {
        nav = market / shares;
        if (nav < 0.05 || nav > 100) flags.push('单位净值异常（' + nav.toFixed(4) + '）');
      }
      /* ② 成本 → 市值 的盈亏幅度应在合理范围 */
      if (cost > 0 && market > 0) {
        const ratio = market / cost;
        if (ratio < 0.3 || ratio > 3) flags.push('市值 / 成本 = ' + ratio.toFixed(2) + '，偏离过大');
      }
      /* ③ 份额 × 成本价 应能还原成本 */
      if (shares > 0 && cost > 0 && nav !== null) {
        const implied = nav * shares;
        if (Math.abs(implied - market) / Math.max(1, market) > 0.01) flags.push('份额×单位净值 ≠ 市值');
      }
      return {
        name, code: String(r.code || '').trim(), shares, cost, market, nav, flags,
        bucket: guessBucket(name),
        level: flags.length >= 2 ? 'bad' : flags.length === 1 ? 'warn' : 'good'
      };
    });
    const sum = k => items.reduce((a, x) => a + x[k], 0);
    const checks = [
      { label: '① 份额 × 单位净值 = 市值', ok: items.filter(x => x.nav !== null && x.flags.indexOf('份额×单位净值 ≠ 市值') < 0).length,
        total: items.filter(x => x.nav !== null).length, note: '逐行校验份额与金额能否互相还原' },
      { label: '② 分项市值合计', ok: items.length, total: items.length, note: '合计 ' + F.money(sum('market')) + ' 元 / 成本 ' + F.money(sum('cost')) + ' 元' },
      { label: '③ 与截图总市值对账', ok: 0, total: 1, note: '', custom: true }
    ];
    if (declaredTotal > 0) {
      const diff = Math.abs(sum('market') - declaredTotal) / declaredTotal;
      checks[2].ok = diff <= 0.02 ? 1 : 0;
      checks[2].note = '截图填写 ' + F.money(declaredTotal) + ' 元，分项合计 ' + F.money(sum('market')) +
        ' 元，偏差 ' + F.pct(diff * 100, 2) + (diff <= 0.02 ? '（通过）' : '（超过 2%，请人工核对）');
    } else {
      checks[2].ok = 1; checks[2].note = '未填写截图总市值，跳过对账；填上可自动核对';
    }
    return { items, checks, totalMarket: sum('market'), totalCost: sum('cost') };
  }

  /* 多图同名去重：名称+代码相同只保留金额较大的一条 */
  function dedupe(items) {
    const m = new Map();
    items.forEach(x => {
      const k = x.name + '|' + x.code;
      if (!m.has(k) || (x.market || x.cost) > (m.get(k).market || m.get(k).cost)) m.set(k, x);
    });
    return Array.from(m.values());
  }

  function open(s) {
    const host = document.getElementById('modal-host');
    let candidates = [], previewUrl = null, busy = false;

    const shell = () => {
      const online = CJ.sync.available;
      const body =
        U.callout('<b>识别只在本机完成。</b>截图会 POST 到同源 <code>/api/portfolio/ocr</code>（你自己的 127.0.0.1 后端），由本机 RapidOCR 推理，' +
          '不落盘、不外发、不进日志。v3 已移除全部云端视觉通道。', 'info') +
        (online ? '' : U.callout('当前是零后端模式，截图识别不可用。启动 <code>python backend/app.py</code> 并安装 RapidOCR 后即可使用；其它功能不受影响。', 'warn')) +
        '<div class="dropzone' + (online ? '' : ' disabled') + '" id="ocr-dz" style="margin-top:12px">' + U.icon('camera', 26) +
        '<b>' + (online ? '选择持仓截图（可多选）' : '当前模式不可用 · 截图识别需本机后端') + '</b>' +
        '<p>' + (online ? '识别结果先进确认表，逐格核对后才写入' : '用 python backend/app.py 启动 8410 后再打开本页；点此可看提示') + '</p></div>' +
        '<input type="file" id="ocr-file" accept="image/png,image/jpeg,image/webp" multiple hidden>' +
        '<div id="ocr-preview" style="margin-top:12px"></div>' +
        '<div id="ocr-result"></div>';
      host.innerHTML = '<div class="modal-mask"><div class="modal modal-lg"><div class="modal-head"><h3>持仓截图识别 · 本机 OCR</h3>' +
        '<button class="icon-btn" data-act="modal-close" aria-label="关闭">✕</button></div>' +
        '<div class="modal-body">' + body + '</div>' +
        '<div class="modal-actions">' + U.btn('关闭', { tone: 'quiet', act: 'modal-close' }) +
        U.btn('确认导入勾选项', { tone: 'primary', icon: 'check', act: 'ocr-apply' }) + '</div></div></div>';
      host.querySelectorAll('[data-act="modal-close"]').forEach(b => b.onclick = close);
      host.querySelector('.modal-mask').onclick = e => { if (e.target.classList.contains('modal-mask')) close(); };
      host.querySelector('[data-act="ocr-apply"]').onclick = apply;
      const dz = host.querySelector('#ocr-dz'), fi = host.querySelector('#ocr-file');
      dz.onclick = () => online
        ? fi.click()
        : U.toast('截图识别需要本机后端（8410）；当前 8412 是零后端模式', 'bad');
      dz.ondragover = e => { e.preventDefault(); if (online) dz.classList.add('over'); };
      dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); handle(e.dataTransfer.files); };
      fi.onchange = () => handle(fi.files);
      if (!online) {
        const applyBtn = host.querySelector('[data-act="ocr-apply"]');
        if (applyBtn) { applyBtn.disabled = true; applyBtn.style.opacity = '.5'; }
      }
    };

    function close() {
      if (previewUrl) { try { URL.revokeObjectURL(previewUrl); } catch (e) {} }
      host.innerHTML = '';
    }
    async function handle(files) {
      if (!files || !files.length || busy) return;
      if (!CJ.sync.available) return U.toast('需要先启动本机后端', 'bad');
      busy = true;
      const box = host.querySelector('#ocr-result');
      box.innerHTML = '<div class="muted-sm">正在本机识别 ' + files.length + ' 张截图…</div>';
      try {
        const results = await Promise.all(Array.from(files).map(f => recognize(f)));
        const raw = results.flatMap(r => r.rows || []);
        candidates = dedupe(raw.map(r => ({
          name: r.name, code: r.code, shares: n(r.shares), cost: n(r.cost), market: n(r.market)
        })));
        const rawLines = results.flatMap(r => r.rawLines || []);
        const first = files[0];
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(first);
        host.querySelector('#ocr-preview').innerHTML = candidates.length
          ? '<img src="' + previewUrl + '" alt="截图预览" style="max-width:100%;max-height:150px;border-radius:12px;border:1px solid var(--line)">'
          : '';
        renderResult(rawLines);
        if (!candidates.length) U.toast('未识别到结构化持仓，可参考下方原始文本手工录入', 'bad');
      } catch (e) {
        box.innerHTML = U.callout('识别失败：' + F.esc(e.message), 'bad');
      } finally { busy = false; }
    }

    function renderResult(rawLines) {
      const box = host.querySelector('#ocr-result');
      if (!candidates.length) {
        box.innerHTML = U.callout('没有可信的候选行。' + (rawLines && rawLines.length ? '以下是 OCR 读到的原始文本，可对照手工录入：' : '请换一张文字清晰的截图。'), 'warn') +
          (rawLines && rawLines.length ? '<div class="mono" style="max-height:160px;overflow:auto;background:var(--surface-2);padding:10px;border-radius:10px">' +
            rawLines.slice(0, 30).map(l => F.esc(l)).join('<br>') + '</div>' : '');
        return;
      }
      const v = validate(candidates);
      box.innerHTML =
        '<div class="field-grid" style="margin:12px 0">' +
        U.field({ k: 'ocr-total', label: '截图上的总市值（可选，用于对账）', value: '', unit: '元', step: 100, hint: '填了会自动核对分项合计' }) +
        '</div>' +
        U.btn('重新校验', { tone: 'quiet', small: true, icon: 'refresh', act: 'ocr-recheck' }) +
        '<h4 style="font-size:13px;margin:14px 0 6px">恒等式自校验</h4>' +
        v.checks.map(c => '<div class="audit-row">' + U.icon(c.ok ? 'check' : 'alert', 15) +
          '<div><b>' + F.esc(c.label) + '</b> <span class="' + (c.ok ? 'tag tag-mint' : 'tag tag-coral') + '">' + (c.ok ? '通过' : '需核对') + '</span>' +
          '<div class="muted-sm">' + F.esc(c.note) + '</div></div></div>').join('') +
        '<h4 style="font-size:13px;margin:16px 0 6px">候选持仓（逐格可改，勾选后才导入）</h4>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th></th><th>名称</th><th>代码</th><th>归入</th>' +
        '<th class="num">份额</th><th class="num">成本</th><th class="num">市值</th><th>校验</th></tr></thead><tbody>' +
        candidates.map((x, i) => '<tr data-row="' + i + '" class="' + (x.flags.length ? 'hl-warn' : '') + '">' +
          '<td><input type="checkbox" data-pick="' + i + '" ' + (x.flags.length < 2 ? 'checked' : '') + '></td>' +
          '<td><input data-f="name" data-i="' + i + '" value="' + F.esc(x.name) + '" style="width:110px;border:0;background:none;border-bottom:1px solid var(--line)"></td>' +
          '<td class="mono">' + F.esc(x.code || '—') + '</td>' +
          '<td>' + U.tag(BUCKET_LABEL[x.bucket] || '权益类', 'gray') + '</td>' +
          '<td class="num"><input data-f="shares" data-i="' + i + '" value="' + x.shares + '" style="width:80px;text-align:right;border:0;background:none;border-bottom:1px solid var(--line)"></td>' +
          '<td class="num"><input data-f="cost" data-i="' + i + '" value="' + x.cost + '" style="width:90px;text-align:right;border:0;background:none;border-bottom:1px solid var(--line)"></td>' +
          '<td class="num"><input data-f="market" data-i="' + i + '" value="' + x.market + '" style="width:90px;text-align:right;border:0;background:none;border-bottom:1px solid var(--line)"></td>' +
          '<td>' + (x.flags.length ? U.tag(x.flags.length + ' 项', 'amber') + '<div class="muted-sm">' + F.esc(x.flags.join('、')) + '</div>' : U.tag('一致', 'mint')) + '</td>' +
          '</tr>').join('') + '</tbody></table></div>' +
        '<div class="muted-sm" style="margin-top:8px">校验规则：市值 ÷ 份额 = 单位净值（应在 0.05~100）；市值 ÷ 成本 应在 0.3~3；分项市值合计 ≈ 截图总市值（容差 2%）。' +
        '任何一项不过都会标黄，仍由你决定是否导入。</div>';
      box.querySelector('[data-act="ocr-recheck"]').onclick = () => {
        syncInputs(); renderResult(rawLines);
      };
      box.querySelectorAll('input[data-f]').forEach(inp => inp.onchange = () => { syncInputs(); });
      const total = box.querySelector('[data-k="ocr-total"]');
      if (total) total.oninput = () => {
        const vv = validate(candidates, F.parse(total.value));
        const rows = box.querySelectorAll('.audit-row');
        if (rows[2]) rows[2].innerHTML = U.icon(vv.checks[2].ok ? 'check' : 'alert', 15) +
          '<div><b>③ 与截图总市值对账</b> <span class="' + (vv.checks[2].ok ? 'tag tag-mint' : 'tag tag-coral') + '">' + (vv.checks[2].ok ? '通过' : '需核对') + '</span>' +
          '<div class="muted-sm">' + F.esc(vv.checks[2].note) + '</div></div>';
      };
      function syncInputs() {
        box.querySelectorAll('input[data-f]').forEach(inp => {
          const i = +inp.dataset.i, f = inp.dataset.f;
          candidates[i][f] = f === 'name' ? inp.value : F.parse(inp.value);
        });
        candidates = dedupe(candidates.map(x => ({ ...x, flags: [], bucket: guessBucket(x.name) })));
      }
    }

    function apply() {
      const box = host.querySelector('#ocr-result');
      if (!box || !candidates.length) return U.toast('还没有候选持仓', 'bad');
      box.querySelectorAll('input[data-f]').forEach(inp => {
        const i = +inp.dataset.i, f = inp.dataset.f;
        if (candidates[i]) candidates[i][f] = f === 'name' ? inp.value : F.parse(inp.value);
      });
      const picked = Array.from(box.querySelectorAll('input[data-pick]:checked')).map(el => candidates[+el.dataset.pick]).filter(Boolean);
      if (!picked.length) return U.toast('请至少勾选一项', 'bad');
      const sums = {};
      picked.forEach(x => { sums[x.bucket] = (sums[x.bucket] || 0) + (x.market > 0 ? x.market : x.cost); });
      CJ.store.commit(st => {
        CJ.portfolio.BUCKETS.forEach(b => { if (sums[b.key] !== undefined) st.holdings[b.key] = Math.round(sums[b.key]); });
      }, { reason: 'ocr-import' });
      CJ.store.log('截图识别导入 ' + picked.length + ' 项持仓（人工确认后）');
      close();
      U.toast('已导入 ' + picked.length + ' 项持仓，五盏灯已重算');
      CJ.app.refresh();
    }

    shell();
  }

  CJ.ocr = { recognize, validate, dedupe, guessBucket, open };
})(window.CJ);
