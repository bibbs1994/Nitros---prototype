import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('each saved-job control restores only its own RO ID',()=>{
  assert.match(html,/data-ro-id="\$\{record\.id\}"/);
  assert.match(html,/async function openRepairOrder\(id\)\{const selectedId=String\(id\|\|''\)\.trim\(\);if\(!selectedId\)return false;if\(selectedId!==activeId\)await persist\('switch repair order',true\);return restoreActive\(selectedId,\{navigate:true\}\)\}/);
  assert.match(html,/const record=await get\(requestedId\)/);
  assert.match(html,/activeId=requestedId;restoring=true/);
  assert.match(html,/await openRepairOrder\(button\.dataset\.roId\)/);
});

test('Resume Current Job opens Active Jobs and requires an explicit repair-order selection',()=>{
  assert.match(html,/async function resumeCurrentRepairOrder\(\)\{await showActiveJobs\(\);return false\}/);
  assert.match(html,/id="resumeDraft"[\s\S]*?Resume Current Job/);
  assert.match(html,/getElementById\("resumeDraft"\)\?\.addEventListener\("click",\(\)=>window\.NitrosActiveRepairPersistence\?\.resume\?\.\(\)\)/);
  assert.match(html,/getElementById\('dashResumeJob'\)\?\.addEventListener\('click',\(\)=>window\.NitrosActiveRepairPersistence\?\.resume\?\.\(\)\)/);
  assert.doesNotMatch(html,/getElementById\('dashResumeJob'\)\?\.addEventListener\('click',\(\)=>go\('workorder'\)\)/);
});

test('a relaunch hydrates a saved RO without navigating away from Home; explicit selection opens its workflow',()=>{
  assert.match(html,/localStorage\.setItem\(core\.draftKey,JSON\.stringify\(record\.draft\|\|\{\}\)\)/);
  assert.match(html,/await core\.setActivePhotoRecord\?\.\(activeId\)/);
  assert.match(html,/restoreTimer\(record\.laborTimer\)/);
  assert.match(html,/const target=savedRoScreen\(record\);restored=true/);
  assert.match(html,/if\(navigate\)core\.showScreen\(target,false\)/);
  assert.match(html,/restoreActive\(selectedId,\{navigate:true\}\)/);
  assert.match(html,/async function resumeCurrentRepairOrder\(\)\{await showActiveJobs\(\);return false\}/);
  assert.match(html,/await openDb\(\);await restoreActive\(\);(?:await window\.NitrosSignatureEvidence\?\.restoreActiveOrder\?\.\(\);)?await renderActiveRepairOrders\(\)/);
  assert.match(html,/if\(navigate\)core\.showScreen\(target,false\)/);
});

test('missing or invalid saved routes fall back safely without deleting a valid RO',()=>{
  assert.match(html,/function savedRoScreen\(record\)\{const candidates=\[record\?\.currentWorkflowStage,record\?\.draft\?\.screen\];return candidates\.find\(screen=>roScreens\.has\(screen\)\)\|\|'workorder'\}/);
  assert.match(html,/if\(!record\|\|record\.status!=='active'\)\{if\(requestedId===activeId\|\|requestedId===localStorage\.getItem\(POINTER\)\)\{activeId='';localStorage\.removeItem\(POINTER\)\}/);
  assert.doesNotMatch(html,/savedRoScreen\([\s\S]{0,300}remove\(/);
});
