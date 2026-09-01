import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileVehicleAreaRelationship, validateVehicleAreaRelationship } from '../semantic-analyzer-core.mjs';

const partial = () => ({ status:'INSUFFICIENT_CONTEXT', vehicleAreaLocation:'', locationEvidence:[], vehicleContextSupport:[], primaryVisibleAssembly:'', observedItems:[], expectedComponentCheck:{}, whatPreventsConfirmation:'', recommendedNextPhotoVerification:'' });
const engineContext = { componentIdentification:{ status:'UNCERTAIN', primaryComponent:'EGR-related electrical connector — exact identity uncertain', supportingEvidence:['An electrical connector and engine wiring harness are visible beside an EGR-related metal assembly.'], secondaryComponents:['engine wiring harness'] }, semanticResult:{ automotiveEvidence:['Underhood engine components and wiring are visible.'], objects:['engine wiring harness','electrical connector'] } };
const base = () => validateVehicleAreaRelationship(partial(),engineContext);
const assessment = (connectionState,evidence,observedObject='Electrical connector') => ({ connectionState, directVisibleEvidence:evidence, visibleEvidence:evidence, observedObject, location:'Upper-center engine area', connectionStateConfidence:94, findingConfidence:94 });

test('10.13.135 generalized vehicle area completes from normalized component evidence',()=>{
  const result=base();
  assert.equal(result.status,'READY');
  assert.match(result.vehicleAreaLocation,/engine/i);
  assert.equal(result.vehicleAreaSource,'derived');
});

test('10.13.135 disconnected connector relationship and guidance derive independently of exact identity',()=>{
  const result=reconcileVehicleAreaRelationship(base(),{connectionAssessments:[assessment('DISCONNECTED_VERIFIED','Electrical connector body is visibly separated from its matching socket with a clear air gap.')]});
  assert.equal(result.status,'READY');
  assert.equal(result.relationshipSource,'derived');
  assert.equal(result.observedItems[0].physicalConnectionState,'DISCONNECTED');
  assert.match(result.recommendedNextPhotoVerification,/connector and component-side electrical receptacle/i);
});

test('10.13.135 partially seated and connected states remain distinct',()=>{
  const partialResult=reconcileVehicleAreaRelationship(base(),{connectionAssessments:[assessment('PARTIALLY_SEATED','Connector is inserted unevenly with incomplete latch engagement.')]});
  const connectedResult=reconcileVehicleAreaRelationship(base(),{connectionAssessments:[assessment('CONNECTED_VERIFIED','Connector body is visibly inserted into the matching receptacle with continuous mating geometry.')]});
  assert.equal(partialResult.observedItems[0].physicalConnectionState,'PARTIALLY_CONNECTED');
  assert.equal(connectedResult.observedItems[0].physicalConnectionState,'CONNECTED');
});

test('10.13.135 disconnected hose derives a hose-to-port relationship',()=>{
  const result=reconcileVehicleAreaRelationship(base(),{connectionAssessments:[assessment('DISCONNECTED_VERIFIED','Vacuum hose end is visibly separated from the open intake port.','Vacuum hose')]});
  assert.equal(result.observedItems[0].physicalConnectionState,'DISCONNECTED');
  assert.match(result.observedItems[0].intendedRelationship,/hose or line connection/i);
  assert.match(result.recommendedNextPhotoVerification,/hose or line end|hose end/i);
});

test('10.13.135 multiple component relationships survive whole-image reconciliation',()=>{
  const result=reconcileVehicleAreaRelationship(base(),{connectionAssessments:[assessment('CONNECTED_VERIFIED','Connector body is visibly inserted into the matching receptacle with continuous mating geometry.'),assessment('DISCONNECTED_VERIFIED','Coolant hose end is visibly separated from its open fitting with a clear gap.','Coolant hose')]});
  assert.equal(result.observedItems.length,2);
  assert.deepEqual(result.observedItems.map(item=>item.physicalConnectionState).sort(),['CONNECTED','DISCONNECTED']);
});

test('10.13.135 no-defect and uncertain-identity cases are valid completed analyses',()=>{
  const result=reconcileVehicleAreaRelationship(base(),{connectionAssessments:[]});
  assert.equal(result.status,'READY');
  assert.equal(result.relationshipSource,'fallback');
  assert.match(result.relationshipReason,/No definite abnormal component relationship/i);
  assert.equal(result.photoGuidanceSource,'fallback');
  assert.ok(result.recommendedNextPhotoVerification);
});
