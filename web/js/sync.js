/* chijia v3 · 可选后端同步
   后端可达（/api/health）才启用：整文档 LWW 存到 v2 后端的 data 实体，
   快照沿用后端的五实体严格还原。零后端时应用完全可用。 */
window.CJ = window.CJ || {};
(function (CJ) {
  'use strict';
  const TOKEN_KEY = 'chijia_v3_token';
  const ENTITY = 'data';
  let timer = null;
  const api = { available: false, probing: null, lastError: '', lastSync: null };

  api.getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
  api.setToken = t => { try { localStorage.setItem(TOKEN_KEY, String(t || '').trim()); } catch (e) {} };

  function req(path, opts) {
    const o = Object.assign({ method: 'GET' }, opts || {});
    o.headers = Object.assign({ 'X-Auth-Token': api.getToken() }, o.headers || {});
    if (o.body && typeof o.body !== 'string') { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); }
    return fetch(path, o).then(async r => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && (j.error.message || j.error.code)) || ('HTTP ' + r.status));
      return j;
    });
  }

  api.probe = function () {
    if (api.probing) return api.probing;
    api.probing = fetch('api/health', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('health')))
      .then(j => { api.available = !!j.ok; api.probing = null; return api.available; })
      .catch(() => { api.available = false; api.probing = null; return false; });
    return api.probing;
  };

  /* 拉取：服务端较新则采纳（LWW：updatedAt 大者胜，平局 deviceId 字典序大者胜） */
  api.pull = function () {
    if (!api.available) return Promise.resolve({ applied: false, reason: 'offline' });
    return req('api/state').then(j => {
      const rec = j.entities && j.entities[ENTITY];
      if (!rec || rec.deleted || !rec.value) return { applied: false, reason: 'empty' };
      const cur = CJ.store.state;
      const wins = rec.updatedAt > (cur.serverAt || 0) ||
        (rec.updatedAt === (cur.serverAt || 0) && (rec.deviceId || '') > (cur.serverDeviceId || ''));
      if (!wins) return { applied: false, reason: 'local-newer' };
      const next = CJ.data.normalize({ state: Object.assign({}, rec.value, { version: 3 }) });
      next.serverAt = rec.updatedAt; next.serverDeviceId = rec.deviceId;
      /* 保留本机设备标识，避免多设备互相覆盖 deviceId */
      next.deviceId = cur.deviceId;
      CJ.store.replace(next, { reason: 'sync-pull' });
      api.lastSync = Date.now();
      return { applied: true, at: rec.updatedAt };
    });
  };

  api.push = function () {
    if (!api.available) return Promise.resolve({ ok: false, reason: 'offline' });
    if (!api.getToken()) return Promise.reject(new Error('未配置 API Token'));
    const s = CJ.store.state;
    return req('api/sync', {
      method: 'POST',
      body: { changes: [{ entity: ENTITY, value: s, updatedAt: s.updatedAt, deviceId: s.deviceId }] }
    }).then(j => {
      const c = (j.changes || [])[0];
      if (c) CJ.store.commit(st => { st.serverAt = c.updatedAt; st.serverDeviceId = c.deviceId; }, { reason: 'sync-push', silent: true });
      api.lastSync = Date.now();
      return { ok: true, at: c && c.updatedAt };
    });
  };

  api.sync = function () {
    return api.pull().then(p => api.push().then(u => ({ pulled: p.applied, pushed: u.ok })));
  };
  api.schedule = function () {
    if (!api.available) return;
    clearTimeout(timer);
    timer = setTimeout(() => { api.push().catch(e => { api.lastError = e.message; }); }, 1200);
  };
  api.snapshots = () => req('api/snapshots');
  api.createSnapshot = label => req('api/snapshots', { method: 'POST', body: { label: label || '手动快照' } });
  api.restore = id => req('api/snapshots/' + encodeURIComponent(id) + '/restore', { method: 'POST' })
    .then(j => api.pull().then(() => j));

  CJ.sync = api;
})(window.CJ);
