/**
 * 持家 chijia v2 · idb.js
 * IndexedDB 封装（pm/contract.md §3/§4）。
 *
 * 库：`chijia` v1，三个 store：
 *   kv     — 实体整文档记录，keyPath `entity`
 *            记录形如 { entity, value, updatedAt, deviceId, deleted }
 *   outbox — 待同步队列，keyPath `entity`（整实体 LWW，每实体至多一条待发）
 *   meta   — 键值元数据（deviceId、lastSync 等），keyPath `key`
 *
 * 协议：变更先写 kv + outbox，再由 sync.js flushOutbox() 尝试 /api/sync；
 * 删除 = deleted:true 墓碑，不物理删行（kv 物理删除只用于本模块内部）。
 */

export const DB_NAME = 'chijia';
export const DB_VERSION = 1;

/** @enum {string} */
export const STORES = {
  KV: 'kv',
  OUTBOX: 'outbox',
  META: 'meta',
};

/** @typedef {{entity: string, value: any, updatedAt: number, deviceId: string, deleted: boolean}} KvRecord */

let _dbPromise = /** @type {Promise<IDBDatabase>|null} */ (null);

/**
 * 打开（并按需升级）数据库；Promise 记忆化，重复调用返回同一连接。
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (!_dbPromise) {
    _dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORES.KV)) db.createObjectStore(STORES.KV, { keyPath: 'entity' });
        if (!db.objectStoreNames.contains(STORES.OUTBOX)) db.createObjectStore(STORES.OUTBOX, { keyPath: 'entity' });
        if (!db.objectStoreNames.contains(STORES.META)) db.createObjectStore(STORES.META, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    });
    _dbPromise.catch(() => { _dbPromise = null; });
  }
  return _dbPromise;
}

/**
 * 在单store事务上执行请求并等待完成。
 * @param {IDBObjectStore} store
 * @param {IDBRequest} request
 * @returns {Promise<any>}
 */
function waitRequest(store, request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    store.transaction.onabort = () => reject(store.transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * 读 kv 记录（整条，含 updatedAt/deleted 元数据）。
 * @param {string} entity 'data'|'txns'|'plan'|'settings'|'pf_holdings'
 * @returns {Promise<KvRecord|null>}
 */
export async function kvGet(entity) {
  const db = await openDB();
  const store = db.transaction(STORES.KV, 'readonly').objectStore(STORES.KV);
  const rec = await waitRequest(store, store.get(entity));
  return rec ?? null;
}

/**
 * 取（或生成）本机 deviceId——写入链路的身份兜底（契约 §3 校验 deviceId 非空）。
 * 与 sync.getDeviceId 同格式（32 位 hex）且共用 meta 缓存，两端互通；
 * 全新 profile 首次写入时在此生成，避免空 deviceId 被 /api/sync 400 拒收。
 * @returns {Promise<string>}
 */
async function ensureDeviceId() {
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

/**
 * 写 kv 记录（自动补 updatedAt/deviceId/deleted）。
 * 注意：此函数只写 kv；需入同步队列时调用方应同时 outboxEnqueue 同一内容
 * （或直接用 commitChange 在单事务里同时写两处）。
 * @param {string} entity
 * @param {any} value
 * @param {{updatedAt?: number, deviceId?: string, deleted?: boolean}} [opts]
 * @returns {Promise<KvRecord>} 实际写入的记录
 */
export async function kvPut(entity, value, opts = {}) {
  const db = await openDB();
  const rec = /** @type {KvRecord} */ ({
    entity,
    value: opts.deleted ? null : value,
    updatedAt: opts.updatedAt ?? Date.now(),
    deviceId: opts.deviceId ?? (await ensureDeviceId()),
    deleted: !!opts.deleted,
  });
  const tx = db.transaction(STORES.KV, 'readwrite');
  await waitRequest(tx.objectStore(STORES.KV), tx.objectStore(STORES.KV).put(rec));
  return rec;
}

/**
 * 墓碑删除：写入 deleted:true 记录（同步协议要求，不物理删行）。
 * @param {string} entity
 * @param {{updatedAt?: number, deviceId?: string}} [opts]
 * @returns {Promise<KvRecord>}
 */
export async function kvDelete(entity, opts = {}) {
  return kvPut(entity, null, { ...opts, deleted: true });
}

/**
 * outbox 入队（变更先写 kv+outbox 再 flush，此为队列侧）。
 * @param {{entity: string, value?: any, updatedAt?: number, deviceId?: string, deleted?: boolean}} change
 * @returns {Promise<KvRecord>} 入队的完整记录
 */
export async function outboxEnqueue(change) {
  const db = await openDB();
  const rec = /** @type {KvRecord} */ ({
    entity: change.entity,
    value: change.deleted ? null : change.value,
    updatedAt: change.updatedAt ?? Date.now(),
    deviceId: change.deviceId ?? (await ensureDeviceId()),
    deleted: !!change.deleted,
  });
  const tx = db.transaction(STORES.OUTBOX, 'readwrite');
  await waitRequest(tx.objectStore(STORES.OUTBOX), tx.objectStore(STORES.OUTBOX).put(rec));
  return rec;
}

/**
 * 变更提交（推荐入口）：单事务同时写 kv + outbox（协议「先写 kv+outbox 再 flush」）。
 * @param {string} entity 'data'|'txns'|'plan'|'settings'|'pf_holdings'
 * @param {any} value
 * @param {{updatedAt?: number, deviceId?: string, deleted?: boolean}} [opts]
 * @returns {Promise<KvRecord>} 写入的完整记录
 */
export async function commitChange(entity, value, opts = {}) {
  const db = await openDB();
  const rec = /** @type {KvRecord} */ ({
    entity,
    value: opts.deleted ? null : value,
    updatedAt: opts.updatedAt ?? Date.now(),
    deviceId: opts.deviceId ?? (await ensureDeviceId()),
    deleted: !!opts.deleted,
  });
  const tx = db.transaction([STORES.KV, STORES.OUTBOX], 'readwrite');
  await waitRequest(tx.objectStore(STORES.KV), tx.objectStore(STORES.KV).put(rec));
  void tx.objectStore(STORES.OUTBOX).put(rec); // 同一事务，随 kv 一起提交
  return rec;
}

/**
 * 读单条 outbox 槽位（F-2：flushOutbox 清队前重读当前槽位，
 * 判定「推送期间是否被本地新编辑替换」）。
 * @param {string} entity
 * @returns {Promise<KvRecord|null>} 无待发项返回 null
 */
export async function outboxGet(entity) {
  const db = await openDB();
  const tx = db.transaction(STORES.OUTBOX, 'readonly');
  const rec = await waitRequest(tx.objectStore(STORES.OUTBOX), tx.objectStore(STORES.OUTBOX).get(entity));
  return rec ?? null;
}

/**
 * 列出全部待同步变更（LWW 整实体，每实体至多一条）。
 * @returns {Promise<KvRecord[]>}
 */
export async function outboxList() {
  const db = await openDB();
  const tx = db.transaction(STORES.OUTBOX, 'readonly');
  const all = await waitRequest(tx.objectStore(STORES.OUTBOX), tx.objectStore(STORES.OUTBOX).getAll());
  return /** @type {KvRecord[]} */ (all ?? []);
}

/**
 * 清除单条 outbox 项（flush 成功或服务端较新覆盖后调用）。
 * @param {string} entity
 * @returns {Promise<void>}
 */
export async function outboxRemove(entity) {
  const db = await openDB();
  const tx = db.transaction(STORES.OUTBOX, 'readwrite');
  await waitRequest(tx.objectStore(STORES.OUTBOX), tx.objectStore(STORES.OUTBOX).delete(entity));
}

/**
 * 清空 outbox（慎用；仅全量重建场景）。
 * @returns {Promise<void>}
 */
export async function outboxClear() {
  const db = await openDB();
  const tx = db.transaction(STORES.OUTBOX, 'readwrite');
  await waitRequest(tx.objectStore(STORES.OUTBOX), tx.objectStore(STORES.OUTBOX).clear());
}

/**
 * 读 meta 键值。
 * @param {string} key
 * @returns {Promise<any>} 不存在时返回 null
 */
export async function metaGet(key) {
  const db = await openDB();
  const tx = db.transaction(STORES.META, 'readonly');
  const rec = await waitRequest(tx.objectStore(STORES.META), tx.objectStore(STORES.META).get(key));
  return rec ? rec.value : null;
}

/**
 * 写 meta 键值。
 * @param {string} key
 * @param {any} value
 * @returns {Promise<void>}
 */
export async function metaPut(key, value) {
  const db = await openDB();
  const tx = db.transaction(STORES.META, 'readwrite');
  await waitRequest(tx.objectStore(STORES.META), tx.objectStore(STORES.META).put({ key, value }));
}
