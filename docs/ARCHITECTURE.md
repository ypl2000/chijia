# v3 架构说明

## 1. 关键决策

| 决策 | 理由 |
|---|---|
| **单页 SPA，彻底去掉 iframe** | v2 的 `focusWithRetries` 双份实现、隐藏 iframe 靠 `BroadcastChannel` 自愈、T10 记录的输入焦点被重渲染打断、BUG-008 首载滚动不到位，根因都在 iframe。v3 用一个 `#view` 容器 + 六页渲染函数，切页只换 innerHTML。 |
| **计算逻辑抽成纯函数引擎** | `web/js/core/` 七个文件无 DOM 依赖，可在 Node 里直接跑断言。v1 的 `applyPlan` 把「生成 block 描述」和「写 DATA + boot()」搅在一起，v3 拆成 `compute* → render`。 |
| **单一状态容器 + 局部结果区刷新** | `store.commit()` 统一打时间戳、落盘、广播；参数输入用 `{silent:true}` 只更新 `#plan-live` / `#calc-live` / `#pf-live`，**不重渲染整个页面**，输入焦点不丢。 |
| **IndexedDB 主 + localStorage 同步镜像** | 首屏零延迟、`file://` 也能用；IDB 里的较新记录会在 init 后覆盖镜像。 |
| **后端可选** | 探测 `GET /api/health`；零后端返回 `{"ok":false,"mode":"local-only"}`，应用完整可用。同步用整文档 LWW 写入后端 `data` 实体，快照沿用 v2 后端的严格还原。 |
| **PWA / 离线** | SW 对 HTML/JS/CSS 走 network-first + `cache:'reload'`，`/api/*` 永不缓存；资源全本地，断网可用。 |
| **自定义弹窗 / 可解释洞察** | 替代原生 `alert/confirm`；分析结论全部来自确定性规则，不接生成式模型。 |

## 2. 模块契约

```
index.html                 单页壳（侧栏 / 顶栏 / 底栏 / toast / modal / 锁屏）
  js/core/*                纯函数引擎：fmt / formats / statement / plan / fire / health / portfolio
  js/data.js               默认 STATE + v1/v2 备份格式归一
  js/store.js              状态容器（commit / subscribe / export / import / reset / log）
  js/sync.js               可选后端（probe / pull / push / snapshots / restore）
  js/pdf.js                本地 pdf.js 文本抽取（按 y 分行、x 排序）
  js/ocr.js                本机 OCR + 恒等式校验 + 确认表
  js/ui.js                 组件（card / table / kpi / stack / lights / toast / confirm / modal）
  js/views/*.js            六页：{ title, sub, render(state), mount(root,state), live?(state) }
  js/app.js                路由 / 主题 / 锁定 / 网络审计 / SW / 打印
```

`render()` 返回 HTML 字符串；`mount()` 绑定事件；带 `live()` 的页面把动态结果区包在 `[data-live]` 里，输入时只替换那一段。

## 3. 状态结构

```js
{
  version: 3, updatedAt, deviceId, serverAt?, serverDeviceId?,
  meta:       { title, subtitle, statsDim, importedAt, lastBackup },
  overview:   { now: { bank, total, sub, rows:[{name,amt,c,note,muted,neg}] } },
  plan:       { start, months, income, spend, invest, cushion, cushionCap, esop,
                fundsBase, bankKeep, depreciation, oneoffIn[], oneoffOut[] },
  income:     { window, salary, bonus, subsidy, total, monthlyAvg, span, src },
  importer:   { employer, salaryAbstract, subsidyKeywords[], skipTypes[], bonusMin, bigExpenseMin },
  calculator:{ spend, rent, income, p0, foodPct, medPct, r, cpi, swr, kids, childCost, health, invest, investYears },
  holdings:   { equity, bond, cash, esop, consumer, restricted, *R, years, modelR, monthlyExpense, monthlyInvest },
  settings:   { theme, monthlyExpense, hasInsurance, autoSync, autoLock },
  txns: [], txnsRules: {}, activity: []
}
```

备份导出为 `{app:'chijia', version:3, exportedAt, state}`；`data.normalize()` 兼容 v1 的 `{data,txns,txnsRules}` 与 v2 五实体里的 `data`。

## 4. 计算口径速查

| 模块 | 公式 |
|---|---|
| 个人账单通胀 π | `(房租×(CPI+0.5) + 饮食×(CPI−0.5) + 医疗×(CPI+2.5) + 其他×CPI) ÷ 月支出` |
| 真实收益率 | `(1+r) ÷ (1+π) − 1` |
| T1 提取率 | `年支出 ÷ SWR + 专项池` |
| T2 本金不动·CPI | `年支出 ÷ (r−CPI) + 专项池` |
| T3 本金不动·个人账单 | `年支出 ÷ rReal + 专项池` |
| 专项池 | `育儿 = 每孩成本÷18 × annuity(18, rReal) × 孩数`；健康按原值；重大投入按 `÷(1+rReal)^n` 折现 |
| 逐年模拟 | `P(n+1) = P(n)×(1+rReal) + 年结余`，最多 99 年 |
| 四池推演 | 安全垫封顶后 `溢出 = cushion − cM` 并入 ESOP 预备；一次性支出按池扣减且不为负；固定资产期末扣折旧 |
| 期末占比 | 最大余额法，合计恒 100%（v2 引入，v1 缺） |
| 组合有效收益 | `(权益×r + 稳健×r + 现金×r + ESOP×r×0.6) ÷ 生息组合` |
| 健康度 | 可投资产口径 7 维 + 总资产口径 7 维，按资产/流水/计划实算，1~5 星 |

**单位**：计算器内部统一「万」，UI 输入混合元/万/%；报告侧用元 + 千分位，`F.parse()` 统一剥离 `≈` 与逗号。

## 5. 相比 v1 / v2 修掉的坑

- v1：`__INCOME` 跨 iframe 传值恒为 `null`（收入联动断开）——v3 用同一状态对象，联动走 `store.commit`。
- v1：`__planFmt` 从未赋值，计划页金额未按设计显示整数——v3 统一 `F.money`。
- v1：消费画像、健康度评分是 `data.js` 里写死的示例文本——v3 全部动态实算。
- v2：π 写死 `0.0233`、SWR/CPI 两档降级为文字说明——v3 三口径并列且 π 可推导。
- v2：逐月执行表、一次性收支规划、双口径健康度整节删除——v3 全量恢复。
- v2：导入流水后 3.x 不重算——v3 的 `health.compute(state, ag)` 每次渲染按最新流水计算。
- v2：`/api/ai/insight` 永远 501——v3 用确定性洞察引擎替代。
- v2：PWA 安装入口、主题切换 UI 缺失——v3 有 manifest + 192/512 图标、手动深浅主题并持久化。

## 6. 版本纪律

改版需同步递增四处：`web/sw.js` 的 `VERSION`、`web/manifest.json` 的 `version`、`web/index.html` 的 `app.css?v=`、`web/app.css` 头注释。新增静态文件要加进 `sw.js` 的 `ASSETS`。

## 7. 测试策略

| 脚本 | 覆盖 |
|---|---|
| `tests/smoke.js` | 纯逻辑 10 组：最大余额法、流水正则/折行/去重、真实 fixture、四池封顶与按池扣减、期末占比、FIRE 三口径与 π、健康度 14 维、体检五灯、备份兼容、六页 render |
| `tests/browser-check.js` | CDP 强制 390 / 1440 视口，六页 × 2：JS 异常、横向溢出、卡片数、截图 |
| `tests/interaction-check.js` | 18 项真实交互：Tab、主题、三处参数实时重算、焦点保持、滑块双向、流水导入→分析页重算、洞察、备份、持久化 |

`browser-check.js` 用 `Emulation.setDeviceMetricsOverride` 绕开 Windows 无头 Chrome 的最小窗口宽度（直接 `--window-size=390` 会按更宽的视口布局再裁切，造成「样式溢出」的假象）。
