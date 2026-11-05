import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const persistence=html.match(/<script id="v10127ae-active-ro-persistence">([\s\S]*?)<\/script>/)?.[1]||'';

test('fresh launch and browser reload keep the authenticated portal on Home with saved jobs retained',()=>{
  assert.match(html,/if\(profile\?\.name\)\{[\s\S]*?portalRoute\("home"\);\}else portalRoute\("login"\)/);
  assert.match(persistence,/async function restoreActive\(id=localStorage\.getItem\(POINTER\)\|\|'',\{navigate=false\}=\{\}\)/);
  assert.match(persistence,/if\(navigate\)core\.showScreen\(target,false\)/);
  assert.match(persistence,/const boot=async\(\)=>\{try\{await openDb\(\);await restoreActive\(\);(?:await window\.NitrosSignatureEvidence\?\.restoreActiveOrder\?\.\(\);)?await renderActiveRepairOrders\(\)/);
  assert.match(html,/window\.addEventListener\("pageshow",\(\)=>\{[\s\S]*?showScreen\("home",false\)/);
  assert.match(html,/window\.addEventListener\("popstate",event=>\{const target=event\.state\?\.nitrosScreen\|\|"home",workflows=new Set\([\s\S]*?showScreen\(workflows\.has\(target\)\?"home":target,false\)/);
  assert.match(html,/if\(target==="home"\)\{\s*clearTimeout\(draftSaveTimer\);\s*refreshDraftPanel\(\);\s*\}else scheduleDraftSave\(\)/);
  assert.match(html,/window\.addEventListener\("pagehide",\(\)=>\{if\(new Set\(\["checkin"[\s\S]*?\.has\(currentScreenId\)\)saveDraft\(\);stopCamera\(\);\}\)/);
});

test('unfinished ROs appear in Active Jobs and route only after a selected card is clicked',()=>{
  assert.match(persistence,/async function renderActiveJobs\(\)[\s\S]*?await openRepairOrder\(button\.dataset\.roId\)/);
  assert.match(persistence,/async function openRepairOrder\(id\)[\s\S]*?restoreActive\(selectedId,\{navigate:true\}\)/);
  assert.match(persistence,/async function resumeCurrentRepairOrder\(\)\{await showActiveJobs\(\);return false\}/);
  assert.match(html,/if\(type==='active'\)\{window\.NitrosActiveRepairPersistence\?\.resume\?\.\(\);return\}/);
  assert.doesNotMatch(html,/if\(type==='active'\)\{restoreDraft\(true\);return\}/);
  assert.match(persistence,/async function renderActiveRepairOrders\(\)[\s\S]*?await openRepairOrder\(button\.dataset\.roId\)/);
});

test('completion returns Home, archives the existing record, and cannot open or create a replacement RO',()=>{
  assert.match(persistence,/async function completeActiveRepairOrder\(\)[\s\S]*?status:'archived',archivedAt:completedAt,completedAt/);
  assert.match(persistence,/localStorage\.removeItem\(POINTER\);localStorage\.removeItem\(core\.draftKey\)[\s\S]*?core\.showScreen\('home'\)/);
  assert.match(persistence,/if\(ok\)void completeActiveRepairOrder\(\)\.catch/);
  assert.doesNotMatch(persistence,/if\(ok\)abandon\('Complete Repair Order'\)/);
  assert.doesNotMatch(persistence,/completeActiveRepairOrder[\s\S]{0,500}ensureActive\(\)/);
});

test('closing an unfinished RO saves it and returns Home without opening the Active Jobs modal',()=>{
  assert.match(persistence,/async function exitCurrentRepairOrder\(\)\{await persist\('exit repair order to active jobs',true\)/);
  assert.match(persistence,/\$\('activeJobsModal'\)\?\.classList\.add\('hidden'\);core\.showScreen\('home'\);await renderActiveRepairOrders\(\)/);
  assert.match(html,/id="activeRepairOrderList"/);
});
