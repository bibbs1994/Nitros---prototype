import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer, get as httpGet} from 'node:http';
import {createServer as createNetServer} from 'node:net';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const chrome='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const roId='RO-SYNTHETIC-HOME-STARTUP-001';
const seedPage=`<!doctype html><meta charset="utf-8"><script>
localStorage.setItem('nitros_portal_v8_profile',JSON.stringify({name:'Synthetic Technician',pinSet:false}));
localStorage.setItem('activeRepairOrderId','${roId}');
const draft={screen:'workorder',fields:{customerName:'Synthetic Customer',roNumber:'SYNTHETIC-RO-001',concern:'Synthetic saved concern'},selectedVehicle:{year:'2020',make:'Synthetic',model:'Test Vehicle',vin:'SYNTHETIC-VIN-001'},estimateLines:[]};
localStorage.setItem('nitros_prototype_v073_active_draft',JSON.stringify(draft));
const req=indexedDB.open('NitrosRepairOrders',1);
req.onupgradeneeded=()=>{const s=req.result.createObjectStore('repairOrders',{keyPath:'id'});s.createIndex('status','status',{unique:false});s.createIndex('updatedAt','updatedAt',{unique:false})};
req.onsuccess=()=>{const db=req.result,tx=db.transaction('repairOrders','readwrite');tx.objectStore('repairOrders').put({schemaVersion:1,id:'${roId}',createdAt:'2026-11-05T12:00:00.000Z',updatedAt:'2026-11-05T12:00:00.000Z',status:'active',currentWorkflowStage:'workorder',customerInformation:{name:'Synthetic Customer'},vehicleInformation:{year:'2020',make:'Synthetic',model:'Test Vehicle'},vin:'SYNTHETIC-VIN-001',draft,repairInformation:{status:'In progress'},laborTimer:{status:'paused',accumulatedElapsedMsBeforeCurrentRun:60000,timeline:[]}});tx.oncomplete=()=>{db.close();location.replace('/')};tx.onerror=()=>{document.body.textContent='Synthetic fixture setup failed'};};
</script>`;

const mime=file=>({'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[path.extname(file)]||'application/octet-stream');
const getJson=url=>new Promise((resolve,reject)=>httpGet(url,response=>{let body='';response.setEncoding('utf8');response.on('data',chunk=>body+=chunk);response.on('end',()=>{try{resolve(JSON.parse(body))}catch(error){reject(error)}})}).on('error',reject));

class ChromeSession{
  constructor(proc,socket,sessionId){this.proc=proc;this.socket=socket;this.sessionId=sessionId;this.sequence=0;this.pending=new Map();socket.addEventListener('message',event=>{const message=JSON.parse(event.data),waiter=this.pending.get(message.id);if(waiter){this.pending.delete(message.id);message.error?waiter.reject(new Error(message.error.message)):waiter.resolve(message.result)}})}
  static async launch(profile,origin,pathName='/__seed__'){
    const probe=createNetServer();await new Promise((resolve,reject)=>probe.listen(0,'127.0.0.1',resolve).once('error',reject));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
    const proc=spawn(chrome,['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--no-sandbox','--disable-dev-shm-usage',`--remote-debugging-port=${port}`,'--remote-allow-origins=*',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
    proc.logs='';for(const stream of [proc.stdout,proc.stderr])stream?.on('data',chunk=>{proc.logs=(proc.logs+chunk.toString()).slice(-1500)});
    const endpoint=`http://127.0.0.1:${port}`;let info,lastError;
    for(let i=0;i<100;i++){try{info=await getJson(`${endpoint}/json/version`);break}catch(error){lastError=error;if(proc.exitCode!==null)throw new Error(`Chrome exited before DevTools was ready: ${proc.logs}`);await new Promise(resolve=>setTimeout(resolve,50))}}
    if(!info){await new Promise(resolve=>{const kill=spawn('taskkill.exe',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});kill.once('exit',resolve);kill.once('error',resolve)});throw new Error(`Chrome DevTools unavailable: ${lastError?.message||'unknown'} ${proc.logs}`)}
    const socket=new WebSocket(info.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
    const session=new ChromeSession(proc,socket,null),target=await session.send('Target.createTarget',{url:'about:blank'}),attached=await session.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});session.sessionId=attached.sessionId;session.targetId=target.targetId;
    await session.send('Page.enable');await session.send('Runtime.enable');await session.send('Network.enable');await session.send('Network.setBypassServiceWorker',{bypass:true});await session.send('Page.navigate',{url:`${origin}${pathName}`});
    await session.waitFor(`document.querySelector('#home')?.classList.contains('active')&&window.NitrosActiveRepairPersistence?.getDiagnostics?.().db==='NitrosRepairOrders'`);
    return session;
  }
  send(method,params={},sessionId=this.sessionId){const id=++this.sequence;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));const timer=setTimeout(()=>{const waiter=this.pending.get(id);if(waiter){this.pending.delete(id);reject(new Error(`Chrome DevTools timed out: ${method}`))}},12000);timer.unref?.()})}
  async evaluate(expression){const result=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text||'Browser evaluation failed');return result.result?.value}
  async waitFor(expression){for(let i=0;i<200;i++){if(await this.evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error(`Browser condition timed out: ${expression}`)}
  async reload(origin){const target=await this.send('Target.createTarget',{url:'about:blank'},null),attached=await this.send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null);this.targetId=target.targetId;this.sessionId=attached.sessionId;await this.send('Page.enable');await this.send('Runtime.enable');await this.send('Network.enable');await this.send('Network.setBypassServiceWorker',{bypass:true});await this.send('Page.navigate',{url:`${origin}/`});await this.waitFor(`document.querySelector('#home')?.classList.contains('active')&&window.NitrosActiveRepairPersistence?.getDiagnostics?.().db==='NitrosRepairOrders'`)}
  async close(){try{await this.send('Browser.close',{},null)}catch{}try{this.socket.close()}catch{}await new Promise(resolve=>{if(this.proc.exitCode!==null)return resolve();const timeout=setTimeout(resolve,1500);this.proc.once('exit',()=>{clearTimeout(timeout);resolve()})});if(this.proc.exitCode===null){await new Promise(resolve=>{const kill=spawn('taskkill.exe',['/PID',String(this.proc.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});kill.once('exit',resolve);kill.once('error',resolve)});await new Promise(resolve=>setTimeout(resolve,250))}}
}

test('startup, refresh, browser restart, explicit Active Jobs selection, and completion preserve Home routing',async t=>{
  const profile=await mkdtemp(path.join(tmpdir(),'nitros-home-startup-'));let session,origin;
  const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1');if(url.pathname==='/__seed__'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(seedPage);return}const relative=url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname);const file=path.resolve(root,`.${relative}`);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return}const body=await readFile(file);res.writeHead(200,{'content-type':mime(file),'cache-control':'no-store'});res.end(body)}catch{res.writeHead(404);res.end('Not found')}});
  t.after(async()=>{if(session)await session.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  session=await ChromeSession.launch(profile,origin);
  await session.waitFor(`document.querySelector('#activeRepairOrderList [data-ro-id="${roId}"]')`);

  const boot=await session.evaluate(`({screen:window.NitrosRepairOrderCore?.getScreen?.()||null,activeId:window.NitrosActiveRepairPersistence?.getActiveId?.()||null,savedCard:document.querySelector('#activeRepairOrderList [data-ro-id="${roId}"]')?.dataset.roId||null,errors:window.__homeTestErrors||[]})`);
  assert.equal(boot.screen,'home','fresh launch must land on Home even when an unfinished RO exists');
  assert.equal(boot.activeId,roId,'startup must preserve the active RO pointer');
  assert.equal(boot.savedCard,roId,'unfinished RO must remain available under Active Jobs');
  const startupRecord=await session.evaluate(`(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('NitrosRepairOrders',1);r.onsuccess=()=>resolve(r.result)});const row=await new Promise(resolve=>{const q=db.transaction('repairOrders').objectStore('repairOrders').get('${roId}');q.onsuccess=()=>resolve(q.result)});db.close();return {recordDraft:row?.draft?.fields?.customerName||null,localDraft:JSON.parse(localStorage.getItem('nitros_prototype_v073_active_draft')||'null')?.fields?.customerName||null}})()`);
  assert.equal(startupRecord.recordDraft,'Synthetic Customer','the persisted synthetic RO must retain its original draft during startup hydration');

  await session.reload(origin);
  await session.waitFor(`window.NitrosRepairOrderCore?.getScreen?.()==='home'&&window.NitrosActiveRepairPersistence?.getActiveId?.()==='${roId}'`);
  assert.equal(await session.evaluate(`document.querySelector('#workorder')?.classList.contains('active')`),false,'refresh must not reopen the unfinished RO');
  await session.close();session=null;

  session=await ChromeSession.launch(profile,origin,'/');
  assert.equal(await session.evaluate('window.NitrosRepairOrderCore.getScreen()'),'home','browser close/reopen must start at Home');
  assert.equal(await session.evaluate(`window.NitrosActiveRepairPersistence.getActiveId()`),roId,'browser restart must preserve the unfinished RO');
  await session.waitFor('window.NitrosActiveRepairPersistence.getDiagnostics().restored===true');
  await session.waitFor(`document.querySelector('#activeRepairOrderList [data-ro-id="${roId}"]')`);
  await session.evaluate(`document.querySelector('#activeRepairOrderList [data-ro-id="${roId}"]').click()`);
  await session.waitFor(`window.NitrosRepairOrderCore?.getScreen?.()==='workorder'`);
  const selectedState=await session.evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('NitrosRepairOrders',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const row=await new Promise(resolve=>{const q=db.transaction('repairOrders').objectStore('repairOrders').get('${roId}');q.onsuccess=()=>resolve(q.result)});db.close();return {screen:window.NitrosRepairOrderCore.getScreen(),hasField:Boolean(document.getElementById('customerName')),input:document.getElementById('customerName')?.value||null,localDraft:localStorage.getItem('nitros_prototype_v073_active_draft'),recordDraft:row?.draft?.fields?.customerName||null,diagnostic:window.NitrosActiveRepairPersistence.getDiagnostics()}})()`);
  assert.equal(selectedState.input,'Synthetic Customer',`the selected unfinished RO should hydrate only after explicit selection; state=${JSON.stringify(selectedState)}`);

  const completed=await session.evaluate(`window.NitrosActiveRepairPersistence.complete()`);
  assert.equal(completed,true,'completion should finish in the isolated synthetic profile');
  assert.equal(await session.evaluate('window.NitrosRepairOrderCore.getScreen()'),'home','completed RO must return to Home');
  const saved=await session.evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('NitrosRepairOrders',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const row=await new Promise((resolve,reject)=>{const q=db.transaction('repairOrders').objectStore('repairOrders').get('${roId}');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});db.close();return {status:row?.status,id:row?.id,pointer:localStorage.getItem('activeRepairOrderId'),activeCount:await window.NitrosActiveRepairPersistence.listActive().then(rows=>rows.length)}})()`);
  assert.equal(saved.status,'archived','completion must retain the persisted RO as an archived record instead of deleting it');
  assert.equal(saved.id,roId);
  assert.equal(saved.pointer,null,'completed RO must no longer be the active pointer');
  assert.equal(saved.activeCount,0,'completion must not create a replacement blank active RO');
  await session.close();session=null;
  session=await ChromeSession.launch(profile,origin,'/');
  assert.equal(await session.evaluate('window.NitrosRepairOrderCore.getScreen()'),'home','reopening after completion must remain on Home');
  const finalStatus=await session.evaluate(`(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('NitrosRepairOrders',1);r.onsuccess=()=>resolve(r.result)});const row=await new Promise(resolve=>{const q=db.transaction('repairOrders').objectStore('repairOrders').get('${roId}');q.onsuccess=()=>resolve(q.result)});db.close();return row?.status})()`);
  assert.equal(finalStatus,'archived','completed history must persist across browser restart');
  void origin;
});
