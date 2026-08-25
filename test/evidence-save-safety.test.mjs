import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const evidence=html.match(/<script>[\s\S]*?\/\/ v8\.1\.3 Smart Evidence System[\s\S]*?<\/script>/)?.[0]||'';

test('Evidence Save snapshots the active RO before beginning evidence storage',()=>{
  assert.match(evidence,/async function snapshotActiveRo\(\)\{[\s\S]*?core\?\.collectDraft\?\.\(\)[\s\S]*?manager\?\.persistNow\?\.\(\)/);
  assert.match(evidence,/recordId=await withTimeout\(snapshotActiveRo\(\),"Repair-order snapshot"\)/);
  assert.match(evidence,/await withTimeout\(window\.NitrosActiveRepairPersistence\?\.persistNow\?\.\(\)\|\|Promise\.resolve\(\),"Repair-order evidence snapshot"\)/);
});

test('successful evidence is stored atomically once per evidence ID and timeline prefers the annotated record',()=>{
  assert.match(evidence,/async function putMany\(entries\)\{[\s\S]*?const tx=db\.transaction\(STORE,"readwrite"\),store=tx\.objectStore\(STORE\);entries\.forEach\(entry=>store\.put\(entry\)\)/);
  assert.match(evidence,/let recordId=activeRecord\(\),id=pendingEvidenceId\|\|`additionalEvidence_\$\{Date\.now\(\)\}`/);
  assert.match(evidence,/pendingEvidenceId=id/);
  assert.match(evidence,/const response=await withTimeout\(putMany\(\[\{\.\.\.meta,key:`\$\{recordId\}:\$\{id\}_original`/);
  assert.match(evidence,/if\(!prior\|\|\/_annotated\$\/i\.test\(item\.fieldId\|\|""\)\)byEvidence\.set\(key,item\)/);
});

test('offline, timeout, invalid response, and repeated save failures preserve the active RO with a clear recovery message',()=>{
  assert.match(evidence,/function withTimeout\(promise,operation,ms=15000\)/);
  assert.match(evidence,/if\(!response\|\|response\.status!=="local-indexeddb"\)throw new Error\("Invalid evidence storage response"\)/);
  assert.match(evidence,/if\(saveBusy\)return/);
  assert.match(evidence,/saveBusy=true;saveButton\.disabled=true/);
  assert.match(evidence,/saveBusy=false;saveButton\.disabled=false/);
  assert.match(evidence,/preserveRoScreen\(originScreen\)/);
  assert.match(evidence,/Evidence could not be saved\. Your repair order is safe\. Please try again\./);
  assert.doesNotMatch(evidence,/location\.reload|window\.location\s*=/);
});

test('evidence errors log safe operation metadata without photo blobs',()=>{
  assert.match(evidence,/function logEvidenceSave\(operation,roId,evidenceId,error=null,status="local-indexeddb"\)/);
  assert.match(evidence,/operation,roId:String\(roId\|\|""\),evidenceId:String\(evidenceId\|\|""\),errorMessage:error\?safeMessage\(error\):"",responseStatus/);
  const logger=evidence.match(/function logEvidenceSave\([^\n]+/)[0];
  assert.doesNotMatch(logger,/blob|originalBlob|base64|data:/i);
});
