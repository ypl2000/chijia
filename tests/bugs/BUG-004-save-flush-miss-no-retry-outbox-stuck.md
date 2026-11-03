# BUG-004：保存触发的 flush 与入队竞态——变更滞留 outbox、服务端缺失最新写、败写回执不清 outbox

- **状态**：VERIFIED（2026-10-26 M2 回归轮；flush 触发缺口在体检页仍存在，另开 BUG-007 跟踪）
- **报告人**：QA（T3）
- **报告日期**：2026-10-26
- **严重度**：S2 一般（数据最终一致可由手动同步/boot pull 自愈，但存在服务端长时间缺最新写的窗口与无意义重试）
- **优先级**：P2
- **归属岗位**：前端（flushOutbox 触发时序与 D12 回执处理）
- **发现途径**：浏览器 E2E（回归清单 ID：DUAL-01 / OFFLINE-01 关联观察）
- **契约依据**：pm/contract.md §3「变更先写 kv+outbox 再尝试 flush」、D12「sync 回执为合并后权威记录，客户端据此幂等清 outbox」

## 复现步骤（现象 A：flush 未携带新变更且无重试）

1. 设备 B（API）以时间戳 T1=1792954400000 写 settings.spend=7002（成功）。
2. 浏览器设备 A：设置页月支出改为 7004 → 「保存月支出」（本地 kv/outbox 均写入 7004@1792954542541 > T1）。
3. 立刻与 8 秒后分别 `GET /api/state`，并检查 A 的 outbox。

| | 结果 |
|---|---|
| 期望（契约 §3） | 保存即尝试 flush，服务端 LWW 收到 7004 并胜出；outbox 清空 |
| 实际 | flush 的 `POST /api/sync` 返回 200 但服务端仍为 7002（该 POST 未包含 7004 变更，疑为空批）；此后 8 秒+ 无任何重试 POST；outbox 滞留 7004 条目；直到手动「立即同步」才上送成功（服务端变 7004） |

## 复现步骤（现象 B：败写回执不清 outbox，D12 违约）

1. 同上场景：A 保存 7003@1792954393022（早于 B 的 T1=1792954400000）→ flush 被服务端正确拒绝（权威回执为 7002@T1）。
2. 读 A 的 kv/outbox。

| | 结果 |
|---|---|
| 期望（D12） | 收到权威回执后幂等清 outbox 对应项，本地采纳 7002 |
| 实际 | outbox 仍保留 7003 条目、kv 仍为 7003；此后每次 flush 都重发这注定失败的写，直到下一次 pull 才收敛 |

## 证据

- 现象 A 时间线（后端日志 phase2 + QA 读取）：
  ```
  INFO: 127.0.0.1:49701 - "POST /api/sync HTTP/1.1" 200 OK      ← A 保存 7004 后的 flush（服务端未变）
  （8 秒内无后续 POST /api/sync）
  SERVER settings: {"value":{"spend":7002},"updatedAt":1792954400000,"deviceId":"dev-qa-B"}   ← 保存后 8s+ 仍为 B 的旧值
  A outbox: [{"entity":"settings","updatedAt":1792954542541,"value":{"spend":7004}}]           ← 滞留
  （手动「立即同步」后） SERVER settings: {"value":{"spend":7004},"updatedAt":1792954542541,"deviceId":"a9d02564..."}  ← 补送成功，条目有效
  ```
- 现象 B 读取：`kv.settings = {spend:7003, updatedAt:1792954393022}`、`outbox=[settings@1792954393022]`；手动同步后收敛为 7002 且 outbox 清空。
- 关联测试：tests/testplan.md DUAL-01（最终三方一致达成）、OFFLINE-01；API 层 LWW 语义本身经 api_test 5 轮 40/40 验证无误——缺陷在客户端 flush/回执链路。
- 截图：不适用（以状态读取与日志为准）。

## 影响面与初步分析

- 影响面：单端使用的「保存后立刻关机」场景下最新改动可能未上送且无重试；多端场景下对端 pull 不到最新值，直到滞留方再次触发同步。boot pullState（D22）与手动同步可自愈，故定 S2。
- QA 初步定位（只报不修）：现象 A 疑为 flushOutbox 读取 outbox 早于本次写入提交（竞态），且 200 空批后不重试；现象 B 为 flush 回执未按 D12 用于清 outbox/采纳权威值。两现象同属 outbox flush 生命周期，建议 owner 一并梳理。

## 回归记录

- 修复提交：前端 P2 修复批（保存链路 kv+outbox 同事务提交后立即 flushOutbox；flushOutbox 按 F-2/A0 处方清队前重读槽位；败写回执采纳权威值写回 kv）
- 回归测试：2026-10-26 M2 回归轮（QA）——**两现象均 PASS → VERIFIED**
  - 现象 A（保存→flush 时效）：B（API dev-qa-B）写 settings.spend=7002@T1 → A 设置页改 7004 →「保存月支出」。保存后 **450ms** 读 A 本地：kv={spend:7004, updatedAt=T_A, deviceId=A}、**outbox 已空**（flush 完成的直接证据）；随后 GET /api/state 服务端=A 的 7004 记录，deviceId=d42bd945…。3 秒内服务端为最新值，判据达成。
  - 现象 B（败写清槽+采纳权威值）：B 以**未来时间戳**（now+10min）写 8002 → A 保存 8100（必败写）→ 700ms 后读 A 本地：**outbox=[]**、**kv.settings={spend:8002, deviceId:dev-qa-B, updatedAt=B 的未来戳}**——败写回执即刻清槽且本地采纳权威值（D12）；服务端保持 8002。附带观察：随后「立即同步」拉取后月支出输入框自动重渲染为 8002（BUG-005 修复联动）。
  - F-2 场景补充：离线 3 实体编辑槽位全保留（F-2/S5）；outbox 为空时「立即同步」不发 POST /api/sync（pushed:0，后端日志计数不变，F-2/S6）。
  - 残留缺口（不在本单范围）：体检页 portfolio.html 添加/清空持仓只写 kv+outbox、**不尝试 flush**（页面未接 flushOutbox/installAutoSync）→ 另开 **BUG-007**。
  - 证据：本轮 QA 会话状态读取（kv/outbox JSON）与 tests/evidence/r2/_backend_8411.log；截图 t14_dual01_converged_9300.png、t16_offline_flush_converged.png。
- 关联：DUAL-01 / OFFLINE-01 状态更新为 ✅通过（tests/testplan.md）。
