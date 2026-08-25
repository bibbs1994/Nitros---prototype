import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('each saved-job control restores only its own RO ID',()=>{
  assert.match(html,/data-ro-id="\$\{record\.id\}"/);
  assert.match(html,/async function openRepairOrder\(id\)\{const selectedId=String\(id\|\|''\)\.trim\(\);if\(!selectedId\)return false;if\(selectedId!==activeId\)await persist\('switch repair order',true\);return restoreActive\(selectedId\)\}/);
  assert.match(html,/const record=await get\(requestedId\)/);
  assert.match(html,/activeId=requestedId;restoring=true/);
  assert.match(html,/await openRepairOrder\(button\.dataset\.roId\)/);
});

test('Resume Current Job restores the most recently active saved RO rather than generic Check-In',()=>{
  assert.match(html,/async function resumeCurrentRepairOrder\(\)\{let selectedId=activeId\|\|localStorage\.getItem\(POINTER\)\|\|'';if\(!selectedId\)\{const records=await listActive\(\);selectedId=records\[0\]\?\.id\|\|''\}return selectedId\?restoreActive\(selectedId\):false\}/);
  assert.match(html,/id="resumeDraft"[\s\S]*?Resume Current Job/);
  assert.match(html,/getElementById\("resumeDraft"\)\?\.addEventListener\("click",\(\)=>window\.NitrosActiveRepairPersistence\?\.resume\?\.\(\)\)/);
  assert.match(html,/getElementById\('dashResumeJob'\)\?\.addEventListener\('click',\(\)=>window\.NitrosActiveRepairPersistence\?\.resume\?\.\(\)\)/);
  assert.doesNotMatch(html,/getElementById\('dashResumeJob'\)\?\.addEventListener\('click',\(\)=>go\('workorder'\)\)/);
});

test('a relaunch restores the saved RO snapshot and its valid workflow position',()=>{
  assert.match(html,/localStorage\.setItem\(core\.draftKey,JSON\.stringify\(record\.draft\|\|\{\}\)\)/);
  assert.match(html,/await core\.setActivePhotoRecord\?\.\(activeId\)/);
  assert.match(html,/restoreTimer\(record\.laborTimer\)/);
  assert.match(html,/const target=savedRoScreen\(record\)/);
  assert.match(html,/await openDb\(\);await restoreActive\(\)/);
});

test('missing or invalid saved routes fall back safely without deleting a valid RO',()=>{
  assert.match(html,/function savedRoScreen\(record\)\{const candidates=\[record\?\.currentWorkflowStage,record\?\.draft\?\.screen\];return candidates\.find\(screen=>roScreens\.has\(screen\)\)\|\|'workorder'\}/);
  assert.match(html,/if\(!record\|\|record\.status!=='active'\)\{if\(requestedId===activeId\|\|requestedId===localStorage\.getItem\(POINTER\)\)\{activeId='';localStorage\.removeItem\(POINTER\)\}/);
  assert.doesNotMatch(html,/savedRoScreen\([\s\S]{0,300}remove\(/);
});
