export const FORMAT = 'nitros-portable-customer-backup';
export const VERSION = 1;
export const LIMITS = Object.freeze({ packageBytes: 64 * 1024 * 1024, binaryBytes: 32 * 1024 * 1024, records: 10000, depth: 80 });
export const SCHEMAS = Object.freeze([
  { name: 'NitrosRepairOrders', version: 1, store: 'repairOrders', keyPath: 'id', indexes: [{ name: 'status', keyPath: 'status', unique: false, multiEntry: false }, { name: 'updatedAt', keyPath: 'updatedAt', unique: false, multiEntry: false }] },
  { name: 'nitros_photo_evidence_v1', version: 1, store: 'photos', keyPath: 'key', indexes: [] }
]);
export const relevantKey = key => key === 'activeRepairOrderId' || /^nitros[_-]/i.test(key);
const excludedKey = key => /profile|session|credential|password|(?:^|[_-])pin(?:$|[_-])|token|secret|auth/i.test(key);
const secretField = key => /(?:password|passphrase|credential|secret|access.?token|refresh.?token|authorization.?header|api.?key|cloudAccessToken|portalPin|sessionId|sessionToken|bearerToken)/i.test(key) || /^(pin|jwt|cookie|cookies|token)$/i.test(key);
const suspiciousValue = value => /\b(?:Bearer\s+[A-Za-z0-9._-]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})/.test(value);
const fail = message => { throw new Error(message); };
export async function hash(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
function base64(bytes) {
  let str = ''; for (let i = 0; i < bytes.length; i += 16384) str += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(str);
}
function unbase64(text) {
  if (typeof text !== 'string' || text.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) fail('Invalid binary encoding');
  return Uint8Array.from(atob(text), c => c.charCodeAt(0));
}
function redact(value, path, exclusions) {
  if (typeof value === 'string' && suspiciousValue(value)) fail(`Possible credential embedded in data at ${path}; review before exporting`);
  if (!value || typeof value !== 'object' || value instanceof Blob || value instanceof Date || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
  if (Array.isArray(value)) return value.map((v, i) => redact(v, `${path}[${i}]`, exclusions));
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail(`Unsupported record type at ${path}`);
  const result = {};
  for (const [key, v] of Object.entries(value)) {
    if (secretField(key)) { exclusions.push(`${path}.${key}`); continue; }
    Object.defineProperty(result, key, { value: redact(v, `${path}.${key}`, exclusions), enumerable: true, writable: true, configurable: true });
  }
  return result;
}
export function sanitizeLocal(key, raw, exclusions) {
  if (!relevantKey(key)) fail('Unrecognized storage key');
  if (excludedKey(key)) { exclusions.push(`localStorage.${key}`); return null; }
  let value; try { value = JSON.parse(raw); } catch { if (suspiciousValue(raw)) fail(`Possible credential in ${key}`); return raw; }
  const before = exclusions.length, cleaned = redact(value, `localStorage.${key}`, exclusions);
  return exclusions.length === before ? raw : JSON.stringify(cleaned);
}
async function encode(value, binaries, depth = 0) {
  if (depth > LIMITS.depth) fail('Record nesting exceeds limit');
  if (value === null) return ['null'];
  if (value === undefined) return ['undefined'];
  if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value];
  if (typeof value === 'number') return ['number', Number.isNaN(value) ? 'NaN' : value === Infinity ? '+Infinity' : value === -Infinity ? '-Infinity' : Object.is(value, -0) ? '-0' : value];
  if (value instanceof Date) return ['date', value.toISOString()];
  if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const digest = await hash(bytes);
    if (!binaries.has(digest)) binaries.set(digest, { sha256: digest, size: bytes.length, base64: base64(bytes) });
    if (typeof File !== 'undefined' && value instanceof File) return ['file', digest, value.type, value.name, value.lastModified];
    return [value instanceof Blob ? 'blob' : value instanceof ArrayBuffer ? 'buffer' : 'view', digest, value instanceof Blob ? value.type : value.constructor.name];
  }
  if (Array.isArray(value)) return ['array', await Promise.all(value.map(v => encode(v, binaries, depth + 1)))];
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail('Unsupported stored value type');
  return ['object', await Promise.all(Object.keys(value).sort().map(async key => [key, await encode(value[key], binaries, depth + 1)]))];
}
function decode(node, binaries, used, depth = 0) {
  if (!Array.isArray(node) || depth > LIMITS.depth) fail('Invalid encoded record');
  const [kind, value] = node;
  switch (kind) {
    case 'null': if (node.length !== 1) fail('Invalid null'); return null;
    case 'undefined': if (node.length !== 1) fail('Invalid undefined'); return undefined;
    case 'string': case 'boolean': if (typeof value !== kind || node.length !== 2) fail('Invalid primitive'); return value;
    case 'number': {
      if (node.length !== 2) fail('Invalid number');
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      const special = { NaN: NaN, '+Infinity': Infinity, '-Infinity': -Infinity, '-0': -0 };
      if (!Object.hasOwn(special, value)) fail('Invalid number'); return special[value];
    }
    case 'date': if (typeof value !== 'string' || new Date(value).toISOString() !== value) fail('Invalid date'); return new Date(value);
    case 'array': if (!Array.isArray(value) || node.length !== 2) fail('Invalid array'); return value.map(v => decode(v, binaries, used, depth + 1));
    case 'object': {
      if (!Array.isArray(value) || node.length !== 2) fail('Invalid object');
      const result = {};
      for (const pair of value) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || Object.hasOwn(result, pair[0])) fail('Duplicate or invalid object property');
        Object.defineProperty(result, pair[0], { value: decode(pair[1], binaries, used, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      return result;
    }
    case 'blob': case 'file': case 'buffer': case 'view': {
      const bytes = binaries.get(value); if (!bytes) fail('Missing binary attachment'); used.add(value);
      if (kind === 'blob') { if (node.length !== 3 || typeof node[2] !== 'string') fail('Invalid blob'); return new Blob([bytes], { type: node[2] }); }
      if (kind === 'file') { if (node.length !== 5 || typeof node[2] !== 'string' || typeof node[3] !== 'string' || !Number.isFinite(node[4])) fail('Invalid file'); return new File([bytes], node[3], { type: node[2], lastModified: node[4] }); }
      if (kind === 'buffer') return bytes.slice().buffer;
      const types = { Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, DataView };
      if (!Object.hasOwn(types, node[2])) fail('Unsupported binary view'); return new types[node[2]](bytes.slice().buffer);
    }
    default: fail('Unsupported encoded type');
  }
}
function checkRelationships(local, databases) {
  const warnings = [], ro = databases.find(d => d.name === SCHEMAS[0].name)?.records || [], photos = databases.find(d => d.name === SCHEMAS[1].name)?.records || [];
  const historyRaw = local.find(x => x.key === 'nitros_prototype_customer_history_v070')?.value;
  let history = []; if (historyRaw) { try { history = JSON.parse(historyRaw); } catch { fail('Customer history is not valid JSON'); } if (!Array.isArray(history)) fail('Customer history must be an array'); }
  const historyIds = new Set();
  for (const h of history) { if (!h?.checkInId || historyIds.has(h.checkInId)) fail('Missing or duplicate customer-history checkInId'); historyIds.add(h.checkInId); }
  const pointer = local.find(x => x.key === 'activeRepairOrderId')?.value;
  if (pointer && !ro.some(r => r.id === pointer && r.status === 'active')) warnings.push('Source active-repair pointer does not identify an active stored repair order.');
  const owners = new Set([...ro.map(r => r.id), ...ro.map(r => r.photoStorageReference).filter(Boolean), ...historyIds, 'active-draft']);
  const signatureCaptures = new Set();
  for (const p of photos) {
    if (!(p.blob instanceof Blob)) fail('Photo record lacks stored binary image');
    if (!p.recordId) fail('Photo record lacks recordId');
    if (p.evidenceType === 'signature') {
      if (!['customer', 'technician'].includes(p.signatureType) || p.fieldId !== `${p.signatureType}Signature`) fail('Invalid signature type or field relationship');
      if (p.repairOrderId !== p.recordId || !ro.some(record => record.id === p.repairOrderId)) fail('Signature is orphaned from its repair order');
      if (typeof p.signatureCaptureId !== 'string' || !/^[a-f0-9-]{36}$/i.test(p.signatureCaptureId) || signatureCaptures.has(p.signatureCaptureId)) fail('Missing or duplicate signature capture identity');
      signatureCaptures.add(p.signatureCaptureId);
      if (p.authorizationType !== (p.signatureType === 'customer' ? 'customer-authorization' : 'technician-attestation')) fail('Invalid signature authorization type');
      if (typeof p.capturedAt !== 'string' || !Number.isFinite(Date.parse(p.capturedAt)) || new Date(p.capturedAt).toISOString() !== p.capturedAt) fail('Invalid signature capture timestamp');
      if (typeof p.mimeType !== 'string' || p.mimeType !== p.blob.type) fail('Signature image type metadata mismatch');
    }
    if (!owners.has(p.recordId)) warnings.push(`Retained photo with unresolved owner: ${p.key}`);
  }
  for (const h of history) {
    for (const p of h.photoEvidence || []) if (!photos.some(x => x.recordId === h.checkInId && (p.key ? x.key === p.key : x.fieldId === p.fieldId))) warnings.push(`Source report references missing photo: ${h.checkInId}/${p.fieldId || p.key || 'unknown'}`);
  }
  return { historyCount: history.length, activeOrders: ro.filter(r => r.status === 'active').length, archivedOrders: ro.filter(r => r.status === 'archived').length, photoCount: photos.length, warnings };
}
export async function createPackage(snapshot, source = {}) {
  const exclusions = [], binaries = new Map(), localStorage = [];
  for (const entry of snapshot.localStorage) { const value = sanitizeLocal(entry.key, entry.value, exclusions); if (value !== null) localStorage.push({ key: entry.key, value }); }
  localStorage.sort((a, b) => a.key.localeCompare(b.key));
  const databases = [];
  for (const db of snapshot.databases) {
    const records = [];
    for (const record of db.records) records.push(await encode(redact(record, `${db.name}.${record[db.keyPath]}`, exclusions), binaries));
    databases.push({ ...db, records });
  }
  const payload = { format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), source, localStorage, databases, binaries: [...binaries.values()], exclusions };
  const envelope = { payload, sha256: await hash(JSON.stringify(payload)) };
  await validatePackage(envelope);
  return envelope;
}
export async function validatePackage(input) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  if (new TextEncoder().encode(text).length > LIMITS.packageBytes) fail('Package exceeds staging size limit');
  let envelope; try { envelope = JSON.parse(text); } catch { fail('Invalid package JSON'); }
  const p = envelope?.payload;
  if (p?.format !== FORMAT || p.version !== VERSION) fail('Unsupported backup format/version');
  if (envelope.sha256 !== await hash(JSON.stringify(p))) fail('Package checksum mismatch');
  if (!Number.isFinite(Date.parse(p.createdAt)) || !Array.isArray(p.exclusions) || !p.exclusions.every(x => typeof x === 'string')) fail('Invalid manifest metadata');
  if (!Array.isArray(p.localStorage) || !Array.isArray(p.databases) || !Array.isArray(p.binaries)) fail('Missing inventory');
  const localKeys = new Set();
  for (const entry of p.localStorage) {
    if (typeof entry?.key !== 'string' || typeof entry.value !== 'string' || localKeys.has(entry.key)) fail('Duplicate or invalid localStorage key');
    const exclusions = [];
    if (sanitizeLocal(entry.key, entry.value, exclusions) === null || exclusions.length) fail('Package contains excluded credential fields');
    localKeys.add(entry.key);
  }
  const binaryMap = new Map(); let bytesTotal = 0;
  for (const b of p.binaries) {
    if (!b || binaryMap.has(b.sha256) || !Number.isSafeInteger(b.size) || b.size < 0) fail('Invalid or duplicate binary');
    bytesTotal += b.size; if (bytesTotal > LIMITS.binaryBytes) fail('Binary size limit exceeded');
    const bytes = unbase64(b.base64);
    if (bytes.length !== b.size || await hash(bytes) !== b.sha256) fail('Binary checksum/size mismatch');
    binaryMap.set(b.sha256, bytes);
  }
  const used = new Set(), names = new Set(), databases = []; let count = p.localStorage.length;
  for (const db of p.databases) {
    const schema = SCHEMAS.find(s => s.name === db?.name);
    if (!schema || names.has(db.name) || db.version !== schema.version || db.store !== schema.store || db.keyPath !== schema.keyPath || JSON.stringify(db.indexes) !== JSON.stringify(schema.indexes) || !Array.isArray(db.records)) fail('Unknown or incompatible database schema');
    names.add(db.name); count += db.records.length; if (count > LIMITS.records) fail('Record limit exceeded');
    const keys = new Set(), records = [];
    for (const node of db.records) {
      const r = decode(node, binaryMap, used), key = r?.[schema.keyPath];
      if (typeof key !== 'string' || !key || keys.has(key)) fail('Duplicate or invalid database record ID');
      const excluded = []; redact(r, db.name, excluded); if (excluded.length) fail('Record contains excluded credentials');
      keys.add(key); records.push(r);
    }
    databases.push({ ...db, records });
  }
  if (SCHEMAS.some(s => !names.has(s.name))) fail('Incomplete database inventory');
  if (used.size !== binaryMap.size) fail('Unreferenced binary attachment');
  const relationships = checkRelationships(p.localStorage, databases);
  return { envelope, snapshot: { localStorage: p.localStorage, databases }, summary: { localKeys: localKeys.size, records: count, uniqueBinaries: binaryMap.size, binaryBytes: bytesTotal, ...relationships, exclusions: p.exclusions } };
}
