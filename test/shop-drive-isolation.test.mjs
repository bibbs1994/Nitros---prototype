import test from 'node:test';
import assert from 'node:assert/strict';
import { bindShopAccount, readShopAccountId, assertPackageShopAccount, SHOP_ACCOUNT_KEY } from '../backup/shop-identity.mjs';
import { DriveBackup, DRIVE_SCOPE, DRIVE_BACKUP_NAMESPACES } from '../backup/drive-backup.mjs';
import { createPackage, SCHEMAS, validatePackage, hash } from '../backup/backup-core.mjs';
import { encryptBackup, decryptBackup } from '../backup/secure-crypto.mjs';

const memoryStorage = () => {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
};

test('shop account binding requires affirmative owner action and stable permission ID', () => {
  const storage = memoryStorage();
  assert.throws(() => bindShopAccount(storage, 'shop-a'), /Explicit shop-owner authorization/);
  assert.equal(readShopAccountId(storage), null);
  assert.deepEqual(bindShopAccount(storage, 'permission-A', { authorized: true }), { previous: null, accountId: 'permission-A', changed: true });
  assert.equal(readShopAccountId(storage), 'permission-A');
  assert.throws(() => bindShopAccount(storage, 'email@example.com', { authorized: false }), /identity is invalid/);
  assert.equal(storage.getItem(SHOP_ACCOUNT_KEY), 'permission-A');
  assert.throws(() => bindShopAccount(storage, 'email@example.com', { authorized: true }), /invalid/);
});

test('production Drive namespace keeps its existing folder name and marker',()=>{
  assert.deepEqual(DRIVE_BACKUP_NAMESPACES.production,{folderName:'Nitros Mobile Backup',purpose:'backup-production-v1',label:'Production'});
});

test('an existing Google account binding cannot be changed without explicit reconfirmation', () => {
  const storage = memoryStorage(); bindShopAccount(storage,'permission-A',{authorized:true});
  assert.throws(() => bindShopAccount(storage,'permission-B'), /Explicit shop-owner authorization/);
  assert.equal(readShopAccountId(storage),'permission-A');
  const changed=bindShopAccount(storage,'permission-B',{authorized:true});
  assert.deepEqual(changed,{previous:'permission-A',accountId:'permission-B',changed:true});
});

test('restore identity rejects unbound legacy and cross-account packages', () => {
  assert.throws(() => assertPackageShopAccount({ payload: { source: {} } }, 'permission-A'), /no verified shop/);
  assert.throws(() => assertPackageShopAccount({ payload: { source: { shopAccountPermissionId: 'permission-B' } } }, 'permission-A'), /different shop/);
  assert.equal(assertPackageShopAccount({ payload: { source: { shopAccountPermissionId: 'permission-A' } } }, 'permission-A'), true);
});

test('corrupt ciphertext, wrong key, corrupt image bytes, and duplicate RO IDs fail validation', async () => {
  const order={id:'RO-SYNTHETIC-001',status:'active',updatedAt:'2026-11-02T20:00:00.000Z',customer:{id:'CUSTOMER-SYNTHETIC-001'},vehicle:{id:'VEHICLE-SYNTHETIC-001'}};
  const blob=new Blob([new Uint8Array([137,80,78,71,13,10,26,10,1,2,3])],{type:'image/png'});
  const snapshot={localStorage:[],databases:[{...SCHEMAS[0],records:[order]},{...SCHEMAS[1],records:[{key:'RO-SYNTHETIC-001:photo',recordId:order.id,fieldId:'inspection',evidenceType:'photo',mimeType:'image/png',blob}]}]};
  const envelope=await createPackage(snapshot,{shopAccountPermissionId:'permission-A'}),keyA=Buffer.alloc(32,4).toString('base64'),keyB=Buffer.alloc(32,5).toString('base64'),cipher=await encryptBackup(envelope,keyA);
  await assert.rejects(decryptBackup(cipher,keyB),/Wrong recovery key or damaged encrypted backup/);
  const brokenCipher=structuredClone(cipher);brokenCipher.ciphertext=(brokenCipher.ciphertext[0]==='A'?'B':'A')+brokenCipher.ciphertext.slice(1);
  await assert.rejects(decryptBackup(brokenCipher,keyA),/Wrong recovery key or damaged encrypted backup/);
  const brokenImage=structuredClone(envelope),binary=brokenImage.payload.binaries[0];binary.base64=(binary.base64[0]==='A'?'B':'A')+binary.base64.slice(1);brokenImage.sha256=await hash(JSON.stringify(brokenImage.payload));
  await assert.rejects(validatePackage(brokenImage),/Binary checksum\/size mismatch/);
  const duplicate=structuredClone(envelope),records=duplicate.payload.databases.find(db=>db.name==='NitrosRepairOrders').records;records.push(structuredClone(records[0]));duplicate.sha256=await hash(JSON.stringify(duplicate.payload));
  await assert.rejects(validatePackage(duplicate),/Duplicate or invalid database record ID/);
});

test('Google Drive history is not requested if connected account differs from shop binding', async () => {
  const calls = [];
  const drive = new DriveBackup({ token: () => 'synthetic-token', shopAccountId: () => 'permission-A', fetcher: async url => {
    calls.push(new URL(url).pathname);
    return new Response(JSON.stringify({ user: { permissionId: 'permission-B' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } });
  await assert.rejects(drive.list(), /does not match this shop/);
  assert.deepEqual(calls, ['/drive/v3/about']);
});

test('staging Drive history queries only its isolated folder namespace',async()=>{
  const calls=[],stagingFolder={id:'folder-stage',mimeType:'application/vnd.google-apps.folder',trashed:false,appProperties:{nitrosPurpose:DRIVE_BACKUP_NAMESPACES.staging.purpose}};
  const drive=new DriveBackup({token:()=> 'synthetic-token',shopAccountId:()=> 'permission-A',namespace:'staging',fetcher:async url=>{
    const parsed=new URL(url);calls.push(parsed);
    if(parsed.pathname.endsWith('/about'))return new Response(JSON.stringify({user:{permissionId:'permission-A'}}),{status:200});
    if(parsed.pathname==='/drive/v3/files'&&parsed.searchParams.get('q')?.includes('nitrosPurpose'))return new Response(JSON.stringify({files:[stagingFolder]}),{status:200});
    if(parsed.pathname==='/drive/v3/files'&&parsed.searchParams.get('q')?.includes('folder-stage'))return new Response(JSON.stringify({files:[{id:'stage-backup',createdTime:'2026-11-03T00:00:00.000Z',size:'100',appProperties:{nitrosFormat:'encrypted-v1'},parents:['folder-stage']}]}),{status:200});
    throw new Error(`Unexpected staging request ${parsed.pathname}`);
  }});
  const files=await drive.list();
  assert.equal(files.length,1);
  const folderQuery=calls.find(url=>url.searchParams.get('q')?.includes('nitrosPurpose'))?.searchParams.get('q');
  assert.match(folderQuery,/backup-staging-v1/);
  assert.doesNotMatch(folderQuery,/backup-production-v1/);
});

test('staging refuses a queued production folder ID without creating or writing to it',async()=>{
  const writes=[],productionFolder={id:'folder-prod',mimeType:'application/vnd.google-apps.folder',trashed:false,appProperties:{nitrosPurpose:DRIVE_BACKUP_NAMESPACES.production.purpose}};
  const drive=new DriveBackup({token:()=> 'synthetic-token',shopAccountId:()=> 'permission-A',namespace:'staging',fetcher:async(url,options={})=>{
    const parsed=new URL(url);if(options.method==='POST')writes.push(parsed.pathname);
    if(parsed.pathname==='/drive/v3/files/folder-prod')return new Response(JSON.stringify(productionFolder),{status:200});
    throw new Error('Unexpected request');
  }});
  const job={folderId:'folder-prod'};
  await assert.rejects(drive.ensureFolder(job,async()=>{}),/Staging backup folder is unavailable or changed/);
  assert.deepEqual(writes,[]);
  assert.equal(job.folderId,'folder-prod');
});

test('staging folder creation uses a distinct name and purpose marker',async()=>{
  const calls=[];let created=null;
  const drive=new DriveBackup({token:()=> 'synthetic-token',namespace:'staging',fetcher:async(url,options={})=>{
    const parsed=new URL(url),method=options.method||'GET';calls.push({parsed,method,body:options.body});
    if(parsed.pathname==='/drive/v3/files'&&parsed.searchParams.get('q')?.includes('nitrosPurpose'))return new Response(JSON.stringify({files:[]}),{status:200});
    if(parsed.pathname.endsWith('/generateIds'))return new Response(JSON.stringify({ids:['folder-stage-new']}),{status:200});
    if(parsed.pathname==='/drive/v3/files/folder-stage-new'&&method==='GET')return created?new Response(JSON.stringify(created),{status:200}):new Response('',{status:404});
    if(parsed.pathname==='/drive/v3/files'&&method==='POST'){created=JSON.parse(options.body);return new Response(JSON.stringify({id:created.id}),{status:200});}
    throw new Error(`Unexpected request ${method} ${parsed.pathname}`);
  }});
  const job={};
  assert.equal(await drive.ensureFolder(job,async()=>{}),'folder-stage-new');
  const post= calls.find(call=>call.method==='POST');
  const createdBody=JSON.parse(post.body);
  assert.equal(createdBody.name,DRIVE_BACKUP_NAMESPACES.staging.folderName);
  assert.equal(createdBody.appProperties.nitrosPurpose,DRIVE_BACKUP_NAMESPACES.staging.purpose);
  assert.notEqual(createdBody.appProperties.nitrosPurpose,DRIVE_BACKUP_NAMESPACES.production.purpose);
});

test('download refuses a file outside the shop backup folder before fetching content', async () => {
  const calls = [];
  const drive = new DriveBackup({ token: () => 'synthetic-token', shopAccountId: () => 'permission-A', fetcher: async url => {
    const parsed = new URL(url); calls.push(`${parsed.pathname}${parsed.searchParams.get('alt') === 'media' ? '?alt=media' : ''}`);
    if (parsed.pathname.endsWith('/about')) return new Response(JSON.stringify({ user: { permissionId: 'permission-A' } }), { status: 200 });
    if (parsed.pathname === '/drive/v3/files') return new Response(JSON.stringify({ files: [{ id: 'shop-folder', mimeType: 'application/vnd.google-apps.folder', trashed: false, appProperties: { nitrosPurpose: 'backup-production-v1' } }] }), { status: 200 });
    if (parsed.pathname === '/drive/v3/files/other-shop-file') return new Response(JSON.stringify({ id: 'other-shop-file', mimeType: 'application/json', trashed: false, parents: ['other-folder'], appProperties: { nitrosFormat: 'encrypted-v1' } }), { status: 200 });
    throw new Error('Unexpected request');
  } });
  await assert.rejects(drive.download('other-shop-file'), /outside this shop/);
  assert.equal(calls.includes('/drive/v3/files/other-shop-file?alt=media'), false);
});

test('wrong-account upload preserves encrypted bytes and stops before folder or file writes', async () => {
  const calls = [];
  const packageEnvelope = await createPackage({ localStorage: [], databases: SCHEMAS.map(schema => ({ ...schema, records: [] })) }, { shopAccountPermissionId: 'permission-A' });
  const encrypted = await encryptBackup(packageEnvelope, Buffer.alloc(32, 7).toString('base64'));
  const original = JSON.stringify(encrypted);
  const job = { id: 'manual:synthetic-backup-001', at: '2026-11-02T21:00:00.000Z', encrypted, shopAccountPermissionId: 'permission-A' };
  const drive = new DriveBackup({ token: () => 'synthetic-token', shopAccountId: () => 'permission-A', fetcher: async url => {
    calls.push(new URL(url).pathname);
    return new Response(JSON.stringify({ user: { permissionId: 'permission-B' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } });
  await assert.rejects(drive.upload(job, async () => {}), /different or unbound shop/);
  assert.deepEqual(calls, ['/drive/v3/about']);
  assert.equal(JSON.stringify(job.encrypted), original);
  assert.equal(DRIVE_SCOPE, 'https://www.googleapis.com/auth/drive.file');
});

test('mocked upload verifies encrypted readback and writes no plaintext record fields', async () => {
  const packageEnvelope = await createPackage({ localStorage: [], databases: SCHEMAS.map(schema => ({ ...schema, records: [] })) }, { shopAccountPermissionId: 'permission-A' });
  const encrypted = await encryptBackup(packageEnvelope, Buffer.alloc(32, 8).toString('base64'));
  const job = { id: 'manual:synthetic-backup-002', at: '2026-11-02T21:00:00.000Z', encrypted, shopAccountPermissionId: 'permission-A' };
  const ciphertextBody = new TextEncoder().encode(JSON.stringify(encrypted));
  const calls = [];
  let allocated = 0, createdFolder = false, storedBytes = null, interruptOnce = true;
  const folder = { id: 'folder-synthetic', mimeType: 'application/vnd.google-apps.folder', trashed: false, appProperties: { nitrosPurpose: 'backup-production-v1' } };
  const fetcher = async (url, options={}) => {
    const parsed = new URL(url), method=options.method||'GET'; calls.push({ path:parsed.pathname, method, query:parsed.searchParams.get('q')||'' });
    if(parsed.pathname.endsWith('/about')) return new Response(JSON.stringify({ user:{permissionId:'permission-A'} }),{status:200});
    if(parsed.pathname.endsWith('/generateIds')) return new Response(JSON.stringify({ids:[allocated++===0?'folder-synthetic':'file-synthetic']}),{status:200});
    if(parsed.pathname==='/drive/v3/files'&&method==='GET') return new Response(JSON.stringify({files:createdFolder?[folder]:[]}),{status:200});
    if(parsed.pathname==='/drive/v3/files/folder-synthetic'&&method==='GET') return createdFolder?new Response(JSON.stringify(folder),{status:200}):new Response('',{status:404});
    if(parsed.pathname==='/drive/v3/files'&&method==='POST') { createdFolder=true; return new Response(JSON.stringify({id:'folder-synthetic'}),{status:200}); }
    if(parsed.pathname.startsWith('/upload/drive/v3/files')&&method==='POST') return new Response('',{status:200,headers:{Location:'https://www.googleapis.com/upload/drive/v3/files/session-synthetic'}});
    if(parsed.pathname.endsWith('/session-synthetic')&&method==='PUT') { if(!options.body&&interruptOnce){interruptOnce=false;throw new TypeError('simulated interrupted transfer');}if(!options.body)return new Response(null,{status:308});storedBytes=new Uint8Array(options.body);return new Response(JSON.stringify({id:'file-synthetic'}),{status:200}); }
    if(parsed.pathname==='/drive/v3/files/file-synthetic'&&!parsed.searchParams.has('alt')) return new Response(JSON.stringify({id:'file-synthetic',mimeType:'application/json',trashed:false,parents:['folder-synthetic'],appProperties:{nitrosFormat:'encrypted-v1'}}),{status:200});
    if(parsed.pathname==='/drive/v3/files/file-synthetic'&&parsed.searchParams.get('alt')==='media') return new Response(storedBytes,{status:200});
    throw new Error(`Unexpected mocked request ${method} ${parsed.pathname}`);
  };
  const drive = new DriveBackup({token:()=> 'synthetic-token',shopAccountId:()=> 'permission-A',fetcher});
  const original=JSON.stringify(encrypted);
  await assert.rejects(drive.upload(job,async()=>{}),/Drive network interrupted; backup remains queued/);
  assert.equal(JSON.stringify(job.encrypted),original);
  assert.equal(job.remoteVerifiedAt,undefined);
  assert.ok(job.session,'Interrupted upload retained its resumable session for retry');
  const remoteId=await drive.upload(job,async()=>{});
  assert.equal(remoteId,'file-synthetic');
  assert.deepEqual(storedBytes,ciphertextBody);
  assert.deepEqual(new TextDecoder().decode(storedBytes),JSON.stringify(encrypted));
  assert.equal(JSON.stringify(job.encrypted),original);
  assert.equal(job.session,undefined);
  assert.ok(calls.some(call=>call.path==='/drive/v3/about'));
  assert.ok(calls.some(call=>call.query.includes('backup-production-v1')));
  assert.ok(calls.some(call=>call.path.includes('/upload/drive/v3/files')));
  assert.ok(calls.some(call=>call.path==='/drive/v3/files/file-synthetic'));
});

test('missing Google token blocks remote operations without a request', async () => {
  let requests = 0;
  const drive = new DriveBackup({ token: () => '', shopAccountId: () => 'permission-A', fetcher: async () => { requests++; throw new Error('must not run'); } });
  await assert.rejects(drive.list(), /Reconnect Google Drive/);
  assert.equal(requests, 0);
});

test('offline Drive transport leaves the encrypted backup byte-for-byte intact for retry', async () => {
  const envelope = await createPackage({ localStorage: [], databases: SCHEMAS.map(schema => ({ ...schema, records: [] })) }, { shopAccountPermissionId: 'permission-A' });
  const encrypted = await encryptBackup(envelope, Buffer.alloc(32, 9).toString('base64'));
  const original = JSON.stringify(encrypted), job = { id:'manual:synthetic-offline-001', at:'2026-11-02T21:00:00.000Z', encrypted, shopAccountPermissionId:'permission-A', queue:true, attempts:2, nextRetry:123 };
  const drive = new DriveBackup({ token:()=> 'synthetic-token', shopAccountId:()=> 'permission-A', fetcher:async()=>{throw new TypeError('simulated offline transport')} });
  await assert.rejects(drive.upload(job,async()=>{}), /Drive network interrupted; backup remains queued/);
  assert.equal(JSON.stringify(job.encrypted), original);
  assert.equal(job.remoteVerifiedAt, undefined);
  assert.equal(job.queue, true);
  assert.equal(job.attempts, 2);
  assert.equal(job.nextRetry, 123);
});
