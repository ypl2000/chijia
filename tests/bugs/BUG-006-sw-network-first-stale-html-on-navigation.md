# BUG-006：改版后普通导航拿到旧版 HTML——network-first 实际不生效（PWA-01/D21 违约）

- **状态**：VERIFIED（2026-10-26 M2 回归轮；归属落定为双向修复：sw.js networkFirst 加 {cache:'reload'}（前端）+ 后端 text/html 补 Cache-Control: no-cache（D30），CACHE-01a/b 由 api_test 断言通过）
- **报告人**：QA（T3）
- **报告日期**：2026-10-26
- **严重度**：S2 一般（改版/修 bug 后用户刷新拿不到新版，PWA 化后「改版即见最新」目标落空；不影响数据正确性）
- **优先级**：P2
- **归属岗位**：待定（跨域候选，退回 PM 裁决：前端 sw.js 的 fetch 未绕过 HTTP 缓存 / 后端静态响应缺 Cache-Control）
- **发现途径**：浏览器 E2E（回归清单 ID：PWA-01）
- **契约依据**：D21「HTML/JS/CSS network-first（离线回退缓存）……改版即见最新」；tests/testplan.md PWA-01

## 复现步骤

1. `python backend/app.py --port 8411`；浏览器访问 `http://127.0.0.1:8411/`，确认 SW 已激活（cache `chijia-v0.2.0`，controller 存在）。
2. 在 `frontend/index.html` 末尾追加注释标记 `<!-- QA-TEMP-MARKER-20261026 -->`（QA 测试后已原样恢复，diff 为空）。
3. 地址栏普通导航到 `/`（非强制刷新），检查 DOM 与服务器日志。

## 期望 vs 实际

| | 结果 |
|---|---|
| 期望（D21 network-first） | 导航请求出网，拿到带标记的新版 index.html（离线时才回退缓存） |
| 实际 | 第一次导航：**服务器未收到任何 `GET /`**（日志无请求），页面为旧版；第二次 reload 仍为旧版 DOM。页内 `fetch('/index.html',{cache:'no-store'})` 可取到新版（200） |

## 证据

- 检查结果（标记在盘期间）：
  ```
  第一次导航: {markerInDom: false, transferSize: 0}          ← 零网络字节，缓存直出
  后端日志:   （无 GET / 记录，仅 sw.js 304）
  第二次 reload: {markerInDom: false, transferSize: 8863}     ← 仍为旧版 DOM
  SW 缓存: caches.match('index.html') 内容不含标记（陈旧副本未被更新）
  页内 no-store fetch: {status:200, fetchHasMarker: true}     ← 服务端确有新版
  还原标记后导航: {markerGone: true}                          ← 恢复正常
  ```
- 后端静态响应头（curl -I）：仅 `ETag/Last-Modified`，**无 `Cache-Control`**——HTML 走浏览器启发式新鲜度缓存。
- sw.js 源码（只读诊断）：`networkFirst()` 使用 `fetch(req)`（默认 cache 模式），导航请求会命中 HTTP 缓存的新鲜副本而不出网；离线回退分支正常。
- 关联测试：tests/testplan.md PWA-01（VER 0.2.0 本身通过：cache 名 `chijia-v0.2.0`、SW 已激活并控制页面、图标等静态资源 cache-first 正常）。

## 影响面与初步分析

- 影响面：PWA 场景下版本迭代后，已安装用户普通刷新可能长时间停留在旧版（启发式新鲜度过期前不会出网），JS/CSS 同理（同为 networkFirst 路径）；「改版递增 VER/?v=」纪律对 HTML 导航本身无效。
- QA 初步定位（只报不修，方向提示）：① sw.js `networkFirst` 改为 `fetch(req, { cache: 'reload' })`；或 ② 后端对 text/html 响应补 `Cache-Control: no-cache`。二者取一即可，请 PM 派单定归属。

## 回归记录

- 修复提交：前端 P2 修复批（sw.js networkFirst 改 `fetch(req, {cache:'reload'})`，注释引 BUG-006/D30 双向保险）+ 后端 D30（text/html 响应 Cache-Control: no-cache，ETag 304 继承；api_test CACHE-01a/b 通过）。SW 版本递增至 v2.0.0（D21 纪律）。
- 回归测试：2026-10-26 M2 回归轮（QA）——**三判据均 PASS → VERIFIED**
  - 前置：清站点数据后重装 SW（cache `chijia-v2.0.0`，controller 存在）。
  - 判据 1（普通导航拿新版）：`frontend/index.html` 末尾追加 `<!-- QA-R2-MARKER-20261026 -->` → 地址栏普通导航（navigation type=navigate，非强制刷新）→ **后端日志新增 `GET / 200 OK`**（上轮为 0 条）；navigation transferSize=8861 / encodedBodySize=8561（真实网络字节，上轮首刷为 0）；DOM 出现标记（文档级注释节点，符合尾注释解析位置）。
  - 判据 2（离线回退仍可用）：停止后端（端口 8411 释放）→ 普通导航 `/` 与 `/settings.html` → 两页均由 SW 缓存完整渲染（标题/正文齐备，t13）。
  - 判据 3（测完还原）：index.html 从备份原样恢复（diff 为空，服务端确认无标记）→ 普通导航 → 200 新取、标记消失（markerGone=true）。
  - 证据：t12_bug006_nav_gets_new_html.png、t13_bug006_offline_fallback_settings.png、后端日志 tests/evidence/r2/_backend_8411.log。
- P3 附加观察（不阻塞销单，建议下轮排期）：SW install 预缓存 `cache.addAll` 遇浏览器 HTTP 缓存条件命中（304 非 ok 响应）会整体失败，导致升级设备首启预缓存不完整（本轮实测 chijia-v2.0.0 仅部分壳资源入库）；运行期 networkFirst 每次成功请求会 cache.put 自愈（本轮访问过六个页面后 13 条全齐，离线兜底实测可用）。建议后续 addAll 改用 `{cache:'reload'}` 与 networkFirst 同口径。
- 关联：PWA-01 状态更新为 ✅通过（tests/testplan.md）。
