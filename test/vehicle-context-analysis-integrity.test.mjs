import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeVehicleAnalysisContext } from '../semantic-analyzer-core.mjs';

const client=readFileSync(new URL('../image-analysis-ad.js',import.meta.url),'utf8');
const crv={year:'2009',make:'Honda',model:'CR-V',engine:'2.4L',vin:'5J6RE48309L000001',activeCaseId:'RO-CRV',repairOrderId:'RO-CRV',vehicleId:'VEH-CRV',contextVersion:'RO-CRV:1'};
const ecosport={year:'2018',make:'Ford',model:'EcoSport',engine:'2.0L',vin:'MAJ6P1UL1JC000001',activeCaseId:'RO-FORD',repairOrderId:'RO-FORD',vehicleId:'VEH-FORD',contextVersion:'RO-FORD:1'};

test('analysis vehicle snapshots retain complete structured identity',()=>{
  const normalized=normalizeVehicleAnalysisContext(crv);
  assert.deepEqual(normalized,{...crv,fuelType:'',drivetrain:'',configuration:'',source:''});
  assert.notDeepEqual(normalized,normalizeVehicleAnalysisContext(ecosport));
});

test('client snapshots context at analysis start and passes it through every retry',()=>{
  assert.match(client,/const vehicleContextSnapshot=createAnalysisVehicleSnapshot\(\)/);
  assert.match(client,/vehicleContextSnapshot:run\.analyzer\.vehicleContextSnapshot/);
  assert.match(client,/const vehicleContext=vehicleContextSnapshot\|\|null/);
  assert.match(client,/Object\.freeze\(\{\.\.\.context\}\)/);
});

test('late or mismatched vehicle results are rejected before rendering',()=>{
  assert.match(client,/Vehicle Context Snapshot/);
  assert.match(client,/vehicleContextMismatchBlocked=true/);
  assert.match(client,/Vehicle context mismatch — stale vehicle-aware result was blocked/);
  assert.match(client,/sameVehicleContext\(requestedVehicleContext,vehicleContextBinding\)/);
});

test('accepted automotive relationship stages complete with deterministic PASS or FAIL',()=>{
  assert.match(client,/function finalizeAcceptedAnalysisStages/);
  assert.match(client,/set\(21,complete\?'PASS':'FAIL'\);set\(22,complete\?'PASS':'FAIL'\);set\(23,complete\?'PASS':'FAIL'\)/);
  assert.match(client,/finalizeAcceptedAnalysisStages\(run,routed\)/);
  assert.match(client,/set\(24,contextPass\?'PASS':'FAIL'\);set\(25,contextPass\?'NOT DETERMINED':'FAIL'\)/);
  assert.match(client,/set\(24,'NOT AVAILABLE'\);set\(25,'NOT DETERMINED'\)/);
});

test('two-layer lock uses diagnostic active-case authority and aborts before dispatch on a vehicle switch',()=>{
  assert.match(client,/diagnosticVehicle=diagnostic\.vehicle&&diagnostic\.vehicle\.year&&diagnostic\.vehicle\.make&&diagnostic\.vehicle\.model/);
  assert.match(client,/VEHICLE_CONTEXT_MISMATCH: active vehicle changed before request dispatch/);
  assert.match(client,/nitrosActiveVehicleContext/);
  assert.match(client,/nitrosAnalysisVehicleSnapshot/);
});
