# -*- coding: utf-8 -*-

# ===== 1. calculator.html：横幅文字改深色 =====
p = 'calculator.html'
s = open(p, encoding='utf-8').read()
old = "bar.style.cssText = 'margin:10px 0 0;padding:9px 14px;border:1px dashed var(--blue);border-radius:10px;font-size:13px;background:#f2f7ff;';"
new = "bar.style.cssText = 'margin:10px 0 0;padding:9px 14px;border:1px dashed var(--blue);border-radius:10px;font-size:13px;background:#f2f7ff;color:#1c2333;';"
assert old in s, 'banner css missing'
s = s.replace(old, new, 1)
old = '''  bar.innerHTML = '🧮 已从《' + (pre.label || '资金报告') + '》导入参数：' +
    applied.join(' / ') + ' —— <a href="#" id="ffcReset" style="color:var(--blue)">恢复默认</a>';'''
new = '''  bar.innerHTML = '🧮 已从《' + (pre.label || '资金报告') + '》导入参数：' +
    applied.join(' / ') + ' —— <a href="#" id="ffcReset" style="color:#2f6fed">恢复默认</a>';'''
assert old in s, 'banner innerhtml missing'
s = s.replace(old, new, 1)
open(p, 'w', encoding='utf-8').write(s)
print('calculator banner fixed')

# ===== 2. report.html：设置模式（?view=settings 只显示导入/备份/收入口径）=====
p = 'report.html'
s = open(p, encoding='utf-8').read()

a = '''function boot(){
  if (location.search.indexOf("app=1") >= 0) document.body.classList.add("app-mode");'''
n = '''function boot(){
  if (location.search.indexOf("app=1") >= 0) document.body.classList.add("app-mode");
  if (new URLSearchParams(location.search).get("view") === "settings") document.body.classList.add("settings-mode");'''
assert a in s, 'boot anchor missing'
s = s.replace(a, n, 1)

a = '''  /* ===== 深色模式（跟随系统）===== */'''
n = '''  /* ===== 设置模式（?view=settings）：只显示导入/备份/收入口径 ===== */
  body.settings-mode .hero,
  body.settings-mode #overviewBox,
  body.settings-mode #guideBox,
  body.settings-mode #partsBox > .pblock,
  body.settings-mode #partsBox > #sec-plan,
  body.settings-mode .fab,
  body.app-mode .fab,
  body.settings-mode .fab { display:none!important; }
  body:not(.settings-mode) #sec-import { display:none!important; }
  /* ===== 深色模式（跟随系统）===== */'''
assert a in s, 'settings-mode css anchor missing'
s = s.replace(a, n, 1)

# 推演应用后不再滚动定位（设置模式下 1.1 隐藏）
a = '''  boot();
  ["sec-1-1", "sec-1-2", "sec-1-3", "sec-1-4"].forEach(id => { const x = document.getElementById(id); if (x) x.open = true; });
  const target = document.getElementById("sec-1-1");
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });'''
n = '''  boot();
  if (!document.body.classList.contains("settings-mode")) {
    ["sec-1-1", "sec-1-2", "sec-1-3", "sec-1-4"].forEach(id => { const x = document.getElementById(id); if (x) x.open = true; });
    const target = document.getElementById("sec-1-1");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }'''
assert a in s, 'scroll guard anchor missing'
s = s.replace(a, n, 1)

# ④ 面板里"每月支出在 ③ 调整"的文案 → 指向设置页
a = 'spendLine.textContent = "每月支出：" + ((DATA.meta.calculator && DATA.meta.calculator.fields.spend) || DEFAULT_PLAN.spend) + " 元（在 ③ 收入口径处调整）";'
n = 'spendLine.textContent = "每月支出：" + ((DATA.meta.calculator && DATA.meta.calculator.fields.spend) || DEFAULT_PLAN.spend) + " 元（在「设置」页的③收入口径处调整）";'
assert a in s, 'spend line missing'
s = s.replace(a, n, 1)

open(p, 'w', encoding='utf-8').write(s)
print('report.html settings-mode added')
