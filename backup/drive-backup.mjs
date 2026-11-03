// No tokens persisted or logged. All remote operations require an explicit token provider.
import { hash, LIMITS } from './backup-core.mjs';
import { ENCRYPTED_LIMIT } from './secure-crypto.mjs';
import { validateDriveAccountId } from './shop-identity.mjs';
export const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
export const BACKUP_FOLDER_NAME='Nitros Mobile Backup';
export const DRIVE_BACKUP_NAMESPACES=Object.freeze({
  production:Object.freeze({folderName:'Nitros Mobile Backup',purpose:'backup-production-v1',label:'Production'}),
  staging:Object.freeze({folderName:'Nitros Mobile Backup - Staging',purpose:'backup-staging-v1',label:'Staging'})
});
// Bounded diagnostics only. Never return provider messages, URLs, or arbitrary strings.
async function googleCategory(response){
  const allowed=new Set(['UNAUTHENTICATED','PERMISSION_DENIED','RESOURCE_EXHAUSTED','INVALID_ARGUMENT','NOT_FOUND','INTERNAL','UNAVAILABLE','authError','insufficientPermissions','accessNotConfigured','serviceDisabled','rateLimitExceeded','userRateLimitExceeded','storageQuotaExceeded','dailyLimitExceeded','backendError','forbidden','notFound']);
  let reader,timer;
  try{return await Promise.race([(async()=>{reader=response.clone().body?.getReader();if(!reader)return 'unknown';let size=0,text='';const decoder=new TextDecoder();while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>8192)return 'unknown';text+=decoder.decode(part.value,{stream:true});}const error=JSON.parse(text+decoder.decode())?.error;return [error?.errors?.[0]?.reason,error?.status].find(x=>allowed.has(x))||'unknown';})(),new Promise(resolve=>{timer=setTimeout(()=>resolve('unknown'),250);})]);}catch{return 'unknown';}finally{clearTimeout(timer);if(reader)void reader.cancel().catch(()=>{});}
}
// Validate before token access, persistence or network I/O. Never echo rejected values.
function uploadPayload(job) {
  const fail=()=>{throw new Error('Invalid encrypted backup upload; original backup retained');};
  const plain=x=>x!==null&&typeof x==='object'&&Object.getPrototypeOf(x)===Object.prototype;
  if(!plain(job))fail();
  const read=(obj,key)=>{const d=Object.getOwnPropertyDescriptor(obj,key);if(!d||!('value' in d))fail();return d.value;};
  const id=read(job,'id'),at=read(job,'at'),p=read(job,'encrypted'),shopAccountPermissionId=read(job,'shopAccountPermissionId');
  try{validateDriveAccountId(shopAccountPermissionId);}catch{fail();}
  if(typeof id!=='string'||id.length>120||!(/^(manual:[a-zA-Z0-9-]{1,64}|scheduled:(daily|weekly)\|[0-6]\|[A-Za-z0-9_+\-/]+\|\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/.test(id)))fail();
  if(id.startsWith('scheduled:')){
    const [, ,zone,slot]=id.split('|'),date=new Date(slot+':00.000Z');
    if(!Number.isFinite(date.getTime())||date.toISOString()!==slot+':00.000Z')fail();
    try{new Intl.DateTimeFormat('en',{timeZone:zone});}catch{fail();}
  }
  if(typeof at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at)||!Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at)fail();
  const fields=['format','version','algorithm','iv','ciphertext'];
  if(!plain(p)||Reflect.ownKeys(p).length!==fields.length)fail();
  const safe=Object.fromEntries(fields.map(k=>[k,read(p,k)]));
  if(safe.format!=='nitros-encrypted-backup'||safe.version!==1||safe.algorithm!=='AES-256-GCM')fail();
  function base64(s,min,max){
    if(typeof s!=='string'||s.length>4*Math.ceil(max/3)||s.length<4*Math.ceil(min/3))fail();
    let raw;try{raw=atob(s);}catch{fail();}
    if(raw.length<min||raw.length>max||btoa(raw)!==s)fail();
  }
  base64(safe.iv,12,12);base64(safe.ciphertext,16,LIMITS.packageBytes+16);
  const text=JSON.stringify(safe);
  if(text.length>ENCRYPTED_LIMIT)fail();
  return {id,at,shopAccountPermissionId,body:new TextEncoder().encode(text)};
}
export class DriveBackup {
  constructor({token,shopAccountId=()=>null,fetcher=(...args)=>globalThis.fetch(...args),onUnauthorized=()=>{},timeoutMs=60000,namespace='production'}){this.token=token;this.shopAccountId=shopAccountId;this.fetcher=fetcher;this.onUnauthorized=onUnauthorized;this.timeoutMs=timeoutMs;this.namespace=namespace;}
  namespaceConfig(){const config=DRIVE_BACKUP_NAMESPACES[this.namespace];if(!config)throw new Error('Google Drive backup namespace is not configured; local encrypted backups remain available');return config;}
  async call(url,options={}){options={...options,signal:options.signal||this.uploadSignal};this.lastFailure=null;const u=new URL(url);const operation=u.pathname.endsWith('/about')?'account verification':u.pathname.endsWith('/generateIds')?'file ID allocation':u.searchParams.get('alt')==='media'?'verification/download':u.pathname.startsWith('/upload/')?(options.method==='POST'?'upload initiation':'transfer/status probe'):u.searchParams.get('q')?.includes('nitrosPurpose')?'folder discovery':u.searchParams.get('q')?'file listing':'folder metadata';
    this.operation=this.uploadStage||operation;
    const failure=classification=>{this.lastFailure={operation:this.operation,classification};};
    if(u.origin!=='https://www.googleapis.com'){failure('untrusted endpoint');throw new Error('Untrusted Drive URL');}const token=this.token();if(!token){failure('authorization unavailable');throw new Error('Reconnect Google Drive; authorization expired');}
    // Fetch redirect:error rejects Google's non-redirect 308 Resume Incomplete.
    // Only an EMPTY status probe follows redirects: no backup data is sent, and
    // browsers strip Authorization on cross-origin redirects. Data requests stay strict.
    const probe=u.pathname.startsWith('/upload/')&&options.method==='PUT'&&options.body===undefined&&/^bytes \*\/\d+$/.test(options.headers?.['Content-Range']);
    const controller=new AbortController();let timer,timedOut=false,reader,r;
    const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
    try{
      r=await Promise.race([(async()=>{
        const response=await this.fetcher(url,{...options,signal:controller.signal,redirect:probe?'follow':'error',headers:{...options.headers,Authorization:`Bearer ${token}`}});
        if(response.url&&new URL(response.url).origin!=='https://www.googleapis.com')throw new Error('Untrusted response');
        // Cover stalled response bodies as well as headers, with a bounded allocation.
        const limit=u.searchParams.get('alt')==='media'?ENCRYPTED_LIMIT:1024*1024;
        if(Number(response.headers.get('Content-Length'))>limit)throw new Error('Response exceeds limit');
        reader=response.body?.getReader();const chunks=[];let size=0;
        if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit)throw new Error('Response exceeds limit');chunks.push(part.value);}
        return new Response(chunks.length?new Blob(chunks):null,{status:response.status,headers:response.headers});
      })(),new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(new Error('timeout'));},this.timeoutMs);})]);
    }catch{
      controller.abort();if(reader)void reader.cancel().catch(()=>{});
      if(options.signal?.aborted){failure('aborted');throw new Error('Upload paused');}
      if(timedOut){failure('request timeout');throw new Error('Drive request timed out; backup remains queued');}
      failure('fetch rejected: transport/CORS/redirect unknown');throw new Error('Drive network interrupted; backup remains queued');
    }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
    if(!r.ok&&![308].includes(r.status)){failure(`HTTP ${r.status}`);this.lastFailure.httpStatus=r.status;this.lastFailure.googleCategory=await googleCategory(r);}
    if(r.status===401){this.onUnauthorized();throw new Error('Reconnect Google Drive; authorization expired');}return r;
  }
  async findFolder(){const namespace=this.namespaceConfig(),q=`trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='nitrosPurpose' and value='${namespace.purpose}' }`,params=new URLSearchParams({spaces:'drive',q,fields:'nextPageToken,files(id,mimeType,trashed,appProperties)',pageSize:'100'}),r=await this.call('https://www.googleapis.com/drive/v3/files?'+params);if(!r.ok)throw new Error(`${namespace.label} backup folder discovery failed (${r.status})`);const body=await r.json(),folders=body.files||[];if(body.nextPageToken||folders.length>1)throw new Error(`Multiple ${namespace.label.toLowerCase()} backup folders; owner review required`);if(!folders.length)return null;const folder=folders[0];if(folder.mimeType!=='application/vnd.google-apps.folder'||folder.trashed||folder.appProperties?.nitrosPurpose!==namespace.purpose)throw new Error(`Invalid ${namespace.label.toLowerCase()} backup folder`);return folder.id;}
  async verifyAccount(){const response=await this.call('https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress)');if(!response.ok)throw new Error(`Google Drive account verification failed (${response.status})`);const user=(await response.json()).user||{},permissionId=user.permissionId;try{validateDriveAccountId(permissionId);}catch{throw new Error('Google Drive did not return a stable account identity');}return Object.freeze({permissionId,emailAddress:typeof user.emailAddress==='string'?user.emailAddress:''});}
  async assertBoundAccount(){const identity=await this.verifyAccount(),bound=this.shopAccountId();let expected;try{expected=validateDriveAccountId(bound);}catch{throw new Error('Bind this shop to its own Google Drive account before accessing backup history');}if(identity.permissionId!==expected)throw new Error('Connected Google account does not match this shop’s bound backup account');return identity;}
  async list(){this.namespaceConfig();await this.assertBoundAccount();const folderId=await this.findFolder();if(!folderId)return[];let page='',files=[];do{const q=`trashed = false and '${folderId}' in parents and appProperties has { key='nitrosFormat' and value='encrypted-v1' }`,params=new URLSearchParams({spaces:'drive',q,fields:'nextPageToken,files(id,name,size,createdTime,appProperties,parents)',pageSize:'100',...(page?{pageToken:page}:{})});const r=await this.call('https://www.googleapis.com/drive/v3/files?'+params);if(!r.ok)throw new Error(`Drive history unavailable (${r.status})`);const body=await r.json();files.push(...(body.files||[]));page=body.nextPageToken||'';}while(page);return files.sort((a,b)=>b.createdTime.localeCompare(a.createdTime));}
  async allocateId(){const r=await this.call('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive');if(!r.ok)throw new Error('Cannot allocate Drive identity');const id=(await r.json()).ids?.[0];if(!id||!/^[-\w]+$/.test(id))throw new Error('Invalid Drive identity');return id;}
  async ensureFolder(job,persist){
    const namespace=this.namespaceConfig(),valid=f=>f?.mimeType==='application/vnd.google-apps.folder'&&!f.trashed&&f.appProperties?.nitrosPurpose===namespace.purpose;
    if(!job.folderId){job.folderId=await this.findFolder();if(!job.folderId)job.folderId=await this.allocateId();await persist(job);}
    if(!/^[-\w]+$/.test(job.folderId))throw new Error('Invalid folder identity');
    const url=`https://www.googleapis.com/drive/v3/files/${job.folderId}?fields=id,mimeType,trashed,appProperties`,existing=await this.call(url);
    if(existing.ok){if(!valid(await existing.json()))throw new Error(`${namespace.label} backup folder is unavailable or changed`);return job.folderId;}
    if(existing.status!==404)throw new Error('Cannot verify staging folder');
    const r=await this.call('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:job.folderId,name:namespace.folderName,mimeType:'application/vnd.google-apps.folder',appProperties:{nitrosPurpose:namespace.purpose}})});
    if(!r.ok&&r.status!==409)throw new Error(`Cannot create ${namespace.label.toLowerCase()} backup folder (${r.status})`);
    const verified=await this.call(url);if(!verified.ok||!valid(await verified.json()))throw new Error(`${namespace.label} folder creation not verified`);return job.folderId;
  }
  async download(id){this.namespaceConfig();if(!/^[\w-]+$/.test(id))throw new Error('Invalid Drive file ID');await this.assertBoundAccount();const folderId=await this.findFolder();if(!folderId)throw new Error('This shop has no verified backup folder');const metadata=await this.call(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,parents,appProperties,mimeType,trashed`);if(!metadata.ok)throw new Error(`Drive backup metadata verification failed (${metadata.status})`);const file=await metadata.json();if(file.id!==id||file.mimeType!=='application/json'||file.trashed||!Array.isArray(file.parents)||!file.parents.includes(folderId)||file.appProperties?.nitrosFormat!=='encrypted-v1')throw new Error('Drive file is outside this shop’s verified encrypted backup folder');const r=await this.call(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);if(!r.ok)throw new Error(`Drive download failed (${r.status})`);if(Number(r.headers.get('Content-Length'))>ENCRYPTED_LIMIT)throw new Error('Remote file exceeds limit');const reader=r.body.getReader(),chunks=[],sizeLimit=ENCRYPTED_LIMIT;let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>sizeLimit){await reader.cancel();throw new Error('Remote file exceeds limit')}chunks.push(value)}return new Blob(chunks).text();}
  async upload(job,persist,signal){
    this.lastFailure=null;
    this.namespaceConfig();
    this.uploadStage='upload validation';this.uploadSignal=signal;
    try{
    const {id,at,shopAccountPermissionId,body}=uploadPayload(job),checksum=await hash(body);
    this.uploadStage='account verification';
    const {permissionId:owner}=await this.verifyAccount();
    const bound=this.shopAccountId();if(bound!==owner||shopAccountPermissionId!==owner)throw new Error('Backup belongs to a different or unbound shop Google account');
    if(job.owner&&job.owner!==owner)throw new Error('Queued backup belongs to another Google account');
    if((job.session||job.remoteId)&&job.driveSpace!=='drive')throw new Error('Legacy upload state retained; owner review required before changing its destination');
    job.owner=owner;await persist(job);
    // Recover an ambiguous final response by finding the immutable backup ID and verifying bytes.
    this.uploadStage='file listing';
    const found=(await this.list()).filter(f=>f.appProperties?.backupId===id);
    if(found.length>1)throw new Error('Duplicate remote backup identities; review required');
    if(found.length){this.uploadStage='remote verification';if(await hash(await this.download(found[0].id))!==checksum)throw new Error('Remote backup integrity mismatch');return found[0].id;}
    this.uploadStage='folder discovery/creation';
    const folderId=await this.ensureFolder(job,persist);
    this.uploadStage='file ID allocation';
    if(!job.remoteId){job.remoteId=await this.allocateId();job.driveSpace='drive';await persist(job);}
    this.uploadStage='upload initiation';
    if(!job.session){const r=await this.call('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',{method:'POST',signal,headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/json','X-Upload-Content-Length':String(body.length)},body:JSON.stringify({id:job.remoteId,name:`Nitros-${at.replace(/[:.]/g,'-')}.nitros.json`,parents:[folderId],appProperties:{nitrosFormat:'encrypted-v1',backupId:id,sha256:checksum}})});if(!r.ok)throw new Error(`Drive upload initiation failed (${r.status})`);const session=r.headers.get('Location');if(!session||new URL(session).origin!=='https://www.googleapis.com')throw new Error('Invalid upload session');job.session=session;await persist(job);}
    this.uploadStage='file transfer';
    let r=await this.call(job.session,{method:'PUT',signal,headers:{'Content-Range':`bytes */${body.length}`}});
    if(r.status===404||r.status===410){delete job.session;await persist(job);throw new Error('Upload session expired; next retry starts a fresh session');}
    if(r.status===308){const range=r.headers.get('Range'),offset=range?Number(range.match(/^bytes=0-(\d+)$/)?.[1])+1:0;if(!Number.isSafeInteger(offset)||offset<0||offset>=body.length)throw new Error('Invalid upload offset');r=await this.call(job.session,{method:'PUT',signal,headers:{'Content-Type':'application/json','Content-Range':`bytes ${offset}-${body.length-1}/${body.length}`},body:body.slice(offset)});}
    if(!r.ok)throw new Error(`Upload incomplete (${r.status}); queued for retry`);
    const result=await r.json();if(!result.id)throw new Error('Drive upload missing identity');
    this.uploadStage='remote verification';
    if(await hash(await this.download(result.id))!==checksum)throw new Error('Uploaded backup readback integrity mismatch');
    delete job.session;return result.id;
    }catch(error){if(!this.lastFailure)this.lastFailure={operation:this.uploadStage,classification:error instanceof SyntaxError?'invalid response JSON':'application validation/storage/integrity failure',httpStatus:null,googleCategory:'unknown'};throw error;}finally{this.uploadStage=null;this.uploadSignal=null;}
  }
}
