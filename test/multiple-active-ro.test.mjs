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

test('new RO flow protects an unfinished draft and requires confirmed discard',()=>{
  assert.match(html,/Keep Current RO/);
  assert.match(html,/Save Current RO & Start New RO/);
  assert.match(html,/Discard Draft & Start New RO/);
  assert.match(html,/Cancel — Keep Draft/);
  assert.match(html,/Confirm Discard & Start New RO/);
  assert.match(html,/if\(choice==='keep'\)\{await restoreActive\(activeId\);return\}/);
  assert.match(html,/if\(choice==='discard'&&!\(await confirmDiscard\(\)\)\)return/);
  assert.match(html,/await abandon\('Confirmed discard before starting new repair order'\)/);
  assert.match(html,/else await persist\('save current and start new',true\)/);
  assert.match(html,/activeJobsNewRo[\s\S]*?await startNewRepairOrder\(\)/);
  assert.doesNotMatch(html,/startNewRepairOrder\(true\)/);
  assert.match(html,/core\.resetActiveWorkspace\(true\)/);
  assert.match(html,/Other saved and active jobs will remain available/);
});

test('active RO restore isolates diagnostics and photo records by RO id',()=>{
  assert.match(html,/await core\.setActivePhotoRecord\?\.\(activeId\)/);
  assert.match(html,/core\.setActivePhotoRecord\?\.\(activeId\)\.then\(\(\)=>persist\('workflow stage',true\)\)/);
  assert.match(html,/photoStorageReference:core\.activePhotoRecord\|\|null/);
  assert.match(html,/record\.diagnosticInformation\)localStorage\.setItem\('nitros_diagnostic_case_v10120'/);
  assert.match(html,/activeRecord=\(\)=>window\.NitrosRepairOrderCore\?\.activePhotoRecord\|\|"active-draft"/);
});
