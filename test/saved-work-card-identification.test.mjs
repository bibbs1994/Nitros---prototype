import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.match(/function savedWorkLabel\(record\)\{[^\n]+/)[0];
const savedWorkLabel=Function(`${source};return savedWorkLabel;`)();

test('Saved Work uses customer and full vehicle as the primary label',()=>{
  const label=savedWorkLabel({id:'RO-internal-long-id',draft:{fields:{customerName:'Oscar',roNumber:'RO-202608221174504',concern:'Turbo / boost concern'},selectedVehicle:{year:'2007',make:'Dodge',model:'Ram 1500'}}});
  assert.equal(label.title,'Oscar • 2007 Dodge Ram 1500');
  assert.equal(label.concern,'Turbo / boost concern');
  assert.equal(label.ro,'RO-202608221174504');
});

test('Saved Work gracefully falls back for partial customer, vehicle, and RO-only records',()=>{
  assert.equal(savedWorkLabel({id:'internal-1',draft:{fields:{customerName:'Oscar',roNumber:'RO-2'},selectedVehicle:{make:'Volkswagen',model:'Jetta'}}}).title,'Oscar • Volkswagen Jetta');
  assert.equal(savedWorkLabel({id:'internal-2',draft:{fields:{roNumber:'RO-3'},selectedVehicle:{year:'2007',make:'Dodge',model:'Ram 1500'}}}).title,'2007 Dodge Ram 1500');
  assert.equal(savedWorkLabel({id:'RO-legacy-only',draft:{fields:{},selectedVehicle:{}}}).title,'RO-legacy-only');
});

test('concern is a concise separate display line and internal id is only a fallback',()=>{
  const label=savedWorkLabel({id:'RO-very-long-internal-identifier-1234567890',draft:{fields:{customerName:'John Smith',workOrderNumber:'RO-22',concern:'x'.repeat(120)},selectedVehicle:{year:'2016',make:'Volkswagen',model:'Jetta'}}});
  assert.equal(label.title,'John Smith • 2016 Volkswagen Jetta');
  assert.equal(label.ro,'RO-22');
  assert.ok(label.concern.length<=96);
  assert.match(label.concern,/…$/);
  assert.match(html,/history-meta">\$\{escape\(label\.concern\)\}/);
});

test('card remains independently selectable and retains the Saved Work removal action',()=>{
  assert.match(html,/active-ro-open/);
  assert.match(html,/active-ro-menu/);
  assert.match(html,/removeFromSavedWork\(button\.dataset\.roId\)/);
});
