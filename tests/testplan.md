# 持家 chijia v2 · QA 回归测试清单（tests/testplan.md）

- 维护人：QA（T3 任务书）；契约依据：`pm/contract.md` 最新版（含 D9~D30 修订）。
- 门禁对齐：章程 §2 —— M1（QA 用例齐 + 自验）→ M2（本清单全链路回归全绿 + 视觉走查，缺陷清零或 PM 豁免）。
- 执行方式：
  - **[API]** `python tests/api_test.py`（一键起服 8411 → 断言 → 停服清理），用例 ID 与本清单一致。
  - **[UI/E2E]** 浏览器自动化（browser-use:web-gui-tester），截图存 `tests/evidence/`（M2 轮起含 `r2/`）。**已于 M2 门禁轮（2026-10-26）全量执行。**
  - 状态列：`✅通过` / `❌FAIL(缺陷单)` / `待执行(UI)`。

## 0. 环境与约定

- 启动：`python backend/app.py --port 8411`（QA 专用端口，避开 8410/8412）；token 自动生成于 `backend/data/token.txt`。
- 金额口径（D4）：千分位纯数字；计划页整数、流水页两位小数；`≈` 表估算；计算器内部单位「万」。
- 五实体（契约 §3）：`data` / `txns` / `plan` / `settings` / `pf_holdings`，整文档 LWW（D8，不做字段级合并）。
- 墓碑线格式（D10/D23）：变更对象**顶层** `deleted` 布尔；`value` 是纯文档（不含同步语义字段），墓碑 `value` 允许为 null。
- state 形状（D29）：`GET /api/state` 已删实体返回墓碑记录 `{value:null,updatedAt,deviceId,deleted:true}`；`null` 仅=从未写入。
- 静态缓存（D30）：`text/html` 静态响应带 `Cache-Control: no-cache`，ETag 304 继承。
- 每轮 API 回归后删除测试产生的 `backend/data/chijia.db*`；`token.txt`、`config.json` 不动。

## A. 鉴权与错误模型（契约 §1/§2，D9）

| ID | 类型 | 用例 | 步骤 → 期望 | 契约依据 | 状态 |
|---|---|---|---|---|---|
| AUTH-01 | API | health 豁免鉴权 | 无 token `GET /api/health` → 200 `{ok:true}` | §2 | ✅通过(api_test) |
| AUTH-02 | API | 无 token 拒绝 | 无 token `GET /api/state` → 401 `{error:{code,message}}` | §1/§2 | ✅通过(api_test) |
| AUTH-03 | API | 错 token 拒绝 | `X-Auth-Token: 000...0`（32 位非真值）→ 401 | §1 | ✅通过(api_test) |
| AUTH-04 | API | 写接口同样受鉴权 | 无 token `POST /api/sync` → 401 | §1 | ✅通过(api_test) |
| AUTH-05 | API | 快照接口受鉴权 | 无 token `GET /api/snapshots` → 401 | §1 | ✅通过(api_test) |
| AUTH-06 | UI/E2E | 前端带 token 访问 | 正确 token 下全部页面/接口可用；静态资源（`/`、`/*.html`）无 header 可达 | §1/D9 | ✅通过(UI)（M2 轮复验：六页壳全可开；token 未设时 API 面正确降级 401 提示、设置后未刷新即恢复（BUG-005 修复）；错 token 时快照创建/restore 正确 401 且四步中止） |
| ERR-01 | API | 未知 API 路径 | `GET /api/nonexistent` → 404 `{error:{code:"not_found",...}}`（不落静态 404） | §2 | ✅通过(api_test) |
| ERR-02 | API | 非法 JSON body | `POST /api/sync` body=`not-json` → 400 `{error:{code:"validation_error",...}}` | §2 | ✅通过(api_test) |
| ERR-03 | API | 缺 changes 字段 | `POST /api/sync` body=`{}` → 400 | §2 | ✅通过(api_test) |
| ERR-04 | API | 变更字段校验 | 缺 `value` / `updatedAt` 非毫秒数 / `deviceId` 空串 / `deleted` 非布尔 → 各 400 | §2 | ✅通过(api_test) |
| ERR-05 | API | 错误格式统一 | 上述 4xx/5xx 全部形如 `{error:{code,message}}`，无裸文本/HTML | §2 | ✅通过(api_test) |
| ERR-06 | API | 非法快照 restore 路径 | `POST /api/snapshots/abc/restore` → 404 `{error:{code:"snapshot_not_found",...}}`（D25；M2 轮已收紧为严格 404 + code 断言） | §2/D25 | ✅通过(api_test) |

## B. 同步协议边界（契约 §3，D8/D10/D12/D15/D17/D22）

| ID | 类型 | 用例 | 步骤 → 期望 | 契约依据 | 状态 |
|---|---|---|---|---|---|
| STATE-01 | API | state 元数据形状 | `GET /api/state` → `entities` 恰含五实体键；存活实体 `{value,updatedAt,deviceId,deleted:false}`；已删实体为墓碑记录 `{value:null,deleted:true,...}`（D29）；`null` 仅=从未写入；`serverTime` 为毫秒整数 | §2/D15/D29 | ✅通过(api_test) |
| LWW-01 | API | 旧时间戳被拒 | 写 `settings`（T+1000, dev-a）→ 再写（T+500, dev-b）→ 服务端仍保留 T+1000 的值/时间/设备，sync 回执亦然 | §3 | ✅通过(api_test) |
| LWW-02 | API | 新时间戳胜出 | 接上：写（T+2000, dev-b）→ 服务端更新为 dev-b 的值 | §3 | ✅通过(api_test) |
| LWW-03 | API | 平局 deviceId 字典序决胜 | 同 `updatedAt`：dev-b 已存 → dev-a 写平局（`"dev-a"<"dev-b"`）不覆盖；dev-c 写平局（`"dev-c">"dev-b"`）覆盖 | §3 | ✅通过(api_test) |
| TOMB-01 | API | 顶层 deleted 墓碑生效 | `POST /api/sync` `{entity:"txns", deleted:true,...}` → sync 回执 `deleted:true`；`GET /api/state` 中该实体为墓碑记录 `{value:null,updatedAt,deviceId,deleted:true}`（D29） | D10/D23/D29 | ✅通过(api_test) |
| TOMB-02 | API | value 内 deleted 不误判 | `POST /api/sync` value=`{"deleted":true,...}` 但顶层无 `deleted` → 回执与 state 均为存活实体，value 原样保留 | D10（「不探测 value 文档内字段」） | ✅通过(api_test) |
| TOMB-03 | API | 墓碑后旧写被拒 | 墓碑（T+3000）→ 旧值写（T+2500）→ 实体保持墓碑记录（state `value:null,deleted:true` 且 updatedAt 仍=T+3000，D29） | §3/D11/D29 | ✅通过(api_test) |
| TOMB-04 | API | 墓碑后新写胜出（前向写语义） | 墓碑（T+3000）→ 新值写（T+4000）→ 实体存活，回执 `deleted:false` | D17（restore 时刻之后的写赢过墓碑） | ✅通过(api_test) |
| TOMB-05 | API | 客户端删除变体（M2 轮新增） | `POST /api/sync` 推 `{value:null, deleted:true}`（本地墓碑同步形状，D23）→ 回执与 state 均为墓碑记录 `{value:null,updatedAt,deviceId,deleted:true}` | D23/D29 | ✅通过(api_test) |
| SYNC-01 | API | sync 每实体权威回执 | 批量 `[新写 settings, 过期写 plan]` → 响应 `changes` 含两实体各一条；过期写者返回服务端当前记录（非请求值），客户端据此幂等清 outbox | D12 | ✅通过(api_test) |
| SYNC-02 | API | 批次校验原子性 | 批内含未知实体 → 400 且同批合法变更不落库（无半批提交，D24 冻结） | §2/D24 | ✅通过(api_test) |
| ENT-01 | API | unknown entity 400 | sync 变更 `entity:"nope"` → 400 `{error:{code:"unknown_entity",...}}` | §2 | ✅通过(api_test) |
| OFFLINE-01 | UI/E2E | 离线 outbox 攒批 → 上线 flush | 断网（拦截 sync）连续改 3 个实体 → IndexedDB kv+outbox 均更新 → 恢复网络 → flush 一次批量上送 → 服务端与对端收敛，outbox 清空 | §3/D22 | ✅通过(UI)（M2 轮复验：停服后 3 实体编辑（settings/pf_holdings/plan）入队、静默无报错、槽位全保留（F-2/S5）；重启后手动同步批量上送、LWW 全部胜出、outbox 清空、plan 墓碑被前向写复活；BUG-004 修复生效。原残留（体检页不主动 flush，BUG-007）已在收官靶向复验轮修复销单：添加 <1s 上送、清空墓碑上送、停服静默入队+恢复 boot flush 自动补送） |
| OFFLINE-02 | UI/E2E | boot 异步 pullState | 首屏不阻塞渲染；服务端较新则热更新重渲染；离线静默不报错；`meta.lastSync` 记录并在设置页展示 | D22 | ✅通过(UI)（M2 轮复验：boot 拉取/离线静默/lastSync 展示均验证；pull 对服务端墓碑已生效（BUG-003 修复），整页刷新 boot pull 后体检页回空态） |
| DUAL-01 | UI/E2E | 双端交替写收敛 | 设备 A、B 交替写同一实体（时间交错）→ 最终两端 + 服务端三方一致（最后写者胜） | §3/D8 | ✅通过(UI)（M2 轮复验：B 9100→A pull 收敛→A 9200 保存即上送→B 9300→A pull；三方一致 9300，kv/UI/服务端同值，保存后 450ms 内 outbox 清空；BUG-004 修复生效） |
| DUAL-02 | UI/E2E | 双端删除同步 | 设备 A 删除实体（墓碑）→ 设备 B pull 后该实体消失，B 的旧写（更早 updatedAt）无法复活 | §3/D10/D17 | ✅通过(UI)（M2 轮复验 BUG-003 修复：B 墓碑（TOMB-05 形状）→ A 立即同步+整页刷新 → A kv 墓碑记录、体检页空态；A 前向写仅含新内容、不复活；证据 tests/evidence/r2/t10/t11） |
| CONC-01 | API | 并发 sync 稳定性与确定性 | 10 线程并发 `POST /api/sync`（互不相同的 updatedAt）→ 全部 2xx 无 500；终态 = updatedAt 最大者（LWW 确定性） | §3/D24 | ✅通过(api_test 5 轮，BUG-001 回归销单) |

## C. 快照 / 回滚（契约 §2/§3，D11/D14/D17）

| ID | 类型 | 用例 | 步骤 → 期望 | 契约依据 | 状态 |
|---|---|---|---|---|---|
| SNAP-01 | API | 创建快照 | `POST /api/snapshots {"label"}` → `{id,createdAt,label,size}`，size>0 | §2 | ✅通过(api_test) |
| SNAP-02 | API | 快照列表 | `GET /api/snapshots` → 含新快照，字段齐 `{id,createdAt,label,size}`，新→旧排序 | §2/§3 | ✅通过(api_test) |
| SNAP-03 | API | 严格还原：存活实体前向写回 | 快照含 data/txns/settings → 篡改 → restore → 三实体值回到快照内容，`deviceId:"server-restore"`，`updatedAt`≈restore 时刻 | D11/D14 | ✅通过(api_test) |
| SNAP-04 | API | 严格还原：缺席实体前向墓碑 | 快照时 `plan` 为墓碑（absent）→ 快照后新建 `plan` → restore → `plan` 前向写墓碑记录（state `{value:null,deleted:true}`，deviceId=server-restore，D29），restore 回执 action=`tombstoned` | D11/D29 | ✅通过(api_test) |
| SNAP-05 | API | restore 后旧写被拒 | restore 后以快照前旧 `updatedAt` 写 data → 被拒，仍为 restore 内容（保证回滚不可被历史写冲掉） | D11/§3 | ✅通过(api_test) |
| SNAP-06 | API | restore 可再撤销（前向写） | restore 后以更新时刻写 `plan` → 胜过 restore 墓碑，实体复活 | D17（预期行为） | ✅通过(api_test) |
| SNAP-07 | API | restore 404 | `POST /api/snapshots/999999/restore` → 404 `{error:{code:"snapshot_not_found",...}}` | §2 | ✅通过(api_test) |
| SNAP-08 | UI/E2E | 导入/应用前自动快照 | 导入流水 apply 前、restore 前自动建快照（设置页可见 label/时间） | 章程 §0 | ✅通过(UI)（M2 轮 BUG-002 修复复验：apply 后快照列表未刷新即出现「自动快照 · 导入流水前」（#3，label/时间齐），后端日志 apply 的 POST /api/sync 前有 POST /api/snapshots；回滚前自动快照（D17 四步 #2）同验；证据 t06） |
| SNAP-09 | UI/E2E | 设置页快照操作 | 设置页手动建快照、列表展示、一键回滚；回滚走 D17 四步：`flushOutbox→自动快照→restore→pullState` | §3/D17 | ✅通过(UI)（M2 轮复验：创建/列表/回滚全通过；回滚后月支出输入框回显快照值 6000、快照面板与 lastSync 自动刷新（BUG-005 修复/D27）；D17 快照失败 confirm 拒绝/同意两分支均正确中止且数据原封（t17）） |

## D. 导入管线（docs/IMPORT.md + DATA.meta.importer 默认值，前端 P1b 后执行）

| ID | 类型 | 用例 | 步骤 → 期望 | 依据 | 状态 |
|---|---|---|---|---|---|
| IMP-01 | UI/E2E | fixture 全解析+分类 | 粘贴 `tests/sample-bocom.txt` 6 行明细（去掉 # 注释行）→ failed=0；分类：工资 2（15000/12000）、奖金 1（26000≥bonusMin=20000）、补贴 1（800，摘要「补贴」）、大额支出 1（6000≥bigExpenseMin=5000）、skip 1（内部转账） | IMPORT.md | ✅通过(UI)（M2 轮复验：6 笔、工资2/奖金1/补贴1/大额1/skip1、未识别 0、区间 2025-01-15~05-06、流入/流出 53,800.00/9,000.00；apply 后规则行即时显示真实值——BUG-005 修复生效） |
| IMP-02 | UI/E2E | 混合格式文本 | bocom 行与其他格式行混合 → 逐行首个命中格式即采用，互不干扰 | IMPORT.md | 待执行(UI)（本轮指定范围外，下一轮补） |
| IMP-03 | UI/E2E | 非法行容错 | 空行、乱码行、日期残缺行 → 计入 failed 并逐行提示，不影响合法行解析 | IMPORT.md/core.js | 待执行(UI)（本轮指定范围外，下一轮补） |
| IMP-04 | UI/E2E | 千分位与两位小数 | 金额 `1,500.00` 千分位解析为数字；流水页金额两位小数展示 | D4/IMPORT.md | ✅通过(UI)（M2 轮复验：分析页 2.x 全部两位小数+千分位（工资 27,000.00/奖金 26,000.00/补贴 800.00 等）；预览汇总两位小数；证据 t08） |
| IMP-05 | UI/E2E | 分类规则可调 | 导入面板改 bonusMin/关键词 → 重新分类即时生效（对应 DATA.meta.importer） | IMPORT.md | ✅通过(UI)（M2 轮补做：奖金下限 20000→15000 保存 → 规则行即时更新、重新解析即时重分类（15000/26000 两笔奖金、12000 一笔工资）；已恢复 20000；证据 t09） |
| IMP-06 | UI/E2E | 余额链路（D18） | bocom 行含余额列 → map 返回 `bal` → 应用后当期余额被修正 | D18 | ✅通过(UI)（M2 轮复验：预览「最新账户余额 64,800.00」＝末行余额列，D18 bal 链路打通） |
| IMP-07 | UI/E2E | 原始 PDF 不上传 | 导入解析全程前端完成；网络面板无流水原文外发请求 | 章程 §0/D6 | ✅通过(UI/部分)（粘贴文本路径全流程仅 /api/sync 标准化对象，后端日志无原文外发；PDF 文件路径未驱动——IAB 运行时不支持文件选择） |

## E. 计划引擎（frontend/src/core.js，前端 P1b 后执行）

| ID | 类型 | 用例 | 步骤 → 期望 | 依据 | 状态 |
|---|---|---|---|---|---|
| PLAN-01 | UI/E2E | 改参数联动 1.1~1.4 | 修改推演参数（比例/增速等）→ 1.1 四池分配 allocbar、1.2 结余推演、1.3 期末预期、1.4 里程碑同步刷新 | D3 | ✅通过(UI)（改收入 10500→12000：1.1 占比/1.2 同步；改消费/投资池：1.3 期末 ≈1,117,288→≈1,239,699、Hero ≈1,290,099、里程碑联动；金额整数+千分位） |
| PLAN-02 | UI/E2E | 预期分布联动 | 参数变化 → 月度预期分布图/表同步 | D3 | ✅通过(UI)（Hero 资金分布占比与 1.3 期末构成随参数刷新） |
| PLAN-03 | UI/E2E | 三池>可支配红字警告 | 消费+投资+缓冲 > 可支配 → 出现红字警告；ESOP 不参与可行性判定 | D19 | ✅通过(UI)（M2 轮复验：消费8000+投资5000+缓冲1260=14,260>12,000：红字「超 2,260 元」警告，ESOP 840 未计入；恢复 4200/4200 后警告消失；证据 t20） |
| PLAN-04 | UI/E2E | 金额口径 | 计划页整数、无小数；千分位分组；`plan.html#params` 打开参数面板并滚动到位 | D4/D16 | ✅通过(UI)（M2 轮复验：整页口径正确；#params 独立 URL 面板展开滚动到位 top≈92、参数持久显示） |

## F. 工具页（calculator / portfolio，前端 P1b 后执行）

| ID | 类型 | 用例 | 步骤 → 期望 | 依据 | 状态 |
|---|---|---|---|---|---|
| TOOL-01 | UI/E2E | 计算器三档实时更新 | 改输入 → 保守/标准/进取三档结果即时重算 | 任务书 | ✅通过(UI)（M2 轮复验：月支出 0.6→0.8 万：月结余 0.7 万/年支出 9.6 万/三档年限与目标本金 192/288/384 万即时刷新，无按钮；证据 t18） |
| TOOL-02 | UI/E2E | FFC_PREFILL 30 分钟 | 计算器结果带 prefill 跳转 → localStorage `FFC_PREFILL` 写入且 30 分钟内有效；过期后不预填；其余 FRI_* 键不存在 | D5 | ✅通过(UI)（M2 轮复验：计划页「发送到计算器」（window.open 新标签）→ 横幅「已自动填入…月收入 1.2 万 · 月支出 0.42 万 · 本金 58.91 万（30 分钟内有效）」、输入框回显一致、FFC_PREFILL={ts,label,fields} 1.4 分钟新鲜、无任何 FRI_* 键；30 分钟过期分支未等表——以 TTL 字段为准；证据 t19） |
| TOOL-03 | UI/E2E | 体检空态引导 | `pf_holdings` 为空 → 体检页空态引导（非空白/报错） | D20 | ✅通过(UI)（M2 轮复验：空态文案「还没有持仓记录——…」+ 四维口径说明；增删改与四维红绿灯实时正常（添加黄金/现金后重算），本地持久化通过；双端删除后空态复现亦验证（t10）） |

## G. 部署形态与健壮性

| ID | 类型 | 用例 | 步骤 → 期望 | 依据 | 状态 |
|---|---|---|---|---|---|
| STATIC-01 | API | 静态资源托管 | `GET /` → 200 text/html（frontend/ 同源托管，无 CORS 面） | §1 | ✅通过(api_test) |
| AI-01 | API | AI 预留接口 501 | 带 token `POST /api/ai/insight` → 501 `{error:{code,message}}`（config 默认 ai.enabled=false；不改动用户 config.json，只断言 501 与错误形状） | §2/D7/D13 | ✅通过(api_test) |
| CACHE-01 | API | 静态缓存口径（D30） | `GET /` 200 且响应头含 `cache-control: no-cache`；带 `If-None-Match`（取 200 的 ETag）二次请求 → 304 且 304 响应继承 `no-cache` | D30/§1 | ✅通过(api_test) |
| STATIC-02 | UI/E2E | 六页壳 + iframe 惰性加载 | 首次点击才设 iframe src；切换仅 display、状态保留；`report.html` 重定向 → `plan.html`；`settings.html#importer` 展开导入面板 | D16/§4 | ✅通过(UI)（M2 轮复验：初始 5 个 iframe src 全 null→首点「计划」仅 frame-plan 设 src→切「分析」仅增设 frame-analysis、其余仍 null（切换仅 display）；report.html→plan.html 重定向通过；settings.html#importer 面板展开滚动到位；plan.html#params 同验；证据 t21/t22） |
| PWA-01 | UI/E2E | SW 策略 | HTML/JS/CSS network-first（离线回退缓存）；图标 cache-first；改版 VER/`?v=` 递增生效 | D21 | ✅通过(UI)（M2 轮 BUG-006 修复复验：SW v2.0.0 激活并控制页面；改 index.html 加标记→普通导航一次拿到新版（后端日志 GET / 200、8561 网络字节、DOM 含标记）；停服离线回退 `/` 与 `/settings.html` 均由缓存完整渲染；还原后导航标记消失。P3 附加观察：install 预缓存 addAll 遇 304 整体失败→预缓存不全，运行期 networkFirst 自愈（详见 BUG-006 回归记录）） |
| SEC-01 | UI/E2E | 数据不出本机 | 全流程仅本机请求（127.0.0.1），无遥测、无第三方请求 | 章程 §0 | ✅通过(UI)（M2 轮复验：settings 页 performance 资源 origin 全部 127.0.0.1:8411、foreignResources=[]；离线导航亦无外部请求） |

## 附：契约（pm/contract.md v1.0 + D9~D30）覆盖对照

| 契约条目 | 覆盖用例 |
|---|---|
| §1 启动/端口/token 生成 | 环境约定 §0 + api_test 起服流程 |
| §1 鉴权（health 豁免、静态放行） | AUTH-01~05、AUTH-06、STATIC-01 |
| §2 GET /api/state（D15 元数据/D29 墓碑记录） | STATE-01、TOMB-01、TOMB-03、SNAP-04 |
| §2 POST /api/sync（D10 墓碑/D12 回执/D24 并发互斥与整批原子） | LWW-01~03、TOMB-01~04、SYNC-01/02、ENT-01、CONC-01 |
| §2 GET/POST /api/snapshots | SNAP-01/02 |
| §2 restore（D11 严格还原/D14 server-restore/D17 前向写/D25 id 口径） | SNAP-03~07、SNAP-09、DUAL-02、ERR-06 |
| §2 /api/ai/insight 501（D7/D13） | AI-01（见 api_test.py） |
| §2 错误统一 `{error:{code,message}}` | ERR-01~06 |
| §3 LWW（毫秒、平局 deviceId） | LWW-01~03、CONC-01 |
| §3 墓碑不物理删行 | TOMB-01~03（后端行为，API 层验证回执与 state） |
| §3 客户端 IndexedDB/outbox/boot 拉取 | OFFLINE-01/02、DUAL-01/02 |
| §3 FFC_PREFILL 30 分钟 | TOOL-02 |
| §4 静态托管/hash 定位/iframe | STATIC-01/02、PLAN-04 |
| D4 金额口径 | IMP-04、PLAN-04 |
| D18 余额链路 | IMP-06 |
| D19 三池警告 | PLAN-03 |
| D21 SW 策略 | PWA-01 |
| D23 墓碑 value 可 null | TOMB-01、TOMB-03 |
| D24 并发互斥/整批原子 | CONC-01、SYNC-02 |
| D29 state 墓碑记录形状 | STATE-01、TOMB-01、TOMB-03、SNAP-04 |
| D30 静态 no-cache/304 继承 | CACHE-01 |

## 附：执行记录

| 日期 | 范围 | 命令 | 结果 | 缺陷 |
|---|---|---|---|---|
| 2026-10-26 | 全部 [API] 用例（上表 32 项，对应 api_test.py 40 项断言） | `python tests/api_test.py`（自起服 8411，测毕停服并清理 backend/data/chijia.db*） | 39/40 PASS | ❌ BUG-001（CONC-01：并发 sync 同一实体丢失较新写入，LWW 判定竞态；6 轮 5 次复现） |
| 2026-10-26（复工轮） | [API] 全量（api_test.py 42 项断言：按 D29 更新 TOMB-01/TOMB-03/SNAP-03c/STATE-01 形状断言，新增 D30 CACHE-01a/b；SYNC-02 标注升格为 D24 冻结项） | `python tests/api_test.py` | 连续 2 轮 42/42 全绿 | 无新缺陷；BUG-001（D24）修复回归再确认通过；BUG-003 的服务端侧前提（D29 state 墓碑记录）已就绪，其前端采纳逻辑待下轮 E2E 全量回归 |
| 2026-10-26（M2 门禁轮） | [API]+[UI/E2E] 全量。API：api_test.py 43 项断言（ERR-06 收紧为严格 404+code=snapshot_not_found；新增 TOMB-05 客户端删除变体）。E2E：browser-use 全量（六张缺陷单销单验证 + F-2 场景 + D17 四步/失败分支 + testplan 其余 UI 项），截图存 tests/evidence/r2/ | `python tests/api_test.py` ×2；后端 8411 长驻 + 浏览器 E2E | API 连续 2 轮 43/43 全绿；E2E 六单全 PASS（BUG-002~006 → VERIFIED）；testplan 全部 [API]/[UI] 用例 ✅（IMP-02/03/06(PDF 分支) 保持范围外/受限记录） | ❌→新单 **BUG-007**（体检页 portfolio.html 添加/清空持仓不触发 flush，S2/P2，另单跟踪）；P3 观察：SW install 预缓存 addAll 遇 304 失败（networkFirst 运行期自愈，详见 BUG-006 回归记录） |
| 2026-10-26（M2 收官靶向复验轮） | BUG-007 三判据 + SW 预缓存（304 场景二次 install）+ idb.js deviceId 兜底 + 设置页写链路快抽查 | 后端 8411 自起自停 + 浏览器靶向验证，截图存 tests/evidence/r3/ | 全部 PASS；BUG-007 → VERIFIED | 无新缺陷。环境备注：浏览器 profile 在多轮 unregister 后出现 SW 僵尸态（脚本 200 下发但不 install/不拦截），经带查询参数的等价脚本 URL 强制新 worker 实例后安装逻辑正常运行（16/16 预缓存、零 304），属运行环境现象、非 SUT 回归（详见本轮报告） |
| 2026-10-26（M2 门禁轮） | 全部 [UI/E2E] 用例（AUTH-06、OFFLINE/DUAL、SNAP-08/09、D/E/F/G 组、STATIC-02/PWA/SEC） | browser-use:web-gui-tester，截图存 tests/evidence/（上轮）与 tests/evidence/r2/（本轮） | 全部 ✅（明细见上表各行 M2 轮批注） | BUG-002~005 销单 VERIFIED；BUG-006 销单 VERIFIED；新单 BUG-007 |

- api_test.py 与本清单映射说明：SNAP-03a/b/c 合并覆盖 SNAP-03 与 SNAP-04（严格还原的存活前向写回 + 缺席墓碑）；LWW-01 拆 a/b 两断言；SYNC-01 拆 a/b/c 三断言。
- 本轮首跑曾有 2 处 FAIL，均为测试脚本自身时序缺陷（SYNC-02 基线取点、CONC-01b 时间基准未考虑 restore 全实体前向写），修脚本后归零；CONC-01b 复跑仍不稳定复现，确认为产品缺陷并出单 BUG-001。
