import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('vehicle information is an independent view-only overlay',()=>{
  assert.match(html,/id="quickVehicleButton"[\s\S]*?Vehicle/);
  assert.match(html,/id="quickVehicleOverlay"[\s\S]*?role="dialog"/);
  assert.match(html,/id="nitros-floating-quick-notes"[\s\S]*?id="nitros-quick-vehicle-information"/);
  assert.doesNotMatch(html.match(/<script id="nitros-quick-vehicle-information">([\s\S]*?)<\/script>/)?.[1]||'',/\.value\s*=|localStorage\.setItem|indexedDB\.(?:open|deleteDatabase)/);
});

test('vehicle information uses active RO and existing draft fields',()=>{
  const script=html.match(/<script id="nitros-quick-vehicle-information">([\s\S]*?)<\/script>/)?.[1]||'';
  assert.match(script,/activeRepairOrderId/);
  assert.match(script,/NitrosRepairOrderCore\?\.collectDraft/);
  for(const field of ['Year','Make','Model','Engine','VIN','EMISSIONS CERTIFICATION','Verification source','License plate','Mileage','Repair Order','Customer'])assert.match(script,new RegExp(`['"]${field}['"]`));
  assert.match(script,/if\(!activeRepairId&&!repairOrder\)return null/);
  assert.match(script,/selected\.emissionsCertification\|\|fields\.emissionsCertification/);
  assert.match(script,/selected\.certificationSource\|\|fields\.certificationSource/);
  assert.match(script,/Unknown — Needs Verification/);
  assert.match(script,/Verified from \$\{emissionsSource\}/);
});

test('vehicle and notes controls use separate compact safe-area positions',()=>{
  assert.match(html,/\.quick-vehicle-fab\{position:fixed[\s\S]*?safe-area-inset-bottom/);
  assert.match(html,/\.quick-notes-fab\{position:fixed[\s\S]*?safe-area-inset-bottom/);
  assert.match(html,/\.quick-vehicle-overlay\{[\s\S]*?padding-top:max\(12px,env\(safe-area-inset-top\)\)/);
  assert.match(html,/\.quick-vehicle-fab\[hidden\]\{display:none\}/);
});
