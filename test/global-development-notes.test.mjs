import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=html.match(/<script id="nitros-global-development-notes">([\s\S]*?)<\/script>/)?.[1]||'';

test('global development note has an independent floating overlay and save wording',()=>{
  assert.match(html,/id="globalDevelopmentNoteButton"[\s\S]*?Dev Note/);
  assert.match(html,/id="globalDevelopmentNoteOverlay"[\s\S]*?role="dialog"/);
  assert.match(html,/Save Development Note/);
  assert.match(html,/will not be attached to the active repair order/i);
  assert.match(html,/\.global-dev-note-fab\{position:fixed[\s\S]*?safe-area-inset-bottom/);
});

test('global development notes persist with build timestamp and screen but no RO association',()=>{
  assert.match(script,/nitros_global_development_notes_v1/);
  assert.match(script,/localStorage\.setItem\(STORAGE_KEY,JSON\.stringify\(notes\)\)/);
  for(const field of ["scope:'global'","type:'development-note'",'createdAt','date:','time:','NitrosBuild?.version','screen:location()'])assert.match(script,new RegExp(field.replace(/[?.]/g,'\\$&')));
  assert.doesNotMatch(script,/activeRepairOrderId|repairOrderId|roNumber|workOrderNumber|Save to (?:Active )?Repair/i);
});

test('vehicle and repair voice-note implementations remain present and separate',()=>{
  assert.match(html,/id="nitros-quick-vehicle-information"/);
  assert.match(html,/id="quickVehicleButton"/);
  assert.match(html,/id="quickVoice"[\s\S]*?Voice Note/);
  assert.match(html,/id="saveQuickVoice"[\s\S]*?Save to Active Repair/);
  assert.match(html,/window\.NitrosGlobalDevelopmentNotes=Object\.freeze/);
});
