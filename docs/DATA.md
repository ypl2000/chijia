# DATA 对象填写说明

`report.html` 顶部 `<script>` 里的 `DATA` 对象是整份报告的唯一数据源。**推荐不改文件**：在页面「使用说明」区域点「💾 导出我的数据」前先正常使用，或直接点「⬆️ 导入我的数据」加载 JSON 备份（数据存浏览器 localStorage，刷新不丢，可导出迁移）。

> 想生成自己的固定模板？把本文件复制一份改名 `report.html`，填入你的 DATA 即可——但记住：填了真实数据的 html 是隐私文件，别上传。

## 顶层结构

```js
const DATA = {
  meta:     { ... },   // 标题、副标题、页脚、计算器联动、导入规则
  hero:     { ... },   // 顶部左右分栏指标（现在 / 计划期末）
  guide:    { ... },   // 使用说明折叠面板（可删）
  overview: { ... },   // 置顶"资金分布&计划总览"
  parts:    [ ... ]    // 三大部分的全部章节
};
```

## meta

| 字段 | 说明 |
|---|---|
| `title` / `subtitle` / `footer` | 页头与页脚文案 |
| `statsDim` | 「统计维度」标签：`{ label, text }`，如流水笔数与跨度 |
| `calculator` | 联动计算器：`file`（相对路径）、`btn`（按钮文案）、`label`（来源标识）、`fields`（预填参数，如 `{spend:6000, rent:3200}`）、`tip` |
| `importer` | 流水分类规则：`employer`（雇主户名关键词）、`salaryAbstract`（工资摘要，默认"工资"）、`subsidyKeywords`（补贴摘要数组）、`skipTypes`（排除的交易类型关键词）、`bonusMin`（工资通道金额 ≥ 此值判为奖金）、`bigExpenseMin`（大额支出阈值） |

## hero / overview

- `hero.now` / `hero.exp`：`{ head, items:[{label, b}] }`——建议左侧放当期、右侧放计划期末，中间箭头自动生成
- `overview.title` / `note` / `arrowCap`：总览标题、口径说明、中间箭头旁的计划摘要（支持 `<br>`）
- `overview.now` / `overview.exp`：`{ head, total, sub, stack:[{w,color,label?}], rows:[{c,name,amt,pc}], callout? }`
  - `stack.w` 为百分比宽度（总和凑 100）；`rows.c` 是圆点颜色；负债行加 `muted:true, neg:true`
- `overview.tableRows`：箭头对照表，每行 `{ tag, tagCls?, tagStyle?, now, exp, note, total? }`
- `overview.readout`：结构读数（HTML 字符串）——**这是分析结论，请按自己的数据重写**

## parts（章节）

每个部分：`{ id, nav:{ico,lab}, no, title, note, sections:[...], rules? }`。有 `rules` 时该部分自动双栏（章节左、保护规则右）。

每个章节：`{ id, title, blocks:[...] }`，block 类型：

| `t` | 字段 | 用途 |
|---|---|---|
| `sub` | `html` | 章节说明文字 |
| `h4` | `html` | 小标题（可含 `<span class="hint">`） |
| `callout` | `html`, `kind?`(`ok`/`warn`) | 提示框 |
| `table` | `head:[str|{h,num?,w?}]`, `rows:[{cls?, cells:[cell]}]` | 表格；cell 为字符串或 `{h, num?, cls?, bar?}`，`bar` 渲染分布条 |
| `allocbar` | `items:[{cls,label}]` | 月度四池分配条（cls: ab-consume/ab-invest/ab-cushion/ab-esop） |
| `cards` | `items:[{lab,val,note,total?}]` | 仓位卡片 |
| `picgrid` | `items:[{h,d}]` | 图标卡片网格 |
| `flow` | `steps:[{t,d}]` | 横向流程链 |
| `tier` | `rows:[{w,bg,label,tag,tagCls,ink?}]` | 分层占比条 |
| `ms` | `items:[str]` | 标签云列表 |
| `procons` | `prosTitle,pros[],consTitle,cons[]` | 优/缺点双栏 |
| `distrows` | `rows:[{name,w,color,pct}]` | 持仓分布横条 |
| `details` | `title, blocks` | 嵌套折叠块（递归） |
| `gap` | `h` | 垂直留白 |

`html` 类字段均按 HTML 渲染（可信内容，注意转义）。

## 建议的口径约定

- 数值统一千分位纯数字（`≈589,128`），避免"X 万"混用
- 汽车等按**残值估值**入"固定资产"；公司股权按**购入成本**计
- 公积金等限用途资产单列，健康度评估时不计入流动性
