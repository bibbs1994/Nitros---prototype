import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('multiple active ROs use stable IndexedDB records and an active pointer',()=>{
  assert.match(html,/DB_NAME='NitrosRepairOrders',STORE='repairOrders',POINTER='activeRepairOrderId'/);
  assert.match(html,/function ensureActive\(\)\{if\(activeId\)return activeId;activeId=uid\(\)/);
  assert.match(html,/async function listActive\(\)/);
  assert.match(html,/async function openRepairOrder\(id\)/);
});

test('new RO flow saves current work, offers return, and requires second discard confirmation',()=>{
  assert.match(html,/Save Current RO & Start New RO/);
  assert.match(html,/Return to Current RO/);
  assert.match(html,/Discard Current Draft/);
  assert.match(html,/Permanently Discard Draft/);
  assert.match(html,/await persist\('save current and start new',true\)/);
  assert.match(html,/core\.resetActiveWorkspace\(true\)/);
  assert.doesNotMatch(html,/Starting a new repair order will discard that active draft/);
});

test('active RO restore isolates diagnostics and photo records by RO id',()=>{
  assert.match(html,/await core\.setActivePhotoRecord\?\.\(activeId\)/);
  assert.match(html,/core\.setActivePhotoRecord\?\.\(activeId\)\.then\(\(\)=>persist\('workflow stage',true\)\)/);
  assert.match(html,/photoStorageReference:core\.activePhotoRecord\|\|null/);
  assert.match(html,/record\.diagnosticInformation\)localStorage\.setItem\('nitros_diagnostic_case_v10120'/);
  assert.match(html,/activeRecord=\(\)=>window\.NitrosRepairOrderCore\?\.activePhotoRecord\|\|"active-draft"/);
});
