# BUG-002：导入流水「应用到分析页」前未自动创建快照（SNAP-08 落空）

- **状态**：VERIFIED（2026-10-26 M2 回归轮）
- **报告人**：QA（T3）
- **报告日期**：2026-10-26
- **严重度**：S2 一般（缺失章程要求的保护性快照；导入覆盖 2.x 统计与当期余额后无法从 UI 一键回到导入前状态）
- **优先级**：P1（回滚能力是章程核心卖点「随时可回滚」的组成部分）
- **归属岗位**：前端（apply 流程未调 POST /api/snapshots）
- **发现途径**：浏览器 E2E（回归清单 ID：SNAP-08）
- **契约依据**：章程 §0「导入/应用/恢复前自动快照」；tests/testplan.md SNAP-08「导入流水 apply 前、restore 前自动建快照（设置页可见 label/时间）」

## 复现步骤

1. `python backend/app.py --port 8411`，设置页录入 token 并「立即同步」。
2. 设置页 ② 流水导入 → 粘贴文本 → 粘贴 tests/sample-bocom.txt 的 6 行明细 → 「🔍 解析并预览」→「✅ 应用到分析页」→ confirm 接受。
3. 设置页「快照管理」查看列表，并 `GET /api/snapshots` 核对。

## 期望 vs 实际

| | 结果 |
|---|---|
| 期望（章程 §0 / SNAP-08） | apply 前自动创建快照，设置页快照列表可见（含 label/时间） |
| 实际 | 快照列表为空（`[]`）；整个会话期间后端未收到任何 `POST /api/snapshots`；快照仅在本轮手动「📸 创建快照」后才出现（id=1） |

## 证据

- 后端访问日志（phase1，apply 前后）：apply 成功横幅「已应用 6 笔流水，分析页数据已自动更新」出现前后仅有 `POST /api/sync`、`GET /api/state`、`GET /api/snapshots`，**无任何 `POST /api/snapshots`**：
  ```
  INFO:     127.0.0.1:56832 - "POST /api/sync HTTP/1.1" 200 OK
  INFO:     127.0.0.1:56586 - "GET /api/state HTTP/1.1" 200 OK
  INFO:     127.0.0.1:65240 - "POST /api/sync HTTP/1.1" 200 OK
  INFO:     127.0.0.1:65243 - "GET /api/state HTTP/1.1" 200 OK
  INFO:     127.0.0.1:65244 - "GET /api/snapshots HTTP/1.1" 200 OK
  ```
- apply 后 `GET /api/snapshots` → `[]`（QA curl 核对）。
- 截图：tests/evidence/05_import_preview_6tx.png（apply 前预览）、tests/evidence/10_snapshot_created.png（此后手动创建的 id=1 快照，非自动）。
- 关联测试：tests/testplan.md SNAP-08。

## 影响面与初步分析

- 影响面：导入应用、（待验证的）数据包导入等「覆盖型写」之前无自动快照；用户误应用错误流水后，若此前未手动建快照则无法回滚到导入前。
- QA 初步定位（只报不修）：restore 前是否自动建快照本轮未单独验证（restore 走服务端三步协议，客户端 apply 前应同样建快照）；申请快照动作完全缺失于 apply 链路。对照 restore 场景：回滚本身走 `/api/snapshots/{id}/restore`，未观察 restore 前自动快照行为。

## 回归记录

- 修复提交：前端 P2 修复批（applyImport 覆盖型写前调 ensureSafetySnapshot，失败经 confirmLoss 询问；数据包导入分支同钩子）
- 回归测试：2026-10-26 M2 回归轮（QA）——**PASS → VERIFIED**
  - 复跑原流程①：设置页粘贴 sample-bocom 6 行 → 解析预览（6 笔/0 未识别）→「✅ 应用到分析页」→ confirm 接受。
  - 快照列表**未整页刷新**即出现第 3 条「自动快照 · 导入流水前 2026/10/26 07:35:20」（label/时间齐全）；后端日志 apply 的 `POST /api/sync` 前同端口有 `POST /api/snapshots 200`。
  - 证据：tests/evidence/r2/t06_apply_auto_snapshot_id3.png；日志 tests/evidence/r2/_backend_8411.log。
  - 附：D17 四步自动快照（回滚前）与数据包导入分支共用 ensureSafetySnapshot；回滚分支已实测（快照 #2），数据包导入分支因 IAB 运行时不支持文件选择未单独驱动（见本轮报告受限项）。
- 关联：SNAP-08 状态更新为 ✅通过（tests/testplan.md）。
