/* Transparent portal storage adapter used only after an isolated restore is activated. */
(() => {
  'use strict';
  const nativeStorage = window.localStorage;
  const nativeOpen = indexedDB.open.bind(indexedDB);
  const nativeDatabases = typeof indexedDB.databases === 'function' ? indexedDB.databases.bind(indexedDB) : null;
  const pointerKey = '__nitros_backup_active_dataset';
  const generation = nativeStorage.getItem(pointerKey) || '';
  const presence = typeof BroadcastChannel === 'function' ? new BroadcastChannel('nitros-backup-presence') : null;
  const pageId = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const pageRole = location.pathname.startsWith('/backup/') ? 'backup' : 'portal';
  if (presence) presence.onmessage = event => {
    if (event.data?.type === 'probe' && event.data.id) presence.postMessage({ type: 'present', probe: event.data.id, pageId, role: pageRole });
  };
  if (generation && !/^[a-f0-9-]{36}$/i.test(generation)) {
    window.NitrosBackupStorageError = 'The active recovery pointer is invalid. Portal storage remains in native mode.';
    return;
  }
  const prefix = generation ? `__nitros_backup_${generation}:` : '';
  const databaseNames = ['NitrosRepairOrders', 'nitros_photo_evidence_v1'];
  const relevant = key => key === 'activeRepairOrderId' || /^nitros[_-]/i.test(String(key));
  if (!generation) {
    window.NitrosBackupStorage = Object.freeze({ nativeStorage, nativeOpen, nativeDatabases, pointerKey, generation, prefix, databaseNames, relevant, pageId, pageRole });
    return;
  }
  const physicalKey = key => generation && relevant(key) ? prefix + key : String(key);
  const assertActive = () => {
    if (nativeStorage.getItem(pointerKey) !== generation) throw new Error('Restored storage changed. Reload the portal before writing.');
  };
  function visibleKeys() {
    const result = [];
    for (let i = 0; i < nativeStorage.length; i++) {
      const key = nativeStorage.key(i);
      if (key === pointerKey || key.startsWith('__nitros_backup_')) continue;
      if (generation && relevant(key)) continue;
      result.push(key);
    }
    if (generation) {
      for (let i = 0; i < nativeStorage.length; i++) {
        const physical = nativeStorage.key(i);
        if (physical.startsWith(prefix)) result.push(physical.slice(prefix.length));
      }
    }
    return result;
  }
  const storage = Object.create(null);
  Object.defineProperties(storage, {
    length: { configurable: true, enumerable: false, get: () => visibleKeys().length },
    key: { configurable: true, enumerable: false, value: index => visibleKeys()[index] ?? null },
    getItem: { configurable: true, enumerable: false, value: key => nativeStorage.getItem(physicalKey(key)) },
    setItem: { configurable: true, enumerable: false, value: (key, value) => { if (generation && relevant(key)) assertActive(); nativeStorage.setItem(physicalKey(key), String(value)); } },
    removeItem: { configurable: true, enumerable: false, value: key => { if (generation && relevant(key)) assertActive(); nativeStorage.removeItem(physicalKey(key)); } },
    clear: { configurable: true, enumerable: false, value: () => {
      if (generation) throw new Error('Bulk storage clearing is disabled for an activated recovery dataset.');
      nativeStorage.clear();
    } },
  });
  const storageProxy = new Proxy(storage, {
    ownKeys: () => visibleKeys(),
    getOwnPropertyDescriptor: (target, key) => visibleKeys().includes(key) ? { configurable: true, enumerable: true, writable: false, value: nativeStorage.getItem(physicalKey(key)) } : Reflect.getOwnPropertyDescriptor(target, key),
    get: (target, key, receiver) => typeof key === 'string' && visibleKeys().includes(key) ? nativeStorage.getItem(physicalKey(key)) : Reflect.get(target, key, receiver),
    set: (target, key, value) => { if (typeof key !== 'string') return false; if (generation && relevant(key)) assertActive(); nativeStorage.setItem(physicalKey(key), String(value)); return true; },
    deleteProperty: (target, key) => { if (generation && relevant(key)) assertActive(); nativeStorage.removeItem(physicalKey(key)); return true; },
  });
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storageProxy });

  indexedDB.open = (name, version) => {
    const physical = generation && databaseNames.includes(String(name)) ? prefix + name : name;
    if (generation && databaseNames.includes(String(name))) assertActive();
    return version === undefined ? nativeOpen(physical) : nativeOpen(physical, version);
  };
  if (nativeDatabases) indexedDB.databases = async () => {
    const list = await nativeDatabases();
    if (!generation) return list;
    const mapped = list.filter(db => !databaseNames.includes(db.name) && !db.name.startsWith('__nitros_backup_'));
    for (const db of list) if (db.name.startsWith(prefix)) mapped.push({ ...db, name: db.name.slice(prefix.length) });
    return mapped;
  };
  window.NitrosBackupStorage = Object.freeze({ nativeStorage, nativeOpen, nativeDatabases, pointerKey, generation, prefix, databaseNames, relevant, pageId, pageRole });
})();
