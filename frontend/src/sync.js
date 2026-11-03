/**
 * 持家 chijia v2 · sync.js
 * 同步客户端（pm/contract.md §2/§3/§4）。
 *
 * - outbox flush：POST /api/sync 批量推变更，LWW 写回服务端较新者，
 *   幂等清 outbox（D12：响应含请求中每个实体的合并后权威记录）
 * - 拉取合并：GET /api/state 按 D15 响应结构做 LWW 拉取合并
 *   （服务端较新 → 覆盖本地 kv 并清对应 outbox）
 * - 快照：列表 / 创建 / 回滚调用
 * - deviceId：crypto 生成 32 位 hex，缓存于 idb meta
 * - 鉴权：除 /api/health 外全部带 X-Auth-Token；token 由用户在设置页录入
 *   （P1），本地存 localStorage `chijia_auth_token`
 * - installAutoSync：挂 window `online` 事件自动重试 flush（幂等，boot 调用）
 * - 采纳广播（O-4）：pullState/flushOutbox 采纳「服务端较新记录」（含墓碑）后，
 *   经 BroadcastChannel 'chijia'（type:'sync-applied'，跨 iframe/跨 Tab）+
 *   window CustomEvent 'chijia:applied'（本页）广播变更实体；隐藏中的工具页
 *   iframe（体检页）据此重渲染——与 BUG-005/D27 设置页事件订阅同族
 */

import { commitChange, kvGet, kvPut, metaGet, metaPut, outboxGet, outboxList, outboxRemove } from './idb.js';

/** localStorage 键：后端 X-Auth-Token（首启生成于 backend/data/token.txt） */
const AUTH_STORAGE_KEY = 'chijia_auth_token';

/** @typedef {{entity: string, value: any, updatedAt: number, deviceId: string, deleted?: boolean}} SyncChange */

/* ---------------------------------- 鉴权 ---------------------------------- */

/**
 * 读当前鉴权 token；未设置返回 null。
 * @returns {string|null}
 */
export function getAuthToken() {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * 保存鉴权 token（设置页 P1 提供录入 UI）。
 * @param {string} token 32 位 hex
 */
export function setAuthToken(token) {
  try {
    if (token) localStorage.setItem(AUTH_STORAGE_KEY, token.trim());
    else localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch { /* 隐私模式等场景静默失败 */ }
}

/* --------------------------------- deviceId -------------------------------- */

/**
 * 取设备 ID（32 位 hex）；无则生成并缓存到 idb meta。
 * @returns {Promise<string>}
 */
export async function getDeviceId() {
  const existing = await metaGet('deviceId');
  if (existing) return existing;
  let id = '';
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    id = crypto.randomUUID().replace(/-/g, '');
  } else {
    const hex = '0123456789abcdef';
    for (let i = 0; i < 32; i++) id += hex[Math.floor(Math.random() * 16)];
  }
  await metaPut('deviceId', id);
  return id;
}

/* --------------------------------- API 调用 -------------------------------- */

/**
 * 统一 API fetch：自动带 X-Auth-Token 与 JSON 头；
 * 非 2xx 抛 Error（附 code/status，错误体形如 {error:{code,message}}）。
 * @param {string} path 以 / 开头的 API 路径
 * @param {{method?: string, body?: string, headers?: Record<string, string>}} [opts]
 * @returns {Promise<any>} 服务端 JSON
 */
export async function apiFetch(path, opts = {}) {
  const token = getAuthToken();
  let res;
  try {
    res = await fetch(path, {
      method: opts.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-Auth-Token': token } : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body,
    });
  } catch (e) {
    throw Object.assign(new Error('网络不可达：' + (e?.message ?? e)), { code: 'NETWORK', status: 0 });
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = json?.error ?? { code: res.status, message: res.statusText };
    throw Object.assign(new Error(err.message ?? 'API 错误'), { code: err.code, status: res.status });
  }
  return json;
}

/* ------------------------------- flush / 拉取 ------------------------------ */

/** LWW 比较：a 是否严格新于 b（毫秒大者胜；平局 deviceId 字典序大者胜，契约 §3） */
function newerThan(a, b) {
  if (!b) return true;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return String(a.deviceId ?? '') > String(b.deviceId ?? '');
}

/**
 * 广播「服务端较新记录已写入本机 kv」（O-4：含墓碑采纳）。
 * 通道组合与 applyImport/data-changed 同构：BroadcastChannel 'chijia'
 * （跨 iframe/跨 Tab；壳内隐藏工具页 iframe 唯一可达的通道）+
 * window CustomEvent 'chijia:applied'（本页同窗口订阅）。
 * detail: { entities: string[] }；无采纳时不出声（正常推送到服务端不广播）。
 * @param {string[]} entities 本轮真正覆盖本地 kv 的实体名
 * @returns {void}
 */
function notifyApplied(entities) {
  if (!Array.isArray(entities) || !entities.length) return;
  const list = [...entities];
  try {
    const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('chijia') : null;
    ch?.postMessage({ type: 'sync-applied', entities: list });
    ch?.close();
  } catch { /* 广播失败不影响同步结果 */ }
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('chijia:applied', { detail: { entities: list } }));
    }
  } catch { /* 非浏览器环境忽略 */ }
}

/**
 * flush outbox：POST /api/sync 推送全部待发变更（D12 幂等清队列）。
 * - 响应 changes 含请求中每个实体的「合并后权威记录」（含未变更者）；
 * - 权威记录较本地 kv 新 → 写回本地 kv（败写回执后本地采纳权威值，BUG-004③）；
 * - 清队（F-2/BUG-004②，A0 修正处方）：清队前**重读当前 outbox 槽位**
 *   （而非 POST 前快照），仅当「当前槽位不新于权威回执」才删——
 *   回执==所推变更（服务端采纳，最常见）→ 同一身份 → 清；
 *   在途窗口内槽位被本地新编辑替换（槽位较权威新）→ 保留待发，下次重推。
 * 后端未就绪/离线时由 apiFetch 抛网络错误，调用方自行捕获。
 * @returns {Promise<{pushed: number, serverNewer: number}>}
 */
export async function flushOutbox() {
  const changes = /** @type {SyncChange[]} */ (await outboxList());
  if (!changes.length) return { pushed: 0, serverNewer: 0 };

  const res = await apiFetch('/api/sync', {
    method: 'POST',
    body: JSON.stringify({ changes }),
  });

  const authority = /** @type {SyncChange[]} */ (Array.isArray(res?.changes) ? res.changes : []);
  let serverNewer = 0;
  /** @type {string[]} */
  const appliedEntities = []; // O-4：败写回执被采纳的实体（含墓碑），广播给工具页重渲染
  for (const ch of authority) {
    const local = await kvGet(ch.entity);
    if (newerThan(ch, local)) {
      await kvPut(ch.entity, ch.value, {
        updatedAt: ch.updatedAt,
        deviceId: ch.deviceId,
        deleted: !!ch.deleted,
      });
      serverNewer += 1;
      appliedEntities.push(ch.entity);
    }
    // F-2：重读当前槽位；「不新于权威」才清（相等=服务端采纳本次推送；
    // 槽位较权威新=推送期间本地又编辑，保留重发）。
    const cur = await outboxGet(ch.entity);
    if (!cur || !newerThan(cur, ch)) await outboxRemove(ch.entity);
  }
  notifyApplied(appliedEntities);

  return { pushed: changes.length, serverNewer };
}

/**
 * 拉取合并：GET /api/state 全量状态（D15 + D29 修订形状）。
 * `entities` 每实体为 `{value,updatedAt,deviceId,deleted}|null`：
 * - 存活记录（deleted:false）较本地新（LWW）→ kvPut 覆盖本地并清对应 outbox 项；
 * - **墓碑记录（deleted:true，value:null，D29）较本地新 → 本地 kv 置墓碑、
 *   清对应 outbox 项（对端删除生效；UI 由渲染层回空态/示例回退）**；
 * - `null` 仅表示服务端从未写入 → 不动本地（防御式兼容 D29 部署时差的旧形状）。
 * @returns {Promise<{serverTime: number, applied: string[], entities: string[]}>}
 */
export async function pullState() {
  const res = await apiFetch('/api/state');
  const entities = /** @type {Record<string, any>|null} */ (res?.entities ?? null);
  if (!entities || typeof entities !== 'object') {
    throw Object.assign(new Error('/api/state 响应缺少 entities 字段'), { code: 'BAD_STATE_RESPONSE' });
  }

  /** @type {string[]} */
  const applied = [];
  for (const [entity, rec] of Object.entries(entities)) {
    if (rec == null) continue; // D29：null 仅=从未写入；旧后端删除形状亦为 null → 保留本地
    if (typeof rec !== 'object') continue; // 防御：异常形状不采纳
    const server = {
      entity,
      value: rec.value,
      updatedAt: Number(rec.updatedAt) || 0,
      deviceId: String(rec.deviceId ?? ''),
      deleted: !!rec.deleted,
    };
    const local = await kvGet(entity);
    if (!newerThan(server, local)) continue; // 本地较新或相等：保留本地（前向写不复活）
    // 墓碑与存活统一走 kvPut：deleted:true → 本地记录 {value:null, deleted:true}（D23 形状）
    await kvPut(entity, server.value, {
      updatedAt: server.updatedAt,
      deviceId: server.deviceId,
      deleted: server.deleted,
    });
    await outboxRemove(entity); // 服务端较新：本地待发项已被覆盖，清除
    applied.push(entity);
  }

  try {
    await metaPut('lastSync', Number(res.serverTime) || Date.now());
  } catch { /* meta 写失败不影响合并结果 */ }
  notifyApplied(applied); // O-4：服务端较新（含墓碑）已采纳，广播实体名供工具页重渲染
  return { serverTime: Number(res.serverTime) || 0, applied, entities: Object.keys(entities) };
}

/* ------------------------- online 事件自动重试 ------------------------- */

let _autoSyncInstalled = false;

/**
 * 挂 window `online` 事件自动重试 flushOutbox（幂等；boot 调用一次）。
 * 附带 `chijia:sync` 事件反馈（detail: {pushed, serverNewer} 或 {error}）。
 * @returns {void}
 */
export function installAutoSync() {
  if (_autoSyncInstalled || typeof window === 'undefined') return;
  _autoSyncInstalled = true;
  window.addEventListener('online', () => {
    flushOutbox()
      .then((r) => {
        try {
          window.dispatchEvent(new CustomEvent('chijia:sync', { detail: r }));
        } catch { /* 忽略 */ }
      })
      .catch((e) => {
        try {
          window.dispatchEvent(new CustomEvent('chijia:sync', { detail: { error: String(e?.message ?? e) } }));
        } catch { /* 忽略 */ }
      });
  });
}

/* ---------------------------------- 快照 ---------------------------------- */

/**
 * 快照列表。
 * @returns {Promise<Array<{id: number, createdAt: number, label: string, size: number}>>}
 */
export async function fetchSnapshots() {
  return apiFetch('/api/snapshots');
}

/**
 * 创建快照。
 * @param {string} label
 * @returns {Promise<any>}
 */
export async function createSnapshot(label) {
  return apiFetch('/api/snapshots', { method: 'POST', body: JSON.stringify({ label }) });
}

/**
 * 覆盖型写保护（BUG-002/D17 修订）：写前自动创建快照；
 * 快照创建失败时经 confirmLoss 询问用户，未确认即抛错中止覆盖型写（禁止静默跳过）。
 * @param {string} label 快照标签
 * @param {{confirmLoss?: (err: Error) => (boolean|Promise<boolean>)}} [opts]
 * @returns {Promise<{created: boolean, confirmedWithoutSnapshot: boolean}>}
 */
export async function ensureSafetySnapshot(label, opts = {}) {
  try {
    await createSnapshot(label);
    return { created: true, confirmedWithoutSnapshot: false };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (typeof opts.confirmLoss === 'function') {
      const ok = await opts.confirmLoss(err);
      if (ok) return { created: false, confirmedWithoutSnapshot: true };
    }
    throw Object.assign(new Error(`自动快照创建失败（${err.message}），已中止覆盖型写`), {
      code: 'SAFETY_SNAPSHOT_FAILED',
      cause: err,
    });
  }
}

/**
 * 回滚（D17 修订·四步协议）：flushOutbox（保住未同步的本地改动）→
 * 自动创建安全快照（覆盖型写保护，失败需 confirm）→ restore → pullState 收敛。
 * 任一步失败即中止并抛错（调用方弹窗说明——UX-SPEC 错误态）。
 * @param {number|string} id 快照 ID
 * @param {{confirmLoss?: (err: Error) => (boolean|Promise<boolean>)}} [opts] 快照失败确认钩子
 * @returns {Promise<{restore: any, pulled: {serverTime: number, applied: string[], entities: string[]}, safetySnapshot: {created: boolean, confirmedWithoutSnapshot: boolean}}>}
 */
export async function restoreSnapshot(id, opts = {}) {
  await flushOutbox(); // 第一步：先推净本地滞留改动，避免 restore 后被旧 outbox 覆盖墓碑
  // 第二步（D17 修订）：覆盖型写保护——restore 会前向覆盖服务端现状
  const safetySnapshot = await ensureSafetySnapshot(`自动快照 · 回滚前 ${new Date().toLocaleString('zh-CN')}`, opts);
  const restore = await apiFetch(`/api/snapshots/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    body: JSON.stringify({}),
  }); // 第三步：快照内容以新 updatedAt 前向写回（可再撤销、可同步到对端）
  const pulled = await pullState(); // 第四步：拉取合并收敛（restore 产生的新变更覆盖本地）
  return { restore, pulled, safetySnapshot };
}

/**
 * 删除实体（D23 删除口径）：墓碑 = {value:null, deleted:true, updatedAt, deviceId}，
 * 先写 kv+outbox 再尝试 flush；失败静默留待 online 重试。
 * @param {string} entity 'data'|'txns'|'plan'|'settings'|'pf_holdings'
 * @returns {Promise<void>}
 */
export async function removeEntity(entity) {
  await commitChange(entity, null, { deleted: true });
  try {
    await flushOutbox();
  } catch {
    /* 离线：留待 online 事件或下次 flush 重试 */
  }
}
