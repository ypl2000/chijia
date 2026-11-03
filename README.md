# 持家 chijia v2

**本地优先的个人财务应用**：账本 + 月度计划推演 + 银行流水分析 + FIRE 计算器 + 组合体检。
数据不出本机——账本存浏览器 IndexedDB、同步落自建后端的本地 SQLite，**无遥测、无第三方数据通道**。

## 功能一览（六 Tab，职责互斥）

| Tab | 职责 |
|---|---|
| 🏠 首页 | 引导与直达入口 |
| 📋 计划 | 参数面板四池推演、1.1~1.5 计划章节（重算即更新） |
| 🔎 分析 | 2.1~2.5 流水统计（导入流水自动更新）+ 3.1~3.4 财务健康度 |
| 🧮 计算器 | FIRE 三档模型（内部单位「万」） |
| 🧪 体检 | 持仓四维红绿灯（存 IndexedDB） |
| ⚙️ 设置 | 数据操作唯一入口：流水导入 / 数据包备份 / 收入口径 / 同步与连接 |

## 快速开始（电脑端）

要求：Python 3.10+，前端无需构建步骤。

```bash
git clone https://github.com/ypl2000/chijia.git
cd chijia
pip install fastapi uvicorn
python backend/app.py                # 默认 http://127.0.0.1:8410
# 可选参数：python backend/app.py --host 127.0.0.1 --port 8410
```

1. 首次启动会在 `backend/data/token.txt` 生成 32 位 hex 的 API Token（控制台同步打印）。
2. 浏览器打开 `http://127.0.0.1:8410`。
3. 进入「⚙️ 设置 → ④ 同步与连接」，把 token 粘贴保存（不配置 token 也可纯本机离线使用，仅 `/api/*` 同步与快照功能不可用）。

建议的月度节奏：**导入流水并应用 → 导出备份 JSON 固化 → 调整计划参数重算**。

## 手机端部署（Tailscale 内网，不出公网）

前提：PC 与手机安装 [Tailscale](https://tailscale.com/) 并登录同一账号。

1. 查 PC 的 Tailscale IP：`tailscale ip -4`（形如 `100.x.y.z`）。
2. 在 PC 上启动后端（二选一）：
   - **方式 A（直接监听）**：`python backend/app.py --host 0.0.0.0`，手机浏览器访问 `http://100.x.y.z:8410`；
   - **方式 B（tailscale serve 反代，自动 HTTPS）**：`tailscale serve --bg 8410`，手机访问 `https://<机器名>.<tailnet>.ts.net`。
3. 手机浏览器打开地址 → 菜单「添加到主屏幕」安装 PWA（图标/名称与桌面一致）。
4. 首次打开进入设置页，录入 `backend/data/token.txt` 中的 token，即可同步与使用快照。

> Tailscale 流量走 WireGuard 加密隧道，服务不暴露公网；换网络也能连（Tailscale 特性）。

## 安全说明

- **鉴权**：除 `GET /api/health` 外，所有 `/api/*` 都要求 `X-Auth-Token` 头；静态页面同源放行（页面本身不含数据）。
- **存储**：服务端数据全部落 `backend/data/`（SQLite `chijia.db`，开 WAL）；浏览器侧账本/持仓在 IndexedDB（库名 `chijia`）。代码与数据分离，删 `backend/data/` 即全量重置（token 会重新生成）。
- **隐私红线**：银行流水 PDF 仅在本机浏览器内用 pdf.js 抽取文本并解析，**原始文件不上传、不落库**；pdf.js 组件首次使用时从公共 CDN 加载（仅为静态脚本请求，不含你的任何数据）。应用本身无遥测、无统计埋点。
- **本仓库不含任何真实数据**：`backend/data/`（token/数据库/本地配置）与内部测试证据均已由 `.gitignore` 排除；克隆后首次启动一切从零生成。

## 数据与备份建议

- **数据从属**：DATA 数据包是账本主数据源（资产/计划/分析快照）；银行流水只更新 2.x 统计与当期余额。
- **备份节奏**：每月导流水并应用后，到「设置 → ① 数据包备份」导出一次备份 JSON；重要操作（换机、大改）前先「📸 创建快照」。
- **自动保护**：应用导入、数据包导入、回滚这三类覆盖型写，前端会自动先建安全快照；快照创建失败会弹窗确认才继续。
- **多设备**：各设备录入同一 token 后点「立即同步」；合并规则为整文档 LWW（`updatedAt` 毫秒大者胜，平局 deviceId 字典序大者胜），删除以墓碑记录同步，不会半途丢失。
- **回滚**：快照回滚 = 前向写入（可再撤销、可同步到对端），回滚前会再自动建一份「回滚前」快照。

## 常见问题

- **离线能用吗？** 能。页面与静态资源由 Service Worker 网络优先 + 缓存兜底；数据写本机 IndexedDB，待发变更在恢复联网后自动补发（`online` 事件触发）。`/api/*` 永不走缓存。
- **改版后界面没变？** SW 已是 network-first 且后端补 `Cache-Control: no-cache`（双向保险），普通刷新即见新版；极端情况强刷一次（Ctrl+F5）或等待 SW 激活（缓存版本随激活清理）。
- **token 忘了/丢了？** 查看 `backend/data/token.txt`；或删除该文件重启后端自动重新生成，再到设置页更新录入。
- **我的数据存在哪？** 浏览器 IndexedDB（库名 `chijia`：kv/outbox/meta）+ `backend/data/chijia.db`。备份即「导出备份 JSON」文件或服务端快照。
- **PDF 解析失败？** 仅支持「文字可复制」的 PDF（扫描件不行）；pdf.js 组件需联网加载一次。可改用「粘贴文本」方式（从 PDF 全选复制粘贴），行格式见 `docs/IMPORT.md`。
- **两台设备改了同一份账本？** 后写者胜（LWW）；删除同步为墓碑。重要修改前先同步一次、并依赖自动快照兜底。
- **全新安装有历史包袱吗？** 无。旧版 sessionStorage 会话键方案已整体废弃，无需任何迁移。

## 仓库结构

```
README.md             本文档（部署 / 安全 / 备份 / FAQ）
docs/                 产品规格：架构、DATA 结构、流水格式与贡献指南、交互红线
backend/
  app.py              FastAPI 入口：token 鉴权、LWW 同步、快照回滚、静态托管
  db.py               SQLite 数据层（WAL）
  data/               运行时数据（token.txt / chijia.db / config.json）——不入库
frontend/
  index.html          壳（六 Tab + iframe 惰性加载）
  plan/analysis/settings/calculator/portfolio.html  五个功能页
  report.html         旧链接重定向存根（→ plan.html）
  app.css             全部样式（深浅双主题/移动端/打印）
  sw.js               PWA Service Worker（network-first，VER 常量）
  manifest.json       PWA 清单
  src/core.js         渲染器 + 计划引擎 + 导入管线 + boot（纯函数库）
  src/data.js         示例账本 DATA
  src/formats.js      流水格式注册表（内置 bocom-personal）
  src/idb.js          IndexedDB 封装（kv/outbox/meta）
  src/sync.js         同步客户端（flush/pull/快照/LWW）
tests/
  api_test.py         43 项 API 回归（纯 stdlib，一键运行）
  功能检测清单.md      65 项人工功能核对表
  sample-bocom.txt    交行流水解析 fixture（虚构数据）
  bugs/               缺陷单档案（历史缺陷与回归记录）
```

## 版本

**v2.0.2**（复检轮微批：BUG-008 首页直达「去调参数/去导入流水」首载时等渲染就绪再滚动到位；BUG-009 清除/保存 token 后快照面板即时重建状态；BUG-010 立即同步的推送/拉取计数合并为一条最终文案；VIS-O-1 计划页 1.2/1.3 表首列 9em 防 CJK 竖排折行；VIS-O-2 分析页空态芯片改「示例账本 · 未导入流水」；1.3「构成」列移动端隐藏。sw.js `VER` / manifest `version` / 各页 `app.css?v=` / app.css 头注释 四处一致）。

**v2.0.1**（v2.0.0 收官化妆批：O-4 工具页同步采纳后重渲染——sync.js 采纳「服务端较新记录」时广播 `sync-applied`，体检页订阅热更新；FFC 横幅「来自「来自计划页」」叠字修复）。

**v2.0.0**（首个完整版本：六 Tab 壳、计划推演、流水导入与分析、FIRE 计算器、组合体检、token 鉴权、LWW 同步、快照回滚、PWA 离线）。
