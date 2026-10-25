# 架构说明（持家 chijia）

> 版本：v1.2 · 2026-10-25 ｜ 维护者：A1 架构师 ｜ 改动本文件需经 PM 批准

## 1. 页面清单与路由表

| Tab | 文件 | PAGE_MODE | 渲染内容 |
|---|---|---|---|
| 🏠 首页 | index.html（壳内原生视图） | — | 引导四步 + 数据规则 + 三件套入口 |
| 📋 计划 | plan.html | `plan` | Hero（现在/预期）+ 资金分布对照 + ④参数面板 + 1.1~1.4 + 1.5保护规则 |
| 🔎 分析 | analysis.html | `analysis` | 统计维度芯片 + 2.1~2.5 流水分析 + 3.1~3.4 健康度评估 |
| 🧮 计算器 | calculator.html | —（独立工具） | 三档 FIRE 模型 |
| 🧪 体检 | portfolio.html | —（独立工具） | 四维红绿灯组合体检 |
| ⚙️ 设置 | settings.html | `settings` | ①数据包备份 ②流水导入 ③收入口径（内嵌 report 文档的 settings 视图） |

- APP 壳 `index.html` 以 iframe 惰性加载各页（首次点击才设 src），切换只改 display，**状态保留**
- 旧 `report.html` 为重定向存根（→ plan.html），仅作历史链接兼容

## 2. 共享文件职责表

| 文件 | 内容 | Owner | 说明 |
|---|---|---|---|
| `app.css` | 全部样式（含深色模式/移动端/settings-mode） | A5 | 各页 `<link>` 引用；引用时带 `?v=版本` 破缓存 |
| `data.js` | `const DATA` 全量示例数据（含 meta/hero/income/plan/overview/parts） | A1 | 各页 `<script src>` 引用；真实数据经数据包导入覆盖 |
| `formats.js` | `window.FORMATS` 流水格式注册表 | A3 | **社区贡献入口**：新银行格式 = 加一个 entry |
| `core.js` | 全部逻辑：渲染器（renderHero/renderOverview/renderParts/renderBlocks/buildTable）+ 计划引擎（computePlan/applyPlan/buildPlanPanel）+ 导入管线（FORMATS 解析/classify/aggregate/computeIncome12m/buildImportBlocks/applyBalance/applyImport/loadPdfJs/extractPdfText）+ 通用 boot/cardify12 | A1 | **无自执行代码**（纯函数库）；`boot()` 由各页面脚本自行调用 |
| `settings.html` 内嵌 buildImporter | 导入面板 UI | A3 | 从 core 分离出来的唯一 UI 块 |

## 3. 存储键协议（sessionStorage，同 Tab iframe 共享；关闭浏览器清空）

| 键 | 写入者 | 读取者 | 语义 |
|---|---|---|---|
| `FRI_DATA_V1` | 设置页（导入数据包） | 计划/分析页（boot 覆盖 DATA） | `{savedAt, data}` 数据包快照 |
| `FRI_TXNS_V1` | 设置页（应用到分析页） | 分析页（boot 恢复 2.x）、设置页（状态行） | `{rules, txns}` 已导入流水 |
| `FRI_PLAN` | 计划页（applyPlan） | 计划页（boot 恢复参数） | 计划推演参数 |
| `FRI_SPEND` | 设置页（月支出调整） | 计划页（boot 同步 fields.spend） | 数字 |
| `FRI_PF_HOLDINGS`（localStorage） | 组合体检 | 组合体检 | 持仓记忆（跨会话） |
| `FFC_PREFILL`（localStorage） | 报告发送按钮 | 计算器/组合体检 | 30 分钟有效 |

**同步机制**：写入方写 sessionStorage → 同 Tab 其他 frame 收到 `storage` 事件 → 相关页面 `location.reload()` 自我更新（plan/analysis 均已挂监听）。设置页自身不监听（自己改的自己可见）。

## 4. 缓存策略

- 本地预览：`python serve.py`（禁缓存头），刷新即最新
- 生产（GitHub Pages）：共享资源引用带 `?v=版本` 参数（改版升参数）；sw.js 缓存壳资源（VER 常量随版本递增）

## 5. 已知约束

- sessionStorage 只在**同一标签页**内共享；跨标签页场景用「导出备份 JSON」迁移
- PDF 解析组件（pdf.js）从 CDN 按需加载，需联网一次
- 计算器内部金额单位为「万」（历史约定，勿混用「元」）
