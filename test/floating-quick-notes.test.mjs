import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('floating quick notes UI is globally available and mobile safe',()=>{
  assert.match(html,/id="quickNotesButton"[\s\S]*?Notes/);
  assert.match(html,/id="quickNotesOverlay"[\s\S]*?role="dialog"/);
  assert.match(html,/position:fixed[\s\S]*?env\(safe-area-inset-bottom\)/);
});

test('quick notes persist independently with required categories and filters',()=>{
  assert.match(html,/nitros_quick_notes_v1/);
  for(const category of ['Repair Note','Customer Note','Development Idea','NATI Idea','General Note'])assert.match(html,new RegExp(category));
  for(const filter of ['All Notes','Current RO','Development Ideas','NATI Ideas'])assert.match(html,new RegExp(filter));
  assert.match(html,/localStorage\.setItem\(STORAGE_KEY,JSON\.stringify\(notes\)\)/);
});

test('notes capture active repair context and support edit pin and confirmed deletion',()=>{
  for(const field of ['activeRepairId','repairOrderId','vin','vehicle','customer','technician'])assert.match(html,new RegExp(field));
  assert.match(html,/data-action="pin"/);
  assert.match(html,/data-action="edit"/);
  assert.match(html,/confirm\('Delete this note\?/);
  assert.match(html,/window\.NitrosQuickNotes=Object\.freeze/);
});
