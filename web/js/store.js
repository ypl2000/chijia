/* chijia v3 · 本地状态容器
   IndexedDB 为主存储，localStorage 同步镜像保证首屏零延迟 / file:// 可用；
   任何写操作走 commit()，统一打时间戳、落盘、广播（无 iframe，一套订阅即可）。 */
window.CJ = window.CJ || {};
(function (CJ) {
  'use strict';
  const LS = 'chijia_v3_state';
  const DB = 'chijia_v3';
  const STORE = 'kv';
  let dbp = null;
  const subs = [];
  const api = { state: null, ready: false, idbOk: false };

  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('no-idb'));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(e => { console.warn('[chijia] IndexedDB 不可用，使用 localStorage', e); return null; });
    return dbp;
  }
  function idbGet() {
    return openDB().then(d => {
      if (!d) return null;
      return new Promise((res, rej) => {
        const q = d.transaction(STORE, 'readonly').objectStore(STORE).get('state');
        q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error);
      });
    }).catch(() => null);
  }
  function idbSet(v) {
    return openDB().then(d => {
      if (!d) return false;
      return new Promise((res) => {
        const t = d.transaction(STORE, 'readwrite');
        t.objectStore(STORE).put(v, 'state');
        t.oncomplete = () => res(true); t.onerror = () => res(false);
      });
    }).catch(() => false);
  }
  function lsGet() { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { return null; } }
  function lsSet(v) { try { localStorage.setItem(LS, JSON.stringify(v)); return true; } catch (e) { return false; } }

  function notify(reason) { subs.forEach(fn => { try { fn(api.state, reason); } catch (e) { console.error(e); } }); }

  api.init = function () {
    api.state = lsGet() || CJ.data.defaultState();
    if (!api.state.version) api.state = CJ.data.defaultState();
    api.ready = true;
    notify('init');
    return idbGet().then(rec => {
      api.idbOk = !!rec || true;
      if (rec && rec.value && rec.value.updatedAt > (api.state.updatedAt || 0)) {
        api.state = rec.value; lsSet(api.state); notify('idb-newer');
      }
    });
  };
  api.subscribe = fn => { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; };

  /* commit(mutator, {reason, silent}) —— mutator 直接改 state（单一可变对象） */
  api.commit = function (mutator, opts) {
    opts = opts || {};
    if (typeof mutator === 'function') mutator(api.state);
    api.state.updatedAt = Date.now();
    lsSet(api.state);
    idbSet({ value: api.state, updatedAt: api.state.updatedAt });
    if (!opts.silent) notify(opts.reason || 'change');
    if (opts.reason !== 'sync-pull' && CJ.sync && CJ.sync.available && api.state.settings.autoSync !== false) CJ.sync.schedule();
    return api.state;
  };
  api.replace = function (next, opts) {
    api.state = next; api.state.updatedAt = Date.now();
    lsSet(api.state); idbSet({ value: api.state, updatedAt: api.state.updatedAt });
    notify((opts && opts.reason) || 'replace');
  };
  api.reset = function () { api.replace(CJ.data.defaultState(), { reason: 'reset' }); };
  api.exportJson = function () {
    return {
      app: 'chijia', version: 3, exportedAt: new Date().toISOString(),
      state: api.state
    };
  };
  api.importJson = function (raw) {
    api.replace(CJ.data.normalize(raw), { reason: 'import' });
    return api.state;
  };
  api.log = function (text) {
    api.commit(s => {
      s.activity = s.activity || [];
      s.activity.unshift({ t: Date.now(), text });
      s.activity = s.activity.slice(0, 20);
    }, { reason: 'activity', silent: true });
  };
  CJ.store = api;
})(window.CJ);
