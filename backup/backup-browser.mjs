import { SCHEMAS, createPackage, validatePackage, hash, relevantKey } from './backup-core.mjs';
import { readShopAccountId, assertPackageShopAccount } from './shop-identity.mjs';
import { driveConfig, PRODUCTION_ORIGIN } from './drive-config.mjs';

export function assertBackupOrigin(origin,config=driveConfig){
  let parsed;try{parsed=new URL(origin);}catch{throw new Error('Backup is unavailable on this origin. Configure this exact staging origin before using staging backup or recovery.');}
  const localOrigin=['127.0.0.1','localhost'].includes(parsed.hostname.toLowerCase());
  const configuredStaging=config.backupNamespace==='staging'&&config.approvedOrigins.includes(origin);
  if(origin!==PRODUCTION_ORIGIN&&!localOrigin&&!configuredStaging)throw new Error('Backup is unavailable on this origin. Configure this exact staging origin before using staging backup or recovery.');
  return true;
}
const env = () => {
  if (!window.NitrosBackupStorage || window.NitrosBackupStorageError) throw new Error(window.NitrosBackupStorageError || 'Portal backup storage adapter is unavailable');
  assertBackupOrigin(location.origin);
  return window.NitrosBackupStorage;
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const requestResult = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const transactionDone = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error('Storage write failed')); tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted')); });
function openExisting(open, name, version) {
  return new Promise((resolve, reject) => {
    const req = version === undefined ? open(name) : open(name, version);
    req.onupgradeneeded = () => { req.transaction.abort(); reject(new Error('Database changed during inventory')); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Close other staging pages before continuing'));
  });
}
function inspectSchema(db, schema) {
  assert(db.version === schema.version && db.objectStoreNames.length === 1 && db.objectStoreNames.contains(schema.store), 'Unknown database version or object store: ' + schema.name);
  const store = db.transaction(schema.store, 'readonly').objectStore(schema.store);
  const indexes = [...store.indexNames].map(name => { const i = store.index(name); return { name, keyPath: i.keyPath, unique: i.unique, multiEntry: i.multiEntry }; });
  assert(store.keyPath === schema.keyPath && !store.autoIncrement && JSON.stringify(indexes) === JSON.stringify(schema.indexes), 'Database schema differs from audited schema: ' + schema.name);
}
async function readSnapshot({ generation = undefined } = {}) {
  const e = env(), explicit = generation !== undefined;
  const prefix = generation ? `__nitros_backup_${generation}:` : '';
  const storage = explicit ? e.nativeStorage : window.localStorage;
  const list = explicit ? await e.nativeDatabases() : await indexedDB.databases();
  const open = explicit ? e.nativeOpen : indexedDB.open.bind(indexedDB);
  const localStorage = [];
  for (let i = 0; i < storage.length; i++) {
    const physical = storage.key(i);
    if (explicit && prefix && !physical.startsWith(prefix)) continue;
    const key = prefix ? physical.slice(prefix.length) : physical;
    if (relevantKey(key)) localStorage.push({ key, value: storage.getItem(physical) });
  }
  const expected = SCHEMAS.map(s => prefix + s.name);
  const backupMetadataDatabases = new Set(['NitrosEncryptedBackupVault']);
  const unknown = list.filter(d => /nitros/i.test(d.name) && !d.name.startsWith('__nitros_backup_') && !backupMetadataDatabases.has(d.name) && !SCHEMAS.some(s => s.name === d.name));
  assert(unknown.length === 0, 'Unrecognized Nitros database; extend inventory before exporting');
  const databases = [];
  for (const schema of SCHEMAS) {
    const name = prefix + schema.name;
    let records = [];
    if (list.some(d => d.name === name)) {
      const db = await openExisting(open, name);
      try { inspectSchema(db, schema); records = await requestResult(db.transaction(schema.store, 'readonly').objectStore(schema.store).getAll()); }
      finally { db.close(); }
    }
    databases.push({ ...schema, records });
  }
  return { localStorage, databases };
}
function dataPart(envelope) {
  const { localStorage, databases, binaries } = envelope.payload;
  return { localStorage, databases, binaries };
}
async function digestData(envelope) { return hash(JSON.stringify(dataPart(envelope))); }
async function exclusive(action) {
  assert(navigator.locks, 'This browser does not support safe cross-tab backup locking');
  return navigator.locks.request('nitros-backup-operation', { ifAvailable: true }, lock => {
    assert(lock, 'Another backup operation is running'); return action();
  });
}
export function workerPackage(data, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Backup deferred because work resumed', 'AbortError')); return; }
    const worker = new Worker('/backup/backup-worker.mjs', { type: 'module' });
    const finish = (error, value) => { worker.terminate(); signal?.removeEventListener('abort', abort); clearTimeout(timer); error ? reject(error) : resolve(value); };
    const abort = () => finish(new DOMException('Backup deferred because work resumed', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Backup validation timed out')), 120000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => event.data.ok ? finish(null, event.data) : finish(new Error(event.data.error));
    worker.onerror = () => finish(new Error('Backup worker failed'));
    worker.postMessage(data);
  });
}
export async function exportVerifiedBackup({ signal } = {}) {
  return exclusive(async () => {
    await requireOnlyPage({ allowPortal: true });
    const source = { origin: location.origin, build: window.NitrosBuild?.version || 'unknown', scope: 'persisted-device-data', staging: driveConfig.backupNamespace==='staging', shopAccountPermissionId: readShopAccountId(env().nativeStorage) };
    // Two complete byte-aware reads detect an ordinary concurrent save. No source writes.
    const first = await workerPackage({ snapshot: await readSnapshot(), source }, signal);
    const second = await workerPackage({ snapshot: await readSnapshot(), source, includeEnvelope: false }, signal);
    assert(first.dataHash === second.dataHash, 'Data changed during export. Wait for saves to finish and retry.');
    return first;
  });
}
export async function exportBackup() { return (await exportVerifiedBackup()).envelope; }
// Read-only post-restore evidence. Returns counts/digests only; never returns record
// contents, keys, tokens, or mutates the active storage generation.
export async function auditActiveDataset(expectedEnvelope = null) {
  return exclusive(async () => {
    await requireOnlyPage();
    const e = env(), generation = e.nativeStorage.getItem(e.pointerKey);
    assert(generation && /^[a-f0-9-]{36}$/i.test(generation), 'No active restored dataset');
    const snapshot = await readSnapshot();
    const actual = await createPackage(snapshot);
    const checked = await validatePackage(actual);
    const dataHash = await digestData(actual);
    let matchesExpected = null;
    if (expectedEnvelope) {
      const expected = await validatePackage(expectedEnvelope);
      matchesExpected = await digestData(expected.envelope) === dataHash;
    }
    return Object.freeze({
      generation,
      dataHash,
      matchesExpected,
      ...checked.summary,
      duplicateIds: 0,
      duplicateLocalKeys: 0,
      integrity: 'PASS',
      readOnly: true,
    });
  });
}
async function requireOnlyPage({ allowPortal = false } = {}) {
  const channel = new BroadcastChannel('nitros-backup-presence'), probe = crypto.randomUUID();
  let otherBackup = false, otherPortal = false;
  channel.onmessage = event => {
    if (event.data?.type !== 'present' || event.data.probe !== probe || event.data.pageId === env().pageId) return;
    if (event.data.role === 'backup') otherBackup = true;
    if (event.data.role === 'portal') otherPortal = true;
  };
  channel.postMessage({ type: 'probe', id: probe });
  await new Promise(resolve => setTimeout(resolve, 200)); channel.close();
  assert(!otherBackup && (allowPortal || !otherPortal), allowPortal ? 'Close other backup pages before continuing' : 'Close other portal and backup pages before restore or audit');
}
async function requireCleanDestination() {
  assert(!env().nativeStorage.getItem(env().pointerKey), 'A restored dataset is already active. Use a new clean browser profile.');
  const s = await readSnapshot({ generation: null });
  assert(s.localStorage.length === 0 && s.databases.every(d => d.records.length === 0), 'Destination contains Nitros data. Nothing was overwritten; use a clean profile.');
}
function journalKey(id) { assert(/^[a-f0-9-]{36}$/i.test(id), 'Invalid restore dataset ID'); return `__nitros_backup_journal:${id}`; }
function writeJournal(id, value) { env().nativeStorage.setItem(journalKey(id), JSON.stringify(value)); }
async function writeDatabase(schema, generation) {
  const name = `__nitros_backup_${generation}:${schema.name}`;
  assert(!(await env().nativeDatabases()).some(d => d.name === name), 'Restore generation already exists');
  const db = await new Promise((resolve, reject) => {
    const req = env().nativeOpen(name, schema.version);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(schema.store, { keyPath: schema.keyPath });
      for (const i of schema.indexes) store.createIndex(i.name, i.keyPath, { unique: i.unique, multiEntry: i.multiEntry });
    };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); req.onblocked = () => reject(new Error('Restore database blocked'));
  });
  try {
    const tx = db.transaction(schema.store, 'readwrite'), done = transactionDone(tx);
    for (const record of schema.records) tx.objectStore(schema.store).add(record);
    await done;
  } finally { db.close(); }
}
export async function prepareRestore(input) {
  return exclusive(async () => {
    // Validation is complete before the first write to the destination.
    let checked = await validatePackage(input);
    const shopAccountId = readShopAccountId(env().nativeStorage);
    assert(shopAccountId, 'Connect and explicitly bind this shop’s Google account before restoring');
    assertPackageShopAccount(checked.envelope, shopAccountId);
    const mode = 'empty';
    await requireOnlyPage();
    const previousPointer = env().nativeStorage.getItem(env().pointerKey);
    const baseline = await createPackage(await readSnapshot()), baselineHash = await digestData(baseline);
    await requireCleanDestination();
    const id = crypto.randomUUID(), dataHash = await digestData(checked.envelope);
    const journal = { id, state: 'PREPARING', mode, previousPointer, baselineHash, packageHash: checked.envelope.sha256, dataHash, summary: checked.summary, createdAt: new Date().toISOString() };
    writeJournal(id, journal);
    try {
      for (const schema of checked.snapshot.databases) await writeDatabase(schema, id);
      for (const { key, value } of checked.snapshot.localStorage) env().nativeStorage.setItem(`__nitros_backup_${id}:${key}`, value);
      const readback = await createPackage(await readSnapshot({ generation: id }));
      assert(await digestData(readback) === dataHash, 'Staged readback differs from backup');
      journal.state = 'READY'; writeJournal(id, journal);
      return journal;
    } catch (error) {
      // Retain quarantine for diagnosis, never delete any source/destination data.
      try { writeJournal(id, { ...journal, state: 'FAILED', error: 'PREPARATION_FAILED' }); } catch { /* Storage may be full. PREPARING still prevents activation. */ }
      throw error;
    }
  });
}
export function preparedDatasets() {
  const storage = env().nativeStorage, list = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i); if (!key.startsWith('__nitros_backup_journal:')) continue;
    try { list.push(JSON.parse(storage.getItem(key))); } catch { /* Unreadable journals are never activation candidates. */ }
  }
  return list;
}
export async function activateRestore(id) {
  return exclusive(async () => {
    await requireOnlyPage();
    const journal = JSON.parse(env().nativeStorage.getItem(journalKey(id)) || 'null');
    assert(journal?.id === id && journal.state === 'READY', 'Dataset is not completely prepared');
    const checkDestination = async () => {
      return requireCleanDestination();
    };
    await checkDestination();
    const checked = await createPackage(await readSnapshot({ generation: id }));
    assert(await digestData(checked) === journal.dataHash, 'Prepared dataset changed; activation refused');
    await requireOnlyPage(); await checkDestination();
    // Single atomic pointer write exposes the fully verified dataset on next navigation.
    // The portal's pre-restore stores remain intact. Its bootstrap adapter switches to
    // this fully validated generation only after the single pointer write.
    env().nativeStorage.setItem(env().pointerKey, id);
    journal.state = 'ACTIVE'; journal.activatedAt = new Date().toISOString(); writeJournal(id, journal);
    return { id, summary: journal.summary };
  });
}
export async function rollbackRestore(id) {
  return exclusive(async () => {
    await requireOnlyPage();
    const journal = JSON.parse(env().nativeStorage.getItem(journalKey(id)) || 'null');
    assert(journal?.id === id && ['READY', 'ACTIVE'].includes(journal.state), 'Restore generation is not eligible for rollback');
    assert(env().nativeStorage.getItem(env().pointerKey) === id, 'Restore generation is not the active dataset');
    const current = await createPackage(await readSnapshot());
    assert(await digestData(current) === journal.dataHash, 'Portal data changed after activation; rollback refused to avoid hiding new work');
    env().nativeStorage.removeItem(env().pointerKey);
    journal.state = 'ROLLED_BACK'; journal.rolledBackAt = new Date().toISOString(); writeJournal(id, journal);
    return { id, state: journal.state, retained: true, reloadRequired: true };
  });
}
export { validatePackage };
