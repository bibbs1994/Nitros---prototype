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

test('Back restores the exact active RO through persistence with a safe screen fallback',()=>{
  assert.match(guard,/NitrosActiveRepairPersistence\?\.restore==='function'\)restored=await window\.NitrosActiveRepairPersistence\.restore\(saved\.id\)/);
  assert.match(guard,/localStorage\.setItem\(POINTER,saved\.id\)/);
  assert.match(guard,/core\.showScreen\(saved\.screen\|\|'workorder',false\)/);
  assert.match(guard,/control\.classList\.contains\('back'\).*?void restore\('Back'\)/s);
});

test('blank-screen recovery is guarded and always exposes Active Jobs recovery',()=>{
  assert.match(guard,/new MutationObserver\(recoverBlank\)\.observe\(document\.body/);
  assert.match(guard,/void restore\('blank-screen recovery'\)/);
  assert.match(html,/id="nitrosRoRecoveryJobs"[^>]*>Return to Active Jobs/);
  assert.match(guard,/closeSecondaryUi\(\);releaseLocks\(\)/);
});
