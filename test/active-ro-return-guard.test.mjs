import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const guard=html.match(/<script id="nitros-active-ro-return-guard">([\s\S]*?)<\/script>/)?.[1]||'';

test('secondary tools persist an active RO return context before opening',()=>{
  assert.match(guard,/const toolControls=new Set\(\['quickEvidence','floatingEvidenceButton','quickSearch','quickNotesButton','quickVehicleButton','globalDevelopmentNoteButton','nitrosSupportInboxButton'\]\)/);
  assert.match(guard,/draft:window\.NitrosRepairOrderCore\?\.collectDraft\?\.\(\)\|\|null/);
  assert.match(guard,/NitrosActiveRepairPersistence\?\.persistNow\?\.\(\)/);
  assert.match(guard,/control\.closest\?\.\('#mobileToolsMenu'\)/);
});

test('Back and return navigation leave unfinished work saved and route Home',()=>{
  assert.match(guard,/core\.showScreen\('home',false\)/);
  assert.match(guard,/clear\(\);\s*if\(typeof core\?\.showScreen==='function'\)core\.showScreen\('home',false\)/);
  assert.doesNotMatch(guard,/NitrosActiveRepairPersistence\?\.restore==='function'/);
  assert.doesNotMatch(guard,/localStorage\.setItem\(POINTER,saved\.id\)/);
  assert.match(guard,/control\.classList\.contains\('back'\).*?void restore\('Back'\)/s);
});

test('blank-screen recovery routes Home and directs the technician to explicitly select from Active Jobs',()=>{
  assert.match(guard,/new MutationObserver\(recoverBlank\)\.observe\(document\.body/);
  assert.match(guard,/activateFallback\('home'\).*?clear\(\);showRecovery\('Your unfinished repair order remains saved\. Open Active Jobs and select it to continue\.'\)/s);
  assert.match(html,/id="nitrosRoRecoveryJobs"[^>]*>Return to Active Jobs/);
  assert.match(guard,/closeSecondaryUi\(\);releaseLocks\(\)/);
});
