/* chijia v3 · 设置页
   ① 数据备份 ② 流水导入 ③ 收入与口径 ④ 隐私与安全 ⑤ 同步与连接 ⑥ 关于
   隐私基线：零云视觉、零 CDN、零遥测；所有网络请求可审计；备份可口令加密。 */
window.CJ = window.CJ || {};
window.CJ.views = window.CJ.views || {};
(function (CJ) {
  'use strict';
  const U = CJ.ui, F = CJ.fmt;

  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  const b64 = u8 => btoa(String.fromCharCode.apply(null, Array.from(u8)));
  const unb64 = s => new Uint8Array(atob(s).split('').map(c => c.charCodeAt(0)));
  async function derive(pass, salt) {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encrypt(obj, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await derive(pass, salt);
    const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { app: 'chijia', version: 3, encrypted: true, kdf: 'PBKDF2-SHA256-150000', cipher: 'AES-256-GCM', salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(buf)) };
  }
  async function decrypt(o, pass) {
    const key = await derive(pass, unb64(o.salt));
    const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.data));
    return JSON.parse(new TextDecoder().decode(buf));
  }
  function stamp() { return new Date().toISOString().slice(0, 10); }

  function privacyList() {
    return [
      ['原始流水不上传、不落库', 'PDF / 截图只在内存解析，解析完即释放；交易明细只存在本机浏览器。'],
      ['零云视觉、零 CDN、零遥测', 'pdf.js 已本地内置于 vendor/pdfjs/，加载失败不会回退到任何外部地址；没有埋点、统计或第三方字体。'],
      ['后端默认只监听 127.0.0.1', '不配置后端时应用完整可用；启用同步时请保持本机监听，不要暴露到公网。'],
      ['所有请求可审计', '下方「网络请求审计」列出本会话发出的每一个请求，可自行核对目标地址。'],
      ['备份可口令加密', 'AES-256-GCM + PBKDF2 15 万次派生，口令不存储、不发送。'],
      ['一键清除与离屏锁定', '清除会抹掉本机账本、流水与设置；锁定后屏幕不显示任何财务数字。']
    ];
  }

  CJ.views.settings = {
    title: '设置', sub: '数据 · 隐私 · 同步',
    render(s) {
      let h = '';
      /* ① 备份 */
      h += U.card({
        id: 'sec-backup', title: '① 数据包备份', icon: 'download',
        sub: '账本 + 最新流水的合订本；兼容 v1 / v2 导出的 JSON',
        body: '<div class="btn-row">' +
          U.btn('导出备份 JSON', { tone: 'primary', icon: 'download', act: 'export' }) +
          U.btn('导出加密备份', { tone: 'quiet', icon: 'lock', act: 'export-enc' }) +
          U.btn('导入备份', { tone: 'quiet', icon: 'upload', act: 'import-open' }) +
          U.btn('重置为示例数据', { tone: 'ghost', icon: 'trash', act: 'reset' }) +
          '</div>' +
          '<input type="file" id="backup-file" accept=".json,.enc.json" hidden>' +
          U.callout('<b>建议节奏：</b>每月导入流水并应用 → 导出一次备份。重要改动（换机、大改）前先导一份。' +
            (s.meta.lastBackup ? ' 上次备份：' + new Date(s.meta.lastBackup).toLocaleString('zh-CN') : ' 目前还没有备份过。'), 'info')
      });

      /* ② 流水导入 */
      h += U.card({
        id: 'sec-import', title: '② 流水导入', icon: 'upload',
        sub: 'PDF / TXT / CSV / 粘贴文本，全部在本机解析；原始文件不上传、不落库',
        body: '<div class="dropzone" id="dz">' + U.icon('camera', 26) +
          '<b>点击选择流水文件（可多选）</b><p>支持文字可复制的 PDF、TXT、CSV；扫描件请改用粘贴文本</p></div>' +
          '<input type="file" id="stmt-file" accept=".pdf,.txt,.csv" multiple hidden>' +
          '<div style="margin:12px 0"><label class="field-label" for="paste-text">或直接粘贴流水文本</label>' +
          '<textarea id="paste-text" rows="4" placeholder="从 PDF 全选复制后粘贴到这里，每行一笔"></textarea></div>' +
          '<div class="btn-row">' + U.btn('解析并预览', { tone: 'primary', icon: 'spark', act: 'parse' }) + '</div>' +
          '<div id="import-preview"></div>' +
          '<div class="divider"></div>' +
          '<h4 style="font-size:12.5px;margin:0 0 6px">支持的流水格式</h4>' +
          U.table({ cls: 'compact', head: ['格式', '行格式说明'], rows: Object.keys(CJ.formats).map(k => [F.esc(CJ.formats[k].name), '<code>' + F.esc(CJ.formats[k].hint) + '</code>']) }) +
          U.callout('解析只更新流水统计与当期余额，<b>不会覆盖</b>账本里的股权、汽车、公积金等资产。多份流水重叠日期会自动去重。', 'info')
      });

      /* ③ 收入与口径 */
      const imp = s.importer;
      h += U.card({
        id: 'sec-income', title: '③ 收入与分类口径', icon: 'settings',
        sub: '这些参数决定流水怎么分类、健康度怎么评分',
        body: '<div class="field-grid">' +
          U.field({ k: 'monthlyExpense', label: '月支出（健康度口径）', value: s.settings.monthlyExpense, unit: '元', step: 100 }) +
          U.field({ k: 'employer', label: '雇主户名关键词', value: imp.employer, type: 'text', hint: '留空 = 不限制' }) +
          U.field({ k: 'salaryAbstract', label: '工资摘要关键词', value: imp.salaryAbstract, type: 'text' }) +
          U.field({ k: 'bonusMin', label: '奖金判定门槛', value: imp.bonusMin, unit: '元', step: 1000 }) +
          U.field({ k: 'bigExpenseMin', label: '大额支出阈值', value: imp.bigExpenseMin, unit: '元', step: 500 }) +
          '</div>' +
          '<div class="field-grid" style="margin-top:12px">' +
          U.field({ k: 'subsidyKeywords', label: '补贴/报销关键词（逗号分隔）', value: imp.subsidyKeywords.join(','), type: 'text' }) +
          U.field({ k: 'skipTypes', label: '排除类型（逗号分隔）', value: imp.skipTypes.join(','), type: 'text' }) +
          '</div>' +
          '<label class="check-row"><input type="checkbox" data-k="hasInsurance" ' + (s.settings.hasInsurance ? 'checked' : '') + '> 已持有重疾 / 医疗 / 意外险（影响健康度「风险保障」评分）</label>' +
          '<div class="btn-row">' + U.btn('保存口径', { tone: 'primary', icon: 'check', act: 'save-rules' }) + '</div>'
      });

      /* ④ 隐私与安全 */
      const logs = (CJ.app && CJ.app.netLog) || [];
      h += U.card({
        id: 'sec-privacy', title: '④ 隐私与安全', icon: 'shield',
        sub: '财务数据不出本机 —— 可核对、可加密、可清除',
        body: privacyList().map(x => '<div class="audit-row">' + U.icon('check', 15) + '<div><b>' + F.esc(x[0]) + '</b><div class="muted-sm">' + F.esc(x[1]) + '</div></div></div>').join('') +
          '<div class="divider"></div>' +
          '<h4 style="font-size:12.5px;margin:0 0 6px">网络请求审计（本会话）</h4>' +
          (logs.length ? '<div>' + logs.slice(0, 12).map(l => '<div class="audit-row"><code>' + F.esc(l.method) + ' ' + F.esc(l.url) + '</code><time class="muted-sm">' + new Date(l.t).toLocaleTimeString('zh-CN') + '</time></div>').join('') + '</div>'
            : U.callout('本会话还没有发出任何网络请求。页面与脚本均来自本机。', 'good')) +
          '<div class="muted-sm" style="margin-top:8px">数据存放：浏览器 localStorage（同步镜像）+ IndexedDB（库名 chijia_v3）；' +
          '当前账本约 ' + (JSON.stringify(s).length / 1024).toFixed(1) + ' KB，流水 ' + F.money((s.txns || []).length) + ' 笔。</div>' +
          '<div class="btn-row">' +
          U.btn('立即锁定', { tone: 'quiet', icon: 'lock', act: 'lock' }) +
          U.btn('一键清除本机数据', { tone: 'danger', icon: 'trash', act: 'wipe' }) +
          '</div>' +
          '<label class="check-row"><input type="checkbox" data-k="autoLock" ' + (s.settings.autoLock ? 'checked' : '') + '> 离开页面 2 分钟后自动锁定</label>' +
          U.callout('<b>本地模型（可选增强）：</b>本版本不接入任何云端大模型。若需要自然语言摘要，可在自己机器上跑 Ollama（127.0.0.1）并自行扩展，流量不出本机；默认关闭，也不随应用分发。', 'info')
      });

      /* ⑤ 同步与连接 */
      const online = CJ.sync.available;
      h += U.card({
        id: 'sec-sync', title: '⑤ 同步与连接', icon: 'sync',
        sub: online ? '已检测到本机后端 · 数据只在本机与自建后端之间同步' : '未检测到后端 · 当前为纯本地模式，全部功能可用',
        body: (online ? U.callout('后端已连接。所有 /api/* 请求需要本机 token；其他设备要同步需自行部署同一后端。', 'good')
          : U.callout('没启动后端也能完整使用。若要多设备同步：在本机运行 <code>python backend/app.py</code>（默认 127.0.0.1:8410），再到这里填入 token。', 'info')) +
          '<div class="field-grid" style="margin-top:10px">' +
          U.field({ k: 'syncToken', label: 'API Token', value: CJ.sync.getToken(), type: 'text', hint: 'backend/data/token.txt' }) +
          '</div>' +
          '<div class="btn-row">' +
          U.btn('保存 Token', { tone: 'quiet', icon: 'check', act: 'save-token' }) +
          U.btn('立即同步', { tone: 'primary', icon: 'sync', act: 'sync-now' }) +
          U.btn('创建快照', { tone: 'quiet', icon: 'plus', act: 'snap-new' }) +
          U.btn('刷新快照列表', { tone: 'ghost', icon: 'refresh', act: 'snap-list' }) +
          '</div>' +
          '<div id="snap-list">' + (online ? '<div class="muted-sm">点「刷新快照列表」查看服务端快照。</div>' : '') + '</div>'
      });

      /* ⑥ 关于 */
      h += U.card({
        id: 'sec-about', title: '⑥ 关于', icon: 'info',
        body: '<div class="kv"><span>版本</span><b>chijia v3.0.0</b></div>' +
          '<div class="kv"><span>形态</span><b>单页 PWA（无 iframe）</b></div>' +
          '<div class="kv"><span>技术</span><b>原生 HTML / CSS / JS · 零构建 · 零运行时依赖</b></div>' +
          '<div class="kv"><span>本地组件</span><b>pdf.js 3.11.174（vendor/pdfjs/）</b></div>' +
          '<div class="kv"><span>可选后端</span><b>FastAPI + SQLite（本机 127.0.0.1）</b></div>' +
          '<div class="muted-sm" style="margin-top:12px">v3 = v1 的完整业务模型（FIRE 三口径、四池月度推演、逐月执行表、双口径健康度）+ v2 的 APP 形态与数据层 + 全新浅色卡片设计；' +
          '把 v2 写死的 π 常数、静态健康度和被删掉的章节全部改成动态实算，并移除云视觉通道。</div>' +
          '<div class="btn-row">' + U.btn('打印 / 导出 PDF', { tone: 'quiet', icon: 'file', act: 'print' }) + '</div>'
      });
      return h;
    },

    mount(root, s) {
      let pendingText = '', pendingTxns = null;

      /* --- 文件选择 --- */
      const fileInput = root.querySelector('#stmt-file'), dz = root.querySelector('#dz');
      dz.onclick = () => fileInput.click();
      dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
      dz.ondragleave = () => dz.classList.remove('over');
      dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); readFiles(e.dataTransfer.files); };
      fileInput.onchange = () => readFiles(fileInput.files);

      function readFiles(files) {
        if (!files || !files.length) return;
        const jobs = Array.from(files).map(f => {
          if (/\.pdf$/i.test(f.name)) return f.arrayBuffer().then(CJ.pdf.extract);
          return f.text();
        });
        Promise.all(jobs).then(parts => {
          pendingText = parts.join('\n');
          U.toast('已读取 ' + files.length + ' 个文件，点「解析并预览」继续');
          dz.querySelector('b').textContent = '已载入 ' + files.length + ' 个文件';
        }).catch(e => U.toast('读取失败：' + e.message, 'bad'));
      }

      function parse() {
        const paste = root.querySelector('#paste-text').value.trim();
        const text = [pendingText, paste].filter(Boolean).join('\n');
        if (!text) return U.toast('请先选择文件或粘贴流水文本', 'bad');
        const txns = CJ.statement.parseStmtText(text);
        const box = root.querySelector('#import-preview');
        if (!txns.length) {
          pendingTxns = null;
          box.innerHTML = U.callout('<b>没有解析出交易。</b>常见原因：PDF 是扫描件（不可复制文字）、行格式不匹配、或数字带特殊符号。可对照下方「支持的流水格式」检查，或改用粘贴文本。', 'bad');
          return;
        }
        pendingTxns = txns;
        const ag = CJ.statement.aggregate(txns, s.importer);
        const inc = CJ.statement.income12m(txns, s.importer);
        box.innerHTML = U.callout('<b>预览：' + F.money(txns.length) + ' 笔</b>，期间 ' + ag.dMin + ' ~ ' + ag.dMax + '（' + ag.months + ' 个月），入账 ' + F.money(ag.totalIn) + ' 元 / 支出 ' + F.money(ag.totalOut) + ' 元。' +
          (inc ? ' 近 12 月月均收入 ' + F.money(inc.monthlyAvg) + ' 元。' : ''), 'good') +
          U.table({ cls: 'compact', head: ['日期', 'C/D', { t: '金额', num: true }, '摘要（前 ' + Math.min(5, txns.length) + ' 笔）'], rows: txns.slice(0, 5).map(t => [t.d, U.tag(t.dc, t.dc === 'C' ? 'mint' : 'coral'), { t: F.money2(t.amt), num: true }, F.esc((t.rest || '').slice(0, 36))]) }) +
          '<div class="btn-row">' + U.btn('应用到报告', { tone: 'primary', icon: 'check', act: 'apply-txns' }) + '</div>';
        box.querySelector('[data-act="apply-txns"]').onclick = () => applyTxns(txns);
      }

      function applyTxns(txns) {
        CJ.store.commit(st => {
          st.txns = txns;
          st.txnsRules = F.deepClone(st.importer);
          st.meta.importedAt = new Date().toISOString();
          const ag = CJ.statement.aggregate(txns, st.importer);
          st.meta.statsDim = '流水 ' + F.money(txns.length) + ' 笔 · ' + ag.months + ' 个月';
          const inc = CJ.statement.income12m(txns, st.importer);
          if (inc) Object.assign(st.income, inc, { src: '流水实算' });
          const sorted = txns.slice().sort((a, b) => ((a.d + (a.t || '')) > (b.d + (b.t || '')) ? 1 : -1));
          const last = sorted[sorted.length - 1];
          if (last && isFinite(last.bal) && last.bal >= 0) CJ.plan.applyBalance(st, last.bal);
        }, { reason: 'import-txns' });
        CJ.store.log('导入并应用 ' + F.money(txns.length) + ' 笔流水');
        U.toast('已应用 ' + F.money(txns.length) + ' 笔流水，分析与健康度已重算');
        setTimeout(() => CJ.app.go('analysis'), 350);
      }

      /* --- 备份 --- */
      const backupFile = root.querySelector('#backup-file');
      function doExport(enc) {
        const obj = CJ.store.exportJson();
        if (!enc) {
          download('chijia-v3-' + stamp() + '.json', JSON.stringify(obj, null, 2));
        } else {
          const pass = window.prompt('设置备份口令（请牢记，无法找回）：');
          if (!pass) return;
          encrypt(obj, pass).then(o => download('chijia-v3-' + stamp() + '.enc.json', JSON.stringify(o)))
            .catch(e => U.toast('加密失败：' + e.message, 'bad'));
        }
        CJ.store.commit(st => { st.meta.lastBackup = new Date().toISOString(); }, { reason: 'backup' });
        CJ.store.log(enc ? '导出加密备份' : '导出备份 JSON');
        U.toast('备份已导出');
      }
      async function doImport(file) {
        try {
          let obj = JSON.parse(await file.text());
          if (obj.encrypted) {
            const pass = window.prompt('输入备份口令：');
            if (!pass) return;
            obj = await decrypt(obj, pass);
          }
          if (await U.confirm('导入会整体替换当前账本与流水，确定继续？建议先导一份当前备份。', { title: '导入备份', okText: '确认导入', danger: true })) {
            if (CJ.sync.available) { try { await CJ.sync.createSnapshot('导入前自动快照'); } catch (e) {} }
            CJ.store.importJson(obj);
            CJ.store.log('导入数据包备份');
            U.toast('备份已导入'); CJ.app.refresh();
          }
        } catch (e) { U.toast('导入失败：' + e.message, 'bad'); }
      }
      backupFile.onchange = () => { if (backupFile.files[0]) doImport(backupFile.files[0]); };

      /* --- 事件委托 --- */
      root.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
        const a = b.dataset.act;
        if (a === 'export' || a === 'export-enc') doExport(a === 'export-enc');
        else if (a === 'import-open') backupFile.click();
        else if (a === 'parse') parse();
        else if (a === 'reset') {
          if (await U.confirm('重置为示例数据？当前账本与流水会被清空（不可撤销）。', { title: '重置数据', okText: '确认重置', danger: true })) {
            CJ.store.reset(); CJ.store.log('重置为示例数据'); U.toast('已重置'); CJ.app.refresh();
          }
        } else if (a === 'save-rules') {
          const val = k => { const e = root.querySelector('[data-k="' + k + '"]'); return e ? e.value : ''; };
          CJ.store.commit(st => {
            st.settings.monthlyExpense = F.parse(val('monthlyExpense'));
            st.importer.employer = val('employer').trim();
            st.importer.salaryAbstract = val('salaryAbstract').trim() || '工资';
            st.importer.bonusMin = F.parse(val('bonusMin'));
            st.importer.bigExpenseMin = F.parse(val('bigExpenseMin'));
            st.importer.subsidyKeywords = val('subsidyKeywords').split(/[,，]/).map(x => x.trim()).filter(Boolean);
            st.importer.skipTypes = val('skipTypes').split(/[,，]/).map(x => x.trim()).filter(Boolean);
            st.settings.hasInsurance = !!root.querySelector('[data-k="hasInsurance"]').checked;
          }, { reason: 'rules' });
          CJ.store.log('更新收入与分类口径');
          U.toast('口径已保存，分析与健康度已重算');
        } else if (a === 'lock') CJ.app.lock();
        else if (a === 'wipe') {
          if (await U.confirm('这会清除本机的账本、流水、设置和同步令牌，且不可恢复。确定继续？', { title: '清除本机数据', okText: '确认清除', danger: true })) {
            try { localStorage.clear(); } catch (e) {}
            try { indexedDB.deleteDatabase('chijia_v3'); } catch (e) {}
            U.toast('已清除，即将重载'); setTimeout(() => location.reload(), 600);
          }
        } else if (a === 'save-token') {
          CJ.sync.setToken(root.querySelector('[data-k="syncToken"]').value);
          U.toast('Token 已保存（只存本机）');
          CJ.sync.probe().then(() => CJ.app.refresh());
        } else if (a === 'sync-now') {
          U.toast('正在同步…');
          CJ.sync.sync().then(r => U.toast('同步完成：拉取' + (r.pulled ? '有更新' : '无更新') + ' / 推送' + (r.pushed ? '成功' : '跳过')))
            .catch(e => U.toast('同步失败：' + e.message, 'bad'));
        } else if (a === 'snap-new') {
          CJ.sync.createSnapshot('手动快照 ' + new Date().toLocaleString('zh-CN')).then(() => { U.toast('快照已创建'); listSnaps(); })
            .catch(e => U.toast('创建失败：' + e.message, 'bad'));
        } else if (a === 'snap-list') listSnaps();
        else if (a === 'print') window.print();
      });
      const autoLock = root.querySelector('[data-k="autoLock"]');
      if (autoLock) autoLock.onchange = () => CJ.store.commit(st => { st.settings.autoLock = autoLock.checked; }, { silent: true });

      function listSnaps() {
        const box = root.querySelector('#snap-list');
        if (!CJ.sync.available) { box.innerHTML = U.callout('未检测到后端，无法列出快照。', 'info'); return; }
        box.innerHTML = '<div class="muted-sm">读取中…</div>';
        CJ.sync.snapshots().then(list => {
          const arr = Array.isArray(list) ? list : (list.snapshots || []);
          box.innerHTML = arr.length ? U.table({
            cls: 'compact', head: ['创建时间', '标签', { t: '大小', num: true }, ''],
            rows: arr.slice(0, 10).map(x => [new Date(x.createdAt).toLocaleString('zh-CN'), F.esc(x.label || '—'), { t: (x.size / 1024).toFixed(1) + ' KB', num: true },
              '<button class="btn btn-sm btn-ghost" data-restore="' + x.id + '">回滚</button>'])
          }) : U.empty('还没有快照', '点「创建快照」先留一份');
          box.querySelectorAll('[data-restore]').forEach(btn => btn.onclick = async () => {
            if (await U.confirm('回滚会以前向写入的方式恢复快照内容（可再撤销），确定继续？', { title: '回滚快照', danger: true })) {
              CJ.sync.restore(btn.dataset.restore).then(() => { U.toast('已回滚'); CJ.app.refresh(); })
                .catch(e => U.toast('回滚失败：' + e.message, 'bad'));
            }
          });
        }).catch(e => { box.innerHTML = U.callout('读取失败：' + F.esc(e.message) + '（请检查 token）', 'bad'); });
      }
    }
  };
})(window.CJ);
