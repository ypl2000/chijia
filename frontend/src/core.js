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
 * 导入去重（问题⑧）：parseLines 末尾按规范化键 `d|time|t|dc|amt|bal` 去重、
 * 保留首条（rest 不入键）——多份流水 PDF 日期范围重叠时同一笔交易会出现在
 * 多份文本里，不去重会产生重复交易（真实导入曾因此多出 1 笔）。
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
 * 计划推演参数（T10 · v2.0.7 推演窗口月化 + 月收入工资口径 + 年度奖金）。
 *
 * v2.0.7 shape 变更（旧 shape（上一代，消费推导化批次）由 migratePlanShape 迁移，见 refreshFromStore）：
 *  - `months`（计划月数 1~360）取代 `years`——旧实体 years×12 平移一次；
 *  - `income` 派生口径改为「近 12 个月工资月均」（不含 bonus/subsidy 摊销），
 *    旧实体手填/旧口径值不保留，迁移时按新口径重派生一次（页面给一次性说明）；
 *  - 新增 `bonusYear`（年度奖金 元/年）与 `bonusMonth`（发放月 1~12，0=不注入）——
 *    推演按月模拟命中发放月时当月投入额外 + 年度奖金（每年一次）。
 * （更早的 shape 变更：消费由输入改为推导值（= 月收入 − 三池合计），consume 字段
 *   不再存储；cushionCap 为安全垫存量上限，溢出自动转定投。）
 * @typedef {Object} PlanParams
 * @property {number} income 计划月收入（元/月；缺省时 computePlan 退化用派生月均）
 * @property {number} invest 每月定投（元/月）
 * @property {number} cushion 每月安全垫（元/月）
 * @property {number} cushionCap 安全垫上限（元，存量封顶；溢出自动转定投）
 * @property {number} esop 每月 ESOP（元/月）
 * @property {number} months 计划月数（1~360；推演窗口 = 今天起 months 个月）
 * @property {number} bonusYear 年度奖金（元/年；0 = 无）
 * @property {number} bonusMonth 奖金发放月（1~12；0 = 不注入）
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

/* 问题⑨：金额估算前缀（≈/=）不再显示——数据源文案保持原样，仅在渲染出口把
   前缀字符替换为等宽透明占位（.est-pad，app.css），数值列视觉位置与去前缀前一致。 */

/** 剥离金额值开头的估算前缀（≈/=，仅一枚），返回剩余文本；无前缀返回 null */
function stripEstPrefix(v) {
  const s = String(v ?? '');
  const rest = s.replace(/^[≈=]/, '');
  return rest === s ? null : rest;
}

/**
 * 写入可能带 ≈/= 前缀的金额值（textContent 通道）：
 * 前缀字符替换为等宽占位 span，数值部分按纯文本写入。
 * @param {HTMLElement} node 目标元素（先清空内容）
 * @param {any} v 原始值
 * @returns {HTMLElement} node
 */
function setEstText(node, v) {
  const s = String(v ?? '');
  const rest = stripEstPrefix(s);
  node.textContent = '';
  if (rest == null) {
    node.textContent = s;
    return node;
  }
  const pad = document.createElement('span');
  pad.className = 'est-pad';
  node.appendChild(pad);
  node.appendChild(document.createTextNode(rest));
  return node;
}

/**
 * 写入含行内估算前缀的纯文本（如里程碑「金融资产 ≈1,160,000 元」）：
 * 紧邻数字的 ≈ 原位替换为等宽占位 span（行中 '=' 多为等式语法而非金额前缀，不处理）。
 * @param {HTMLElement} node 目标元素（先清空内容）
 * @param {any} v 原始文本
 * @returns {HTMLElement} node
 */
function setEstInlineText(node, v) {
  node.textContent = '';
  for (const part of String(v ?? '').split(/(≈(?=\d))/)) {
    if (part === '≈') {
      const pad = document.createElement('span');
      pad.className = 'est-pad';
      node.appendChild(pad);
    } else if (part) {
      node.appendChild(document.createTextNode(part));
    }
  }
  return node;
}

/** 可信 HTML 通道同款处理：紧邻数字的 ≈ 替换为占位 markup（来源限 DATA 可信 HTML 字段） */
function estAwareHtml(html) {
  return String(html ?? '').replace(/≈(?=\d)/g, '<span class="est-pad"></span>');
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
      li.appendChild(setEstText(el('b', 'hero-val num'), it.b)); // 问题⑨：≈/= 前缀换等宽占位
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
    box.appendChild(setEstText(el('div', 'ov-total num'), side?.total ?? '')); // 问题⑨：≈/= 前缀换等宽占位
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
      li.appendChild(setEstText(el('b', 'ov-amt num'), r.amt)); // 问题⑨：≈/= 前缀换等宽占位
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
      tr.appendChild(setEstText(el('td', 'num'), r.now)); // 问题⑨：≈/= 前缀换等宽占位
      tr.appendChild(setEstText(el('td', 'num'), r.exp));
      tr.appendChild(el('td', 'hint', r.note));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrapEl.appendChild(table);
    panel.appendChild(wrapEl);
  }

  if (ov?.readout) {
    const ro = el('div', 'callout ov-readout');
    ro.innerHTML = estAwareHtml(ov.readout); // 可信 HTML（DATA.md：结构读数为 HTML 字符串）；问题⑨：≈ 前缀换等宽占位
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
          step.appendChild(setEstInlineText(el('span', 'hint'), st.d)); // 问题⑨：行内 ≈ 前缀换等宽占位
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
        bc.appendChild(setEstText(el('span'), cell.h ?? '')); // 问题⑨：≈/= 前缀换等宽占位
        const bar = el('div', 'bar');
        const fill = el('i');
        fill.style.width = Math.max(0, Math.min(100, Number(cell.bar.pct) || 0)) + '%';
        bar.appendChild(fill);
        bc.appendChild(bar);
        td.appendChild(bc);
      } else {
        setEstText(td, isObj ? String(cell.h ?? '') : String(cell ?? '')); // 问题⑨：≈/= 前缀换等宽占位
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

/**
 * 章节（可折叠面板）序列；opts.defaultCollapsed 控制初始开合。
 * 改动②：opts.flatSections 列出的章节 id 渲染为平铺面板——无折叠交互、
 * 内容直接可见、不带编号标题（内容自带的 h4 小标题充当节标题）。
 * 改动③：可折叠章节标题形如「x.y 名称：评语」时，评语段按灯色着色加粗。
 */
function appendSections(mount, sections, opts) {
  for (const sec of sections ?? []) {
    if (Array.isArray(opts.flatSections) && opts.flatSections.includes(sec.id)) {
      const flat = el('div', 'panel section-flat');
      flat.id = sec.id ?? '';
      const body = el('div', 'panel-body sec-body');
      renderBlocks(body, sec.blocks);
      flat.appendChild(body);
      mount.appendChild(flat);
      continue;
    }
    const d = el('details', 'panel section-panel');
    d.id = sec.id ?? '';
    d.open = !opts.defaultCollapsed;
    const summary = el('summary', 'sec-summary');
    appendSecTitle(summary, sec.title ?? '');
    d.appendChild(summary);
    const body = el('div', 'panel-body sec-body');
    renderBlocks(body, sec.blocks);
    d.appendChild(body);
    mount.appendChild(d);
  }
}

/* ------------------------ 改动③：健康度评语灯色判定 ------------------------
 * 章节标题「x.y 名称：评语」（如 3.1 消费习惯：健康且克制）的评语段按灯色醒目：
 *  - 标题含 🟢/🟡/🔴 时直接采用该灯色；
 *  - 否则按评语关键词打分：正负词并存=琥珀（有亮点有短板），仅正=绿，仅负=红，
 *    无命中=不着色（保持原文）；灯色 token 深浅主题各自保证对比度。
 * 无「：」分隔的标题（如 3.3 评分卡、1.x/2.x 各节）不参与，完全不受影响。 */
const VERDICT_LIGHT_EMOJI = { '🟢': 'ok', '🟡': 'warn', '🔴': 'danger' };
const VERDICT_GREEN_RE = /(健康|优秀|克制|达标|稳定|出色|偏优|良好|充裕|无忧|出色)/;
const VERDICT_RED_RE = /(失衡|风险|预警|危险|超支|透支|不足|偏高|偏薄|偏低|薄弱|恶化|单一|赤字)/;

/** 把章节标题写入 summary；命中灯色时拆成「名称段 + 着色评语段」两个 span */
function appendSecTitle(summary, title) {
  const s = String(title ?? '');
  const m = s.match(/^(\d+(?:\.\d+)?\s*[^：:]*[：:])\s*(.+)$/);
  if (!m) {
    summary.textContent = s;
    return;
  }
  const comment = m[2].trim();
  let tone = null;
  for (const [emo, t] of Object.entries(VERDICT_LIGHT_EMOJI)) {
    if (s.includes(emo)) {
      tone = t;
      break;
    }
  }
  if (!tone) {
    const hasGreen = VERDICT_GREEN_RE.test(comment);
    const hasRed = VERDICT_RED_RE.test(comment);
    tone = hasGreen && hasRed ? 'warn' : hasGreen ? 'ok' : hasRed ? 'danger' : null;
  }
  if (!tone) {
    summary.textContent = s;
    return;
  }
  summary.appendChild(el('span', 'sec-title-head', m[1]));
  summary.appendChild(el('span', 'sec-verdict sec-verdict-' + tone, comment));
}

/* --------------------------------- 计划引擎 -------------------------------- */

/**
 * 等额定投终值系数：((1+r)^n − 1) / r（r=0 时退化为 n）。
 * 仅作推演对照/外部换算用：computePlan 为逐月循环（见下），两者在
 * 「等额月投」下数学等价（fin=fin×(1+rm)+invM 迭代 n 月 ≡ 本金复利 + annuityFV）。
 */
function annuityFV(r, n) {
  if (n <= 0) return 0;
  if (!r) return n;
  return (Math.pow(1 + r, n) - 1) / r;
}

/** 推演第 m 月（1-based，第 1 月=now 当月）对应的日历 YYYY-MM（T10 按月模拟） */
function simYm(now, m) {
  const d = new Date(now.getFullYear(), now.getMonth() + m - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 计划推演（T10 · v2.0.7 按月化窗口 + 工资月均口径 + 年度奖金年度注入）。
 *
 * 口径：
 *  - 推演窗口 = 计划月数 months（1~360），第 1 月 = 今天当月；结束月 = 今天 + months − 1；
 *  - 消费 = 计划月收入 − 三池合计（定投+安全垫+ESOP），推导值不可编辑
 *    （「先储蓄后消费」）；可行性 = 消费 ≥ 0，超出即不可行（红字「消费为负」）；
 *  - 月收入缺省（plan.income ≤ 0）时退化用 income12m/12 月均（手动覆盖仍优先）；
 *  - 年度奖金（R2）：按月模拟中日历月命中 bonusMonth 时，当月投入额外 + bonusYear
 *    （每年一次，注入定投通道参与后续复利）；窗口 < 12 个月且不含发放月 → 不命中
 *    即不注入（保守，调用方在页面注明）；
 *  - 推演（v1 cushionCap 语义，溢出转定投）：
 *      每月安全垫入账 cM = min(cushion, cap − 已累计)，未入账部分（溢出）自动转定投；
 *      定投（含溢出与奖金注入）与期初本金按月复利；安全垫零收益累计（保守）；
 *      ESOP 按购入成本累计（不计收益）；期末金融资产 = 末月 fin + 安全垫累计。
 *
 * @param {PlanParams} plan
 * @param {number} income12m 近 12 个月总收入（元；仅在 income 缺省时使用）
 * @param {Date} [now] 推演起点（默认当前时间；第 1 月 = now 当月）
 * @returns {{feasible: boolean, warn?: string, income: number, consume: number, threeTotal: number, pools: {consume:number, invest:number, cushion:number, esop:number}, months: number, endFinance: number, endNet: number, avgIncome12m: number, cushionFinal: number, capMonth: number, overflowTotal: number, marks: Array<{m:number, fin:number, net:number}>, bonusInjections: Array<{m:number, ym:string, amt:number}>, bonusInjectedTotal: number, bonusPerYear: number, bonusMonth: number}}
 */
export function computePlan(plan, income12m = 0, now = new Date()) {
  const normMonths = (v) => Math.max(1, Math.min(360, Math.round(Number(v) || 1)));
  const p = /** @type {PlanParams} */ ({
    income: Number(plan?.income) || 0,
    invest: Number(plan?.invest) || 0,
    cushion: Number(plan?.cushion) || 0,
    cushionCap: Number(plan?.cushionCap) || 0,
    esop: Number(plan?.esop) || 0,
    months: normMonths(plan?.months),
    bonusYear: Math.max(0, Number(plan?.bonusYear) || 0),
    bonusMonth: Math.max(0, Math.min(12, Math.round(Number(plan?.bonusMonth) || 0))),
    rate: Number(plan?.rate) || 0,
    base: Number(plan?.base) || 0,
  });
  const avgIncome12m = income12m > 0 ? income12m / 12 : 0;
  const income = p.income > 0 ? p.income : avgIncome12m;

  // 消费推导（先储蓄后消费）：三池（定投+安全垫+ESOP）先转出，剩余为消费
  const threeTotal = p.invest + p.cushion + p.esop;
  const consume = income - threeTotal;
  const feasible = consume >= -0.005;
  const warn = feasible
    ? undefined
    : `消费为负：三池合计（定投+安全垫+ESOP）${fmtInt(threeTotal)} 元 > 计划月收入 ${fmtInt(income)} 元（超 ${fmtInt(-consume)} 元）：请下调三池`;

  // 逐月推演（T10 按月窗口 + 奖金年度注入；月序 1..months，第 1 月 = now 当月）：
  //   fin = 定投通道（期初本金 + 定投 + 安全垫溢出 + 奖金月注入，按月复利）；
  //   cCum = 安全垫零收益累计；期末金融资产 = fin + cCum（安全垫计入金融资产、不计收益）
  const months = p.months;
  const rm = p.rate / 12;
  const startMonth = now.getMonth(); // 0-based
  let fin = p.base;
  let cCum = 0;
  let capMonth = 0; // 首个「安全垫存满上限」的月序（1-based；0 = 推演期内未存满）
  const marks = /** @type {Array<{m:number, fin:number, net:number}>} */ ([]);
  const bonusInjections = /** @type {Array<{m:number, ym:string, amt:number}>} */ ([]);
  for (let m = 1; m <= months; m++) {
    const cM = Math.min(p.cushion, Math.max(0, p.cushionCap - cCum));
    const calMonth = ((startMonth + m - 1) % 12) + 1; // 该推演月的日历月（1-based）
    const bonusM = p.bonusYear > 0 && p.bonusMonth >= 1 && calMonth === p.bonusMonth ? p.bonusYear : 0;
    const invM = p.invest + (p.cushion - cM) + bonusM; // 溢出自动转定投；奖金月额外注入
    fin = fin * (1 + rm) + invM;
    cCum += cM;
    if (!capMonth && p.cushion > 0 && cCum >= p.cushionCap - 0.005) capMonth = m;
    if (bonusM > 0) bonusInjections.push({ m, ym: simYm(now, m), amt: bonusM });
    marks.push({ m, fin: fin + cCum, net: fin + cCum + p.esop * m });
  }
  const endFinance = fin + cCum;
  const esopTotal = p.esop * months;
  const endNet = endFinance + esopTotal;
  const overflowTotal = p.cushion * months - cCum; // 转入定投的安全垫溢出总额
  const bonusInjectedTotal = bonusInjections.reduce((s, x) => s + x.amt, 0);

  return {
    feasible,
    warn,
    income,
    consume,
    threeTotal,
    pools: { consume, invest: p.invest, cushion: p.cushion, esop: p.esop },
    months,
    endFinance,
    endNet,
    avgIncome12m,
    cushionFinal: cCum,
    capMonth,
    overflowTotal,
    marks,
    bonusInjections,
    bonusInjectedTotal,
    bonusPerYear: p.bonusYear,
    bonusMonth: p.bonusMonth,
  };
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
    /* 离线：留待 online 重试 */
  }
}

/* ------------------------- ⑫A 预期侧整块动态化（方案A） ------------------------- */

/** 归一化行名用于匹配：仅保留字母/数字/CJK（去空白与全半角标点、括注） */
function normRowName(s) {
  return String(s ?? '').replace(/[^\p{L}\p{N}]+/gu, '');
}

/** 公共前缀长度 */
function commonPrefixLen(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

/**
 * 预期行 ↔ 现值行匹配：全局贪心（按公共前缀降序占位，每行至多用一次，阈值 ≥2 字），
 * 未配上的一对再做「互为子串（≥2 字）」兜底（如 tag「固定资产残值」↔ 行「汽车残值」）。
 * @param {string[]} expNames 归一化后的预期侧行名
 * @param {string[]} nowNames 归一化后的现在侧行名
 * @returns {Map<number, number>} expIdx → nowIdx
 */
function matchRowNames(expNames, nowNames) {
  const pairs = [];
  for (let i = 0; i < expNames.length; i++) {
    for (let j = 0; j < nowNames.length; j++) {
      pairs.push({ i, j, score: commonPrefixLen(expNames[i], nowNames[j]) });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedExp = new Set();
  const usedNow = new Set();
  const map = new Map();
  for (const p of pairs) {
    if (p.score >= 2 && !usedExp.has(p.i) && !usedNow.has(p.j)) {
      usedExp.add(p.i);
      usedNow.add(p.j);
      map.set(p.i, p.j);
    }
  }
  for (let i = 0; i < expNames.length; i++) {
    if (usedExp.has(i)) continue;
    for (let j = 0; j < nowNames.length; j++) {
      if (usedNow.has(j)) continue;
      const a = expNames[i];
      const b = nowNames[j];
      if (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))) {
        usedExp.add(i);
        usedNow.add(j);
        map.set(i, j);
        break;
      }
    }
  }
  return map;
}

/** 最大余额法整数百分比：合计恰为 100（total≤0 时全 0），各项为 amt/total 的最佳整数近似 */
function largestRemainderPct(amounts, total) {
  const exact = amounts.map((v) => (total > 0 ? (v / total) * 100 : 0));
  const floors = exact.map((v) => Math.floor(v));
  let rest = 100 - floors.reduce((s, v) => s + v, 0);
  const order = exact.map((v, i) => ({ i, rem: v - floors[i] })).sort((a, b) => b.rem - a.rem);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i] += 1;
    rest -= 1;
  }
  return floors;
}

/** 去掉全部括注的短名（堆叠条/图例用）：「固定资产（小米汽车 · 残值估值）」→「固定资产」 */
function shortRowName(name) {
  const s = String(name ?? '').replace(/\s*[（(][^（）()]*[)）]\s*/g, '').trim();
  return s || String(name ?? '');
}

/**
 * ⑫A 方案A：计划页「预期」侧整块由计划参数动态生成，数据包静态 hero.exp/overview.exp
 * 字段退役（不再作为渲染来源）。
 *
 * 口径（全资产）：
 *  - hero.exp：head =「计划期末 · <今天+计划月数−1 的月份，YYYY-MM>」；两项 = 计划期末金融资产（≈endFinance）、
 *    计划期末总资产（≈期末全资产合计，负债 0 净=总）；
 *  - overview.exp：构成行 = 数据包静态 exp 行作模板（名/色/顺序），数值按「现值平移」取 now 侧
 *    同名行现值（名称归一后贪心匹配），名含「基金」的首个模板行 = endFinance（金融资产期末推演，
 *    其余基金名行并入不再单列）；total = 各构成行现值之和；所有 pc 按新总额用最大余额法重算
 *    （合计恰 100%）；stack 同步重算；静态 exp.head/total/sub/callout 一并退役、动态生成；
 *  - tableRows：逐行同步——tag 含「基金」→ ≈endFinance；total 合计行：金融资产 → ≈endFinance、
 *    总资产/净资产 → ≈全资产合计；负债/欠款 → 0；其余行匹配构成行取平移值（保留原 ≈ 前缀风格）；
 *  - readout：静态结构读数含 v1 旧值，一并退役，由动态数字生成。
 *
 * @param {DATA} data 当前生效 DATA
 * @param {PlanParams} plan 计划参数（renderPlanPage / chijia:planrecalc 提供）
 * @returns {{hero: HeroSide, overview: OverviewSide, tableRows: DATA['overview']['tableRows'], readout: string}}
 */
export function buildExpectedSides(data, plan) {
  const res = computePlan(plan, 0);
  const months = Math.max(1, Math.round(Number(plan?.months) || 1));
  // 结束月 = 今天 + 计划月数 − 1（T10）：末月最后一天作展示日（如 2026-11 起 8 个月 → 2027-06-30）
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth() + months, 0);
  const p2 = (n) => String(n).padStart(2, '0');
  const ymd = `${end.getFullYear()}-${p2(end.getMonth() + 1)}-${p2(end.getDate())}`;
  const ym = `${end.getFullYear()}-${p2(end.getMonth() + 1)}`;
  const startYm = `${today.getFullYear()}-${p2(today.getMonth() + 1)}`;
  const ratePct = Math.round((Number(plan?.rate) || 0) * 1000) / 10;

  const ov = data?.overview ?? {};
  const nowRows = (ov.now?.rows ?? []).map((r) => ({
    ...r,
    _norm: normRowName(r.name),
    _amt: Math.round(parseNum(r.amt)),
  }));
  // 模板行：静态 exp 行优先；缺失时退化为 now 侧正资产行（同样走平移+基金行规则）
  const tmplSrc = (ov.exp?.rows ?? []).length
    ? ov.exp.rows
    : nowRows.filter((r) => (r._amt ?? 0) > 0);
  const tmpl = tmplSrc.map((r) => ({ ...r, _norm: normRowName(r.name) }));

  // 基金行判定：首个名含「基金」的模板行承接 endFinance；其余基金名行并入、不再单列
  let fundSeen = false;
  const compRows = [];
  for (const r of tmpl) {
    if (/基金/.test(String(r.name ?? ''))) {
      if (!fundSeen) {
        fundSeen = true;
        compRows.push({ ...r, _fund: true });
      }
      continue;
    }
    compRows.push(r);
  }

  const match = matchRowNames(
    compRows.map((r) => r._norm),
    nowRows.map((r) => r._norm),
  );

  // 金额：基金行 = endFinance；其余 = now 侧同名行现值（无匹配为 0；负值保留并标 neg）
  const amounts = compRows.map((r, i) => {
    if (r._fund) return Math.round(res.endFinance);
    const src = match.get(i);
    return src != null ? Math.round(parseNum(nowRows[src].amt)) : 0;
  });
  const total = amounts.reduce((s, v) => s + (v > 0 ? v : 0), 0);
  const pct = largestRemainderPct(amounts.map((v) => Math.max(0, v)), total);

  const fundIdx = compRows.findIndex((r) => r._fund);
  const esopIdx = compRows.findIndex((r) => /ESOP|虚拟股/i.test(String(r.name ?? '')));

  const rows = compRows.map((r, i) => {
    const amt = amounts[i];
    const amtStr = r._fund
      ? '≈' + fmtInt(res.endFinance)
      : match.get(i) != null
        ? String(nowRows[match.get(i)].amt ?? '0')
        : '0';
    const neg = amt < 0;
    return {
      c: r.c,
      name: r.name,
      amt: amtStr,
      pc: neg ? '—' : pct[i] + '%',
      ...(neg ? { muted: true, neg: true } : {}),
    };
  });

  const stack = [];
  for (let i = 0; i < compRows.length; i++) {
    if ((amounts[i] ?? 0) <= 0 || pct[i] <= 0) continue;
    stack.push({
      w: pct[i],
      color: compRows[i].c,
      label: `${shortRowName(compRows[i].name)} ${pct[i]}%`,
    });
  }

  // 奖金注入说明（R2 推演证据 / 未注入保守说明）
  const bonusClause = res.bonusPerYear > 0
    ? res.bonusInjections.length
      ? `含年度奖金注入 ${res.bonusInjections.length} 次（${res.bonusInjections.map((x) => x.ym).join('、')}，合计 ≈${fmtInt(res.bonusInjectedTotal)} 元，已计入金融资产）；`
      : `年度奖金 ${fmtInt(res.bonusPerYear)} 元未注入：窗口 ${startYm}~${ym} 未覆盖 ${res.bonusMonth} 月发放月（保守）；`
    : '';

  const overview = {
    head: `预期 · ${ymd}（按参数推演）`,
    total: '≈' + fmtInt(total),
    sub: '｜ 净资产（负债 0）',
    stack,
    rows,
    callout:
      `预期侧由计划参数动态推演（${startYm} → ${ymd}，${months} 个月）：金融资产按年化 ${ratePct}% 复利、非金融资产按现值平移；` +
      bonusClause +
      '含假设，非承诺收益，月末以实际数据复核。',
  };

  // tableRows：tag/说明样式保留，exp 列全部换动态值
  const tableRows = (ov.tableRows ?? []).map((r) => {
    const tag = String(r.tag ?? '');
    let expVal;
    if (r.total && /金融资产/.test(tag)) {
      expVal = '≈' + fmtInt(res.endFinance);
    } else if (r.total) {
      expVal = '≈' + fmtInt(total); // 总资产/净资产等合计行（负债 0，净=总）
    } else if (/负债|欠款/.test(tag)) {
      expVal = '0';
    } else {
      const hit = matchRowNames([normRowName(tag)], compRows.map((c) => c._norm)).get(0);
      expVal = hit != null
        ? compRows[hit]._fund
          ? '≈' + fmtInt(res.endFinance)
          : match.get(hit) != null ? String(nowRows[match.get(hit)].amt ?? '0') : '0'
        : '0';
    }
    return { ...r, exp: expVal };
  });

  // 结构读数：静态 readout 含 v1 旧值（与动态预期侧矛盾），一并退役改由动态数字生成
  const fundPct = fundIdx >= 0 ? pct[fundIdx] : 0;
  const nowPosTotal = nowRows.reduce((s, r) => s + Math.max(0, r._amt ?? 0), 0);
  let esopClause = '';
  if (esopIdx >= 0 && (amounts[esopIdx] ?? 0) > 0) {
    const nowSrc = match.get(esopIdx);
    const nowEsop = nowSrc != null ? Math.max(0, nowRows[nowSrc]._amt ?? 0) : 0;
    esopClause =
      `ESOP 集中度（成本口径）现在 ${nowPosTotal > 0 ? Math.round((nowEsop / nowPosTotal) * 1000) / 10 : 0}%` +
      ` → 计划期末 ${pct[esopIdx]}%；`;
  }
  const readout =
    `<b>结构读数（按当前参数动态推演）：</b>计划期末总资产 <b>≈${fmtInt(total)}</b> 元（负债 0，净=总）；` +
    `金融资产 <b>≈${fmtInt(res.endFinance)}</b>、占 ${fundPct}%；${esopClause}` +
    '构成与占比随参数联动，月末以实际数据复核。';

  const hero = {
    head: `计划期末 · ${ym}`,
    items: [
      { label: '计划期末金融资产', b: '≈' + fmtInt(res.endFinance) },
      { label: '计划期末总资产', b: '≈' + fmtInt(total) },
    ],
  };

  return { hero, overview, tableRows, readout };
}

/**
 * 构建 ④ 参数面板 UI（T10 · v2.0.7 计划月数 + 年度奖金 + 输入修复）。
 *
 * 字段（三池=绝对值，每月元，步进 500；对齐 v1 core.js:689-693 步进）：
 *   计划月收入（自动派生+可覆盖）/ 每月定投 / 每月安全垫 / 安全垫上限 / 每月 ESOP /
 *   金融资产期初本金 / 年度奖金 / 计划月数（1~360，步进 1）/ 奖金发放月（1~12，0=不注入）。
 * 展示行（不可编辑）：消费（推导）= 月收入 − 三池合计 + 三池占月收入比；
 *   计划窗口行：起始月 → 结束月（今天+计划月数−1，随月数联动）。
 * 校验区：三池合计 > 月收入 → 红字「消费为负：请下调三池」（role=alert）；
 *         安全垫存满上限 → 溢出自动转定投提示；年度奖金 → 注入/未覆盖说明。
 *
 * R3 输入修复：input 事件只暂存（焦点字段保护——编辑中不重渲染面板、不广播、不落库）；
 *   blur（或点「按参数重算」）才归一显示值 + 持久化 + 广播重演。全部参数可键盘直接输入。
 *
 * @param {HTMLElement} mount
 * @param {PlanParams} plan 当前参数
 * @param {(next: PlanParams) => void} onChange 参数变更回调（仅在 blur/重算时触发）
 * @param {{incomeSource?: string, incomeRescope?: boolean}} [meta]
 *   incomeSource：派生说明（月收入自动派生来源文案；无流水派生时省略）；
 *   incomeRescope：一次性口径升级说明（旧实体 income 为含奖金摊销口径，本次已按工资月均重派生）
 * @returns {void}
 */
export function buildPlanPanel(mount, plan, onChange, meta = {}) {
  if (!mount) return;
  mount.textContent = '';
  const normMonths = (v) => Math.max(1, Math.min(360, Math.round(Number(v) || 1)));
  const normBonusMonth = (v) => Math.max(0, Math.min(12, Math.round(Number(v) || 0)));
  const current = /** @type {PlanParams} */ ({
    income: Number(plan?.income) || 0,
    invest: Number(plan?.invest) || 0,
    cushion: Number(plan?.cushion) || 0,
    cushionCap: Number(plan?.cushionCap) || 0,
    esop: Number(plan?.esop) || 0,
    months: normMonths(plan?.months),
    bonusYear: Math.max(0, Number(plan?.bonusYear) || 0),
    bonusMonth: normBonusMonth(plan?.bonusMonth),
    rate: Number(plan?.rate) || 0,
    base: Number(plan?.base) || 0,
  });

  const root = el('div', 'pp');

  // R2 迁移一次性说明：旧实体 income 为含奖金摊销口径，本次已按工资月均重派生（不保留旧值）
  if (meta.incomeRescope) {
    const rescope = el('div', 'callout warn pp-rescope-note');
    rescope.textContent =
      'ℹ 口径升级（v2.0.7）：计划月收入改为「近 12 个月工资月均」（不含奖金/补贴摊销），已按流水重新派生，旧手填值不再保留，可直接改写覆盖；' +
      '新增「年度奖金」按发放月一次性注入推演。推演窗口由「推演年数」改为「计划月数」（旧年数 ×12 平移）。';
    root.appendChild(rescope);
  }

  const grid = el('div', 'pp-grid');
  const fields = /** @type {const} */ ([
    ['income', '计划月收入（元/月）', 500],
    ['invest', '每月定投（元/月）', 500],
    ['cushion', '每月安全垫（元/月）', 500],
    ['cushionCap', '安全垫上限（元）', 1000],
    ['esop', '每月 ESOP（元/月）', 500],
    ['base', '金融资产期初本金（元）', 1000],
    ['bonusYear', '年度奖金（元/年）', 500],
    ['bonusMonth', '奖金发放月（月）', 1],
    ['months', '计划月数（月）', 1],
  ]);
  /** @type {Record<string, HTMLInputElement>} */
  const inputs = {};
  let dirty = false; // R3：编辑中暂存标记（blur 时有改动才持久化广播）
  /** 字段显示值（收益率以百分数呈现 0.05 ↔ 5，其余原样） */
  const displayVal = (key) => String(key === 'rate' ? Math.round(current.rate * 1000) / 10 : current[key]);
  /** input 事件：只暂存（R3 焦点字段保护） */
  const stash = (key, input) => {
    const v = Number(input.value);
    if (!Number.isFinite(v) || v < 0) {
      dirty = true; // 非法/负值：不落 current，blur 时归一显示
      return;
    }
    current[key] =
      key === 'months' ? normMonths(v)
      : key === 'bonusMonth' ? normBonusMonth(v)
      : key === 'rate' ? v / 100
      : v;
    dirty = true;
  };
  /** blur 事件：归一显示值；有改动才刷新展示区 + 持久化 + 广播重演（R3） */
  const commit = (key, input) => {
    input.value = displayVal(key);
    if (!dirty) return;
    dirty = false;
    refresh();
    emit();
  };
  for (const [key, label, step] of fields) {
    const lab = el('label', 'pp-field');
    lab.appendChild(el('span', 'pp-lab', label));
    const input = /** @type {HTMLInputElement} */ (el('input'));
    input.type = 'number';
    input.inputMode = 'decimal';
    if (key === 'months') {
      input.min = '1';
      input.max = '360';
    } else {
      input.min = '0';
    }
    input.step = String(step);
    if (key === 'bonusMonth') input.max = '12';
    input.value = displayVal(key);
    input.dataset.k = key;
    input.addEventListener('input', () => stash(key, input));
    input.addEventListener('blur', () => commit(key, input));
    lab.appendChild(input);
    if (key === 'bonusMonth') {
      const hint = el('span', 'pp-sub-hint', '1~12 月；0 = 不注入');
      lab.appendChild(hint);
    }
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
    input.value = displayVal('rate');
    input.dataset.k = 'rate';
    input.addEventListener('input', () => stash('rate', input));
    input.addEventListener('blur', () => commit('rate', input));
    lab.appendChild(input);
    grid.appendChild(lab);
    inputs.rate = input;
  }
  root.appendChild(grid);

  // 计划窗口行（R1：结束月 = 今天 + 计划月数 − 1，随月数联动）
  const windowHint = el('p', 'hint pp-window-hint');
  root.appendChild(windowHint);

  // 月收入派生说明（自动派生+可覆盖）：有流水派生来源时标注口径（工资月均）
  if (meta.incomeSource) {
    const note = el('p', 'hint pp-derive-note', '计划月收入：' + meta.incomeSource + '；手动改写后以手填为准。');
    root.appendChild(note);
  }

  // 展示行：消费（推导，不可编辑）+ 三池占比（占计划月收入）
  const deriveBox = el('div', 'pp-derive');
  const consumeRow = el('div', 'pp-derive-row');
  const poolsRow = el('div', 'pp-derive-row');
  deriveBox.appendChild(consumeRow);
  deriveBox.appendChild(poolsRow);
  root.appendChild(deriveBox);

  const status = el('div', 'pp-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.appendChild(status);

  const actions = el('div', 'pp-actions');
  const btn = el('button', 'btn btn-primary', '🔄 按参数重算');
  btn.type = 'button';
  const flash = el('span', 'hint pp-flash');
  btn.addEventListener('click', () => {
    dirty = false;
    refresh();
    emit();
    flash.textContent = '已按当前参数重算 ✓';
    setTimeout(() => { flash.textContent = ''; }, 2500);
  });
  actions.appendChild(btn);
  actions.appendChild(flash);
  root.appendChild(actions);
  mount.appendChild(root);

  function emit() {
    onChange({ ...current });
  }

  function refresh() {
    const res = computePlan(current, 0);
    const pct = (v) => (res.income > 0 ? Math.round((v / res.income) * 100) : 0);

    // 计划窗口行（R1：起始月 → 结束月动态显示）
    {
      const today = new Date();
      const startYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
      windowHint.textContent = `计划窗口：${startYm} → ${simYm(today, res.months)}（${res.months} 个月；结束月 = 今天 + 计划月数 − 1）`;
    }

    // 展示行：消费推导 + 三池占比
    consumeRow.textContent = '';
    {
      const tag = el('span', 'tag tag-gray', '消费（推导）');
      const val = el('b', null, fmtInt(res.consume) + ' 元/月');
      const use = el('span', 'hint', '房租 + 饮食 + 其他日常');
      const how = el('span', 'hint', '= 计划月收入 − 三池合计，不可编辑');
      consumeRow.append(tag, val, use, how);
    }
    poolsRow.textContent = '';
    {
      const lead = el('span', 'hint', '三池占比（占计划月收入）：');
      const inv = el('span', null, `定投 ${fmtInt(current.invest)} · ${pct(current.invest)}%`);
      const cus = el('span', null, `安全垫 ${fmtInt(current.cushion)} · ${pct(current.cushion)}%`);
      const eso = el('span', null, `ESOP ${fmtInt(current.esop)} · ${pct(current.esop)}%`);
      poolsRow.append(lead, inv, cus, eso);
    }

    // 校验区
    status.textContent = '';
    if (!res.feasible) {
      const warnBox = el('div', 'callout danger plan-warn');
      warnBox.setAttribute('role', 'alert');
      // res.warn 已含「消费为负：…请下调三池」完整话术（任务书指定红字），此处仅加警示符
      warnBox.textContent = '⚠ ' + (res.warn ?? '参数不可行');
      status.appendChild(warnBox);
    } else {
      const okBox = el('div', 'callout ok');
      okBox.innerHTML =
        `校验通过：三池合计（定投+安全垫+ESOP）${fmtInt(res.threeTotal)} ≤ 计划月收入 ${fmtInt(res.income)} 元；` +
        `消费（推导）${fmtInt(res.consume)} 元/月。` +
        `${res.months} 个月后金融资产 <b><span class="est-pad"></span>${fmtInt(res.endFinance)}</b> 元，净资产 <b><span class="est-pad"></span>${fmtInt(res.endNet)}</b> 元` +
        '（估算，含复利假设）';
      status.appendChild(okBox);
    }
    // 年度奖金注入说明（R2：注入证据 / 窗口未覆盖保守说明）
    if (res.bonusPerYear > 0) {
      status.appendChild(el(
        'p',
        'hint pp-bonus-hint',
        res.bonusInjections.length
          ? `年度奖金 ${fmtInt(res.bonusPerYear)} 元/年：${res.bonusMonth} 月发放月当月注入定投（本次推演命中 ${res.bonusInjections.length} 次：${res.bonusInjections.map((x) => x.ym).join('、')}，合计 ${fmtInt(res.bonusInjectedTotal)} 元，已计入期末金融资产）。`
          : `年度奖金 ${fmtInt(res.bonusPerYear)} 元未注入：计划窗口 ${res.months} 个月未覆盖 ${res.bonusMonth} 月发放月（保守处理，不计入推演）。`,
      ));
    }
    // 安全垫上限提示（v1 cushionCap 语义：存满后溢出自动转定投）
    if (current.cushion > 0) {
      let capHint = '';
      if (current.cushionCap <= 0) {
        capHint = `安全垫上限为 0：每月 ${fmtInt(current.cushion)} 元安全垫全额自动转入定投。`;
      } else if (res.capMonth > 0) {
        capHint = `安全垫将在第 ${res.capMonth} 个月存满上限 ${fmtInt(current.cushionCap)} 元，其后每月 ${fmtInt(current.cushion)} 元自动转入定投（推演已计入）。`;
      } else {
        capHint = `安全垫 ${res.months} 个月内不会存满上限（期末累计 ≈${fmtInt(res.cushionFinal)} 元）。`;
      }
      status.appendChild(el('p', 'hint pp-cap-hint', capHint));
    }
  }
  refresh();
}

/* --------------------------------- 导入管线 -------------------------------- */

/**
 * 流水文本逐行解析：逐行尝试注册表中的格式，首个命中的即采用。
 *
 * 问题⑧（末尾去重，保留首条）：多份流水 PDF 日期范围重叠时，同一笔交易会
 * 出现在多份文本里，不去重会产生重复交易。规范化去重键 =
 * `d|time|t|dc|amt|bal`（amt/bal 归一为两位小数字符串；time 取 map 可选提供
 * 的行内交易时间，格式未提供时为空串）。rest（户名+摘要）明确不入键：
 * 同一天的真实多笔交易可能 d/time/t/dc/amt/bal 之外的摘要续行不同（折行截断），
 * 但键内各列已足以区分真实交易——跨 PDF 重复行的这些列必然全同；
 * 而若把 rest 入键，摘要折行差异会让真重复（同笔交易跨 PDF）漏判。
 *
 * @param {string} text 用户粘贴的文本或 pdf.js 抽取文本
 * @param {Record<string, import('./formats.js').FormatEntry>} [formats] 默认 FORMATS
 * @returns {{txns: Txn[], failed: string[]}} failed 为未命中任何格式的原始行
 */
export function parseLines(text, formats = FORMATS) {
  const rows = /** @type {Array<{txn: Txn, key: string}>} */ ([]);
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
      const txn = {
        d: mapped.d,
        t: String(mapped.t ?? ''),
        dc: mapped.dc,
        amt: Math.abs(Number(mapped.amt)),
        rest: String(mapped.rest ?? '').trim(),
        ...(Number.isFinite(Number(mapped.bal)) ? { bal: Number(mapped.bal) } : {}),
      };
      // 去重键（问题⑧）：rest 不入键，理由见函数注释
      const key = [
        txn.d,
        String(mapped.time ?? ''),
        txn.t,
        txn.dc,
        Number(txn.amt).toFixed(2),
        Number.isFinite(Number(txn.bal)) ? Number(txn.bal).toFixed(2) : '',
      ].join('|');
      rows.push({ txn, key });
    } else {
      failed.push(raw.trim());
    }
  }
  // 末尾去重（问题⑧）：同键只保留首条
  const seen = new Set();
  const txns = /** @type {Txn[]} */ ([]);
  for (const { txn, key } of rows) {
    if (seen.has(key)) continue;
    seen.add(key);
    txns.push(txn);
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
 * 已分类交易中的「近 12 个月窗口收入通道交易」（工资+奖金+补贴）。
 * 窗口 = 今日往前 12 个月（computeIncome12m 与 deriveIncome12mInfo 共用，口径一致）。
 * @param {Txn[]} txns 已分类（cat 已写回）的交易
 * @param {Date} [now] 计算基准，默认当前时间
 * @returns {Txn[]} 窗口内收入交易
 */
function incomeWindowOf(txns, now = new Date()) {
  const cutoff = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
  return (txns ?? []).filter((t) => {
    if (t.dc !== 'C') return false;
    if (!(t.cat === 'salary' || t.cat === 'bonus' || t.cat === 'subsidy')) return false;
    const d = new Date(String(t.d) + 'T00:00:00');
    return !Number.isNaN(d.getTime()) && d >= cutoff && d <= now;
  });
}

/**
 * 近 12 个月收入合计（工资+奖金+补贴通道；skip 除外）。
 * @param {Txn[]} txns 已分类（cat 已写回）的交易
 * @param {Date} [now] 计算基准，默认当前时间
 * @returns {number} 元
 */
export function computeIncome12m(txns, now = new Date()) {
  return incomeWindowOf(txns, now).reduce((s, t) => s + t.amt, 0);
}

/**
 * 原始交易 → 分类 → 近 12 个月窗口收入交易（deriveIncome12mInfo 专用）。
 * @param {Txn[]} txns 全量交易（未分类）
 * @param {ImporterRules} [rules] 分类规则
 * @param {Date} [now] 计算基准，默认当前时间
 * @returns {Txn[]} 窗口内收入交易（已写回 cat）
 */
function incomeWindowTxns(txns, rules, now = new Date()) {
  return incomeWindowOf(classify(txns ?? [], rules ?? {}), now);
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

/** 里程碑展示月序选取：窗口长时隔点抽样，始终含末月（T10：推演窗口按月化） */
function pickMilestoneMonths(months) {
  const wanted = [3, 6, 12, 24, 36, 60, 120, 180, 240, 300, 360, months];
  return Array.from(new Set(wanted.filter((m) => m >= 1 && m <= months))).sort((a, b) => a - b);
}

/** 里程碑标签：整年月序显示「第 N 年末」，其余显示「第 N 个月末」 */
function milestoneLabel(m) {
  return m % 12 === 0 ? `第 ${m / 12} 年末` : `第 ${m} 个月末`;
}

/**
 * 由计划参数生成 1.1~1.4 章节（D3 锚点；计划页参数重算后自动更新用）。
 * T10 · v2.0.7 新口径：推演窗口=计划月数（第 1 月=今天当月）、月收入=工资月均派生、
 * 年度奖金按发放月一次性注入定投通道（窗口未覆盖发放月则不注入并注明）；
 * 消费=月收入−三池合计（推导）、结余=三池合计、安全垫存满上限后溢出自动转定投。
 * 返回 `{id,title,blocks}[]`：1.1 四池分配（allocbar+明细+可行性 callout）、
 * 1.2 结余推演、1.3 期末预期、1.4 里程碑。金额走 D4 计划页整数口径。
 * @param {PlanParams} plan
 * @param {number} [income12m] 近 12 个月总收入（元，仅在 income 缺省时作退化口径）
 * @returns {Array<{id: string, title: string, blocks: Block[]}>}
 */
export function buildPlanBlocks(plan, income12m = 0) {
  const res = computePlan(plan, income12m);
  const { consume, invest, cushion, esop } = res.pools;
  const income = res.income;
  const den = income > 0 ? income : res.threeTotal || 1; // 占比分母=计划月收入（缺省退化三池合计）
  const pctOf = (v) => Math.round((v / den) * 100);

  /* 1.1 四池分配 */
  const alloc = [
    { cls: 'ab-consume', label: `消费（推导） ${pctOf(consume)}%`, v: consume, use: '房租 + 饮食 + 其他日常' },
    { cls: 'ab-invest', label: `定投 ${pctOf(invest)}%`, v: invest, use: '指数基金定投（发薪日自动转出）' },
    { cls: 'ab-cushion', label: `安全垫 ${pctOf(cushion)}%`, v: cushion, use: '应急备用金，存满上限后溢出自动转定投' },
    { cls: 'ab-esop', label: `ESOP ${pctOf(esop)}%`, v: esop, use: '公司股权按购入成本计' },
  ];
  const s11 = /** @type {Block[]} */ ([
    { t: 'sub', html: `「先储蓄后消费」：计划月收入先切出三池（定投/安全垫/ESOP），剩余即消费——消费为<b>推导值</b>（= 月收入 − 三池合计），不可直接编辑；校验：三池合计 ≤ 计划月收入。` },
    { t: 'allocbar', items: alloc.map(({ cls, label }) => ({ cls, label })) },
    { t: 'h4', html: `月度分配明细 <span class="hint">（按计划月收入 ${fmtInt(income)} 计；消费行带「推导」标识）</span>` },
    {
      t: 'table',
      head: [{ h: '池子' }, { h: '金额(元/月)', num: true, w: '22%' }, { h: '占比', num: true, w: '14%' }, '用途'],
      rows: alloc.map(({ label, v, use }) => ({
        cells: [label.replace(/\s*\d+(?:\.\d+)?%\s*$/, ''), { h: fmtInt(v), num: true }, { h: pctOf(v) + '%', num: true }, use],
      })),
    },
    res.feasible
      ? {
          t: 'callout', kind: 'ok',
          html: `三池合计 ${fmtInt(res.threeTotal)} ≤ 计划月收入 ${fmtInt(income)} 元，消费（推导）${fmtInt(consume)} 元（房租 + 饮食 + 其他日常）。` +
            (res.capMonth > 0 && cushion > 0
              ? `安全垫第 ${res.capMonth} 个月存满上限，其后每月溢出自动转定投。`
              : cushion > 0 ? `安全垫按上限 ${fmtInt(Number(plan?.cushionCap) || 0)} 元累计。` : ''),
        }
      : { t: 'callout', kind: 'warn', html: '⚠ ' + (res.warn ?? '消费为负：请下调三池') },
  ]);

  /* 1.2 结余推演（首列 minw 9em 与 1.3 同款机制，VIS-O-1 收尾）。
     与 1.3 的差异：此处只设 minw 不设 w——1.2 行名最长 13 字（月度结余（投资+缓冲+ESOP)，
     一行需 ~210px），钉死 w 会让宽屏首列停在 117px 仍折 2 行（实测）；minw-only 让宽屏
     auto 按内容放宽（1440 实测 234px 全行名 1 行）、390 由 9em 硬下限兜底（实测 143px，
     10+ 字长行名在 349px 内容宽内物理上仍为 2 行语义断行，非逐字竖排；一行需 ~210px，
     剩余宽不足金额/说明两列 min-content）。无横向溢出（390/1440 实测 tblScrollW==tblClientW） */
  const s12Rows = [
    { cells: ['计划月收入', { h: fmtInt(income), num: true }, incomeSourceHint(plan, income12m) ] },
    { cells: ['月度结余（三池合计）', { h: fmtInt(res.threeTotal), num: true, cls: 'strong' }, '定投 + 安全垫 + ESOP，发薪日先转出'] },
    { cells: ['消费（推导）', { h: fmtInt(consume), num: true }, '房租 + 饮食 + 其他日常（= 月收入 − 三池合计）'] },
    { cells: ['进入复利通道（定投）', { h: fmtInt(invest), num: true }, '按年化假设复利；安全垫存满后溢出自动并入'] },
  ];
  if (res.overflowTotal > 0.005) {
    s12Rows.push({
      cells: ['安全垫溢出（并入定投）', { h: fmtInt(res.overflowTotal), num: true }, `第 ${res.capMonth} 个月存满上限后至期末的溢出总额（推演已计复利）`],
    });
  }
  // R2：年度奖金注入（一次性，非月度）——命中发放月则列注入证据；未覆盖则保守不注入
  if (res.bonusPerYear > 0) {
    if (res.bonusInjections.length) {
      s12Rows.push({
        cells: [
          '年度奖金注入（一次性）',
          { h: fmtInt(res.bonusInjectedTotal), num: true },
          `${res.bonusMonth} 月发放月当月额外投入定投通道，本次推演命中 ${res.bonusInjections.length} 次（${res.bonusInjections.map((x) => x.ym).join('、')}），已计复利`,
        ],
      });
    }
  }
  const s12 = /** @type {Block[]} */ ([
    {
      t: 'table',
      head: [{ h: '项目', minw: '9em' }, { h: '金额(元/月)', num: true, w: '26%' }, '说明'],
      rows: s12Rows,
    },
    {
      t: 'details',
      title: '推演假设明细',
      blocks: [
        { t: 'ms', items: [
          `年化 ${Math.round((Number(plan?.rate) || 0) * 1000) / 10}% 复利（仅本金与定投，含安全垫溢出）`,
          '收入不增长（保守）',
          `安全垫零收益累计，上限 ${fmtInt(Number(plan?.cushionCap) || 0)} 元${res.capMonth > 0 && cushion > 0 ? `（第 ${res.capMonth} 个月存满）` : ''}，溢出自动转定投`,
          `ESOP 按购入成本累计 ${fmtInt(esop * res.months)} 元（${res.months} 个月）`,
          res.bonusPerYear > 0
            ? res.bonusInjections.length
              ? `年度奖金 ${fmtInt(res.bonusPerYear)} 元/年于 ${res.bonusMonth} 月注入定投（本次推演 ${res.bonusInjections.length} 次，合计 ${fmtInt(res.bonusInjectedTotal)} 元）`
              : `年度奖金 ${fmtInt(res.bonusPerYear)} 元/年：计划窗口 ${res.months} 个月未覆盖 ${res.bonusMonth} 月发放月，未注入（保守）`
            : '年度奖金未设置（0 元）',
        ] },
        { t: 'gap', h: '8px' },
        { t: 'sub', html: '任一假设变化请在上方参数面板重算，不要手改本文。' },
      ],
    },
  ]);

  /* 1.3 期末预期（bars 以净资产为 100 基准）；
     首列 w/minw 9em（VIS-O-1）——无显式宽时 auto 布局把首列压到 ~70px，
     CJK 行名（金融资产合计/其中：安全垫，T8 前叫「缓冲池」）被逐字竖排折行；9em（fs-sm 13px → 117px，
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
        { cells: ['金融资产合计', { h: '≈' + fmtInt(res.endFinance), num: true, bar: bar(res.endFinance) }, { h: Math.round((res.endFinance / endNet) * 100) + '%', num: true }, '期初本金复利 + 定投复利（含安全垫溢出）' + (res.bonusInjectedTotal > 0 ? ' + 年度奖金注入' : '')] },
        { cells: ['其中：安全垫', { h: '≈' + fmtInt(res.cushionFinal), num: true, bar: bar(res.cushionFinal) }, { h: Math.round((res.cushionFinal / endNet) * 100) + '%', num: true }, `零收益保守累计${Number(plan?.cushionCap) > 0 ? `，上限 ${fmtInt(Number(plan?.cushionCap))} 元` : ''}`] },
        { cells: ['ESOP 池', { h: fmtInt(esop * res.months), num: true, bar: bar(esop * res.months) }, { h: Math.round(((esop * res.months) / endNet) * 100) + '%', num: true }, '按购入成本，不计收益'] },
        { cells: ['净资产合计', { h: '≈' + fmtInt(res.endNet), num: true, cls: 'strong', bar: { pct: 100 } }, { h: '100%', num: true }, '金融资产 + ESOP'] },
      ],
    },
    { t: 'sub', html: `推演期 ${res.months} 个月${res.months % 12 === 0 ? `（${res.months / 12} 年）` : ''}；含复利假设，非承诺收益，月末用实际数据复核。` },
  ]);

  /* 1.4 里程碑 */
  const s14 = /** @type {Block[]} */ ([
    {
      t: 'flow',
      steps: pickMilestoneMonths(res.months).map((m) => {
        const mark = res.marks.find((x) => x.m === m) ?? res.marks[res.marks.length - 1];
        return { t: milestoneLabel(mark.m), d: `金融资产 ≈${fmtInt(mark.fin)} 元 · 净资产 ≈${fmtInt(mark.net)} 元` };
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

/** 1.2「计划月收入」行说明：派生口径（工资月均）或参数面板取值（面板值可覆盖自动派生） */
function incomeSourceHint(plan, income12m) {
  if ((Number(plan?.income) || 0) > 0) return '参数面板取值（面板可覆盖自动派生）';
  return income12m > 0 ? '近 12 个月入账 ÷ 12 推导' : '自动派生（近 12 个月工资 ÷ min(12, 跨度)）';
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

/** pdf.js UMD 构建（v3 系最后提供 window.pdfjsLib 的版本）。
 *  ⑪ 本地化：vendor 内置与 CDN 双保险——本地优先（零外部请求、断网可用），
 *  vendor 缺失时回退原 CDN（历史路径兼容）。路径相对页面根（六页均在 frontend 根）。 */
const PDFJS_VENDOR = 'vendor/pdfjs/';
const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';

/** 动态插一条 script，resolve 表示加载成功且回调可用 */
function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(null);
    s.onerror = () => reject(new Error('script 加载失败：' + src));
    document.head.appendChild(s);
  });
}

/**
 * 按需加载 pdf.js：本地 vendor 优先，失败回退 CDN（⑪ 双保险）。
 * 两路都失败才抛错，调用方须弹窗说明——UX-SPEC 错误态。
 * @returns {Promise<any>} pdfjsLib 命名空间
 */
export async function loadPdfJs() {
  const w = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
  if (w.pdfjsLib?.getDocument) return w.pdfjsLib;
  let ready = false;
  for (const base of [PDFJS_VENDOR, PDFJS_CDN]) {
    try {
      await loadScriptOnce(base + 'pdf.min.js');
      ready = !!w.pdfjsLib?.getDocument;
    } catch {
      ready = false;
    }
    if (ready) break;
  }
  if (!ready || !w.pdfjsLib?.getDocument) {
    throw Object.assign(
      new Error('pdf.js 组件加载失败：本地组件（vendor/pdfjs/）缺失且 CDN 不可达。可改用「粘贴文本」方式导入。'),
      { code: 'PDFJS_LOAD_FAILED' },
    );
  }
  const lib = w.pdfjsLib;
  // worker 与库同目录（本地 vendor 内置；断网/无 CDN 均可用）
  lib.GlobalWorkerOptions.workerSrc = PDFJS_VENDOR + 'pdf.worker.min.js';
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
 * 一次性口径升级说明标记（T10 · R2 迁移）：旧实体 income 为含奖金摊销口径，
 * migratePlanShape 检出旧 shape 时置 true → renderPlanPage 给面板传一次性说明文案；
 * 新 shape 落库（首次 blur/重算）后 reload 不再触发迁移，说明随之消失。
 */
let _planIncomeRescoped = false;

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

/**
 * 计划参数缺省值（自动派生仅在无手动值时生效——idb 存在 plan 实体即以手动值为准）：
 *  - 期初本金 = boot 时 hero 实时「当前流动资产」（无该项则退回非估算「金融资产」项）；
 *  - 月收入 = 近 12 个月工资月均（工资类入账 ÷min(12,跨度) 口径，见 deriveIncome12mInfo；
 *    无流水时退回示例口径 10500）；
 *  - 计划月数（T10）= 数据包 hero.exp.head 目标月与今天的月距（含首末月，1~360）；
 *    无数据包/解析失败默认 12；
 *  - 年度奖金/发放月（T10）= 近 12 个月 bonus 类合计 / 最早发放月（deriveBonusInfo）；
 *  - 三池/上限默认值自 v1 `chijia/core.js:657-662` DEFAULT_PLAN 提炼：
 *    定投 4000、安全垫 3000、安全垫上限 24000、ESOP 预备 5000（v1 line 689-693 同组字段）；
 *  - 收益率保持既有默认（5%）。
 * @param {DATA} data
 * @param {number} [avgIncome12m] 近 12 个月工资月均（元/月；renderPlanPage 由 txns 派生后传入）
 * @returns {PlanParams}
 */
function defaultPlan(data, avgIncome12m = 0) {
  const items = data?.hero?.now?.items ?? [];
  const findBy = (kw) =>
    items.find((it) => String(it.label ?? '').includes(kw) && !String(it.label ?? '').includes('估'));
  const asset = findBy('流动资产') ?? findBy('金融资产');
  const bonus = deriveBonusInfo();
  return {
    income: avgIncome12m > 0 ? Math.round(avgIncome12m) : 10500,
    invest: 4000, // v1 DEFAULT_PLAN（chijia/core.js:658）
    cushion: 3000, // v1 DEFAULT_PLAN
    cushionCap: 24000, // v1 DEFAULT_PLAN（安全垫存满后溢出自动转定投）
    esop: 5000, // v1 DEFAULT_PLAN
    months: defaultMonths(data), // T10：数据包目标月距（≈8）/无包 12
    bonusYear: bonus ? Math.round(bonus.total) : 0, // T10：近 12 月 bonus 合计
    bonusMonth: bonus ? bonus.month : 0, // T10：历史奖金最早发放月（1~12；0=不注入）
    rate: 0.05,
    base: Number.isFinite(parseNum(asset?.b)) ? parseNum(asset?.b) : 0,
  };
}

/**
 * 默认计划月数（T10）：数据包 hero.exp.head 目标月与今天的月距（含首末月，钳位 1~360；
 * 如 2026-11 起、目标 2027-06-30 → 8）。非用户数据包（示例态）或解析失败 → 默认 12。
 * @param {DATA} data 当前生效 DATA
 * @returns {number}
 */
function defaultMonths(data) {
  if (!_dataFromStore) return 12;
  const m = String(data?.hero?.exp?.head ?? '').match(/((?:19|20)\d{2})-(\d{1,2})/);
  if (!m) return 12;
  const t = new Date();
  const dist = (Number(m[1]) - t.getFullYear()) * 12 + (Number(m[2]) - (t.getMonth() + 1)) + 1;
  return dist >= 1 ? Math.min(360, dist) : 12;
}

/**
 * 近 12 个月收入派生信息（元）——T10 · v2.0.7 改「工资月均」口径：
 * 按生效分类规则归类后，取「近 12 个月窗口内 salary 类入账合计 ÷ min(12, 跨度)」，
 * 不含 bonus/subsidy 摊销（奖金改由「年度奖金」参数按发放月一次性注入推演）。
 * 跨度 = 窗口内首末笔工资入账月距，含首末月，钳位 [1,12]（数据不足 12 个月不被 ÷12 稀释）。
 * 无流水、窗口内无工资入账时返回 null（调用方退回静态默认，不虚构）。
 * @param {DATA} data 当前生效 DATA（取 meta.importer 兜底规则）
 * @returns {{avg: number, total: number, span: number, count: number}|null}
 */
function deriveIncome12mInfo(data) {
  const win = incomeWindowTxns(_txnsDoc?.txns ?? [], _txnsDoc?.rules ?? data?.meta?.importer ?? {})
    .filter((t) => t.cat === 'salary'); // R2：工资月均口径（不含 bonus/subsidy 摊销）
  if (!win.length) return null;
  const total = win.reduce((s, t) => s + t.amt, 0);
  const dmin = win.reduce((m, t) => (t.d < m ? t.d : m), win[0].d);
  const dmax = win.reduce((m, t) => (t.d > m ? t.d : m), win[0].d);
  const ym = (d) => [Number(String(d).slice(0, 4)), Number(String(d).slice(5, 7))];
  const [y1, m1] = ym(dmin);
  const [y2, m2] = ym(dmax);
  // 实际跨度（含首末月，v1 chijia/core.js:457 同式；钳位 [1,12]）
  const span = Math.max(1, Math.min(12, (y2 - y1) * 12 + (m2 - m1) + 1));
  const avg = total / span;
  return Number.isFinite(avg) && avg > 0 ? { avg, total, span, count: win.length } : null;
}

/**
 * 近 12 个月奖金派生信息（T10 · v2.0.7）：「年度奖金」默认值来源——
 * 窗口内 bonus 类入账合计与最早发放月（多笔/多月取最早月，逐月注入语义见 computePlan）。
 * 无流水、窗口内无奖金入账时返回 null（年度奖金默认 0 / 发放月 0 = 不注入）。
 * @returns {{total: number, month: number, count: number}|null}
 */
function deriveBonusInfo() {
  const win = incomeWindowTxns(_txnsDoc?.txns ?? [], _txnsDoc?.rules ?? _data?.meta?.importer ?? {})
    .filter((t) => t.cat === 'bonus');
  if (!win.length) return null;
  const total = win.reduce((s, t) => s + t.amt, 0);
  const dmin = win.reduce((m, t) => (t.d < m ? t.d : m), win[0].d);
  const month = Number(String(dmin).slice(5, 7));
  return total > 0 && month >= 1 && month <= 12 ? { total, month, count: win.length } : null;
}

/**
 * 近 12 个月月均入账（元/月）：deriveIncome12mInfo 的数值便捷封装。
 * @param {DATA} data 当前生效 DATA
 * @returns {number} 无可派生数据时返回 0
 */
function deriveAvgIncome12m(data) {
  const info = deriveIncome12mInfo(data);
  return info ? info.avg : 0;
}

/**
 * plan 实体 shape 迁移（T10 · v2.0.7 推演窗口月化 + 月收入工资口径）。
 *
 * 旧 shape（上一代）：{ income(含奖金摊销口径), invest, cushion, cushionCap, esop, years, rate, base }
 * 新 shape（v2.0.7+） ：{ income(工资月均口径), invest, cushion, cushionCap, esop,
 *                        months, bonusYear, bonusMonth, rate, base }
 *
 * 迁移规则：
 *  1. 判定：value 不含 `months` 字段即旧 shape（新 shape 必有）；本函数对旧/新 shape 均幂等；
 *  2. R1 窗口平移：旧 `years` ×12 → `months`（如 years:5 → months:60），钳位 [1,360]；
 *  3. R2 月收入口径变更：旧 income 为「含奖金/补贴摊销」口径，语义变更 → 本次按
 *     「近 12 个月工资月均」重派生一次，旧手填值不保留（页面给一次性说明文案，
 *     见 renderPlanPage meta.incomeRescope / _planIncomeRescoped 标记）；
 *     无工资流水可派生时置 0（面板红字提示，用户需手填）；
 *  4. R2 奖金新字段：bonusYear = 近 12 个月 bonus 合计、bonusMonth = 最早发放月
 *     （deriveBonusInfo；无奖金流水 → 0/0 = 不注入）；
 *  5. cushionCap 缺失（更早 shape）时补 v1 默认 24000（v1 `chijia/core.js:659`）；
 *  6. rate/base 原样保留（非法值按 computePlan 兜底归一）。
 *
 * 迁移时机：refreshFromStore 读 plan 实体后立即执行（内存内迁移，不回写 idb）；
 * 用户首次 blur/「按参数重算」时 applyPlan 以新 shape 持久化，其后不再触发迁移与说明。
 * 不立即回写的原因：boot 保持只读语义（与 data/txns 装载一致），且本迁移幂等，重复执行无损。
 * @param {any} raw idb plan 实体 value（可能为旧 shape）
 * @returns {PlanParams}
 */
function migratePlanShape(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const num = (x) => (Number.isFinite(Number(x)) && Number(x) >= 0 ? Number(x) : 0);
  const legacy = !('months' in v); // 旧 shape 标记（上一代：years 计窗口、income 含奖金摊销）
  let income = num(v.income);
  let months = legacy
    ? Math.max(1, Math.min(360, Math.round(Number(v.years) || 1) * 12)) // 规则 2：years×12 平移
    : Math.max(1, Math.min(360, Math.round(Number(v.months) || 1)));
  let bonusYear = Math.max(0, num(v.bonusYear));
  let bonusMonth = Math.max(0, Math.min(12, Math.round(Number(v.bonusMonth) || 0)));
  if (legacy) {
    // 规则 3：income 按工资月均重派生（旧含奖金摊销口径值不保留）
    income = Math.round(deriveAvgIncome12m(_data));
    // 规则 4：奖金默认 = 近 12 月 bonus 合计 / 最早发放月
    const bonus = deriveBonusInfo();
    bonusYear = bonus ? Math.round(bonus.total) : 0;
    bonusMonth = bonus ? bonus.month : 0;
    _planIncomeRescoped = true; // 一次性说明标记（内存；新 shape 落库后不再触发）
  }
  return {
    income,
    invest: num(v.invest),
    cushion: num(v.cushion),
    // 规则 5：更早 shape 无 cushionCap → v1 默认 24000；原值保留（非法归 0）
    cushionCap: legacy && v.cushionCap == null ? 24000 : num(v.cushionCap),
    esop: num(v.esop),
    months,
    bonusYear,
    bonusMonth,
    rate: Number(v.rate) || 0,
    base: num(v.base),
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
      // T8：读旧 shape（≤2.0.5 含 consume/无 cushionCap）即迁移为新 shape（幂等，见上）
      _plan = migratePlanShape(rec.value);
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
  // ⑫A 方案A：预期侧整块动态化——先解析计划参数，hero.exp/overview.exp/tableRows/readout
  // 全部由 buildExpectedSides 推演生成（数据包静态 exp 字段退役，不再作为渲染来源）
  const incomeIsDerived = !_plan; // 须在 _plan 赋值前捕获：plan 实体不存在 → income 为自动派生
  const plan = _plan ?? defaultPlan(data, deriveAvgIncome12m(data));
  _plan = plan;
  const expected = buildExpectedSides(data, plan);
  renderHero(document.getElementById('hero-mount'), { ...data.hero, exp: expected.hero });
  renderOverview(document.getElementById('overview-mount'), {
    ...data.overview,
    exp: expected.overview,
    tableRows: expected.tableRows,
    readout: expected.readout,
  });
  const planParts = (data.parts ?? []).filter((p) => p.no === '1' || p.id === 'plan');
  renderParts(document.getElementById('parts-mount'), planParts, { defaultCollapsed: false });

  const panelMount = document.getElementById('plan-panel-mount');
  if (panelMount) {
    // 改动①：无手动值（plan 实体不存在）时自动派生默认参数——本金=当前流动资产、
    // 月收入=近 12 个月工资月均（工资类 ÷min(12,跨度) 口径）、月数=数据包目标月距；
    // 有手动值则原样恢复（旧 shape 已迁移）。派生口径文案随 meta 传入面板标注。
    const incomeInfo = deriveIncome12mInfo(data);
    // R3 焦点保护：面板输入聚焦中（编辑未 blur）不重建面板，避免打断键入/清空焦点值；
    // 面板留旧状态，等 blur 后的下一次渲染再重建（emit 只在 blur/重算触发，不会回写旧值）
    const active = /** @type {HTMLElement|null} */ (/** @type {any} */ (document).activeElement);
    const panelEditing = !!(active && panelMount.contains(active) && active.tagName === 'INPUT');
    if (!panelEditing) {
      let saveTimer = /** @type {number|undefined} */ (undefined);
      buildPlanPanel(
        panelMount,
        plan,
        (next) => {
          _plan = next;
          // R3：仅 blur/「按参数重算」到达此处——持久化（kv+outbox+尽力同步），
          // 并广播重算事件给页面脚本（页面据此重渲染 1.1~1.4 与预期分布，自动展开）
          clearTimeout(saveTimer);
          saveTimer = window.setTimeout(() => {
            applyPlan(next).catch(() => {});
          }, 600);
          dispatchPlanRecalc(next);
        },
        {
          ...(incomeInfo && incomeIsDerived
            ? {
                incomeSource:
                  `按近 12 个月工资入账 ${fmtInt(incomeInfo.total)} 元 ÷ ${incomeInfo.span} 个月自动派生` +
                  `（工资月均，不含奖金/补贴摊销；${incomeInfo.count} 笔工资入账）`,
              }
            : {}),
          ...(_planIncomeRescoped ? { incomeRescope: true } : {}),
        },
      );
    }
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
  renderParts(document.getElementById('parts-mount'), analysisParts, {
    defaultCollapsed: true,
    flatSections: ['s21', 's22'], // 改动②：2.1 收入构成 / 2.2 支出结构 平铺展示（不折叠、无编号标题）
  });
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
