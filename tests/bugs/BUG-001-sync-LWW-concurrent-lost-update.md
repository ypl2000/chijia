# BUG-001：并发 sync 同一实体时丢失较新写入（LWW 判定存在读-改-写竞态）

- **状态**：REJECTED(已修复销单)（QA 回归通过，2026-10-26；A0 终审销单）
- **报告人**：QA（T3）
- **报告日期**：2026-10-26
- **严重度**：S1 严重（违反冻结契约 §3 LWW 合并语义；多端同时上线场景下较新写入被静默覆盖，构成数据丢失）
- **优先级**：P1（默认单用户低频使用难触发，但双端同时 flush outbox 即可触发；建议 P1 边界加固窗口修复，与 db.py 注释「P1 边界加固时再复核」呼应）
- **归属岗位**：后端
- **发现途径**：tests/api_test.py（用例 ID：CONC-01b）；专项取证脚本见「证据」
- **契约依据**：pm/contract.md §3「LWW：`updatedAt` 毫秒大者胜；平局 `deviceId` 字典序大者胜」；§2 D12（sync 回执为「合并后权威记录」）

## 复现步骤

1. `python backend/app.py --port 8411`（取 `backend/data/token.txt` 为 token）
2. 以 10 线程并发 `POST /api/sync`，全部写同一实体 `settings`，`updatedAt` 严格唯一递增：
   - 第 i 个请求（i=0..9）：`{"changes":[{"entity":"settings","value":{"spend":9000+i},"updatedAt":T0+i,"deviceId":"dev-qa-conc-i"}]}`，T0 为发起前取的同一基准毫秒
3. 全部请求返回后 `GET /api/state` 读 `entities.settings`
4. （等价复现）直接 `python tests/api_test.py`，看 CONC-01b

## 期望 vs 实际

| | 结果 |
|---|---|
| 期望（契约 §3） | 终态 = `updatedAt` 最大者：`value={"spend":9009}, updatedAt=T0+9, deviceId="dev-qa-conc-9"`，与请求到达/提交顺序无关 |
| 实际 | 终态被更旧时间戳覆盖。6 轮执行 5 次复现：终态出现 `spend=9007@T0+7`（2 次）、`spend=9002@T0+2`（2 次）、`9007`（1 次），仅 1 次正确 |

## 证据

专项取证（10 并发，逐请求权威回执，一次性输出）：

```
预期胜者（updatedAt 最大）: i=9  (ts=1792951272651, value spend=9009, dev=dev-qa-conc-9)
各请求回执（按 i）:
  i=1 status=200 回执 value={'spend': 9007} updatedAt=...649 deviceId=dev-qa-conc-7
  i=2 status=200 回执 value={'spend': 9002} updatedAt=...644 deviceId=dev-qa-conc-2
  i=8 status=200 回执 value={'spend': 9008} updatedAt=...650 deviceId=dev-qa-conc-8
  i=9 status=200 回执 value={'spend': 9009} updatedAt=...651 deviceId=dev-qa-conc-9   ← 已确认写入
服务端终态: value={'spend': 9002} updatedAt=...644 deviceId=dev-qa-conc-2            ← 被 i=2 覆盖
```

关键事实（同一输出内自证）：

- i=9 的回执已确认 `9009@...651` 落库，其后无任何更新时间戳的写入；
- 但 i=2 的回执是 `9002@...644`（早 7 毫秒）——说明 i=2 的「判胜读取」发生在 i=9 落库之前，其 upsert 却在 i=9 之后提交，把 9009 覆盖掉；
- 10 个请求全部 200，即每份 D12「权威回执」发出后随即失真——客户端据此清 outbox 后再 pull，会静默丢掉 i=9 这笔较新数据。

复现频率：`python tests/api_test.py` 整套 4 轮中 3 轮 FAIL；专项脚本 2 轮均 FAIL（合计 5/6）。单次 10 并发负载即可稳定暴露。

截图：不适用（API 缺陷，以响应原文为准）。
关联测试：tests/api_test.py `CONC-01a`（全部 2xx，无 500）/ `CONC-01b`（终态确定性，FAIL）；tests/testplan.md `CONC-01`。

## 影响面与初步分析

- 影响面：`POST /api/sync` 对同一实体的并发合并（典型触发：双端离线后同时上线 flush outbox；或前端重试风暴）。较新写入被较旧写入静默覆盖，无错误、无提示，且各端按「权威回执」清空 outbox 后无法自愈——数据丢失类缺陷。
- QA 初步定位（只报不修，供 owner 参考）：`/api/sync` 的合并决策为「读 current（`db.get_entity`）→ `_incoming_wins` 比较 → `put_entity` 写入」，三步未对并发互斥。Python sqlite3 默认仅在 DML 前隐式开事务，SELECT 不持锁、不进入写事务，因此多个请求可基于同一份旧 `current` 各自判胜；SQLite（WAL）只串行化「写本身」，不串行化「读-判-写」整个过程，后提交者覆盖先提交者，LWW 语义被破坏。
- 方向提示（非修复方案）：如将读-判-写包进同一写事务（`BEGIN IMMEDIATE`）或应用层写锁可消除竞态；注意 WAL 下持旧快照升级写锁会遇 `SQLITE_BUSY_SNAPSHOT`，需配套重试。请 owner 权衡取舍。
- 门禁影响：阻塞 M2「回归全绿」（CONC-01 红灯）。

## 回归记录

- 修复提交：后端 `/api/sync` 读-判-写互斥加固（P2 修复批，owner：后端工程师）
- 回归测试：2026-10-26 QA 独立回归——`python tests/api_test.py` 连续 **5 轮全部 40/40 PASS**，其中 CONC-01a（10 并发全 2xx、无 500）与 CONC-01b（终态=最大 updatedAt，LWW 确定性）每轮均绿，达到本单建议的「连续 5 轮 CONC-01 全绿」标准。对应 tests/testplan.md CONC-01 状态已更新为 ✅通过。
- 备注：E2E 双端交替写（DUAL-01）实测同样收敛正常（见 testplan 执行记录）；客户端 outbox 链路另有新单 BUG-004（flush 竞态/败写回执），与本单服务端语义无关。
- 复工再确认（2026-10-26）：api_test 断言按 D29/D30 更新（42 项断言）后连续 2 轮全绿，CONC-01a/b 每轮均过——D24 读改写互斥修复持续有效。
