#!/usr/bin/env node
/* eslint-disable */
/* 持家 chijia 静态审计脚本（零依赖）：node tests/audit.js
   检查：a) 页面内联脚本 getElementById 的 id 有落点  b) 本地引用文件存在
        c) 页面调用的核心函数有定义  d) settings.html 不得裸调 boot()
        e) sw.js ASSETS 文件存在                                     */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = __dirname + "/..";
let errors = [], warnings = [];

function read(f) { return fs.readFileSync(path.join(ROOT, f), "utf8"); }
function exists(f) { return fs.existsSync(path.join(ROOT, f)); }

const PAGES = ["index.html", "plan.html", "analysis.html", "settings.html", "calculator.html", "portfolio.html"];
const CORE_FNS = ["boot", "renderParts", "renderHero", "renderOverview", "applyImport", "applyPlan",
  "computePlan", "buildPlanPanel", "aggregate", "buildImportBlocks", "computeIncome12m",
  "classifyTxn", "parseStmtText", "loadStoredImport", "mergeWrappedLines", "extractPdfText", "cardify12"];

/* 提取每页内联脚本 */
function inlineScripts(file) {
  const html = read(file);
  const out = [];
  html.replace(/<script>([\s\S]*?)<\/script>/g, (m, code) => { out.push(code); return m; });
  return { html, scripts: out };
}

/* ---- a) getElementById 落点检查 ---- */
for (const page of PAGES) {
  const { html, scripts } = inlineScripts(page);
  const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const core = read("core.js");
  const dynIds = new Set([...core.matchAll(/\.id = "([^"]+)"/g)].map(m => m[1]));
  const missing = new Set();
  scripts.forEach(code => {
    [...code.matchAll(/getElementById\("([^"]+)"\)/g)].forEach(m => {
      const id = m[1];
      if (!htmlIds.has(id) && !dynIds.has(id)) missing.add(id);
    });
  });
  if (missing.size) errors.push(`[${page}] getElementById 无落点: ${[...missing].join(", ")}`);
  else console.log(`  ✓ [${page}] getElementById 落点完整`);
}

/* ---- b) 本地引用存在 ---- */
for (const page of PAGES) {
  const html = read(page);
  [...html.matchAll(/(?:src|href)="\.\/([^"?]+)(?:\?[^"]*)?"/g)].forEach(m => {
    if (!exists(m[1])) errors.push(`[${page}] 引用缺失: ./${m[1]}`);
  });
}
console.log("  ✓ 本地引用检查完成");

/* ---- c) 核心函数定义检查 ---- */
const core = read("core.js") + "\n" + read("formats.js") + "\n" + read("data.js");
for (const page of ["plan.html", "analysis.html"]) {
  const pageSrc = read(page);
  const inline = [...pageSrc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
  for (const fn of CORE_FNS) {
    if (inline.includes(fn + "(") && !new RegExp("function\\s+" + fn + "\\b").test(core) && !new RegExp("const\\s+" + fn + "\\b").test(core)) {
      errors.push(`[${page}] 调用未定义函数: ${fn}`);
    }
  }
}
console.log("  ✓ 核心函数定义检查完成");

/* ---- d) settings.html 禁裸调 boot ---- */
{
  const settings = read("settings.html");
  const inline = [...settings.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
  if (/(?<!function )boot\(\)/.test(inline.replace("function boot(){", ""))) {
    // settings 页自身不含 boot 定义；任何裸调用都视为历史 bug
    if (/\bboot\(\)/.test(inline)) warnings.push("[settings.html] 存在 boot() 调用（该页无渲染容器，历史上曾崩溃）");
  }
}

/* ---- e) sw.js ASSETS ---- */
{
  const sw = read("sw.js");
  const m = /const ASSETS = \[([\s\S]*?)\];/.exec(sw);
  if (m) {
    const files = [...m[1].matchAll(/"\.\/([^"]+)"/g)].map(x => x[1]);
    files.forEach(f => { if (!exists(f)) errors.push(`[sw.js] ASSETS 文件缺失: ${f}`); });
    console.log(`  ✓ sw.js ASSETS ${files.length} 项检查完成`);
  }
}

/* ---- 汇总 ---- */
console.log("\n===== 审计结果 =====");
if (errors.length) { errors.forEach(e => console.log("✗ " + e)); console.log(`共 ${errors.length} 个问题`); process.exit(1); }
if (warnings.length) warnings.forEach(w => console.log("⚠ " + w));
console.log("✓ 全部通过");
