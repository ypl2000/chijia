# BUG-007：体检页添加/清空持仓只写 kv+outbox、不触发 flush——变更滞留至访问其他页面才上送

- **状态**：VERIFIED（2026-10-26 M2 收官靶向复验轮）
- **报告人**：QA（T3）
- **报告日期**：2026-10-26
- **严重度**：S2 一般（数据最终一致可由其他页面 boot flush / 手动同步自愈，outbox 不丢；但单端「体检页操作后关机」场景最新改动不上送，且与契约「变更先写 kv+outbox 再尝试 flush」不符）
- **优先级**：P2
- **归属岗位**：前端（portfolio.html 保存链路未接 flushOutbox / installAutoSync）
- **发现途径**：浏览器 E2E（回归清单 ID：OFFLINE-01 前置观察 / BUG-004 同族扩展排查）
- **契约依据**：pm/contract.md §3「变更先写 kv+outbox 再尝试 flush」；D12/D22（flush 与 boot 自动同步口径）

## 复现步骤

1. `python backend/app.py --port 8411`，设置页录入 token 并「立即同步」（页面为 settings.html）。
2. 同一标签页直接导航到 `portfolio.html`（该页注释明示「独立工具页，独立初始化（不调用 core.boot）」）。
3. 「＋ 添加持仓」填入名称/类型/金额 → 点击添加 → 立即（≤3 秒）`GET /api/state` 并观察后端日志。

## 期望 vs 实际

| | 结果 |
|---|---|
| 期望（契约 §3） | 添加持仓=变更提交：先写 kv+outbox，**再尝试 flush**（POST /api/sync）；后端未就绪时静默留待 online/下次 flush 重试 |
| 实际（添加后 2.4 秒+ 观测） | 本地 `kv.pf_holdings` 已更新、outbox 已入队，但**无任何 `POST /api/sync`**（后端日志该时段仅页面静态资源与 boot `GET /api/state`）；服务端无该笔变更。直到回到 settings 页手动「立即同步」/访问带 core.boot 的页面（boot flushOutbox）才上送成功 |

## 证据

- 后端日志（添加持仓后尾部，无 POST /api/sync）：
  ```
  INFO:     127.0.0.1:60109 - "GET /src/sync.js HTTP/1.1" 200 OK
  INFO:     127.0.0.1:62622 - "GET /src/idb.js HTTP/1.1" 200 OK
  ...
  INFO:     127.0.0.1:52282 - "GET /api/state HTTP/1.1" 200 OK     ← 仅 portfolio 页 boot 拉取
  （添加持仓后 2.4s+：无 POST /api/sync）
  ```
- 本地状态（只读 IndexedDB 读取）：`kv.pf_holdings` 已更新为含新持仓的记录；`outbox` 含同内容 `pf_holdings` 槽位——写入侧正常，仅缺 flush 触发。
- 对照组（同轮设置页）：月支出「保存月支出」后 450ms 内 outbox 清空且服务端收到（BUG-004 修复后的正确行为）。
- 源码只读诊断（只报不修）：portfolio.html 脚本头注释「独立工具页，独立初始化（不调用 core.boot）」；import 仅 `{ commitChange, kvGet }` 与 `{ removeEntity }`——未引入 `flushOutbox`/`installAutoSync`，「＋ 添加持仓」「🗑 清空持仓」「单笔删除」（removeEntity 内部有 flush，异常静默）均无后续显式 flush 钩子。
- 关联测试：tests/testplan.md OFFLINE-01（离线攒批场景不受影响，槽位保留正常）；BUG-004（同族：保存→flush 触发缺口，设置页已修，体检页遗漏）。

## 影响面与初步分析

- 影响面：仅影响从体检页发起的持仓变更的上送时效（最终一致性由 outbox 保证，不丢数据）；多端场景对端在滞留方访问其他页面前 pull 不到新持仓；「体检页操作后直接关机」的改动停留在本机。
- QA 初步定位（只报不修）：portfolio.html 为独立初始化页面，保存链路复用 commitChange 但未像 settings/plan 页那样在提交后调用 flushOutbox，也未挂 installAutoSync（online 重试）；后续访问任一挂 core.boot 的页面时 boot flushOutbox 会补送（本轮已实证补送成功）。

## 回归记录

- 修复提交：靶向修复批（portfolio.html 保存链路对齐同步协议：添加/清空后 `commitChange/removeEntity → flushOutbox().catch(静默)`，并挂 `installAutoSync()` 补挂 online 自动重试；注释引 BUG-007）
- 回归测试：2026-10-26 M2 收官靶向复验轮（QA）——**三判据均 PASS → VERIFIED**
  - 判据 1（添加 → 3 秒内上送）：体检页添加「靶向复验-第二笔 2000 黄金」→ 添加后 **747ms** 读本地 outbox 已空；后端日志 `POST /api/sync 200`；GET /api/state 服务端 pf_holdings 两笔（含该笔），updatedAt 与本地写入同刻。
  - 判据 2（清空 → 墓碑上送）：「🗑 清空持仓」confirm 接受 → 本地 kv 变墓碑记录 `{value:null, deleted:true}`、outbox 清空、UI 回空态；服务端 pf_holdings 墓碑记录（同 updatedAt、deleted:true）；POST 计数递增（200）。
  - 判据 3（停服 → 静默入队 → 恢复补送）：停服后添加「离线复验持仓 30000 债券」→ 无任何报错面、kv 已更新、outbox 保留该槽（静默入队）；重启后端 → 刷新体检页（该页无 boot flush，槽保留，符合预期）→ 访问设置页（core.boot 页 boot 异步 flushOutbox，D22 设计路径）→ **无需人工点击**槽位自动补送，outbox 清空、服务端 pf_holdings=该笔。附加：体检页已挂 installAutoSync，真实断网恢复（'online' 事件）同路径自动重试。
  - 证据：tests/evidence/r3/_backend_8411.log（POST 计数与状态码）、r3_t02_deviceid_display.png、r3_t03_settings_save_quickcheck.png、r3_t04_portfolio_synced.png。
- 附带复验（同轮）：idb.js `ensureDeviceId()` 兜底——全新 profile（kv/meta 清空）体检页写入携带非空 deviceId（6a39a5f5…）、服务端 200 接收（不再 400 空串拒收），设置页「本机 deviceId」显示一致；设置页月支出保存 1.1s 内上送（写链路无回归）。
- 关联：tests/testplan.md OFFLINE-01 批注已更新（残留缺口关闭）。
