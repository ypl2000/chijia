# BUG-003：pull 不应用服务端墓碑——对端删除的实体在本端永不消失（DUAL-02 FAIL）

- **状态**：VERIFIED（2026-10-26 M2 回归轮）
- **报告人**：QA（T3）
- **报告日期**：2026-10-26
- **严重度**：S1 严重（协议违约：删除同步失效；被删数据在对端持续展示，且后续本地写会把已删数据整体复活）
- **优先级**：P0（双端删除是五实体同步协议的核心语义；手机端删除后 PC 端永远看不到删除）
- **归属岗位**：前端（pull 合并未处理服务端 null/墓碑记录）
- **发现途径**：浏览器 E2E（回归清单 ID：DUAL-02）
- **契约依据**：pm/contract.md §3「拉回服务端较新者覆盖本地并清 outbox 对应项」、D10（顶层 deleted 墓碑）、D15（state 每实体 `{value,updatedAt,deviceId,deleted}|null`）；tests/testplan.md DUAL-02

## 复现步骤

1. `python backend/app.py --port 8411`；浏览器（设备 A，deviceId a9d02564…）已建 2 笔持仓并同步（服务端 pf_holdings 存活）。
2. 设备 B（API 直写，dev-qa-B）以更新时间戳发墓碑（D23 格式）：
   `POST /api/sync {"changes":[{"entity":"pf_holdings","value":null,"updatedAt":1792954600000,"deviceId":"dev-qa-B","deleted":true}]}` → 200，回执 deleted=true。
3. 设备 A：设置页点「🔄 立即同步」（flushOutbox→pullState）；再整页刷新触发 boot pullState。
4. 读 A 的 IndexedDB `kv.pf_holdings` 与服务端 `GET /api/state`。

## 期望 vs 实际

| | 结果 |
|---|---|
| 期望（契约 §3/D15，DUAL-02） | A pull 后本地 pf_holdings 消失（kv 删除该实体或置墓碑），体检页回空态 |
| 实际（pull + 整页刷新 boot pull 后均如此） | 服务端 `entities.pf_holdings = null`；A 本地 kv 仍为 `{deleted:false, updatedAt:1792954272557, deviceId:"server-restore"}`（pull 前的旧记录）；体检页仍显示「沪深300指数 100,000 · 合计 100,000 元」 |

## 证据

- 服务端与本地对照（同步/刷新后一次性读取）：
  ```
  SERVER pf_holdings: null
  A kv: {"entity":"pf_holdings","deleted":false,"updatedAt":1792954272557,"deviceId":"server-restore"}
  体检页 UI: 沪深300指数 指数基金 100,000 100.0% （合计 100,000 元）
  ```
- 复活实证（影响放大）：A 随后添加一笔「复活测试-黄金」前向写（D17 语义本身正确），服务端 pf_holdings 复活为 **两笔**——包括墓碑本应删除的「沪深300指数」：
  ```
  {"value":{"items":[{"name":"沪深300指数",...},{"name":"复活测试-黄金",...}]},"updatedAt":1792954779129,"deviceId":"a9d02564...","deleted":false}
  ```
- 截图：tests/evidence/12_dual02_tombstone_not_applied.png（刷新 + boot pull 后体检页仍显示已删持仓）。
- 关联测试：tests/testplan.md DUAL-02；对照 API 层 TOMB-01~04（服务端侧墓碑语义全部通过，缺陷仅在客户端 pull 合并）。

## 影响面与初步分析

- 影响面：五实体任意一个在「另一端」被删除后，本端永远不会观察到删除；本端后续对该实体的任何写操作会把删除前数据整体写回服务端（复活），删除操作实质失效。PC+手机双端为产品核心形态，删除同步失效直接阻断 M2。
- QA 初步定位（只报不修）：pull 合并对 `GET /api/state` 中 `null`（墓碑）实体未做本地删除处理——推测只合并非 null 记录；A 自己删除（data 实体，本地写入的墓碑）表现正常，故缺陷范围为「拉取方向」。

## 回归记录

- 修复提交：前端 P2 修复批（pullState 对 D29 墓碑记录统一走 kvPut：`{value:null, deleted:true}`，并清对应 outbox 项；UI 渲染层回空态）
- 回归测试：2026-10-26 M2 回归轮（QA）——**PASS → VERIFIED**
  - 复跑 DUAL-02：A（浏览器 d42bd945…）体检页添加「沪深300指数 100,000」→ 立即同步（服务端存活）→ 设备 B（API，dev-qa-B）以 TOMB-05 客户端删除变体形状发墓碑 `{value:null, deleted:true, updatedAt=now}`（回执 deleted=true）→ A 设置页「立即同步」。
  - A 本地 `kv.pf_holdings` 变为墓碑记录 `{value:null, deleted:true, deviceId:dev-qa-B}`，outbox 清空；体检页整页加载（boot pull）后回空态「还没有持仓记录——…」，不再显示已删持仓。
  - 前向写不复活：A 添加「复活测试-黄金 10,000」→ 立即同步 → 服务端 `items` 仅含黄金一笔，沪深300 未复活。
  - 证据：tests/evidence/r2/t10_bug003_tombstone_empty_state.png、t11_bug003_forward_write_ui.png。
- 关联：DUAL-02 状态更新为 ✅通过（tests/testplan.md）；API 侧 TOMB-05（客户端删除变体 value:null+deleted:true）本轮新增断言并通过（api_test 43/43）。
