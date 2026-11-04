import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { manualBackupNotice } from '../backup/manual-backup-outcome.mjs';

test('a backup deferred by another tab produces an actionable notice',()=>{
  assert.match(manualBackupNotice({deferred:true,reason:'Another tab holds the backup lock'}),/close or finish backup work.*then retry/i);
});

test('unknown deferral reasons use a safe, useful fallback',()=>{
  const message=manualBackupNotice({deferred:true,reason:'sensitive or unexpected detail'});
  assert.match(message,/backup lock.*retry when it finishes/i);
  assert.doesNotMatch(message,/sensitive or unexpected detail/i);
});

test('missing or incomplete save results are reported as unconfirmed',()=>{
  assert.match(manualBackupNotice(undefined),/not confirmed as saved.*check backup history/i);
  assert.match(manualBackupNotice({status:'SUCCESS'}),/not confirmed as saved/i);
  assert.match(manualBackupNotice({status:'FAILED',error:'raw detail'}),/not confirmed as saved/i);
});

test('a saved encrypted backup does not produce a contradictory failure notice',()=>{
  assert.equal(manualBackupNotice({status:'SUCCESS',encrypted:{format:'nitros-encrypted-backup'}}),null);
});

test('Backup Now awaits save and surfaces its deferred outcome; unsupported locking fails clearly',async()=>{
  const ui=await readFile(new URL('../backup/secure-ui.mjs',import.meta.url),'utf8');
  const html=await readFile(new URL('../backup/secure.html',import.meta.url),'utf8');
  assert.match(html,/<button id="backup">Back Up Now — encrypted<\/button>/);
  assert.match(ui,/\$\('backup'\)\.onclick=\(\)=>run\(async\(\)=>\{const result=await save\(\);const notice=manualBackupNotice\(result\);if\(notice\)show\(notice\);\}\)/);
  assert.match(ui,/if\(!navigator\.locks\?\.request\)throw new Error\('This browser does not support safe backup locking/);
});

test('manual backup failures are visible and overlapping operations are guarded',async()=>{
  const ui=await readFile(new URL('../backup/secure-ui.mjs',import.meta.url),'utf8');
  assert.match(ui,/async function run\(fn\)\{if\(busy\|\|uploadController\)\{show\('Action not started: another operation is running/);
  assert.match(ui,/catch\(e\)\{show\('Stopped safely: '\+e\.message\)\}finally\{busy=false;/);
  assert.match(ui,/navigator\.locks\.request\('nitros-encrypted-backup',\{ifAvailable:true\}/);
  assert.match(ui,/history refreshed: \$\{files\.length\} encrypted backup file\(s\) found for this verified account and namespace/);
});
