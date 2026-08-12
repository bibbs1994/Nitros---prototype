import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('Oliver automatically opens in RO mode when any active repair identity exists',()=>{
  assert.match(html,/const hasActiveRepair=Boolean\(localStorage\.getItem\('activeRepairOrderId'\).*nitros_active_repair_order.*nitros_active_workboard_id/);
  assert.match(html,/openOliverDiagnosticMode\(hasActiveRepair\?'ro':'general'\)/);
});

test('RO context aggregates the full available repair record without adding UI',()=>{
  for(const source of ['nitros_prototype_v073_active_draft','nitros_v822_workboard','nitros_prototype_customer_history_v070','NitrosDiagnosticV10120','activePhotoRecord'])assert.match(html,new RegExp(source));
  for(const field of ['activeRepairId','ro','year','make','model','engine','vehicle','vin','mileage','customer','concern','dtcs','notes','technicianFindings','previousTests','repairHistory','repairStatus','currentStage','photos','uploadedEvidence','history','verifiedRepairInformation'])assert.match(html,new RegExp(`\\b${field}\\b`));
  assert.match(html,/Object\.assign\(caseData,vehicle,\{vehicle:c\.vehicle\|\|caseData\.vehicle,vin:c\.vin\|\|caseData\.vin,repairOrderId:/);
  assert.match(html,/window\.NitrosDiagnosticV10120\?\.attachRepairOrderContext\?\.\(c\)/);
});

test('RO conversation contract uses known facts and rejects mandatory intake',()=>{
  assert.match(html,/Never ask for a fact that is already present anywhere in the repair-order context/);
  assert.match(html,/Do not follow a mandatory intake sequence/);
  assert.match(html,/Ask at most one concise question, and only when its answer materially changes diagnostic direction/);
  assert.match(html,/Recommend the single best next test from the evidence/);
});

test('voice changes are delivery-only and expose a future provider abstraction',()=>{
  assert.match(html,/Voice-delivery layer only: keep Oliver's diagnostic words and decisions unchanged/);
  assert.match(html,/persona:'calm-seasoned-master-technician'/);
  assert.match(html,/providerAdapter:'future-ready'/);
  assert.equal((html.match(/new SpeechSynthesisUtterance\(/g)||[]).length,1);
});
