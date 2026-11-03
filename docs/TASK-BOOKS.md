# 任务书与边界表（A0 监督员执掌）

> A0 依本表核查各 agent 的实际动作；越界 = 打回。改动本表需 PM 批准。

## 角色任务书

### A0 监督员
- 职责：边界核查、交付验收（对照各任务书验收标准）、进度与风险日报、冲突裁决或上报 PM
- 权力：打回不合规范提交；**无权直接修改代码**
- 汇报对象：PM（用户）

### A1 架构师（架构 + 交互设计双责）
- 拥有：core.js、data.js、app.css、formats.js、docs/ARCHITECTURE.md、docs/UX-SPEC.md
- 职责：共享文件完整性、跨页同步协议、交互设计规范、实现走查签收
- 禁碰：plan.html / analysis.html / settings.html 的功能逻辑（发现问题出单给 A2/A3）
- 验收：ARCHITECTURE/UX-SPEC 与实现一致；共享文件改动有记录

### A2 功能工程师（计划线）
- 拥有：plan.html；core.js 末尾可追加计划专用辅助函数（如 fmt0）；data.js 的 plan 字段
- 禁碰：analysis.html / settings.html / calculator.html / portfolio.html / 共享文件既有函数
- 验收：改参数 → 1.1~1.4 + 预期分布联动；不可行参数有警告；金额显示整数

### A3 功能工程师（导入与分析线）
- 拥有：settings.html、analysis.html
- 禁碰：plan.html / core.js / data.js / formats.js
- 验收：PDF→解析→应用→分析页同步全链路；数据包导入不崩溃；文案无「报告」残留

### A4 QA 回归工程师
- 拥有：tests/ 目录
- 职责：回归脚本与清单、bug 出单（复现步骤 + 截图）；**只报不修**
- 验收：audit.js 通过；回归清单覆盖存储键协议全部数据流

### A5 视觉工程师
- 拥有：app.css 的视觉 Token 部分（色板/字号/间距/圆角/阴影）、各页视觉走查报告
- 职责：深浅色两套主题质量、移动端密度与排版、对比度
- 禁碰：功能逻辑（JS）
- 验收：深浅色 × 三视口（390/768/1440）走查通过；对比度可读

### A6 发布与文档工程师
- 拥有：README.md、sw.js、manifest.json、版本号、git 操作
- 职责：文档与架构同步、版本递增、推送（API 备用通道）
- 禁碰：功能文件

### PM（用户 + 主协调代理）
- 拥有：最终验收、推送决定、任务分派、冲突裁决
- 执行浏览器端到端验收

## 边界速查（禁止矩阵）

| 文件 | A1 | A2 | A3 | A4 | A5 | A6 |
|---|---|---|---|---|---|---|
| plan.html | 审 | **写** | ✗ | 报 | 样式建议 | ✗ |
| analysis.html | 审 | ✗ | **写** | 报 | 样式建议 | ✗ |
| settings.html | 审 | ✗ | **写** | 报 | 样式建议 | ✗ |
| core.js | **写** | 追加辅助 | ✗ | 报 | ✗ | ✗ |
| data.js / formats.js | **写** | ✗ | ✗ | 报 | ✗ | ✗ |
| app.css | **写**(结构) | ✗ | ✗ | 报 | **写**(视觉) | ✗ |
| README / sw.js / manifest | 建议 | ✗ | ✗ | ✗ | ✗ | **写** |

## 现行存储键协议（速查）

| 键 | 写 | 读 |
|---|---|---|
| FRI_DATA_V1 | 设置页（导入数据包） | 计划/分析（boot 覆盖） |
| FRI_TXNS_V1 | 设置页（应用流水） | 分析（恢复 2.x）、设置（状态） |
| FRI_PLAN | 计划页（applyPlan） | 计划（boot 恢复参数） |
| FRI_SPEND | 设置页（月支出） | 计划（boot 同步） |
| FRI_PF_HOLDINGS | 体检（localStorage） | 体检 |
| FFC_PREFILL | 报告发送按钮 | 计算器/体检（30 分钟） |
