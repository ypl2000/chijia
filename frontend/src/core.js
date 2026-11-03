/**
 * 持家 chijia v2 · core.js
 * 全部逻辑：渲染器 + 计划引擎 + 导入管线 + 通用 boot + cardify12。
 *
 * ⚠ 纯函数库：无自执行代码、无顶层副作用；boot() 由各页面脚本自行调用，
 *   boot 内部才挂 hashchange / beforeprint / online 等监听。
 *
 * 金额口径（章程 D4）：千分位纯数字字符串；计划页整数、流水页两位小数；
 * `≈` 前缀表示估算；计算器内部单位「万」。
 *
 * 渲染安全口径：DATA 中字段名以 `html`/`readout`/`arrowCap` 结尾的可信 HTML
 * 字段按 innerHTML 渲染（docs/DATA.md）；其余一律 textContent（转义）。
 */

import { FORMATS } from './formats.js';
import { DATA as SAMPLE_DATA } from './data.js';
import { commitChange, kvGet } from './idb.js';
import { flushOutbox, installAutoSync, pullState, ensureSafetySnapshot } from './sync.js';

/* --------------------------------- 类型定义 -------------------------------- */

/** @typedef {'C'|'D'} Dc 借贷标志：C=入账，D=支出 */

/**
 * 标准化交易对象（IMPORT.md map 契约）。
 * @typedef {Object} Txn
 * @property {string} d  日期 YYYY-MM-DD
 * @property {string} t  交易类型
 * @property {Dc} dc     借贷标志
 * @property {number} amt 金额（元，正数）
 * @property {string} rest 户名+摘要（合并文本，用于雇主/补贴关键词分类）
 * @property {number} [bal] 交易后余额（元；格式注册表可选提供，applyBalance 用）
 * @property {string} [cat] 分类结果（classify 写回）：
 *   salary / bonus / subsidy / bigExpense / skip / other
 */

/**
 * 导入分类规则（DATA.meta.importer）。
 * @typedef {Object} ImporterRules
 * @property {string[]} employer 雇户户名关键词
 * @property {string} [salaryAbstract] 工资摘要（默认「工资」）
 * @property {string[]} [subsidyKeywords] 补贴摘要关键词
 * @property {string[]} [skipTypes] 排除的交易类型关键词
 * @property {number} [bonusMin] 工资通道金额 ≥ 此值判为奖金
 * @property {number} [bigExpenseMin] 大额支出阈值
 */

/**
 * 计划推演参数。
 * @typedef {Object} PlanParams
 * @property {number} income 月均可支配收入（元）
 * @property {number} consume 消费池（元/月）
 * @property {number} invest 投资池（元/月）
 * @property {number} cushion 缓冲池（元/月）
 * @property {number} esop ESOP 池（元/月）
 * @property {number} years 推演年数
 * @property {number} rate 年化收益率假设（小数，如 0.05）
 * @property {number} base 金融资产期初本金（元）
 */

/**
 * DATA 顶层对象（docs/DATA.md 词表）。
 * @typedef {import('./data.js').DATA} DATA
 */

/** @typedef {import('./data.js').Part} Part */
/** @typedef {import('./data.js').Block} Block */

/* ---------------------------------- 小工具 --------------------------------- */

/**
 * HTML 转义（所有非可信 html 字段统一走这里）。
 * @param {any} s
 * @returns {string}
 */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 千分位整数（D4：计划页金额口径；负数保留符号）。
 * @param {number} n
 * @returns {string}
 */
export function fmtInt(n) {
  const v = Math.round(Number(n) || 0);
  const sign = v < 0 ? '-' : '';
  return sign + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 千分位两位小数（D4：流水页金额口径）。
 * @param {number} n
 * @returns {string}
 */
export function fmtMoney(n) {
  const v = Number(n) || 0;
  const neg = v < 0;
  const [ip, fp] = Math.abs(v).toFixed(2).split('.');
  return (neg ? '-' : '') + ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + fp;
}

/** @returns {HTMLElement} 创建元素；text 提供时按 textContent 写入 */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = String(text);
  return node;
}

/** 深拷贝（DATA 均为 JSON 安全值） */
function deepClone(v) {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}

/** 从「标签: 金额」文案里提取整数（如 hero item b '≈1,160,000' → 1160000） */
function parseNum(s) {
  const m = String(s ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

/* ---------------------------------- 渲染器 --------------------------------- */

/**
 * 渲染 Hero（顶部左右分栏：现在 / 计划期末，中间箭头自动生成）。
 * @param {HTMLElement} mount 挂载容器（清空后渲染）
 * @param {DATA['hero']} hero `{ now: {head, items:[{label,b}]}, exp: {…} }`
 * @returns {void}
 */
export function renderHero(mount, hero) {
  if (!mount) return;
  mount.textContent = '';
  const wrap = el('div', 'hero');
  const sides = /** @type {const} */ ([['now', hero?.now, 'hero-side'], ['exp', hero?.exp, 'hero-side hero-side-exp']]);
  let first = true;
  for (const [, side, cls] of sides) {
    if (!first) wrap.appendChild(el('div', 'hero-arrow', '➜'));
    first = false;
    const box = el('div', cls);
    box.appendChild(el('div', 'hero-head', side?.head ?? ''));
    const ul = el('ul', 'hero-list');
    for (const it of side?.items ?? []) {
      const li = el('li', 'hero-item');
      li.appendChild(el('span', 'hero-label', it.label));
      li.appendChild(el('b', 'hero-val num', it.b));
      ul.appendChild(li);
    }
    box.appendChild(ul);
    wrap.appendChild(box);
  }
  mount.appendChild(wrap);
}

/**
 * 渲染置顶「资金分布 & 计划总览」（双栈条 + 对照表 + 结构读数）。
 * @param {HTMLElement} mount
 * @param {DATA['overview']} overview 见 docs/DATA.md overview 字段表
 * @returns {void}
 */
export function renderOverview(mount, ov) {
  if (!mount) return;
  mount.textContent = '';
  const panel = el('section', 'panel ov-panel');

  const head = el('div', 'ov-head');
  const h2 = el('h2', 'ov-title', ov?.title ?? '');
  head.appendChild(h2);
  if (ov?.note) head.appendChild(el('p', 'hint ov-note', ov.note));
  panel.appendChild(head);

  const wrap = el('div', 'ov-wrap');
  for (const key of /** @type {const} */ (['now', 'exp'])) {
    if (key === 'exp') {
      const arrow = el('div', 'ov-arrow');
      arrow.appendChild(el('div', 'ov-arrow-glyph', '➜'));
      if (ov?.arrowCap != null) {
        const cap = el('div', 'ov-arrow-cap');
        cap.innerHTML = ov.arrowCap; // 可信 HTML（支持 <br>）
        arrow.appendChild(cap);
      }
      wrap.appendChild(arrow);
    }
    const side = ov?.[key];
    const box = el('div', 'ov-side' + (key === 'exp' ? ' ov-side-exp' : ''));
    box.appendChild(el('div', 'ov-side-head', side?.head ?? ''));
    box.appendChild(el('div', 'ov-total num', side?.total ?? ''));
    box.appendChild(el('div', 'ov-sub hint', side?.sub ?? ''));

    const stack = el('div', 'stack');
    stack.setAttribute('role', 'img');
    stack.setAttribute('aria-label', (side?.head ?? '') + ' 资金分布');
    for (const seg of side?.stack ?? []) {
      const s = el('span');
      const w = Number(seg.w) || 0;
      s.style.width = w + '%';
      s.style.background = seg.color || 'var(--c-invest)';
      if (seg.label) {
        s.title = seg.label;
        // V-2：窄段（<15%）不在段内强塞文字（防裁切），悬浮提示 + 下方图例
        if (w >= 15) s.textContent = seg.label;
      }
      stack.appendChild(s);
    }
    box.appendChild(stack);
    // V-2：图例外置
    if ((side?.stack ?? []).length) {
      const legend = el('ul', 'stack-legend');
      for (const seg of side?.stack ?? []) {
        const li = el('li', 'stack-leg');
        const sw = el('i', 'swatch');
        sw.style.background = seg.color || 'var(--c-invest)';
        li.appendChild(sw);
        li.appendChild(el('span', null, seg.label ?? ''));
        legend.appendChild(li);
      }
      box.appendChild(legend);
    }

    const rows = el('ul', 'ov-rows');
    for (const r of side?.rows ?? []) {
      const li = el('li', 'ov-row' + (r.muted ? ' muted' : '') + (r.neg ? ' neg' : ''));
      const dot = el('i', 'dot');
      dot.style.background = r.c || 'var(--c-invest)';
      li.appendChild(dot);
      li.appendChild(el('span', 'ov-name', r.name));
      li.appendChild(el('b', 'ov-amt num', r.amt));
      li.appendChild(el('span', 'ov-pc num', r.pc));
      rows.appendChild(li);
    }
    box.appendChild(rows);
    if (side?.callout) {
      const c = el('div', 'callout ov-callout');
      c.textContent = side.callout;
      box.appendChild(c);
    }
    wrap.appendChild(box);
  }
  panel.appendChild(wrap);

  if (Array.isArray(ov?.tableRows) && ov.tableRows.length) {
    const wrapEl = el('div', 'table-wrap ov-table-wrap');
    const table = el('table', 'data-table ov-table');
    const thead = el('thead');
    const hr = el('tr');
    for (const h of ['对照项', '现在', '计划期末', '说明']) {
      const th = el('th', null, h);
      if (h !== '对照项' && h !== '说明') th.classList.add('num');
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    for (const r of ov.tableRows) {
      const tr = el('tr', r.total ? 'is-total' : '');
      const tdTag = el('td');
      const tag = el('span', 'tag' + (r.tagCls ? ' ' + r.tagCls : ''), r.tag);
      if (r.tagStyle) tag.setAttribute('style', r.tagStyle);
      tdTag.appendChild(tag);
      tr.appendChild(tdTag);
      tr.appendChild(el('td', 'num', r.now));
      tr.appendChild(el('td', 'num', r.exp));
      tr.appendChild(el('td', 'hint', r.note));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrapEl.appendChild(table);
    panel.appendChild(wrapEl);
  }

  if (ov?.readout) {
    const ro = el('div', 'callout ov-readout');
    ro.innerHTML = ov.readout; // 可信 HTML（DATA.md：结构读数为 HTML 字符串）
    panel.appendChild(ro);
  }
  mount.appendChild(panel);
}

/**
 * 渲染一组 block（DATA.md block 词表，details 类型递归）。
 * @param {HTMLElement} mount
 * @param {Block[]} blocks
 * @returns {void}
 */
export function renderBlocks(mount, blocks) {
  if (!mount) return;
  for (const b of blocks ?? []) {
    if (!b || !b.t) continue;
    switch (b.t) {
      case 'sub': {
        const p = el('p', 'block-sub');
        p.innerHTML = b.html ?? ''; // 可信 HTML
        mount.appendChild(p);
        break;
      }
      case 'h4': {
        const h = el('h4', 'block-h4');
        h.innerHTML = b.html ?? ''; // 可信 HTML（可含 span.hint）
        mount.appendChild(h);
        break;
      }
      case 'callout': {
        const c = el('div', 'callout' + (b.kind ? ' ' + b.kind : ''));
        c.innerHTML = b.html ?? ''; // 可信 HTML
        mount.appendChild(c);
        break;
      }
      case 'table':
        mount.appendChild(buildTable(/** @type {any} */ (b)));
        break;
      case 'allocbar': {
        const bar = el('div', 'allocbar');
        const items = b.items ?? [];
        const ALLOC_COLORS = {
          'ab-consume': 'var(--c-consume)',
          'ab-invest': 'var(--c-invest)',
          'ab-cushion': 'var(--c-cushion)',
          'ab-esop': 'var(--c-esop)',
        };
        for (const it of items) {
          const s = el('span', it.cls ?? '');
          s.textContent = it.label ?? '';
          // 无宽度字段时，从 label 尾部提取百分比；都没有则均分。
          // flex-shrink 1：百分比合计超出 100% 时按比例收缩，避免溢出。
          // V-3：窄段（<15%，与 V-2 同阈值）不在段内塞字（防裁切为碎片），悬浮提示 + 下方图例。
          const m = String(it.label ?? '').match(/(\d+(?:\.\d+)?)\s*%\s*$/);
          s.style.flex = m ? `0 1 ${m[1]}%` : '1 1 0';
          if (m && Number(m[1]) < 15) {
            s.textContent = '';
            s.title = it.label ?? '';
          }
          bar.appendChild(s);
        }
        mount.appendChild(bar);
        // V-3：图例外置
        if (items.length) {
          const legend = el('ul', 'alloc-legend');
          for (const it of items) {
            const li = el('li', 'alloc-leg');
            const sw = el('i', 'swatch');
            sw.style.background = ALLOC_COLORS[it.cls] ?? 'var(--c-surface-2)';
            li.appendChild(sw);
            li.appendChild(el('span', null, it.label ?? ''));
            legend.appendChild(li);
          }
          mount.appendChild(legend);
        }
        break;
      }
      case 'cards': {
        const grid = el('div', 'card-grid stat-cards');
        for (const it of b.items ?? []) {
          const card = el('div', 'card stat-card');
          card.appendChild(el('div', 'stat-lab hint', it.lab));
          card.appendChild(el('div', 'stat-val num', it.val));
          if (it.note) card.appendChild(el('div', 'stat-note hint', it.note));
          if (it.total) {
            const emoji = String(it.total).charAt(0);
            const mood = emoji === '🟢' ? ' tag-ok' : emoji === '🟡' ? ' tag-warn' : emoji === '🔴' ? ' tag-danger' : '';
            card.appendChild(el('div', 'tag' + mood, it.total));
          }
          grid.appendChild(card);
        }
        mount.appendChild(grid);
        break;
      }
      case 'picgrid': {
        const grid = el('div', 'pic-grid');
        for (const it of b.items ?? []) {
          const cell = el('div', 'cell');
          cell.appendChild(el('b', null, it.h));
          cell.appendChild(el('span', null, it.d));
          grid.appendChild(cell);
        }
        mount.appendChild(grid);
        break;
      }
      case 'flow': {
        const chain = el('div', 'flow-chain');
        const steps = b.steps ?? [];
        steps.forEach((st, i) => {
          const step = el('div', 'step');
          step.appendChild(el('b', null, st.t));
          step.appendChild(el('span', 'hint', st.d));
          chain.appendChild(step);
          if (i < steps.length - 1) chain.appendChild(el('span', 'flow-sep', '→'));
        });
        mount.appendChild(chain);
        break;
      }
      case 'tier': {
        const box = el('div', 'tier');
        const bar = el('div', 'tier-bar');
        for (const r of b.rows ?? []) {
          const s = el('span');
          s.style.width = (Number(r.w) || 0) + '%';
          s.style.background = r.bg || 'var(--c-invest)';
          if (r.ink) s.style.color = r.ink;
          s.textContent = r.label ?? '';
          s.title = `${r.label} ${r.tag ?? ''}`.trim();
          bar.appendChild(s);
        }
        box.appendChild(bar);
        const legend = el('ul', 'tier-legend');
        for (const r of b.rows ?? []) {
          const li = el('li', 'tier-leg');
          const sw = el('i', 'swatch');
          sw.style.background = r.bg || 'var(--c-invest)';
          li.appendChild(sw);
          li.appendChild(el('span', 'tier-leg-label', r.label));
          li.appendChild(el('span', 'tag' + (r.tagCls ? ' ' + r.tagCls : ''), r.tag));
          legend.appendChild(li);
        }
        box.appendChild(legend);
        mount.appendChild(box);
        break;
      }
      case 'ms': {
        const cloud = el('div', 'ms-cloud');
        for (const item of b.items ?? []) cloud.appendChild(el('span', 'tag', item));
        mount.appendChild(cloud);
        break;
      }
      case 'procons': {
        const grid = el('div', 'procons');
        const mk = (cls, title, items) => {
          const card = el('div', 'procons-col ' + cls);
          card.appendChild(el('h4', null, title));
          const ul = el('ul');
          for (const it of items ?? []) ul.appendChild(el('li', null, it));
          card.appendChild(ul);
          return card;
        };
        grid.appendChild(mk('pros', b.prosTitle ?? '优点', b.pros));
        grid.appendChild(mk('cons', b.consTitle ?? '缺点', b.cons));
        mount.appendChild(grid);
        break;
      }
      case 'distrows': {
        const box = el('div', 'dist-rows');
        for (const r of b.rows ?? []) {
          const row = el('div', 'dist-row');
          const name = el('span', 'dist-name', r.name);
          name.title = String(r.name ?? ''); // V-4：截断时悬浮全文
          row.appendChild(name);
          const bar = el('div', 'bar');
          const i = el('i');
          i.style.width = (Number(r.w) || 0) + '%';
          i.style.background = r.color || 'var(--c-invest)';
          bar.appendChild(i);
          row.appendChild(bar);
          row.appendChild(el('span', 'dist-pct num', r.pct));
          box.appendChild(row);
        }
        mount.appendChild(box);
        break;
      }
      case 'details': {
        const d = el('details', 'panel details-block');
        d.appendChild(el('summary', null, b.title ?? '展开'));
        const body = el('div', 'panel-body');
        renderBlocks(body, b.blocks); // 递归
        d.appendChild(body);
        mount.appendChild(d);
        break;
      }
      case 'gap': {
        const g = el('div', 'gap');
        g.style.height = b.h ?? '16px';
        mount.appendChild(g);
        break;
      }
      default:
        // 未知类型：静默跳过（保持控制台零报错），留注释便于排查
        mount.appendChild(document.createComment(`unknown block: ${b.t}`));
    }
  }
}

/**
 * 构建 table block 对应的表格元素（cell 支持 {h,num?,cls?,bar?}）。
 * @param {Extract<Block, {t:'table'}>} block
 * @returns {HTMLTableElement}
 */
export function buildTable(block) {
  const wrap = el('div', 'table-wrap');
  const table = /** @type {HTMLTableElement} */ (el('table', 'data-table'));
  const head = /** @type {any} */ (block).head ?? [];
  // hideNarrow 列（说明性尾列，1.3「构成」）：≤480px 视口整列隐藏（th/td 同步打标，
  // CSS 见 app.css .col-hide-narrow）——PM 裁决方案①，390 下避免长文案列逐字竖排
  const hideNarrowCols = new Set(
    head
      .map((h, i) => (h && typeof h === 'object' && h.hideNarrow ? i : -1))
      .filter((i) => i >= 0),
  );
  if (head.length) {
    const thead = el('thead');
    const tr = el('tr');
    head.forEach((h, i) => {
      const isObj = h && typeof h === 'object';
      const th = el('th', ((isObj && h.num ? 'num ' : '') + (hideNarrowCols.has(i) ? 'col-hide-narrow' : '')).trim() || null, isObj ? h.h : h);
      if (isObj && h.w) th.style.width = String(h.w);
      if (isObj && h.minw) th.style.minWidth = String(h.minw); // VIS-O-1：列宽硬下限（auto 布局下 width 会被 CJK 逐字断行压缩）
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
  }
  const tbody = el('tbody');
  for (const row of /** @type {any} */ (block).rows ?? []) {
    let cls = row.cls ?? '';
    if (cls === 'total') cls += ' is-total';
    if (cls === 'muted') cls += ' is-muted';
    const tr = el('tr', cls || null);
    (row.cells ?? []).forEach((cell, i) => {
      const isObj = cell && typeof cell === 'object';
      const td = el('td', ((isObj && cell.num ? 'num ' : '') + (isObj && cell.cls ? cell.cls : '') + (hideNarrowCols.has(i) ? ' col-hide-narrow' : '')).trim() || null);
      if (isObj && cell.bar) {
        const bc = el('div', 'bar-cell');
        bc.appendChild(el('span', null, cell.h ?? ''));
        const bar = el('div', 'bar');
        const fill = el('i');
        fill.style.width = Math.max(0, Math.min(100, Number(cell.bar.pct) || 0)) + '%';
        bar.appendChild(fill);
        bc.appendChild(bar);
        td.appendChild(bc);
      } else {
        td.textContent = isObj ? String(cell.h ?? '') : String(cell ?? '');
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return /** @type {HTMLTableElement} */ (wrap.firstElementChild);
}

/**
 * 渲染 parts 全部章节；part.rules 存在时自动双栏（章节左、保护规则右）。
 * @param {HTMLElement} mount
 * @param {Part[]} parts
 * @param {{defaultCollapsed?: boolean}} [opts] 分析页各节默认折叠（UX-SPEC §3）
 * @returns {void}
 */
export function renderParts(mount, parts, opts = {}) {
  if (!mount) return;
  mount.textContent = '';
  for (const part of parts ?? []) {
    const section = el('section', 'part');
    section.id = 'part-' + (part.id ?? '');

    const head = el('div', 'part-head');
    const h2 = el('h2', 'part-title');
    if (part.no) h2.appendChild(el('span', 'part-no', part.no));
    h2.appendChild(document.createTextNode(part.title ?? ''));
    head.appendChild(h2);
    if (part.note) head.appendChild(el('p', 'hint part-note', part.note));
    section.appendChild(head);

    if (part.rules) {
      // 双栏：章节左、保护规则右（DATA.md parts 从属规则）
      const layout = el('div', 'part-layout');
      const left = el('div', 'part-sections');
      appendSections(left, part.sections, opts);
      layout.appendChild(left);
      const aside = el('aside', 'card rules-col');
      aside.id = 'rules-' + (part.id ?? '');
      aside.appendChild(el('h3', 'rules-title', part.rules.title ?? '保护规则'));
      const rulesBody = el('div', 'rules-body');
      renderBlocks(rulesBody, part.rules.blocks);
      aside.appendChild(rulesBody);
      layout.appendChild(aside);
      section.appendChild(layout);
    } else {
      appendSections(section, part.sections, opts);
    }
    mount.appendChild(section);
  }
}

/** 章节（可折叠面板）序列；opts.defaultCollapsed 控制初始开合 */
function appendSections(mount, sections, opts) {
  for (const sec of sections ?? []) {
    const d = el('details', 'panel section-panel');
    d.id = sec.id ?? '';
    d.open = !opts.defaultCollapsed;
    const summary = el('summary', 'sec-summary', sec.title ?? '');
    d.appendChild(summary);
    const body = el('div', 'panel-body sec-body');
    renderBlocks(body, sec.blocks);
    d.appendChild(body);
    mount.appendChild(d);
  }
}

/* --------------------------------- 计划引擎 -------------------------------- */

/**
 * 等额定投终值系数：((1+r)^n − 1) / r（r=0 时退化为 n）。
 */
function annuityFV(r, n) {
  if (n <= 0) return 0;
  if (!r) return n;
  return (Math.pow(1 + r, n) - 1) / r;
}

/**
 * 计划推演：按参数与近 12 个月收入计算四池分配、可行性与期末预期。
 *
 * 口径（D19）：
 *  - 可支配 = plan.income（缺省时退化为 income12m/12 的月均值）；
 *  - 可行性 = 三池合计（消费+投资+缓冲）≤ 可支配，超出即不可行（红字警告）；
 *    ESOP 为独立第四池：展示于 allocbar、计入期末净资产，但不参与可行性判定；
 *  - 期末金融资产 = 期初本金复利 + 投资池定投复利 + 缓冲池无收益累计（保守）；
 *  - ESOP 按购入成本累计（不计收益），计入净资产。
 *
 * @param {PlanParams} plan
 * @param {number} income12m 近 12 个月总收入（元；computeIncome12m 的结果）
 * @returns {{feasible: boolean, warn?: string, pools: {consume:number, invest:number, cushion:number, esop:number}, months: number, endFinance: number, endNet: number, avgIncome12m: number, milestones: Array<{when: string, what: string}>}}
 */
export function computePlan(plan, income12m = 0) {
  const p = /** @type {PlanParams} */ ({
    income: Number(plan?.income) || 0,
    consume: Number(plan?.consume) || 0,
    invest: Number(plan?.invest) || 0,
    cushion: Number(plan?.cushion) || 0,
    esop: Number(plan?.esop) || 0,
    years: Math.max(1, Math.round(Number(plan?.years) || 1)),
    rate: Number(plan?.rate) || 0,
    base: Number(plan?.base) || 0,
  });
  const avgIncome12m = income12m > 0 ? income12m / 12 : 0;
  const disposable = p.income > 0 ? p.income : avgIncome12m;

  const pools = { consume: p.consume, invest: p.invest, cushion: p.cushion, esop: p.esop };
  // D19：可行性只看三池（消费+投资+缓冲）；ESOP 独立展示、计入净资产，不参与判定
  const threeTotal = p.consume + p.invest + p.cushion;
  const over = threeTotal - disposable;
  const feasible = over <= 0.005;
  const warn = feasible
    ? undefined
    : `三池合计（消费+投资+缓冲）${fmtInt(threeTotal)} 元 > 月可支配 ${fmtInt(disposable)} 元（超 ${fmtInt(over)} 元）：请下调某池后重算`;

  const months = p.years * 12;
  const rm = p.rate / 12;
  const fvBase = p.base * Math.pow(1 + rm, months);
  const fvInvest = p.invest * annuityFV(rm, months);
  const fvCushion = p.cushion * months; // 缓冲池按零收益保守累计
  const endFinance = fvBase + fvInvest + fvCushion;
  const esopTotal = p.esop * months;
  const endNet = endFinance + esopTotal;

  const milestones = [];
  for (let y = 1; y <= p.years; y++) {
    const n = y * 12;
    const fin = p.base * Math.pow(1 + rm, n) + p.invest * annuityFV(rm, n) + p.cushion * n;
    milestones.push({ when: `第 ${y} 年末`, what: `金融资产 ≈${fmtInt(fin)} 元 · 净资产 ≈${fmtInt(fin + p.esop * n)} 元` });
  }

  return { feasible, warn, pools, months, endFinance, endNet, avgIncome12m, milestones };
}

/**
 * 应用计划：持久化到 idb 实体 `plan`（kv + outbox）并尝试同步；
 * 不可行参数红字警告由 buildPlanPanel 呈现，不接受静默失败（UX-SPEC 流程②）。
 * @param {PlanParams} plan
 * @returns {Promise<void>}
 */
export async function applyPlan(plan) {
  await commitChange('plan', plan);
  try {
    await flushOutbox();
  } catch {
    /* 离线：留待 online 事件或下次 flush 重试 */
  }
}

/**
 * 构建 ④ 参数面板 UI（数字输入 + 「按参数重算」按钮，改值回调）。
 * 面板内置实时可行性检查：四池合计 > 可支配 → 红字警告（role=alert）。
 * @param {HTMLElement} mount
 * @param {PlanParams} plan 当前参数
 * @param {(next: PlanParams) => void} onChange 参数变更回调
 * @returns {void}
 */
export function buildPlanPanel(mount, plan, onChange) {
  if (!mount) return;
  mount.textContent = '';
  const current = /** @type {PlanParams} */ ({
    income: Number(plan?.income) || 0,
    consume: Number(plan?.consume) || 0,
    invest: Number(plan?.invest) || 0,
    cushion: Number(plan?.cushion) || 0,
    esop: Number(plan?.esop) || 0,
    years: Math.max(1, Math.round(Number(plan?.years) || 1)),
    rate: Number(plan?.rate) || 0,
    base: Number(plan?.base) || 0,
  });

  const root = el('div', 'pp');
  const grid = el('div', 'pp-grid');
  const fields = /** @type {const} */ ([
    ['income', '月可支配收入（元/月）', 100],
    ['consume', '消费池（元/月）', 100],
    ['invest', '投资池（元/月）', 100],
    ['cushion', '缓冲池（元/月）', 100],
    ['esop', 'ESOP 池（元/月）', 100],
    ['base', '金融资产期初本金（元）', 1000],
    ['years', '推演年数（年）', 1],
  ]);
  /** @type {Record<string, HTMLInputElement>} */
  const inputs = {};
  for (const [key, label, step] of fields) {
    const lab = el('label', 'pp-field');
    lab.appendChild(el('span', 'pp-lab', label));
    const input = /** @type {HTMLInputElement} */ (el('input'));
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = '0';
    input.step = String(step);
    input.value = String(current[key]);
    input.dataset.k = key;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (Number.isFinite(v) && v >= 0) current[key] = key === 'years' ? Math.max(1, Math.round(v)) : v;
      refresh();
      emit(false);
    });
    lab.appendChild(input);
    grid.appendChild(lab);
    inputs[key] = input;
  }
  // 收益率以百分数呈现（0.05 ↔ 5）
  {
    const lab = el('label', 'pp-field');
    lab.appendChild(el('span', 'pp-lab', '年化收益率（%）'));
    const input = /** @type {HTMLInputElement} */ (el('input'));
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = '0';
    input.step = '0.1';
    input.value = String(Math.round(current.rate * 1000) / 10);
    input.dataset.k = 'rate';
    input.addEventListener('input', () => {
      const v = Number(input.value);
      current.rate = Number.isFinite(v) && v >= 0 ? v / 100 : 0;
      refresh();
      emit(false);
    });
    lab.appendChild(input);
    grid.appendChild(lab);
    inputs.rate = input;
  }
  root.appendChild(grid);

  const status = el('div', 'pp-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.appendChild(status);

  const actions = el('div', 'pp-actions');
  const btn = el('button', 'btn btn-primary', '🔄 按参数重算');
  btn.type = 'button';
  const flash = el('span', 'hint pp-flash');
  btn.addEventListener('click', () => {
    refresh();
    emit(true);
    flash.textContent = '已按当前参数重算 ✓';
    setTimeout(() => { flash.textContent = ''; }, 2500);
  });
  actions.appendChild(btn);
  actions.appendChild(flash);
  root.appendChild(actions);
  mount.appendChild(root);

  function emit(explicit) {
    onChange({ ...current });
    if (explicit) void 0;
  }

  function refresh() {
    const res = computePlan(current, 0);
    status.textContent = '';
    if (!res.feasible) {
      const warnBox = el('div', 'callout danger plan-warn');
      warnBox.setAttribute('role', 'alert');
      warnBox.textContent = '⚠ ' + (res.warn ?? '参数不可行');
      status.appendChild(warnBox);
    } else {
      const okBox = el('div', 'callout ok');
      const three = current.consume + current.invest + current.cushion; // D19：判定只看三池
      okBox.innerHTML =
        `三池合计（消费+投资+缓冲）${fmtInt(three)} ≤ 可支配 ${fmtInt(current.income || res.avgIncome12m)} 元；` +
        `ESOP ${fmtInt(current.esop)} 元/月 独立累计（计入净资产，不参与判定）。` +
        `${res.months} 个月后金融资产 <b>≈${fmtInt(res.endFinance)}</b> 元，净资产 <b>≈${fmtInt(res.endNet)}</b> 元` +
        '（估算，含复利假设）';
      status.appendChild(okBox);
    }
  }
  refresh();
}

/* --------------------------------- 导入管线 -------------------------------- */

/**
 * 流水文本逐行解析：逐行尝试注册表中的格式，首个命中的即采用。
 * @param {string} text 用户粘贴的文本或 pdf.js 抽取文本
 * @param {Record<string, import('./formats.js').FormatEntry>} [formats] 默认 FORMATS
 * @returns {{txns: Txn[], failed: string[]}} failed 为未命中任何格式的原始行
 */
export function parseLines(text, formats = FORMATS) {
  const txns = /** @type {Txn[]} */ ([]);
  const failed = /** @type {string[]} */ ([]);
  const entries = Object.values(formats ?? {});
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\u200b/g, '').trim();
    if (!line) continue;
    let mapped = null;
    for (const f of entries) {
      const m = line.match(f.re);
      if (!m) continue;
      try {
        mapped = f.map(m);
      } catch {
        mapped = null;
      }
      break; // 首个命中即采用
    }
    const ok =
      mapped &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(mapped.d ?? '')) &&
      (mapped.dc === 'C' || mapped.dc === 'D') &&
      Number.isFinite(Number(mapped.amt));
    if (ok) {
      txns.push({
        d: mapped.d,
        t: String(mapped.t ?? ''),
        dc: mapped.dc,
        amt: Math.abs(Number(mapped.amt)),
        rest: String(mapped.rest ?? '').trim(),
        ...(Number.isFinite(Number(mapped.bal)) ? { bal: Number(mapped.bal) } : {}),
      });
    } else {
      failed.push(raw.trim());
    }
  }
  return { txns, failed };
}

/**
 * 交易分类：按规则写回 cat 字段（雇主→工资、奖金下限、补贴、大额支出、跳过）。
 * @param {Txn[]} txns
 * @param {ImporterRules} rules DATA.meta.importer
 * @returns {Txn[]} 新数组（不改动入参）
 */
export function classify(txns, rules) {
  const r = rules ?? {};
  const employer = r.employer ?? [];
  const salaryAbstract = r.salaryAbstract ?? '工资';
  const subsidyKeywords = r.subsidyKeywords ?? [];
  const skipTypes = r.skipTypes ?? [];
  const bonusMin = Number.isFinite(Number(r.bonusMin)) ? Number(r.bonusMin) : Infinity;
  const bigExpenseMin = Number.isFinite(Number(r.bigExpenseMin)) ? Number(r.bigExpenseMin) : Infinity;

  return (txns ?? []).map((t0) => {
    const t = { ...t0 };
    const rest = String(t.rest ?? '');
    if (skipTypes.some((k) => String(t.t ?? '').includes(k))) {
      t.cat = 'skip';
    } else if (t.dc === 'C') {
      const fromEmployer = employer.some((k) => rest.includes(k));
      const isSalary = rest.includes(salaryAbstract);
      if (fromEmployer || isSalary) t.cat = t.amt >= bonusMin ? 'bonus' : 'salary';
      else if (subsidyKeywords.some((k) => rest.includes(k))) t.cat = 'subsidy';
      else t.cat = 'other';
    } else {
      t.cat = t.amt >= bigExpenseMin ? 'bigExpense' : 'other';
    }
    return t;
  });
}

/** 月份键 YYYY-MM（容错解析失败） */
function ymOf(d) {
  return /^\d{4}-\d{2}/.test(String(d)) ? String(d).slice(0, 7) : '未知';
}

/** 往来对手名：取户名+摘要的首个空白分段（中文户名通常无空格） */
function counterpartyOf(rest) {
  const seg = String(rest ?? '').trim().split(/\s+/)[0] ?? '';
  return seg || '（未知对手）';
}

/**
 * 聚合：月度流入/流出/结余、类型分布、往来对手 Top。
 * cat==='skip'（内部转账等）不参与任何聚合。
 * @param {Txn[]} txns 已分类（cat 已写回）的交易
 * @returns {{months: Array<{ym: string, inflow: number, outflow: number, net: number}>, byType: Array<{type: string, count: number, amt: number}>, byCounter: Array<{name: string, dc: Dc, count: number, amt: number}>}}
 */
export function aggregate(txns) {
  const months = /** @type {Record<string, {ym: string, inflow: number, outflow: number, net: number}>} */ ({});
  const byTypeMap = /** @type {Record<string, {type: string, count: number, amt: number}>} */ ({});
  const byCounterMap = /** @type {Record<string, {name: string, dc: Dc, count: number, amt: number}>} */ ({});

  for (const t of txns ?? []) {
    if (t.cat === 'skip') continue;
    const ym = ymOf(t.d);
    const m = (months[ym] ??= { ym, inflow: 0, outflow: 0, net: 0 });
    if (t.dc === 'C') m.inflow += t.amt;
    else m.outflow += t.amt;

    const bt = (byTypeMap[t.t || '（未知类型）'] ??= { type: t.t || '（未知类型）', count: 0, amt: 0 });
    bt.count += 1;
    bt.amt += t.amt;

    const name = counterpartyOf(t.rest);
    const key = name + '|' + t.dc;
    const bc = (byCounterMap[key] ??= { name, dc: t.dc, count: 0, amt: 0 });
    bc.count += 1;
    bc.amt += t.amt;
  }

  const monthList = Object.values(months)
    .map((m) => ({ ...m, net: m.inflow - m.outflow }))
    .sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0));
  const byType = Object.values(byTypeMap).sort((a, b) => b.amt - a.amt);
  const byCounter = Object.values(byCounterMap).sort((a, b) => b.amt - a.amt);
  return { months: monthList, byType, byCounter };
}

/**
 * 近 12 个月收入合计（工资+奖金+补贴通道；skip 除外）。
 * @param {Txn[]} txns
 * @param {Date} [now] 计算基准，默认当前时间
 * @returns {number} 元
 */
export function computeIncome12m(txns, now = new Date()) {
  const cutoff = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
  let sum = 0;
  for (const t of txns ?? []) {
    if (t.dc !== 'C') continue;
    if (!(t.cat === 'salary' || t.cat === 'bonus' || t.cat === 'subsidy')) continue;
    const d = new Date(String(t.d) + 'T00:00:00');
    if (Number.isNaN(d.getTime())) continue;
    if (d >= cutoff && d <= now) sum += t.amt;
  }
  return sum;
}

/** 收入分类中文名 */
const CAT_LABEL = {
  salary: '工资',
  bonus: '奖金',
  subsidy: '补贴',
  other: '其他入账',
  bigExpense: '大额支出',
};

/** 支出 tier 配色（循环取用） */
const TIER_COLORS = ['#4e8cff', '#2fbf71', '#e8a13c', '#8f6bd6', '#9aa4b2'];

/** 空态引导块（UX-SPEC §3：无数据不留空白，给出去向与下一步） */
function emptyGuide(msg) {
  return { t: 'callout', kind: 'warn', html: msg ?? '暂无数据：前往「设置 → ② 流水导入」选择 PDF 或粘贴文本，解析预览后应用到分析页。' };
}

/**
 * 由导入流水生成分析 2.x 章节（D20：按节分组，锚点见章程 D3）。
 * 返回 `{id,title,blocks}[]`，boot 直接作为 part 2 的 sections 渲染；
 * 整体无流水或某节无数据时，该节出空态引导。金额一律两位小数（D4 流水页口径）。
 * @param {Txn[]} txns
 * @returns {Array<{id: string, title: string, blocks: Block[]}>}
 */
export function buildImportBlocks(txns) {
  const NO_TXNS = '尚未导入流水：前往「设置 → ② 流水导入」选择银行流水 PDF 或粘贴文本，解析预览确认后本页自动更新。';

  /* 2.1 收入构成（按分类） */
  const incomeByCat = /** @type {Record<string, {count: number, amt: number}>} */ ({});
  let incomeTotal = 0;
  let expenseTotal = 0;
  const s21Blocks = /** @type {Block[]} */ ([
    { t: 'h4', html: '收入构成 <span class="hint">（按分类规则归集）</span>' },
  ]);
  if (Array.isArray(txns) && txns.length) {
    for (const t of txns) {
      if (t.cat === 'skip') continue;
      if (t.dc === 'C') {
        const key = t.cat === 'salary' || t.cat === 'bonus' || t.cat === 'subsidy' ? t.cat : 'other';
        const rec = (incomeByCat[key] ??= { count: 0, amt: 0 });
        rec.count += 1;
        rec.amt += t.amt;
        incomeTotal += t.amt;
      } else {
        expenseTotal += t.amt;
      }
    }
  }
  const incomeRows = Object.entries(incomeByCat)
    .sort((a, b) => b[1].amt - a[1].amt)
    .map(([cat, rec]) => {
      const pct = incomeTotal > 0 ? (rec.amt / incomeTotal) * 100 : 0;
      return {
        cells: [
          CAT_LABEL[cat] ?? cat,
          { h: fmtMoney(rec.amt), num: true },
          { h: String(rec.count), num: true },
          { h: pct.toFixed(1) + '%', num: true, bar: { pct: Math.round(pct) } },
        ],
      };
    });
  if (incomeRows.length) {
    s21Blocks.push(
      {
        t: 'table',
        head: [{ h: '来源' }, { h: '金额(元)', num: true, w: '26%' }, { h: '笔数', num: true, w: '14%' }, { h: '占比', num: true, w: '28%' }],
        rows: incomeRows,
      },
      { t: 'sub', html: `统计区间内：流入合计 <b>${fmtMoney(incomeTotal)}</b> 元，流出合计 <b>${fmtMoney(expenseTotal)}</b> 元。` },
    );
  } else {
    s21Blocks.push(emptyGuide(Array.isArray(txns) && txns.length ? '统计区间内没有入账记录（C 类交易）。' : NO_TXNS));
  }

  /* 2.2 支出结构（tier：按支出类型占比，取前 4 类 + 其他） */
  const { months, byType, byCounter } = aggregate(txns ?? []);
  const expenses = byType.filter((x) => (txns ?? []).some((t) => t.t === x.type && t.dc === 'D' && t.cat !== 'skip'));
  const expenseSum = expenses.reduce((s, x) => s + x.amt, 0) || 1;
  const s22Blocks = /** @type {Block[]} */ ([
    { t: 'h4', html: '支出结构 <span class="hint">（按交易类型占比）</span>' },
  ]);
  if (expenses.length) {
    const top = expenses.slice(0, 4);
    const restAmt = expenses.slice(4).reduce((s, x) => s + x.amt, 0);
    const tierRows = top.map((x, i) => ({
      w: Math.round((x.amt / expenseSum) * 100),
      bg: TIER_COLORS[i % TIER_COLORS.length],
      label: x.type,
      tag: ((x.amt / expenseSum) * 100).toFixed(1) + '%',
      tagCls: '',
    }));
    if (restAmt > 0) {
      tierRows.push({
        w: Math.max(0, 100 - tierRows.reduce((s, r) => s + r.w, 0)),
        bg: '#9aa4b2',
        label: '其他',
        tag: ((restAmt / expenseSum) * 100).toFixed(1) + '%',
        tagCls: '',
      });
    }
    s22Blocks.push({ t: 'tier', rows: tierRows });
  } else {
    s22Blocks.push(emptyGuide(Array.isArray(txns) && txns.length ? '统计区间内没有支出记录（D 类交易）。' : NO_TXNS));
  }

  /* 2.3 月度趋势 */
  const s23Blocks = /** @type {Block[]} */ ([
    { t: 'h4', html: '月度趋势' },
  ]);
  if (months.length) {
    s23Blocks.push({
      t: 'table',
      head: [{ h: '月份' }, { h: '流入(元)', num: true, w: '24%' }, { h: '流出(元)', num: true, w: '24%' }, { h: '结余(元)', num: true, w: '24%' }],
      rows: months.map((m) => ({
        cells: [
          m.ym,
          { h: fmtMoney(m.inflow), num: true },
          { h: fmtMoney(m.outflow), num: true },
          { h: fmtMoney(m.net), num: true, cls: m.net < 0 ? 'neg' : 'strong' },
        ],
      })),
    });
  } else {
    s23Blocks.push(emptyGuide(NO_TXNS));
  }

  /* 2.4 类型分布 */
  const s24Blocks = /** @type {Block[]} */ ([
    { t: 'h4', html: '类型分布 <span class="hint">（已排除 skipTypes 内部转账）</span>' },
  ]);
  if (byType.length) {
    s24Blocks.push({
      t: 'table',
      head: [{ h: '类型' }, { h: '笔数', num: true, w: '16%' }, { h: '金额(元)', num: true, w: '28%' }],
      rows: byType.map((x) => ({
        cells: [x.type, { h: String(x.count), num: true }, { h: fmtMoney(x.amt), num: true }],
      })),
    });
  } else {
    s24Blocks.push(emptyGuide(NO_TXNS));
  }

  /* 2.5 往来对手 Top 8 */
  const s25Blocks = /** @type {Block[]} */ ([
    { t: 'h4', html: '往来对手 Top' },
  ]);
  if (byCounter.length) {
    s25Blocks.push({
      t: 'table',
      head: [{ h: '对手' }, { h: '方向', w: '12%' }, { h: '笔数', num: true, w: '14%' }, { h: '金额(元)', num: true, w: '28%' }],
      rows: byCounter.slice(0, 8).map((x) => ({
        cells: [x.name, x.dc === 'C' ? '收' : '支', { h: String(x.count), num: true }, { h: fmtMoney(x.amt), num: true }],
      })),
    });
  } else {
    s25Blocks.push(emptyGuide(NO_TXNS));
  }

  return [
    { id: 's21', title: '2.1 收入构成', blocks: s21Blocks },
    { id: 's22', title: '2.2 支出结构', blocks: s22Blocks },
    { id: 's23', title: '2.3 月度趋势', blocks: s23Blocks },
    { id: 's24', title: '2.4 类型分布', blocks: s24Blocks },
    { id: 's25', title: '2.5 往来对手 Top', blocks: s25Blocks },
  ];
}

/** 里程碑展示年份选取：年份多时隔点抽样，始终含末日 */
function pickMilestoneYears(years) {
  const wanted = [1, 2, 3, 5, 10, 15, 20, 25, 30, years];
  return Array.from(new Set(wanted.filter((y) => y >= 1 && y <= years))).sort((a, b) => a - b);
}

/**
 * 由计划参数生成 1.1~1.4 章节（D3 锚点；计划页参数重算后自动更新用）。
 * 返回 `{id,title,blocks}[]`：1.1 四池分配（allocbar+明细+可行性 callout）、
 * 1.2 结余推演、1.3 期末预期、1.4 里程碑。金额走 D4 计划页整数口径。
 * @param {PlanParams} plan
 * @param {number} [income12m] 近 12 个月总收入（元）
 * @returns {Array<{id: string, title: string, blocks: Block[]}>}
 */
export function buildPlanBlocks(plan, income12m = 0) {
  const res = computePlan(plan, income12m);
  const { consume, invest, cushion, esop } = res.pools;
  const disposable = (Number(plan?.income) || 0) > 0 ? Number(plan.income) : res.avgIncome12m;
  const den = disposable > 0 ? disposable : consume + invest + cushion + esop || 1;
  const pctOf = (v) => Math.round((v / den) * 100);

  /* 1.1 四池分配 */
  const alloc = [
    { cls: 'ab-consume', label: `消费 ${pctOf(consume)}%`, v: consume, use: '日常开销与房租' },
    { cls: 'ab-invest', label: `投资 ${pctOf(invest)}%`, v: invest, use: '指数基金定投（发薪日自动转出）' },
    { cls: 'ab-cushion', label: `缓冲 ${pctOf(cushion)}%`, v: cushion, use: '应急备用金，只进不出' },
    { cls: 'ab-esop', label: `ESOP ${pctOf(esop)}%`, v: esop, use: '公司股权按购入成本计' },
  ];
  const s11 = /** @type {Block[]} */ ([
    { t: 'sub', html: `月度可支配收入按「消费 / 投资 / 缓冲 / ESOP」四池分配，先转出后消费。可行性判定只看三池（消费+投资+缓冲），ESOP 独立累计（D19）。` },
    { t: 'allocbar', items: alloc.map(({ cls, label }) => ({ cls, label })) },
    { t: 'h4', html: `月度分配明细 <span class="hint">（按月可支配 ${fmtInt(disposable)} 计）</span>` },
    {
      t: 'table',
      head: [{ h: '池子' }, { h: '金额(元/月)', num: true, w: '22%' }, { h: '占比', num: true, w: '14%' }, '用途'],
      rows: alloc.map(({ label, v, use }) => ({
        cells: [label.replace(/\s*\d+(?:\.\d+)?%\s*$/, ''), { h: fmtInt(v), num: true }, { h: pctOf(v) + '%', num: true }, use],
      })),
    },
    res.feasible
      ? { t: 'callout', kind: 'ok', html: `三池合计 ${fmtInt(consume + invest + cushion)} ≤ 可支配 ${fmtInt(disposable)} 元，无超配；ESOP ${fmtInt(esop)} 元/月 独立累计。` }
      : { t: 'callout', kind: 'warn', html: '⚠ ' + (res.warn ?? '参数不可行') },
  ]);

  /* 1.2 结余推演（首列 minw 9em 与 1.3 同款机制，VIS-O-1 收尾）。
     与 1.3 的差异：此处只设 minw 不设 w——1.2 行名最长 13 字（月度结余（投资+缓冲+ESOP），
     一行需 ~210px），钉死 w 会让宽屏首列停在 117px 仍折 2 行（实测）；minw-only 让宽屏
     auto 按内容放宽（1440 实测 234px 全行名 1 行）、390 由 9em 硬下限兜底（实测 143px，
     10+ 字长行名在 349px 内容宽内物理上仍为 2 行语义断行，非逐字竖排；一行需 ~210px，
     剩余宽不足金额/说明两列 min-content）。无横向溢出（390/1440 实测 tblScrollW==tblClientW） */
  const s12 = /** @type {Block[]} */ ([
    {
      t: 'table',
      head: [{ h: '项目', minw: '9em' }, { h: '金额(元/月)', num: true, w: '26%' }, '说明'],
      rows: [
        { cells: ['月可支配收入', { h: fmtInt(disposable), num: true }, income12m > 0 ? '近 12 个月收入口径校准' : '参数面板设定'] },
        { cells: ['消费池支出', { h: fmtInt(consume), num: true }, '当月花掉的部分'] },
        { cells: ['月度结余（投资+缓冲+ESOP）', { h: fmtInt(invest + cushion + esop), num: true, cls: 'strong' }, '先转出后消费的沉淀部分'] },
        { cells: ['进入复利通道（投资池）', { h: fmtInt(invest), num: true }, '定投按年化假设复利'] },
      ],
    },
    {
      t: 'details',
      title: '推演假设明细',
      blocks: [
        { t: 'ms', items: [`年化 ${Math.round((Number(plan?.rate) || 0) * 1000) / 10}% 复利（仅本金与投资池）`, '收入不增长（保守）', '缓冲池按零收益累计', `ESOP 按购入成本累计 ${fmtInt(esop * res.months)} 元（${res.months} 个月）`] },
        { t: 'gap', h: '8px' },
        { t: 'sub', html: '任一假设变化请在上方参数面板重算，不要手改本文。' },
      ],
    },
  ]);

  /* 1.3 期末预期（bars 以净资产为 100 基准）；
     首列 w/minw 9em（VIS-O-1）——无显式宽时 auto 布局把首列压到 ~70px，
     CJK 行名（金融资产合计/其中：缓冲池）被逐字竖排折行；9em（fs-sm 13px → 117px，
     minw 为硬下限防压缩）保证 6 字行名一行放下。
     构成列 hideNarrow（PM 裁决方案①）：≤480px 整列隐藏——390 下期末数字列
     min-content ~135px + 首列 108px 后剩余宽不足以让占比与构成列并存（给构成列
     minw 会令整表横向溢出 52px，实测）；≥481px（含 768/1440）维持完整显示 */
  const endNet = Math.max(1, Math.round(res.endNet));
  const bar = (v) => ({ pct: Math.max(2, Math.round((v / endNet) * 100)) });
  const s13 = /** @type {Block[]} */ ([
    {
      t: 'table',
      head: [{ h: '项目', w: '9em', minw: '9em' }, { h: '期末(元)', num: true, w: '26%' }, { h: '占比', num: true, w: '16%' }, { h: '构成', hideNarrow: true }],
      rows: [
        { cells: ['金融资产合计', { h: '≈' + fmtInt(res.endFinance), num: true, bar: bar(res.endFinance) }, { h: Math.round((res.endFinance / endNet) * 100) + '%', num: true }, '期初本金复利 + 投资池定投复利 + 缓冲池累计'] },
        { cells: ['其中：缓冲池', { h: '≈' + fmtInt(cushion * res.months), num: true, bar: bar(cushion * res.months) }, { h: Math.round(((cushion * res.months) / endNet) * 100) + '%', num: true }, '零收益保守累计'] },
        { cells: ['ESOP 池', { h: fmtInt(esop * res.months), num: true, bar: bar(esop * res.months) }, { h: Math.round(((esop * res.months) / endNet) * 100) + '%', num: true }, '按购入成本，不计收益'] },
        { cells: ['净资产合计', { h: '≈' + fmtInt(res.endNet), num: true, cls: 'strong', bar: { pct: 100 } }, { h: '100%', num: true }, '金融资产 + ESOP'] },
      ],
    },
    { t: 'sub', html: `推演期 ${res.months} 个月（${Math.round(res.months / 12)} 年）；含复利假设，非承诺收益，月末用实际数据复核。` },
  ]);

  /* 1.4 里程碑 */
  const s14 = /** @type {Block[]} */ ([
    {
      t: 'flow',
      steps: pickMilestoneYears(Math.max(1, Math.round(Number(plan?.years) || 1))).map((y) => {
        const m = res.milestones.find((x) => x.when === `第 ${y} 年末`) ?? res.milestones[res.milestones.length - 1];
        return { t: m.when, d: m.what };
      }),
    },
  ]);

  return [
    { id: 's11', title: '1.1 四池分配', blocks: s11 },
    { id: 's12', title: '1.2 结余推演', blocks: s12 },
    { id: 's13', title: '1.3 期末预期', blocks: s13 },
    { id: 's14', title: '1.4 里程碑', blocks: s14 },
  ];
}

/**
 * 用流水最新余额修正 DATA 当期余额（银行流水只更新第二部分统计与当期余额）。
 * 余额来源：交易对象可选 `bal` 字段（格式注册表可提供交易后余额）；
 * 无 bal 但 DATA.balance 存在时，退化为 balance + 净流入累计。
 * DATA.md 词表未定义余额字段，这里落到 `DATA.balance`（数值，元）并同步
 * hero「金融资产」口径项（存在时）。
 * @param {Txn[]} txns 已按日期升序的交易（末笔余额为当期）
 * @param {DATA} data
 * @returns {DATA} 新对象（不改动入参）
 */
export function applyBalance(txns, data) {
  if (!Array.isArray(txns) || !txns.length || !data) return data;
  const sorted = [...txns].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const last = sorted[sorted.length - 1];
  let balance = Number.isFinite(Number(last?.bal)) ? Number(last.bal) : NaN;
  if (!Number.isFinite(balance) && Number.isFinite(Number(/** @type {any} */ (data).balance))) {
    const net = sorted.filter((t) => t.cat !== 'skip').reduce((s, t) => s + (t.dc === 'C' ? t.amt : -t.amt), 0);
    balance = Number(data.balance) + net;
  }
  if (!Number.isFinite(balance)) return data; // 无可靠余额来源：不虚构数字

  const next = deepClone(data);
  next.balance = Math.round(balance * 100) / 100;
  const item = next.hero?.now?.items?.find((it) => String(it.label ?? '').includes('金融资产'));
  if (item) item.b = fmtInt(balance);
  return next;
}

/**
 * 应用导入：覆盖型写保护（BUG-002/D17 修订：应用前自动建快照，失败经
 * opts.confirmLoss 询问，拒绝则中止）→ 持久化 txns+rules 到 idb 实体 `txns`、
 * 广播变更事件；UI 层反馈（弹窗确认/提示导出备份）由设置页负责（UX-SPEC 流程①）。
 * 广播：window CustomEvent 'chijia:imported' + BroadcastChannel 'chijia'，
 * 分析页据此自动更新（iframe 场景）。
 * @param {Txn[]} txns
 * @param {ImporterRules} rules
 * @param {{confirmLoss?: (err: Error) => (boolean|Promise<boolean>)}} [opts] 快照失败确认钩子
 * @returns {Promise<{safetySnapshot: {created: boolean, confirmedWithoutSnapshot: boolean}}>}
 */
export async function applyImport(txns, rules, opts = {}) {
  // BUG-002：覆盖型写保护——应用会覆盖既有 txns 实体，先自动快照
  const safetySnapshot = await ensureSafetySnapshot(
    `自动快照 · 导入流水前 ${new Date().toLocaleString('zh-CN')}`,
    opts,
  );
  await commitChange('txns', { rules, txns });
  try {
    const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('chijia') : null;
    ch?.postMessage({ type: 'imported', count: txns?.length ?? 0 });
    ch?.close();
  } catch { /* 广播失败不影响持久化 */ }
  try {
    window.dispatchEvent(new CustomEvent('chijia:imported', { detail: { count: txns?.length ?? 0 } }));
  } catch { /* 非浏览器环境忽略 */ }
  try {
    await flushOutbox();
  } catch {
    /* 离线：留待 online 重试 */
  }
  return { safetySnapshot };
}

/** pdf.js UMD 构建（v3 系最后提供 window.pdfjsLib 的版本） */
const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';

/**
 * 按需从 CDN 加载 pdf.js（需联网一次；加载失败抛错，调用方须弹窗说明——UX-SPEC 错误态）。
 * @returns {Promise<any>} pdfjsLib 命名空间
 */
export async function loadPdfJs() {
  const w = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
  if (w.pdfjsLib?.getDocument) return w.pdfjsLib;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS_CDN + 'pdf.min.js';
    s.onload = () => resolve(null);
    s.onerror = () =>
      reject(
        Object.assign(new Error('pdf.js 组件加载失败：本功能需联网获取解析组件（CDN 不可达）。可改用「粘贴文本」方式导入。'), {
          code: 'PDFJS_LOAD_FAILED',
        }),
      );
    document.head.appendChild(s);
  });
  const lib = w.pdfjsLib;
  if (!lib?.getDocument) {
    throw Object.assign(new Error('pdf.js 加载异常：未获得解析组件'), { code: 'PDFJS_LOAD_FAILED' });
  }
  lib.GlobalWorkerOptions.workerSrc = PDFJS_CDN + 'pdf.worker.min.js';
  return lib;
}

/**
 * 用 pdf.js 抽取 PDF 全文文本（逐页 join，供 parseLines 消费）。
 * @param {File} file 用户选择的 PDF 文件
 * @returns {Promise<string>}
 */
export async function extractPdfText(file) {
  const lib = await loadPdfJs();
  let doc;
  try {
    doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  } catch (e) {
    throw Object.assign(new Error('PDF 打开失败：文件可能已损坏或为扫描件（仅支持文字可复制的 PDF）。' ), {
      code: 'PDF_OPEN_FAILED',
      cause: e,
    });
  }
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) {
      text += item.str ?? '';
      text += item.hasEOL ? '\n' : ' ';
    }
    pages.push(text);
  }
  try {
    await doc.destroy();
  } catch { /* 清理失败忽略 */ }
  return pages.join('\n');
}

/* ---------------------------------- 通用 ---------------------------------- */

/** 当前页面模式（boot 写入） */
let _pageMode = /** @type {'plan'|'analysis'|'settings'|null} */ (null);

/** 当前生效 DATA（示例被 idb `data` 实体覆盖后的结果） */
let _data = /** @type {any} */ (null);

/** 当前计划参数（boot 写入，供 P1b 页面脚本读取） */
let _plan = /** @type {PlanParams|null} */ (null);

/**
 * 读当前生效 DATA（boot 之后可用；未 boot 时返回 null）。
 * @returns {DATA|null}
 */
export function getCurrentData() {
  return _data;
}

/**
 * 读当前页面模式。
 * @returns {'plan'|'analysis'|'settings'|null}
 */
export function getPageMode() {
  return _pageMode;
}

/** 计划参数缺省值：期初本金取 hero「金融资产」（非估算项），四池按示例口径。
 * @param {DATA} data
 * @returns {PlanParams}
 */
function defaultPlan(data) {
  const asset = data?.hero?.now?.items?.find(
    (it) => String(it.label ?? '').includes('金融资产') && !String(it.label ?? '').includes('估'),
  );
  return {
    income: 10500,
    consume: 4200,
    invest: 4200,
    cushion: 1260,
    esop: 840,
    years: 5,
    rate: 0.05,
    base: Number.isFinite(parseNum(asset?.b)) ? parseNum(asset?.b) : 0,
  };
}

/**
 * D16 跨页定位：hash → 面板展开 + 滚动到位。
 * settings.html#importer → 导入面板；plan.html#params → 参数面板。
 * 选择器优先约定 data-panel 属性，向后兼容 P0 骨架的固定 id。
 */
const HASH_ANCHORS = {
  settings: {
    importer: ['[data-panel="importer"]', '#panel-import', '#importer'],
  },
  plan: {
    params: ['[data-panel="params"]', '#plan-panel', '#params'],
  },
};

/** 执行当前 location.hash 表达的意图（boot 与 hashchange 共用） */
function applyHashIntent() {
  const name = (location.hash || '').replace(/^#/, '').trim();
  if (!name || !_pageMode) return;
  const selectors = HASH_ANCHORS[_pageMode]?.[name] ?? [`#${CSS.escape(name)}`];
  for (const sel of selectors) {
    let target = null;
    try {
      target = document.querySelector(sel);
    } catch {
      target = null;
    }
    if (!target) continue;
    if (target instanceof HTMLDetailsElement) target.open = true;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
}

/** 打印时折叠全部展开（beforeprint 展开，afterprint 还原；CSS 仅兜底） */
function installPrintExpand() {
  /** @type {HTMLDetailsElement[]} */
  let opened = [];
  window.addEventListener('beforeprint', () => {
    opened = Array.from(document.querySelectorAll('details:not([open])'));
    for (const d of opened) d.open = true;
  });
  window.addEventListener('afterprint', () => {
    for (const d of opened) d.open = false;
    opened = [];
  });
}

/** 全局监听是否已随首次 boot 安装（重复 boot/rerender 不重复挂） */
let _listenersInstalled = false;

/** 当前生效 DATA 是否来自 idb `data` 实体（用户数据包），区分示例态 */
let _dataFromStore = false;

/** 当前 txns 实体（boot/rerender 装载，供 renderPage 使用） */
let _txnsDoc = /** @type {{rules?: any, txns?: any[]}|null} */ (null);

/**
 * 页面启动入口：按 pageMode 装载实体数据并渲染。
 * - 读 idb `data` 实体覆盖 data.js 示例（整文档覆盖，LWW 已由同步层保证）；
 * - 读 `txns` 实体重算分析 2.x；读 `plan` 实体恢复推演参数；
 * - 渲染当前页挂载点；首 次 boot 挂 hashchange（D16）、打印展开、online 自动重试；
 * - D22：boot 即异步 flushOutbox + pullState（不阻塞首屏；服务端较新热更新重渲染；
 *   离线静默）。
 * @param {'plan'|'analysis'|'settings'} pageMode ARCHITECTURE.md 页面清单
 * @returns {void}
 */
export function boot(pageMode) {
  _pageMode = pageMode ?? null;
  if (!_listenersInstalled && typeof window !== 'undefined') {
    _listenersInstalled = true;
    installAutoSync();
    installPrintExpand();
    window.addEventListener('hashchange', applyHashIntent);
  }
  void bootAsync();
}

/**
 * 重渲染（不重复挂监听）：重读 idb 实体并按当前 pageMode 重渲染。
 * 供分析页在导入应用后、设置页在数据包导入后调用（跨面板热更新）。
 * @returns {Promise<void>}
 */
export async function rerender() {
  await refreshFromStore();
  renderPage();
  applyHashIntent();
  announceRendered();
}

/** 广播「本页数据渲染完成」——O-2：设置页面板在数据装载后构建/重建（修空预填时序） */
function announceRendered() {
  try {
    window.dispatchEvent(new CustomEvent('chijia:rendered', { detail: { pageMode: _pageMode } }));
  } catch { /* 非浏览器环境忽略 */ }
}

/** boot/rerender 共用异步主体：装载 → 渲染 → flush → pullState 热更新（D22） */
async function bootAsync() {
  await refreshFromStore();
  renderPage();
  applyHashIntent();
  announceRendered();

  // 离线遗留 outbox 静默补发（失败忽略：online 事件会再试）
  flushOutbox().catch(() => {});

  // D22：不阻塞首屏的拉取合并；服务端较新（命中本页关心的实体）则热更新重渲染
  try {
    const r = await pullState();
    if (r.applied.some((e) => e === 'data' || e === 'txns' || e === 'plan' || e === 'settings')) {
      await refreshFromStore();
      renderPage();
      applyHashIntent();
      announceRendered();
    }
    try {
      // BUG-005：设置页等订阅 pull 结果（lastSync 变化等）重渲染面板
      window.dispatchEvent(new CustomEvent('chijia:pulled', { detail: r }));
    } catch { /* 非浏览器环境忽略 */ }
  } catch {
    /* 离线/未配置 token：静默，数据继续用本地 */
  }
}

/** 从 idb 装载 data/txns/plan 实体（idb 不可用时回退示例数据） */
async function refreshFromStore() {
  let data = deepClone(SAMPLE_DATA);
  _dataFromStore = false;
  try {
    const rec = await kvGet('data');
    if (rec && !rec.deleted && rec.value && typeof rec.value === 'object') {
      data = rec.value;
      _dataFromStore = true;
    }
  } catch { /* idb 不可用（如 file:// 隐私模式）：用示例数据 */ }
  _data = data;

  _txnsDoc = null;
  try {
    const rec = await kvGet('txns');
    if (rec && !rec.deleted && rec.value && Array.isArray(rec.value.txns) && rec.value.txns.length) {
      _txnsDoc = rec.value;
    }
  } catch { /* 忽略 */ }

  _plan = null;
  try {
    const rec = await kvGet('plan');
    if (rec && !rec.deleted && rec.value && typeof rec.value === 'object') {
      _plan = rec.value;
    }
  } catch { /* 忽略 */ }
}

/** 按当前 pageMode 渲染各挂载点（mount 缺失时跳过，保持向后兼容） */
function renderPage() {
  if (_pageMode === 'plan') renderPlanPage();
  else if (_pageMode === 'analysis') renderAnalysisPage();
  else if (_pageMode === 'settings') renderSettingsPage();
}

/** 计划页：Hero + 总览 + 1.x 章节 + 参数面板（重算联动事件见 chijia:planrecalc） */
function renderPlanPage() {
  const data = /** @type {DATA} */ (_data);
  renderHero(document.getElementById('hero-mount'), data.hero);
  renderOverview(document.getElementById('overview-mount'), data.overview);
  const planParts = (data.parts ?? []).filter((p) => p.no === '1' || p.id === 'plan');
  renderParts(document.getElementById('parts-mount'), planParts, { defaultCollapsed: false });

  const panelMount = document.getElementById('plan-panel-mount');
  if (panelMount) {
    const plan = _plan ?? defaultPlan(data);
    _plan = plan;
    let saveTimer = /** @type {number|undefined} */ (undefined);
    buildPlanPanel(panelMount, plan, (next) => {
      _plan = next;
      // 参数变更防抖持久化（kv+outbox+尽力同步），并广播重算事件给页面脚本
      // （页面据此重渲染 1.1~1.4 与预期分布，自动展开——UX-SPEC 流程②）
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        applyPlan(next).catch(() => {});
      }, 600);
      dispatchPlanRecalc(next);
    });
    // 首渲染即广播一次当前参数（页面据此生成 1.1~1.4 并缓存参数供「发送到计算器」）
    dispatchPlanRecalc(plan);
  }
}

/** 广播计划重算事件（detail: {plan, res}） */
function dispatchPlanRecalc(plan) {
  try {
    const res = computePlan(plan, 0);
    window.dispatchEvent(new CustomEvent('chijia:planrecalc', { detail: { plan, res } }));
  } catch { /* 非浏览器环境忽略 */ }
}

/** 分析页：统计维度芯片 + 2.x（D20 按节分组/空态引导）+ 3.x（默认折叠） */
function renderAnalysisPage() {
  const data = /** @type {DATA} */ (_data);
  const hasTxns = !!(_txnsDoc?.txns?.length);
  const dimMount = document.getElementById('stats-dim-mount');
  if (dimMount) {
    let dim = data.meta?.statsDim;
    if (hasTxns) {
      const dates = (_txnsDoc?.txns ?? []).map((t) => String(t.d ?? '')).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
      dim = {
        label: data.meta?.statsDim?.label ?? '统计维度',
        text: `${dates[0]?.slice(0, 7) ?? '—'} ~ ${dates[dates.length - 1]?.slice(0, 7) ?? '—'} · 共 ${_txnsDoc?.txns.length} 笔`,
      };
    } else if (!_dataFromStore) {
      // VIS-O-2：示例账本且未导入流水时，芯片不得沿用「示例流水 N 笔」——
      // 与 2.x「暂无数据」callout 并存自相矛盾；改为不误导的空态口径，
      // 导入流水后走上方 hasTxns 分支恢复实测口径（笔数与时间跨度）。
      dim = {
        label: data.meta?.statsDim?.label ?? '统计维度',
        text: '示例账本 · 未导入流水（导入后在 2.x 显示实测口径）',
      };
    }
    if (dim) {
      dimMount.textContent = '';
      const chip = el('div', 'stats-chip');
      chip.appendChild(el('span', 'tag tag-blue', dim.label));
      chip.appendChild(el('span', 'stats-chip-text', dim.text));
      dimMount.appendChild(chip);
    }
  }

  const parts = deepClone(data.parts ?? []);
  const p2 = parts.find((p) => p.no === '2' || p.id === 'txns');
  if (p2) {
    if (hasTxns) {
      // 实体流水覆盖：2.x 由 buildImportBlocks 按节分组重算（D20）
      const rules = _txnsDoc?.rules ?? data.meta?.importer ?? {};
      const classified = classify(_txnsDoc?.txns ?? [], rules);
      p2.sections = /** @type {any} */ (buildImportBlocks(classified));
    } else if (!_dataFromStore) {
      // 示例账本且未导入流水：空态引导（UX-SPEC §3），不留空白
      p2.sections = [{ id: 's2x-empty', title: '2.x 流水统计', blocks: [emptyGuide()] }];
    }
    // 用户数据包（_dataFromStore）且无流水：尊重包内 2.x 原样渲染
  }
  const analysisParts = parts.filter(
    (p) => p.no === '2' || p.no === '3' || p.id === 'txns' || p.id === 'health',
  );
  renderParts(document.getElementById('parts-mount'), analysisParts, { defaultCollapsed: true });
}

/** 设置页：数据由 boot 装载（getCurrentData/metaGet 供页面脚本读取）；UI 见 settings.html */
function renderSettingsPage() {
  void 0;
}

/**
 * cardify12：将序列规整为 12 格仓位卡片数据（v1 遗留辅助）。
 * 不足 12 格以空卡补齐，超出截断。
 * @param {Array<{lab: string, val: string|number, note?: string, total?: string}>} items
 * @returns {Array<{lab: string, val: string, note?: string, total?: string}>}
 */
export function cardify12(items) {
  const out = (items ?? []).slice(0, 12).map((it) => ({
    lab: String(it?.lab ?? ''),
    val: String(it?.val ?? ''),
    ...(it?.note != null ? { note: String(it.note) } : {}),
    ...(it?.total != null ? { total: String(it.total) } : {}),
  }));
  while (out.length < 12) out.push({ lab: '', val: '' });
  return out;
}
