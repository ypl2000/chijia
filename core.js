/* =====================================================================
   渲染器 —— 只认 DATA，不含具体数字。
   ===================================================================== */
const $ = (id) => document.getElementById(id);
let INC = null;   /* 当前生效的收入口径状态（供 Hero 发送按钮使用） */
function el(tag, cls, html){ const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
const fmt = n => (window.__planFmt ? Math.round(n).toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/* ---- Hero ---- */
function renderHero(){
  const m = DATA.meta, box = $("heroBox");
  box.innerHTML = "";
  if (window.PAGE_MODE === "analysis"){
    box.appendChild(el("div", "chip dim", `${m.statsDim.label} <b>${m.statsDim.text}</b>`));
    return;
  }
  box.appendChild(el("h1", "", m.title));
  box.appendChild(el("p", "sub", m.subtitle));
  const chips = el("div", "chips");
  chips.appendChild(el("div", "chip dim", `${m.statsDim.label} <b>${m.statsDim.text}</b>`));
  box.appendChild(chips);
  const split = el("div", "stat-split");
  [["now", "stat-side now"], ["exp", "stat-side exp"]].forEach(([key, cls]) => {
    const side = DATA.hero[key], card = el("div", cls);
    card.appendChild(el("div", "ss-head", side.head));
    const items = el("div", "ss-items");
    side.items.forEach(it => {
      const it2 = el("div", "ss-item");
      it2.appendChild(el("span", "", it.label)); it2.appendChild(el("b", "", it.b));
      items.appendChild(it2);
    });
    card.appendChild(items); split.appendChild(card);
    if (key === "now") split.appendChild(el("div", "stat-arrow", "➜"));
  });
  box.appendChild(split);
  if (m.calculator){
    const wrap = el("div", "");
    wrap.style.cssText = "margin-top:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;";
    const btn = el("button", "ffc-btn", m.calculator.btn);
    btn.title = m.calculator.tip || "";
    btn.addEventListener("click", () => {
      /* 持仓映射：把「现在」分布卡按关键词归入组合体检的六个桶 */
      const p = { monthlyExpense: parseFloat(m.calculator.fields.spend) || 0 };
      (DATA.overview.now.rows || []).forEach(r => {
        if (r.muted) return;
        const v = parseFloat(String(r.amt).replace(/[≈,]/g, "")) || 0;
        const n = r.name || "";
        if (/基金/.test(n)) p.equity = (p.equity || 0) + v;
        else if (/ESOP|虚拟股/.test(n)) p.esop = (p.esop || 0) + v;
        else if (/银行|活期|现金|安全垫/.test(n)) p.cash = (p.cash || 0) + v;
        else if (/公积金|限用途/.test(n)) p.restricted = (p.restricted || 0) + v;
        else if (/固定资产|车/.test(n)) p.consumer = (p.consumer || 0) + v;
      });
      try { localStorage.setItem("FFC_PREFILL", JSON.stringify({ ts: Date.now(), label: m.calculator.label, fields: m.calculator.fields, portfolio: p, income: window.__INCOME || null })); } catch(e){}
      if (window.parent !== window) {
        try { window.parent.postMessage({ ffSwitch: "calculator" }, "*"); } catch(e){}
      } else {
        window.open(m.calculator.file, "_blank");
      }
    });
    wrap.appendChild(btn);
    wrap.appendChild(el("span", "ffc-tip", m.calculator.tip || ""));
    box.appendChild(wrap);
  }
}

/* ---- 使用说明 ---- */
function renderGuide(){
  const g = DATA.guide, box = $("guideBox");
  box.innerHTML = "";
  if (!g) return;
  const d = el("details", "sec"); d.id = "sec-guide"; d.open = true;
  d.appendChild(el("summary", "", g.title + '<span class="chev">▼</span>'));
  const body = el("div", "sec-body");
  const ol = el("ol");
  ol.style.cssText = "margin:0;padding-left:22px;line-height:1.9;font-size:13.5px;";
  g.steps.forEach(s => ol.appendChild(el("li", "", s)));
  body.appendChild(ol);
  const tip = el("p", "", '📥 数据包与流水的导入 / 导出 / 重置，都在第二部分顶部的「数据与流水导入」面板，一处搞定。');
  tip.style.cssText = "margin:12px 0 0;font-size:12.5px;color:var(--sub);";
  body.appendChild(tip);
  d.appendChild(body); box.appendChild(d);
}

/* ---- 置顶总览 ---- */
function distCard(key, cls){
  const d = DATA.overview[key], card = el("div", "dist-card " + cls);
  card.appendChild(el("div", "dc-head", d.head));
  card.appendChild(el("div", "dc-total", d.total + ' <span style="font-size:12px;font-weight:400;color:var(--sub);">' + d.sub + "</span>"));
  const stack = el("div", "dstack");
  d.stack.forEach(s => {
    const seg = el("div", "", s.label || "");
    seg.style.width = s.w + "%";
    seg.style.background = s.color;
    stack.appendChild(seg);
  });
  card.appendChild(stack);
  d.rows.forEach(r => {
    const row = el("div", "drow"), nm = el("div", "nm");
    if (r.c) { const dot = el("span", "dot", ""); dot.style.background = r.c; nm.appendChild(dot); }
    nm.appendChild(document.createTextNode(r.name));
    if (r.muted) nm.classList.add("muted");
    row.appendChild(nm);
    row.appendChild(el("div", "amt" + (r.neg ? " neg" : ""), r.amt));
    row.appendChild(el("div", "pc2", r.pc));
    card.appendChild(row);
  });
  if (d.callout) { const c = el("div", "callout ok", d.callout); c.style.marginTop = "12px"; card.appendChild(c); }
  return card;
}
function renderOverview(){
  const o = DATA.overview, box = $("overviewBox");
  box.innerHTML = "";
  if (window.PAGE_MODE === "analysis"){
    box.appendChild(distCard("now", "now"));
    return;
  }
  const sec = el("section", "sec-body");
  sec.style.cssText = "background:var(--card);border-radius:14px;box-shadow:0 1px 3px rgba(28,35,51,.06);padding:22px 24px;margin-bottom:18px;";
  const h3 = el("h3", "", "");
  h3.style.cssText = "font-size:17px;display:flex;align-items:center;gap:10px;margin-bottom:2px;";
  const bar = el("span", "", ""); bar.style.cssText = "width:5px;height:18px;border-radius:3px;background:var(--blue);display:inline-block;";
  h3.appendChild(bar); h3.appendChild(document.createTextNode(o.title));
  sec.appendChild(h3);
  const sub = el("p", "sec-sub", o.note); sub.style.marginBottom = "12px"; sec.appendChild(sub);
  const grid = el("div", "dist-grid");
  grid.appendChild(distCard("now", "now"));
  const arw = el("div", "dist-arrow");
  arw.appendChild(el("div", "big", "➜")); arw.appendChild(el("div", "cap", o.arrowCap));
  grid.appendChild(arw);
  grid.appendChild(distCard("exp", "exp"));
  sec.appendChild(grid);
  const det = el("details", "sub");
  det.appendChild(el("summary", "", '详细项目对照表：现在 ➜ 预期（含结构读数）<span class="chev">▼</span>'));
  const body = el("div", "sub-body");
  const tbl = el("div", "tbl-wrap"), table = el("table");
  table.innerHTML = '<thead><tr><th>项目</th><th class="num">现在</th><th></th><th class="num">预期</th><th>说明（箭头关系）</th></tr></thead>';
  const tb = el("tbody");
  o.tableRows.forEach(r => {
    const tr = el("tr", r.total ? "total" : "");
    const tagStyle = r.tagStyle ? ` style="${r.tagStyle}"` : "";
    const tag = r.tagCls ? `<span class="tag ${r.tagCls}">${r.tag}</span>` : `<span class="tag"${tagStyle}>${r.tag}</span>`;
    tr.innerHTML = `<td>${tag}</td><td class="num">${r.now}</td><td class="arw">➜</td><td class="num">${r.exp}</td><td>${r.note}</td>`;
    tb.appendChild(tr);
  });
  table.appendChild(tb); tbl.appendChild(table); body.appendChild(tbl);
  body.appendChild(el("div", "callout warn", o.readout));
  det.appendChild(body); sec.appendChild(det);
  box.appendChild(sec);
}

/* ---- 通用 block 渲染 ---- */
function renderBlocks(container, blocks){
  blocks.forEach(b => {
    switch (b.t) {
      case "sub": container.appendChild(el("p", "sec-sub", b.html)); break;
      case "h4": container.appendChild(el("h4", "", b.html)); break;
      case "callout": container.appendChild(el("div", "callout" + (b.kind ? " " + b.kind : ""), b.html)); break;
      case "gap": { const g = el("div", "", ""); g.style.height = (b.h || 14) + "px"; container.appendChild(g); break; }
      case "allocbar": { const w = el("div", "allocbar"); b.items.forEach(i => w.appendChild(el("div", i.cls, i.label))); container.appendChild(w); break; }
      case "cards": { const w = el("div", "cards"); b.items.forEach(i => { const c = el("div", "pcard" + (i.total ? " total" : "")); c.appendChild(el("div", "lab", i.lab)); c.appendChild(el("div", "val", i.val)); c.appendChild(el("div", "note", i.note)); w.appendChild(c); }); container.appendChild(w); break; }
      case "picgrid": { const w = el("div", "pic-grid"); b.items.forEach(i => { const c = el("div", "pic-card"); c.appendChild(el("div", "h", i.h)); c.appendChild(el("div", "d", i.d)); w.appendChild(c); }); container.appendChild(w); break; }
      case "flow": { const w = el("div", "flow"); b.steps.forEach((s, i) => { if (i) w.appendChild(el("div", "arrow", "➜")); const st = el("div", "step"); st.appendChild(el("div", "t", s.t)); st.appendChild(el("div", "d", s.d)); w.appendChild(st); }); container.appendChild(w); break; }
      case "tier": { const w = el("div", "tier"); b.rows.forEach(r => { const row = el("div", "t-row"); const bar = el("div", "t-bar", r.label); bar.style.width = r.w; bar.style.background = r.bg; if (r.ink) bar.style.color = "var(--ink)"; row.appendChild(bar); row.appendChild(el("span", "tag " + r.tagCls, r.tag)); w.appendChild(row); }); container.appendChild(w); break; }
      case "ms": { const w = el("div", "ms"); b.items.forEach(i => w.appendChild(el("span", "", i))); container.appendChild(w); break; }
      case "procons": { const w = el("div", "pc-grid"); [["pros", b.prosTitle, b.pros], ["cons", b.consTitle, b.cons]].forEach(([cls, tt, list]) => { const pc = el("div", "pc " + cls); pc.appendChild(el("h4", "", tt)); const ul = el("ul"); list.forEach(li => ul.appendChild(el("li", "", li))); pc.appendChild(ul); w.appendChild(pc); }); container.appendChild(w); break; }
      case "distrows": b.rows.forEach(r => { const row = el("div", "dist-row2"); row.appendChild(el("div", "name", r.name)); const bar = el("div", "bar"); const i = el("i", "", ""); i.style.width = r.w + "%"; i.style.background = r.color; bar.appendChild(i); row.appendChild(bar); row.appendChild(el("div", "pct", r.pct)); container.appendChild(row); }); break;
      case "table": container.appendChild(buildTable(b)); break;
      case "details": { const d = el("details", "sub"); d.appendChild(el("summary", "", b.title + '<span class="chev">▼</span>')); const sb = el("div", "sub-body"); renderBlocks(sb, b.blocks); d.appendChild(sb); container.appendChild(d); break; }
    }
  });
}
function buildTable(b){
  const wrap = el("div", "tbl-wrap"), table = el("table"), thead = el("thead"), hr = el("tr");
  b.head.forEach(hc => { const th = el("th", typeof hc === "object" && hc.num ? "num" : "", typeof hc === "object" ? hc.h : hc); if (typeof hc === "object" && hc.w) th.style.width = hc.w; hr.appendChild(th); });
  thead.appendChild(hr); table.appendChild(thead);
  const tb = el("tbody");
  b.rows.forEach(r => {
    const tr = el("tr", r.cls || "");
    r.cells.forEach(c => {
      if (typeof c === "object" && c.bar !== undefined) { const td = el("td"); const qb = el("div", "qbar"); const i = el("i", "", ""); i.style.width = c.bar + "%"; qb.appendChild(i); td.appendChild(qb); tr.appendChild(td); return; }
      const td = el("td");
      if (typeof c === "object") {
        const cl = [];
        if (c.num) cl.push("num");
        if (c.cls) cl.push(c.cls);
        if (cl.length) td.className = cl.join(" ");
        td.innerHTML = c.h;
      } else td.innerHTML = c;
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  table.appendChild(tb); wrap.appendChild(table);
  return wrap;
}

/* ---- 三大部分 ---- */
function buildSection(s){
  const d = el("details", "sec"); d.id = s.id;
  d.appendChild(el("summary", "", s.title + '<span class="chev">▼</span>'));
  const body = el("div", "sec-body");
  renderBlocks(body, s.blocks);
  d.appendChild(body);
  return d;
}
function renderParts(){
  const box = $("partsBox"), fab = $("fab");
  box.innerHTML = "";
  if (fab) fab.innerHTML = "";
  const mode = window.PAGE_MODE || "plan";
  if (mode === "plan"){
    if (fab) fab.appendChild(el("div", "brand", "¥"));
    box.appendChild(buildPlanPanel());
  }
  DATA.parts.forEach(p => {
    if (mode === "plan" && p.id !== "pb1") return;
    if (mode === "analysis" && p.id !== "pb2" && p.id !== "pb3") return;
    const blk = el("div", "pblock"); blk.id = p.id;
    const banner = el("div", "part"); banner.id = p.id.replace("pb", "part");
    banner.appendChild(el("span", "no", p.no));
    banner.appendChild(el("h2", "", p.title));
    banner.appendChild(el("span", "pnote", p.note));
    blk.appendChild(banner);
    if (p.rules) {
      const grid = el("div", "p1-grid"), main = el("div", "p1-main");
      p.sections.forEach(s => main.appendChild(buildSection(s)));
      grid.appendChild(main);
      const aside = el("aside", "p1-rules");
      aside.appendChild(el("h4", "", p.rules.title));
      p.rules.items.forEach(r => {
        const row = el("div", "rule");
        row.appendChild(el("div", "no", r.no));
        const dv = el("div"); dv.appendChild(el("b", "", r.b)); dv.appendChild(el("p", "", r.p));
        row.appendChild(dv); aside.appendChild(row);
      });
      grid.appendChild(aside); blk.appendChild(grid);
    } else {
      p.sections.forEach(s => blk.appendChild(buildSection(s)));
    }
    box.appendChild(blk);
    if (fab) {
      const a = el("a", "", `<span class="ico">${p.nav.ico}</span><span class="lab">${p.nav.lab}</span>`);
      a.href = "#" + banner.id; a.dataset.part = p.id;
      fab.appendChild(a);
    }
  });
}
function renderFoot(){ $("footBox").textContent = DATA.meta.footer; }

/* =====================================================================
   流水导入 —— 本地解析银行流水文本（交行个人客户交易清单格式等），
   自动生成 2.1 / 2.2 / 2.3，结果会话级保存。不上传。
   ===================================================================== */
const LS_KEY = "FRI_TXNS_V1";

/* 折行合并：PDF 抽取常把"户名/摘要"拆到下一行——若某行以"序号+日期"开头但不匹配任何
   格式，则把后续非新记录的行拼接进来再试（对复制粘贴路径同样生效） */
function mergeWrappedLines(lines){
  const fmts = Object.keys(FORMATS);
  const startRe = /^\s*\d+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/;
  const matched = (ln) => fmts.some(k => FORMATS[k].re.test(ln));
  const out = [];
  for (let i = 0; i < lines.length; i++){
    let ln = lines[i];
    if (startRe.test(ln) && !matched(ln)) {
      let j = i + 1;
      while (!matched(ln) && j < lines.length && !startRe.test(lines[j])) { ln += " " + lines[j]; j++; }
      i = j - 1;
    }
    out.push(ln);
  }
  return out;
}

function parseStmtText(text){
  const fmts = Object.keys(FORMATS);
  const out = [];
  mergeWrappedLines(text.split(/\r?\n/)).forEach(ln => {
    for (const key of fmts) {
      const f = FORMATS[key], m = f.re.exec(ln);
      if (m) { out.push(f.map(m)); return; }
    }
  });
  return out;
}
function classifyTxn(txn, r){
  if (r.skipTypes.some(k => txn.t.includes(k))) return null;
  if (r.employer && !txn.rest.includes(r.employer)) return null;
  if (r.subsidyKeywords.some(k => txn.rest.includes(k))) return "sub";
  if (txn.rest.includes(r.salaryAbstract)) return txn.amt >= r.bonusMin ? "bonus" : "salary";
  return "other";
}
function aggregate(txns, rules){
  const dates = txns.map(t => t.d).sort();
  const dMin = dates[0], dMax = dates[dates.length - 1];
  const m1 = dMin.slice(0, 7).split("-").map(Number), m2 = dMax.slice(0, 7).split("-").map(Number);
  const months = (m2[0] - m1[0]) * 12 + (m2[1] - m1[1]) + 1;
  const byYear = {};
  txns.forEach(t => {
    const y = t.d.slice(0, 4); byYear[y] = byYear[y] || { n: 0, d: 0, c: 0 };
    byYear[y].n++; if (t.dc === "D") byYear[y].d += t.amt; else byYear[y].c += t.amt;
  });
  const emp = { salary: {}, bonus: {}, sub: {}, other: {} };
  txns.forEach(t => {
    const c = classifyTxn(t, rules); if (!c || c === "other") return;
    const y = t.d.slice(0, 4); emp[c][y] = emp[c][y] || [];
    emp[c][y].push(t);
  });
  const quarters = {};
  txns.forEach(t => {
    if (classifyTxn(t, rules) !== "sub") return;
    const y = t.d.slice(0, 4), q = Math.floor((+t.d.slice(5, 7) - 1) / 3) + 1, k = `${y} Q${q}`;
    quarters[k] = quarters[k] || { n: 0, sum: 0, min: Infinity, max: -Infinity };
    quarters[k].n++; quarters[k].sum += t.amt;
    quarters[k].min = Math.min(quarters[k].min, t.amt); quarters[k].max = Math.max(quarters[k].max, t.amt);
  });
  const big = txns.filter(t => t.dc === "D" && t.amt >= rules.bigExpenseMin).sort((a, b) => b.amt - a.amt).slice(0, 20);
  return { dMin, dMax, months, byYear, emp, quarters, big };
}
function buildImportBlocks(ag, rules){
  const span = `${ag.dMin} ~ ${ag.dMax}`;
  const years = Object.keys(ag.byYear).sort();
  const yearRows = years.map(y => ({ cells: [y,
    { h: String(ag.byYear[y].n), num: true }, { h: fmt(ag.byYear[y].d), num: true }, { h: fmt(ag.byYear[y].c), num: true }] }));
  const yTot = years.reduce((a, y) => ({ n: a.n + ag.byYear[y].n, d: a.d + ag.byYear[y].d, c: a.c + ag.byYear[y].c }), { n: 0, d: 0, c: 0 });
  const b21 = [
    { t: "sub", html: `解析期间 <b>${span}</b>（约 ${ag.months} 个月），共命中 <b>${yTot.n.toLocaleString()}</b> 笔。` },
    { t: "table", head: ["年份", { h: "笔数", num: true }, { h: "借方（支出）", num: true }, { h: "贷方（收入）", num: true }],
      rows: yearRows.concat([{ cls: "total", cells: ["合计",
        { h: String(yTot.n), num: true }, { h: fmt(yTot.d), num: true }, { h: fmt(yTot.c), num: true }] }]) }
  ];
  const label = { salary: "月薪工资", bonus: "年终奖/激励", sub: "补贴/报销（小额）" };
  const rows22 = ["salary", "bonus", "sub"].map(c => {
    const ys = Object.keys(ag.emp[c]).sort();
    if (!ys.length) return null;
    const n = ys.reduce((s, y) => s + ag.emp[c][y].length, 0);
    const sum = ys.reduce((s, y) => s + ag.emp[c][y].reduce((x, t) => x + t.amt, 0), 0);
    return { cells: [`<span class="tag ${c === "sub" ? "tag-green" : c === "bonus" ? "tag-orange" : "tag-blue"}">${label[c]}</span>`,
      { h: String(n), num: true }, { h: fmt(sum), num: true },
      ys.map(y => `${y}（${ag.emp[c][y].length} 笔 / ${fmt(ag.emp[c][y].reduce((x, t) => x + t.amt, 0))}）`).join("；")] };
  }).filter(Boolean);
  const b22 = [
    { t: "sub", html: `按雇主户名关键词「<b>${rules.employer}</b>」+ 摘要关键词自动分类（工资通道金额 ≥ ${rules.bonusMin.toLocaleString()} 判为奖金；小额一律记补贴）。` },
    { t: "table", head: ["类别", { h: "笔数", num: true }, { h: "合计（元）", num: true }, "分年明细"], rows: rows22 }
  ];
  const qk = Object.keys(ag.quarters).sort();
  if (qk.length) {
    const maxQ = Math.max(...qk.map(k => ag.quarters[k].sum));
    b22.push({ t: "h4", html: `补贴/报销季度统计 <span class="hint">—— 共 ${qk.reduce((s, k) => s + ag.quarters[k].n, 0)} 笔 · ${fmt(qk.reduce((s, k) => s + ag.quarters[k].sum, 0))}</span>` });
    const qRows = qk.map(k => {
      const q = ag.quarters[k];
      return { cells: [k, { h: String(q.n), num: true }, { h: fmt(q.sum), num: true },
        { h: q.n > 1 ? `${fmt(q.min)}~${fmt(q.max)}` : fmt(q.min), num: true }, { bar: Math.round(q.sum / maxQ * 100) }] };
    });
    const qTotal = { cls: "total", cells: ["合计",
      { h: String(qk.reduce((s, k) => s + ag.quarters[k].n, 0)), num: true },
      { h: fmt(qk.reduce((s, k) => s + ag.quarters[k].sum, 0)), num: true },
      { h: "—", num: true },
      `月均 ≈${fmt(qk.reduce((s, k) => s + ag.quarters[k].sum, 0) / ag.months)}`] };
    b22.push({ t: "table",
      head: ["季度", { h: "笔数", num: true }, { h: "合计（元）", num: true }, { h: "单笔区间（元）", num: true }, { h: "季度分布", w: "190px" }],
      rows: qRows.concat([qTotal]) });
    b22.push({ t: "callout", html: "<b>读数（自动生成，请补充结论）：</b>补贴/报销多为脉冲式小额入账——只能当缓冲，不进收入基本盘。" });
  }
  const b23 = [
    { t: "sub", html: `金额 ≥ ${rules.bigExpenseMin.toLocaleString()} 的支出 Top ${ag.big.length}（按金额降序），可据此手工归类购车/租房/医疗等大项。` },
    { t: "table", head: [{ h: "#", num: true }, "日期", { h: "金额", num: true }, "对方户名 / 摘要（截断）"],
      rows: ag.big.map((t, i) => ({ cells: [{ h: String(i + 1), num: true }, t.d, { h: fmt(t.amt), num: true },
        t.rest.split(/交易流水号|订单编号|\|/)[0].trim().slice(0, 60) || "—" ] })) }
  ];
  return { b21, b22, b23, span };
}
/* 把流水最后一笔余额同步进 Hero 指标与「现在」分布卡：银行行、总资产、净资产、
   各行占比、堆叠条全部按新总额重建；其余资产不动。返回 {total, delta} 或 null */
function applyBalance(balance){
  if (!isFinite(balance) || balance < 0) return null;
  const fmtB = n => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = s => parseFloat(String(s).replace(/[≈,]/g, "")) || 0;
  const now = DATA.overview && DATA.overview.now;
  const h = DATA.hero && DATA.hero.now;
  if (!now || !h) return null;
  const bankRow = now.rows.find(r => /银行|活期|现金/.test(r.name) && !r.muted);
  const oldBank = bankRow ? num(bankRow.amt) : 0;
  if (bankRow) bankRow.amt = fmtB(balance);
  const assets = now.rows.filter(r => !r.muted && !r.neg);
  const vals = assets.map(r => num(r.amt));
  const total = vals.reduce((a, b) => a + b, 0);
  const liabRow = now.rows.find(r => r.muted && r.neg);
  const liab = liabRow ? Math.abs(num(liabRow.amt)) : 0;
  now.total = "总资产 ≈" + Math.round(total).toLocaleString();
  now.sub = "｜ 净资产 ≈" + Math.round(total - liab).toLocaleString() + (liab ? "（欠款 " + Math.round(liab).toLocaleString() + "）" : "");
  assets.forEach((r, i) => {
    const pct = total ? vals[i] / total * 100 : 0;
    r.pc = pct.toFixed(1) + "%";
  });
  now.stack = assets.map((r, i) => {
    const pct = total ? vals[i] / total * 100 : 0;
    const short = String(r.name).split("（")[0];
    return { w: +pct.toFixed(1), color: r.c, label: pct >= 8 ? short + " " + pct.toFixed(1) + "%" : "" };
  });
  const delta = balance - oldBank;
  h.items.forEach(it => {
    if (it.label === "当期余额") it.b = fmtB(balance);
    else if (/总资产|流动资产/.test(it.label || "")) {
      const approx = String(it.b).startsWith("≈");
      it.b = (approx ? "≈" : "") + Math.round(num(it.b) + delta).toLocaleString();
    }
  });
  (DATA.overview.tableRows || []).forEach(r => {
    if (/银行|活期|现金/.test(r.tag || "")) r.now = fmtB(balance);
    if (r.tag === "总资产") r.now = "≈" + Math.round(total).toLocaleString();
    if (r.tag === "净资产") r.now = "≈" + Math.round(total - liab).toLocaleString();
  });
  return { total, delta };
}
function applyImport(txns, rules, save){
  const ag = aggregate(txns, rules);
  const blocks = buildImportBlocks(ag, rules);
  DATA.meta.statsDim.text = `流水 ${txns.length.toLocaleString()} 笔 · ${ag.months} 个月`;
  const p2 = DATA.parts.find(p => p.id === "pb2");
  p2.note = `${blocks.span} · 本地解析`;
  const setB = (id, blocks, title) => { const s = p2.sections.find(s => s.id === id); if (!s) return; s.blocks = blocks; if (title) s.title = title; };
  setB("sec-2-1", blocks.b21, "2.1 流水概况");
  setB("sec-2-2", blocks.b22, "2.2 收入结构");
  setB("sec-2-3", blocks.b23, "2.3 大额支出（Top 20）");
  /* 同步当期余额（流水按时间排序后的最后一笔余额）到 Hero 与分布卡 */
  let balInfo = null;
  const sorted = [...txns].sort((a, b) => ((a.d + (a.t || "")) > (b.d + (b.t || "")) ? 1 : -1));
  const last = sorted[sorted.length - 1];
  if (last && isFinite(last.bal) && last.bal >= 0) balInfo = applyBalance(last.bal);
  boot();
  /* 强反馈：展开刚写入的三节并定位到 2.1，否则折叠状态下看不出变化 */
  ["sec-2-1", "sec-2-2", "sec-2-3"].forEach(id => { const x = document.getElementById(id); if (x) x.open = true; });
  const target = document.getElementById("sec-2-1");
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  if (save !== false) { try { sessionStorage.setItem(LS_KEY, JSON.stringify({ rules, txns })); } catch(e){} }
  return { ag, balInfo, lastBal: last ? last.bal : null };
}
/* 近 12 个月收入（含奖金）：按分类汇总最近一年的 C 类入账，月均 = 总额 / min(12, 实际跨度) */
function computeIncome12m(txns, rules, src){
  if (!txns || !txns.length) return null;
  const cats = txns.filter(t => t.dc === "C")
    .map(t => ({ d: t.d, amt: t.amt, cat: classifyTxn(t, rules) }))
    .filter(x => x.cat === "salary" || x.cat === "bonus" || x.cat === "sub");
  if (!cats.length) return null;
  const dMax = cats.reduce((m, x) => x.d > m ? x.d : m, "");
  const cutoff = (parseInt(dMax.slice(0, 4), 10) - 1) + dMax.slice(4);
  const win = cats.filter(x => x.d > cutoff);
  if (!win.length) return null;
  const sum = c => win.filter(x => x.cat === c).reduce((a, x) => a + x.amt, 0);
  const salary = sum("salary"), bonus = sum("bonus"), subsidy = sum("sub");
  const allDates = txns.reduce((acc, t) => { acc.push(t.d); return acc; }, []);
  const dMin = allDates.reduce((m, x) => x < m ? x : m, "9999");
  const spanM = Math.max(1, Math.min(12, (parseInt(dMax.slice(0, 4), 10) - parseInt(dMin.slice(0, 4), 10)) * 12 + (parseInt(dMax.slice(5, 7), 10) - parseInt(dMin.slice(5, 7), 10)) + 1));
  const total = salary + bonus + subsidy;
  return { window: cutoff + " ~ " + dMax, salary, bonus, subsidy, total, monthlyAvg: total / spanM, span: spanM, src: src || "流水" };
}
function loadStoredImport(){
  try {
    const raw = sessionStorage.getItem(LS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj.txns || !obj.txns.length) return null;
    return obj;
  } catch(e){ return null; }
}

/* ---- PDF 文本抽取（按需联网加载 pdf.js，y 坐标分行后逐行拼接） ---- */
let _pdfjsPromise = null;
function loadPdfJs(){
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = new Promise((resolve, reject) => {
    const urls = [
      ["https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
       "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"],
      ["https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
       "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js"]
    ];
    const tryAt = (i) => {
      if (i >= urls.length) { reject(new Error("解析组件加载失败（需要联网一次）；可改用复制粘贴")); return; }
      const s = document.createElement("script");
      s.src = urls[i][0];
      s.onload = () => {
        try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = urls[i][1]; resolve(window.pdfjsLib); }
        catch (e) { tryAt(i + 1); }
      };
      s.onerror = () => tryAt(i + 1);
      document.head.appendChild(s);
    };
    tryAt(0);
  });
  return _pdfjsPromise;
}
async function extractPdfText(buf){
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: buf }).promise;
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++){
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str && i.str.trim() !== "");
    items.sort((a, b) => (b.transform[5] - a.transform[5]) || (a.transform[4] - b.transform[4]));
    let cur = null; const lines = [];
    items.forEach(it => {
      const y = it.transform[5], x = it.transform[4];
      if (!cur || Math.abs(cur.y - y) > 3) { cur = { y, parts: [] }; lines.push(cur); }
      cur.parts.push({ x, s: it.str });
    });
    lines.forEach(l => out.push(l.parts.sort((a, b) => a.x - b.x).map(p => p.s).join(" ").replace(/\s+/g, " ").trim()));
  }
  return out.join("\n");
}

/* ---- 导入面板 ---- */
/* ===== 计划推演引擎：由参数重算 1.1~1.4 与预期分布 ===== */
function computePlan(p){
  const rows = [];
  let cCum = 0, eCum = 0;
  const sy = parseInt(p.start.slice(0, 4), 10), sm = parseInt(p.start.slice(5, 7), 10);
  for (let m = 0; m < p.months; m++){
    const mi = sm - 1 + m;
    const ym = (sy + Math.floor(mi / 12)) + "-" + String(mi % 12 + 1).padStart(2, "0");
    const cLeft = Math.max(0, p.cushionCap - cCum);
    const cM = Math.min(p.cushion, cLeft);
    const eM = p.esop + (p.cushion - cM);
    cCum += cM; eCum += eM;
    const evs = (p.oneoffOut || []).filter(o => o.m === m);
    let cut = 0; evs.forEach(o => { if (o.pool === "预备") cut += o.amt; });
    eCum = Math.max(0, eCum - cut);
    rows.push({ m, ym, cM, cCum, eM, eCum, invest: p.invest, evs });
  }
  const funds = p.fundsBase + p.invest * p.months;
  const oneoffInTotal = (p.oneoffIn || []).reduce((a, o) => a + o.amt, 0);
  return { rows, funds, cushionFinal: cCum, esopFinal: eCum, liquid: cCum + funds + eCum + p.bankKeep, oneoffInTotal };
}

function applyPlan(p, save){
  const eng = computePlan(p);
  DATA.plan = JSON.parse(JSON.stringify(p));
  const p1 = DATA.parts.find(x => x.id === "pb1");
  const setB = (id, blocks, title) => { const sec = p1.sections.find(x => x.id === id); if (!sec) return; sec.blocks = blocks; if (title) sec.title = title; };
  const disposable = p.income - p.spend;
  const pools = p.invest + p.cushion + p.esop;
  const feasible = disposable >= pools;
  setB("sec-1-1", [
    { t: "sub", html: "每月可支配 <b>" + fmt(disposable) + "</b> 元 = 收入 " + fmt(p.income) + " − 消费 " + fmt(p.spend) + "，固定切为三份，月月光。" },
    { t: "allocbar", items: [
      { cls: "ab-consume", label: "消费 " + fmt(p.spend) },
      { cls: "ab-invest", label: "定投 " + fmt(p.invest) },
      { cls: "ab-cushion", label: "安全垫 " + fmt(p.cushion) },
      { cls: "ab-esop", label: "ESOP 预备 " + fmt(p.esop) }
    ]},
    { t: "table", head: ["池子", { h: "金额/月", num: true }, "说明"], rows: [
      { cells: ['<span class="tag tag-gray">消费</span>', { h: fmt(p.spend), num: true }, "房租 + 饮食 + 其他日常"] },
      { cells: ['<span class="tag tag-blue">定投（固定）</span>', { h: "<b>" + fmt(p.invest) + "</b>", num: true }, "宽基指数 + 红利低波，按月自动扣"] },
      { cells: ['<span class="tag tag-green">安全垫</span>', { h: fmt(p.cushion), num: true }, "存到 <b>" + fmt(p.cushionCap) + " 为止</b>，货币/T+0，锁定不动"] },
      { cells: ['<span class="tag tag-orange">ESOP 预备金</span>', { h: fmt(p.esop), num: true }, "下次认购窗口的弹药（无认购计划可并入定投）"] }
    ]},
    { t: "callout", kind: feasible ? "" : "warn", html: feasible
      ? "<b>校验通过：</b>三池合计 " + fmt(pools) + " ≤ 可支配 " + fmt(disposable) + "，计划可行。"
      : "<b>参数不可行：</b>三池合计 " + fmt(pools) + " &gt; 可支配 " + fmt(disposable) + "——请降低消费或削减某个池子。" }
  ], "1.1 每月资金使用计划（由 ④ 参数推演）");

  let capHit = false;
  const rows12 = eng.rows.map(r => {
    const ev = []; let cls = "";
    (p.oneoffOut || []).filter(o => o.m === r.m).forEach(o => {
      if (o.pool === "现金"){ if (!cls) cls = "hl-red"; ev.push('<span class="tag tag-red">支出</span> ' + o.label + " " + fmt(o.amt) + "（余额扣，不动模板）"); }
      else ev.push('<span class="tag tag-red">' + o.label + '</span> ' + fmt(o.amt) + "（从预备扣）");
    });
    (p.oneoffIn || []).filter(o => o.m === r.m).forEach(o => ev.push('<span class="tag tag-blue">' + o.label + '</span> 若到账 +' + fmt(o.amt) + "，按既定规则分配"));
    if (!capHit && r.cCum >= p.cushionCap){ capHit = true; cls = "hl-green"; ev.push('<span class="tag tag-green">垫满</span> 安全垫达 ' + fmt(p.cushionCap) + "，后续月投并入预备"); }
    return { cls, cells: [r.ym, { h: fmt(r.invest), num: true }, { h: fmt(r.cM), num: true }, { h: fmt(r.cCum), num: true }, { h: fmt(r.eM), num: true }, { h: fmt(r.eCum), num: true }, ev.length ? ev.join(" ") : '<span class="muted">—</span>'] };
  });
  setB("sec-1-2", [
    { t: "sub", html: "安全垫存满后，其月投自动并入 ESOP 预备（共 " + p.months + " 个月）。" },
    { t: "table", head: ["月份", { h: "定投", num: true }, { h: "安全垫月投", num: true }, { h: "安全垫累计", num: true }, { h: "预备月投", num: true }, { h: "预备累计", num: true }, "当月特殊事项"], rows: rows12 }
  ], "1.2 逐月执行表（由 ④ 参数推演）");

  const ymOf = m => (m < eng.rows.length ? eng.rows[m].ym : "计划期后首月");
  setB("sec-1-3", [
    { t: "sub", html: "均不计入基本盘；落地即超额完成。增删请用上方 ④ 面板。" },
    { t: "table", head: [{ h: "预计时点", w: "110px" }, "可能的大额收入", { h: "金额", num: true }, "去向"], rows: (p.oneoffIn || []).map(o => ({ cells: [ymOf(o.m), o.label, { h: "+" + fmt(o.amt), num: true }, "按既定规则分配（退税/奖金 → 定投与预备）"] })) },
    { t: "gap", h: 14 },
    { t: "table", head: [{ h: "预计时点", w: "110px" }, "可能的大额支出", { h: "金额", num: true }, "扣减来源"], rows: (p.oneoffOut || []).map(o => ({ cells: [ymOf(o.m), o.label, { h: fmt(o.amt), num: true }, o.pool === "预备" ? "从 ESOP 预备扣，顺延目标" : "从银行余额扣，不动模板"] })) }
  ], "1.3 一次性收入&支出（由 ④ 参数推演）");

  setB("sec-1-4", [
    { t: "sub", html: "基本盘口径：不含一次性收入 / 市场涨跌。" },
    { t: "cards", items: [
      { lab: "安全垫（货币/T+0）", val: fmt(eng.cushionFinal), note: p.cushionCap ? "上限 " + fmt(p.cushionCap) + "，存满锁定" : "锁定不动" },
      { lab: "基金持仓", val: "≈" + fmt(eng.funds), note: "存量 " + fmt(p.fundsBase) + " + 定投累计 " + fmt(p.invest * p.months) },
      { lab: "ESOP 预备金", val: fmt(eng.esopFinal), note: "认购窗口弹药主体" },
      { lab: "流动资产合计", val: "≈" + fmt(eng.liquid), note: p.oneoffInTotal ? "若一次性收入到账 → +" + fmt(p.oneoffInTotal) : "不含一次性收入", total: true }
    ]}
  ], "1.4 预期仓位（由 ④ 参数推演）");

  /* 级联：预期分布卡 + 对照表 + Hero 计划期末 */
  const num = x => parseFloat(String(x).replace(/[≈,]/g, "")) || 0;
  const now = DATA.overview.now, exp = DATA.overview.exp;
  const val = r => num(r && r.amt);
  const esopNow = val(now.rows.find(r => /ESOP|虚拟股/.test(r.name)));
  const carNow = val(now.rows.find(r => /固定资产|车/.test(r.name)));
  const gjj = val(now.rows.find(r => /公积金/.test(r.name)));
  const findR = (rows, kw) => rows.find(r => kw.test(r.name || r.tag || ""));
  const expAssets = [
    { kw: /ESOP|虚拟股/, amt: esopNow },
    { kw: /固定资产|车/, amt: Math.max(0, carNow - p.depreciation) },
    { kw: /公积金/, amt: gjj },
    { kw: /基金/, amt: eng.funds },
    { kw: /预备/, amt: eng.esopFinal },
    { kw: /安全垫/, amt: eng.cushionFinal },
    { kw: /银行/, amt: p.bankKeep }
  ];
  const total = expAssets.reduce((a, x) => a + x.amt, 0);
  expAssets.forEach(x => {
    const r = findR(exp.rows, x.kw); if (!r) return;
    r.amt = (r.amt && String(r.amt).startsWith("≈") ? "≈" : "") + fmt(x.amt);
    r.pc = (x.amt / total * 100).toFixed(1) + "%";
  });
  exp.total = "总资产 ≈" + Math.round(total).toLocaleString();
  exp.sub = "｜ 负债 0";
  exp.stack = expAssets.map(x => {
    const pct = x.amt / total * 100;
    const r = findR(exp.rows, x.kw);
    const short = String(r ? r.name : "").split("（")[0];
    return { w: +pct.toFixed(1), color: r ? r.c : "var(--blue)", label: pct >= 8 ? short + " " + pct.toFixed(1) + "%" : "" };
  });
  (DATA.overview.tableRows || []).forEach(r => {
    if (/基金/.test(r.tag || "")) { r.exp = "≈" + fmt(eng.funds); r.note = "存量 " + fmt(p.fundsBase) + " + 定投 " + fmt(p.invest) + " × " + p.months + " 个月"; }
    if (/安全垫/.test(r.tag || "")) r.exp = fmt(eng.cushionFinal);
    if (/预备/.test(r.tag || "")) r.exp = fmt(eng.esopFinal);
    if (/固定资产/.test(r.tag || "")) r.exp = "≈" + fmt(Math.max(0, carNow - p.depreciation));
    if (r.tag === "总资产") r.exp = "≈" + Math.round(total).toLocaleString();
    if (r.tag === "净资产") r.exp = "≈" + Math.round(total).toLocaleString();
  });
  (DATA.hero.exp.items || []).forEach(it => {
    if (/流动资产/.test(it.label || "")) it.b = "≈" + fmt(eng.liquid);
    if (/总资产/.test(it.label || "")) it.b = "≈" + Math.round(total).toLocaleString();
  });

  boot();
  if (!document.body.classList.contains("settings-mode")) {
    ["sec-1-1", "sec-1-2", "sec-1-3", "sec-1-4"].forEach(id => { const x = document.getElementById(id); if (x) x.open = true; });
  }
  if (!document.body.classList.contains("settings-mode")) {
    const t = document.getElementById("sec-1-1"); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (save !== false) { try { sessionStorage.setItem("FRI_PLAN", JSON.stringify(p)); } catch(e){} }
  return eng;
}

/* ===== ④ 计划参数面板 ===== */
const DEFAULT_PLAN = {
  start: "2026-11", months: 8, income: 21000, spend: 6000,
  invest: 4000, cushion: 3000, cushionCap: 24000, esop: 5000,
  fundsBase: 30000, bankKeep: 6000, depreciation: 10000,
  oneoffIn: [], oneoffOut: []
};
function buildPlanPanel(){
  const d = el("details", "sec"); d.id = "sec-plan"; d.open = true;
  d.appendChild(el("summary", "", "📋 计划参数推演（改参数 → 第一部分与预期分布自动重算）<span class=\"chev\">▼</span>"));
  const body = el("div", "sec-body");
  const p = Object.assign({}, DEFAULT_PLAN, DATA.plan || {});
  body.appendChild(el("p", "sec-sub", '改下面任意参数，<b>第一部分（1.1~1.4）</b>与置顶「预期」分布会<b>自动重算</b>；一次性收支可增删。参数仅存当前标签页会话。「每月支出」在 ③ 收入口径处调整，两处联动。'));

  const grid = el("div", "");
  grid.style.cssText = "display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;";
  const field = (label, id, val, extra) => {
    const dv = el("div", "");
    dv.appendChild(el("label", "", label)).style.cssText = "display:block;font-size:12px;color:var(--sub);margin-bottom:3px;";
    const inp = el("input", "", ""); inp.id = id; inp.type = "number"; inp.value = val;
    if (extra) { inp.min = extra.min; inp.max = extra.max; inp.step = extra.step; }
    inp.style.cssText = "width:110px;border:1px solid var(--line);border-radius:8px;padding:6px 9px;font-size:13.5px;text-align:right;background:#fff;";
    dv.appendChild(inp); return dv;
  };
  const textField = (label, id, val, w) => {
    const dv = el("div", "");
    dv.appendChild(el("label", "", label)).style.cssText = "display:block;font-size:12px;color:var(--sub);margin-bottom:3px;";
    const inp = el("input", "", ""); inp.id = id; inp.type = "text"; inp.value = val;
    inp.style.cssText = "width:" + (w || 90) + "px;border:1px solid var(--line);border-radius:8px;padding:6px 9px;font-size:13.5px;background:#fff;";
    dv.appendChild(inp); return dv;
  };
  grid.appendChild(textField("起始月（YYYY-MM）", "pfStart", p.start, 90));
  grid.appendChild(field("计划月数", "pfMonths", p.months, { min: 1, max: 36 }));
  grid.appendChild(field("计划月收入", "pfIncome", p.income, { min: 0, step: 500 }));
  grid.appendChild(field("每月定投", "pfInvest", p.invest, { min: 0, step: 500 }));
  grid.appendChild(field("每月安全垫", "pfCushion", p.cushion, { min: 0, step: 500 }));
  grid.appendChild(field("安全垫上限", "pfCap", p.cushionCap, { min: 0, step: 1000 }));
  grid.appendChild(field("每月 ESOP 预备", "pfEsop", p.esop, { min: 0, step: 500 }));
  grid.appendChild(field("基金存量", "pfFunds", p.fundsBase, { min: 0, step: 1000 }));
  grid.appendChild(field("期末银行常备", "pfBank", p.bankKeep, { min: 0, step: 500 }));
  grid.appendChild(field("期间折旧", "pfDep", p.depreciation, { min: 0, step: 1000 }));
  body.appendChild(grid);
  const spendLine = el("div", "", "");
  spendLine.style.cssText = "font-size:12.5px;color:var(--sub);margin:6px 0;";
  body.appendChild(spendLine);

  /* 一次性收支编辑 */
  const oneoffBox = el("div", "");
  oneoffBox.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:6px;";
  let TEMP_IN = (p.oneoffIn || []).slice();
  let TEMP_OUT = (p.oneoffOut || []).slice();
  const renderOneoff = () => {
    oneoffBox.innerHTML = "";
    [["收入（不计入基本盘）", "in", TEMP_IN], ["支出", "out", TEMP_OUT]].forEach(([tt, kind, arr]) => {
      const dv = el("div", "");
      dv.appendChild(el("h4", "", "一次性" + tt + ' <span class="hint">' + arr.length + ' 项</span>'));
      const lst = el("div", "");
      arr.forEach((o, i) => {
        const row = el("div", "");
        row.style.cssText = "display:flex;gap:6px;align-items:center;font-size:12.5px;padding:3px 0;";
        row.innerHTML = '<span class="tag ' + (kind === "in" ? "tag-blue" : "tag-red") + '">第 ' + (o.m + 1) + ' 月</span> ' +
          o.label + ' <b>' + (kind === "in" ? "+" : "") + fmt(o.amt) + '</b> 元' + (kind === "out" && o.pool === "预备" ? '（预备扣）' : '');
        const del = el("button", "", "删");
        del.style.cssText = "margin-left:auto;border:1px solid var(--line);background:#fff;border-radius:6px;cursor:pointer;font-size:11px;padding:1px 7px;color:var(--red);";
        del.addEventListener("click", () => { arr.splice(i, 1); renderOneoff(); applyAll(); });
        row.appendChild(del); lst.appendChild(row);
      });
      if (!arr.length) lst.appendChild(el("div", "", '<span class="hint">暂无</span>'));
      dv.appendChild(lst);
      /* 添加行 */
      const ar = el("div", "");
      ar.style.cssText = "display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap;";
      const mi = el("input", "", ""); mi.type = "number"; mi.placeholder = "月序"; mi.min = 0;
      mi.style.cssText = "width:56px;border:1px solid var(--line);border-radius:6px;padding:3px 6px;font-size:12px;text-align:right;";
      const lb = el("input", "", ""); lb.type = "text"; lb.placeholder = "名称";
      lb.style.cssText = "width:110px;border:1px solid var(--line);border-radius:6px;padding:3px 6px;font-size:12px;";
      const am = el("input", "", ""); am.type = "number"; am.placeholder = "金额"; am.min = 0;
      am.style.cssText = "width:90px;border:1px solid var(--line);border-radius:6px;padding:3px 6px;font-size:12px;text-align:right;";
      const add = el("button", "", "+ 添加");
      add.style.cssText = "border:1px solid var(--line);background:#fff;border-radius:6px;cursor:pointer;font-size:12px;padding:3px 10px;";
      add.addEventListener("click", () => {
        const mI = parseInt(mi.value), aI = parseFloat(am.value);
        if (!isFinite(mI) || !lb.value || !isFinite(aI)) return;
        const item = { m: Math.max(0, mI - 1), label: lb.value, amt: aI };
        if (kind === "out") item.pool = "预备";
        arr.push(item); mi.value = ""; lb.value = ""; am.value = "";
        renderOneoff(); applyAll();
      });
      ar.appendChild(mi); ar.appendChild(lb); ar.appendChild(am); ar.appendChild(add);
      dv.appendChild(ar);
      oneoffBox.appendChild(dv);
    });
  };

  body.appendChild(el("h4", "", "一次性收支（增删后自动重算）"));
  body.appendChild(oneoffBox);

  const btns = el("div", "");
  btns.style.cssText = "display:flex;gap:10px;margin-top:12px;align-items:center;flex-wrap:wrap;";
  const applyBtn = el("button", "ffc-btn primary", "🔄 按参数重算计划");
  applyBtn.style.cssText = "background:var(--blue);color:#fff;border:none;";
  const resetBtn2 = el("button", "btn", "↺ 恢复模板默认");
  btns.appendChild(applyBtn); btns.appendChild(resetBtn2);
  const planStatus = el("span", "", ""); planStatus.id = "planStatus";
  planStatus.style.cssText = "font-size:12.5px;color:var(--sub);";
  btns.appendChild(planStatus);
  body.appendChild(btns);

  d.appendChild(body);  /* 先入树，再绑事件 */

  /* 交互 */
  const q = (sel) => d.querySelector(sel);
  const rp = (id) => { const v = parseFloat(q("#" + id).value); return isFinite(v) ? v : 0; };
  const readParams = () => Object.assign({}, DEFAULT_PLAN, {
    start: q("#pfStart").value.trim() || DEFAULT_PLAN.start,
    months: Math.max(1, Math.min(36, rp("pfMonths")) || 8),
    income: rp("pfIncome"),
    spend: (DATA.meta.calculator && DATA.meta.calculator.fields.spend) || DEFAULT_PLAN.spend,
    invest: rp("pfInvest"), cushion: rp("pfCushion"), cushionCap: rp("pfCap"),
    esop: rp("pfEsop"), fundsBase: rp("pfFunds"), bankKeep: rp("pfBank"), depreciation: rp("pfDep"),
    oneoffIn: TEMP_IN, oneoffOut: TEMP_OUT
  });
  const applyAll = () => { applyPlan(readParams(), true); };
  applyBtn.addEventListener("click", applyAll);
  resetBtn2.addEventListener("click", () => {
    if (!confirm("恢复模板默认参数？当前推演结果会被覆盖。")) return;
    sessionStorage.removeItem("FRI_PLAN");
    const fresh = Object.assign({}, DEFAULT_PLAN, DATA.plan || {});
    Object.keys(DATA.plan || {}).forEach(k => delete DATA.plan[k]);
    Object.assign(DATA.plan, fresh);
    location.reload();
  });
  /* 每月支出与 ③ 联动显示 */
  const syncSpendLine = () => { spendLine.textContent = "每月支出：" + ((DATA.meta.calculator && DATA.meta.calculator.fields.spend) || DEFAULT_PLAN.spend) + " 元（在 ③ 收入口径处调整）"; };
  syncSpendLine();
  renderOneoff();
  return d;
}

/* ---- footer + 启动 ---- */
function renderFoot(){ $("footBox").textContent = DATA.meta.footer; }
function bindInteractions(){
  const fabLinks = Array.from(document.querySelectorAll('.fab a[data-part]'));
  fabLinks.forEach(a => {
    a.addEventListener('click', () => {
      const block = document.getElementById(a.dataset.part);
      if (block) block.querySelectorAll('details.sec').forEach(x => x.open = true);
    });
  });
  const spy = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) fabLinks.forEach(l => l.classList.toggle('active', l.dataset.part === e.target.id));
    });
  }, { rootMargin: '-30% 0px -55% 0px' });
  document.querySelectorAll('.pblock').forEach(b => spy.observe(b));
}

/* ===== 通用启动（各页面设置 PAGE_MODE 后调用）===== */
function boot(){
  if (location.search.indexOf("app=1") >= 0) document.body.classList.add("app-mode");
  if (new URLSearchParams(location.search).get("view") === "settings") document.body.classList.add("settings-mode");
  renderHero(); renderOverview(); renderParts(); renderFoot(); bindInteractions();
  cardify12();
  window.__chijiaReady = true;   /* APP 壳据此判断 iframe 就绪 */
}
/* 窄屏：逐月执行表切换为「每月一卡」 */
function cardify12(){
  const wrap = document.querySelector("#sec-1-2 .tbl-wrap");
  if (!wrap) return;
  const table = wrap.querySelector("table");
  const host = wrap.parentElement;
  let cards = host.querySelector(".cards12");
  const narrow = window.innerWidth < 640;
  if (narrow && !cards){
    const head = [...table.querySelectorAll("thead th")].map(x => x.textContent.trim());
    cards = el("div", "cards12");
    [...table.querySelectorAll("tbody tr")].forEach(tr => {
      const c = tr.cells;
      const card = el("div", "card12");
      card.innerHTML = '<div class="c12h">' + c[0].textContent + '</div>' +
        '<div class="c12g">' + [1, 2, 3, 4, 5].map(i => '<div class="c12i"><span>' + (head[i] || "") + '</span><b>' + c[i].textContent + '</b></div>').join("") + '</div>' +
        '<div class="c12e">' + c[6].innerHTML + '</div>';
      cards.appendChild(card);
    });
    host.appendChild(cards);
    table.style.display = "none";
  } else if (!narrow && cards){
    cards.remove(); table.style.display = "";
  }
}
window.addEventListener("resize", cardify12);
