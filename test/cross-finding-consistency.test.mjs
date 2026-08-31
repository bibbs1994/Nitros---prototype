import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalVisualState, evaluateCrossFindingConflicts, promoteFinalEvidence, reconcileVisualFindings, validateVehicleAreaRelationship } from '../semantic-analyzer-core.mjs';

const finding = overrides => ({
  location: 'Central-left EGR-area connector', observedObject: 'Electrical connector', seatingStatus: 'NOT_RELIABLY_VISIBLE', findingType: 'SEATING_NOT_RELIABLY_VISIBLE', severity: 'UNDETERMINED', findingConfidence: 92, connectionState: 'INDETERMINATE', connectionStateConfidence: 92, visibleEvidence: 'Electrical connector body is visible, but its mating socket is obscured.', recommendedVerification: 'Photograph both connector halves and the latch from another angle.', safetyDrivabilityImpact: null, ...overrides
});
const reconcile = assessments => reconcileVisualFindings({ status: 'OBSERVED_CONDITION', connectionAssessments: assessments }, { observation: { objects: [] }, relationship: { status: 'READY' } });

test('10.13.125 A–D applies direct-evidence states and calibrated confidence', () => {
  const unclear = reconcile([finding({ observedObject: 'Electrical connector at EGR assembly' })]).connectionAssessments[0];
  assert.equal(unclear.connectionState, 'INDETERMINATE');
  assert.ok(unclear.connectionStateConfidence <= 60, 'A: an obscured mating interface is capped at 60%');
  const egrPreserved = reconcileVisualFindings({ status: 'OBSERVED_CONDITION', componentIdentification: { primaryComponent: 'EGR valve', status: 'IDENTIFIED' }, connectionAssessments: [finding()] }, { observation: { objects: [] }, relationship: { status: 'READY' } });
  assert.equal(egrPreserved.componentIdentification.primaryComponent, 'EGR valve', 'A: reconciliation preserves independently identified component evidence');
  const separated = reconcile([finding({ seatingStatus: 'SEPARATION_OR_GAP_VISIBLE', findingType: 'CLEAR_DEFECT', severity: 'HIGH', connectionState: 'DISCONNECTED_VERIFIED', visibleEvidence: 'A visible air gap separates the electrical connector from its matching receptacle.', findingConfidence: 96, connectionStateConfidence: 96 })]).connectionAssessments[0];
  assert.equal(separated.connectionState, 'DISCONNECTED_VERIFIED');
  assert.equal(separated.findingType, 'CLEAR_DEFECT');
  assert.equal(separated.connectionStateConfidence, 96, 'B: direct two-sided separation retains high confidence');
  const seated = reconcile([finding({ seatingStatus: 'NO_GAP_OR_SEPARATION_VISIBLE', findingType: 'NO_DEFECT_VISIBLE', severity: 'LOW', connectionState: 'CONNECTED_VERIFIED', visibleEvidence: 'Both connector halves are fully seated, the latch is engaged, and no abnormal gap is visible.', findingConfidence: 95, connectionStateConfidence: 95 })]).connectionAssessments[0];
  assert.equal(seated.connectionState, 'CONNECTED_VERIFIED');
  const rustyClamp = reconcile([finding({ observedObject: 'Hose clamp', seatingStatus: 'NO_GAP_OR_SEPARATION_VISIBLE', findingType: 'NO_DEFECT_VISIBLE', severity: 'LOW', connectionState: 'DISCONNECTED_VERIFIED', visibleEvidence: 'Rust is visible on the clamp, but the hose remains seated over the fitting with no abnormal gap.', findingConfidence: 94, connectionStateConfidence: 94 })]).connectionAssessments[0];
  assert.notEqual(rustyClamp.connectionState, 'DISCONNECTED_VERIFIED', 'D: corrosion alone cannot verify disconnection');
});

test('10.13.125 E–G blocks unsupported missing claims and resolves conflicting connector findings', () => {
  const vehicleArea = evidence => validateVehicleAreaRelationship({
    status: 'READY', vehicleAreaLocation: 'Upper engine area', locationConfidence: 70, locationEvidence: ['Engine components are visible.'], vehicleContextSupport: ['Vehicle context identifies an intake system.'], primaryVisibleAssembly: 'Intake assembly', observedItems: [], whatPreventsConfirmation: 'The surrounding mounting area must be inspected.', recommendedNextPhotoVerification: 'Inspect the exact mounting site.',
    expectedComponentCheck: { expectedMajorComponents: ['Intake sensor'], visiblyAccountedFor: [], possibleMissingOrRemovedComponent: 'Intake sensor', supportingVisualEvidence: evidence, vehicleContextSupport: ['Vehicle context identifies an intake sensor.'], confidence: 92, whatPreventsConfirmation: 'The surrounding mounting area must be inspected.', recommendedTechnicianVerification: 'Inspect the exact mounting site.' }
  }).expectedComponentCheck;
  const outsideFrame = vehicleArea(['The sensor mounting area is outside the current image.']);
  assert.equal(outsideFrame.possibleMissingOrRemovedComponent, 'No visually supported missing component detected.', 'E: an out-of-frame mounting site cannot support a missing claim');
  const emptySite = vehicleArea(['The empty sensor mounting boss is visibly unobstructed, with no sensor installed.']);
  assert.equal(emptySite.possibleMissingOrRemovedComponent, 'Intake sensor', 'F: a visible, unobstructed empty mounting site retains a supported missing candidate');
  const conflict = reconcile([
    finding({ connectionState: 'CONNECTED_VERIFIED', seatingStatus: 'NO_GAP_OR_SEPARATION_VISIBLE', findingType: 'NO_DEFECT_VISIBLE', severity: 'LOW', visibleEvidence: 'Connector body is visible near the component.' }),
    finding({ connectionState: 'DISCONNECTED_VERIFIED', seatingStatus: 'SEPARATION_OR_GAP_VISIBLE', findingType: 'CLEAR_DEFECT', severity: 'MODERATE', visibleEvidence: 'A visible air gap separates the connector from its matching receptacle.', findingConfidence: 93, connectionStateConfidence: 93 })
  ]);
  assert.equal(conflict.connectionAssessments.length, 1, 'G: one canonical connection finding remains');
  assert.equal(conflict.connectionAssessments[0].connectionState, 'DISCONNECTED_VERIFIED');
  assert.equal(conflict.crossFindingConsistency.conflictsResolved, true);
});

test('10.13.126 A–F isolates malformed findings and promotes direct visible defects', () => {
  const directDisconnect = finding({ connectionState: 'INDETERMINATE', seatingStatus: 'NOT_RELIABLY_VISIBLE', findingType: 'SEATING_NOT_RELIABLY_VISIBLE', severity: 'UNDETERMINED', findingConfidence: 94, connectionStateConfidence: 94, visibleEvidence: 'The electrical connector is visibly separated from its matching receptacle by an air gap.' });
  const promoted = reconcile([directDisconnect]);
  assert.equal(promoted.status, 'OBSERVED_CONDITION', 'A: direct separation is promoted even when component state started indeterminate');
  assert.equal(promoted.connectionAssessments[0].connectionState, 'DISCONNECTED_VERIFIED');
  assert.equal(promoted.finalEvidencePromotion.promotedCount, 1);

  const uncertainComponent = reconcileVisualFindings({ status: 'POSSIBLE_CONCERN_DETECTED', componentIdentification: { status: 'UNCERTAIN', primaryComponent: 'Likely actuator', possibleAlternatives: ['EGR valve', 'purge valve'] }, connectionAssessments: [directDisconnect] });
  assert.equal(uncertainComponent.connectionAssessments[0].findingType, 'CLEAR_DEFECT', 'B: defect certainty remains independent of component-name certainty');

  const ambiguous = reconcile([finding({ connectionState: 'INDETERMINATE', visibleEvidence: 'Electrical connector is visible, but the mating face is obscured.', findingConfidence: 72, connectionStateConfidence: 72 })]);
  assert.notEqual(ambiguous.connectionAssessments[0].findingType, 'CLEAR_DEFECT', 'C: obscured seating is not promoted');

  const noDefect = reconcile([finding({ connectionState: 'CONNECTED_VERIFIED', seatingStatus: 'NO_GAP_OR_SEPARATION_VISIBLE', findingType: 'NO_DEFECT_VISIBLE', severity: 'LOW', visibleEvidence: 'Both connector halves are fully seated with the latch visibly engaged and no abnormal gap.' })]);
  assert.equal(noDefect.finalEvidencePromotion.promotedCount, 0, 'D: no-defect output completes the positive-evidence gate before returning none');

  const partial = reconcile([null, directDisconnect]);
  assert.equal(partial.crossFindingConsistency.status, 'PARTIAL', 'E: one malformed candidate cannot fail reconciliation globally');
  assert.equal(partial.connectionAssessments.length, 1);
  assert.match(partial.reconciliationErrors[0].reason, /not an object/i);

  const conflict = reconcile([directDisconnect, finding({ connectionState: 'CONNECTED_VERIFIED', seatingStatus: 'NO_GAP_OR_SEPARATION_VISIBLE', findingType: 'NO_DEFECT_VISIBLE', severity: 'LOW', visibleEvidence: 'Connector body is visible near the component.', findingConfidence: 55, connectionStateConfidence: 55 })]);
  assert.equal(conflict.connectionAssessments.length, 1, 'F: weaker generic secure claim is removed for the same object');
  assert.equal(conflict.connectionAssessments[0].connectionState, 'DISCONNECTED_VERIFIED');
  assert.equal(conflict.crossFindingConsistency.conflictsResolved, true);
});

test('10.13.128 A–C retains connected, disconnected, and partially seated EGR connector states independently of identity', () => {
  const egr = { status: 'IDENTIFIED', primaryComponent: 'EGR valve', normalizedComponentConfidence: 94 };
  const connected = buildCanonicalVisualState(egr, reconcile([finding({ candidateId: 'egr-connector', connectionState: 'CONNECTED_VERIFIED', seatingStatus: 'NO_GAP_OR_SEPARATION_VISIBLE', findingType: 'NO_DEFECT_VISIBLE', severity: 'LOW', visibleEvidence: 'Both connector halves are fully seated, the latch is engaged, and no abnormal gap is visible.', findingConfidence: 95, connectionStateConfidence: 95 })]));
  assert.equal(connected.componentIdentity.primaryComponent, 'EGR valve');
  assert.equal(connected.connectionStates[0].connectionState, 'CONNECTED_VERIFIED');
  const disconnected = buildCanonicalVisualState(egr, reconcile([finding({ candidateId: 'egr-connector', connectionState: 'DISCONNECTED_VERIFIED', seatingStatus: 'SEPARATION_OR_GAP_VISIBLE', findingType: 'CLEAR_DEFECT', severity: 'HIGH', visibleEvidence: 'A visible air gap separates the electrical connector from its matching receptacle.', findingConfidence: 96, connectionStateConfidence: 96 })]));
  assert.equal(disconnected.connectionStates[0].connectionState, 'DISCONNECTED_VERIFIED');
  const partial = buildCanonicalVisualState(egr, reconcile([finding({ candidateId: 'egr-connector', connectionState: 'PARTIALLY_SEATED', seatingStatus: 'POSSIBLE_IMPROPER_SEATING', findingType: 'POSSIBLE_CONCERN', severity: 'MODERATE', visibleEvidence: 'The connector is cocked with a visible partial insertion gap at the mating interface.', findingConfidence: 82, connectionStateConfidence: 82 })]));
  assert.equal(partial.connectionStates[0].connectionState, 'PARTIALLY_SEATED');
});

test('10.13.128 D–F makes image evidence canonical against prompt bias, identity correction, and stale contradictory claims', () => {
  const directDisconnect = finding({ candidateId: 'egr-connector', connectionState: 'DISCONNECTED_VERIFIED', seatingStatus: 'SEPARATION_OR_GAP_VISIBLE', findingType: 'CLEAR_DEFECT', severity: 'HIGH', visibleEvidence: 'A visible air gap separates the electrical connector from its matching receptacle.', findingConfidence: 96, connectionStateConfidence: 96 });
  const reconciled = reconcile([directDisconnect, finding({ candidateId: 'egr-connector', connectionState: 'CONNECTED_VERIFIED', seatingStatus: 'NO_GAP_OR_SEPARATION_VISIBLE', findingType: 'NO_DEFECT_VISIBLE', severity: 'LOW', visibleEvidence: 'Connector body is visible near the component.', findingConfidence: 92, connectionStateConfidence: 92 })]);
  assert.equal(reconciled.connectionAssessments.length, 1, 'F: one evidence-resolved item remains after a conflicting stale claim');
  const correctedIdentity = buildCanonicalVisualState({ status: 'IDENTIFIED', primaryComponent: 'EGR valve', normalizedComponentConfidence: 91 }, reconciled);
  assert.equal(correctedIdentity.componentIdentity.primaryComponent, 'EGR valve', 'E: reconciliation may correct identity');
  assert.equal(correctedIdentity.connectionStates[0].connectionState, 'DISCONNECTED_VERIFIED', 'E: identity correction cannot reverse physical separation');
  assert.match(correctedIdentity.connectionStates[0].directVisibleEvidence, /air gap/i, 'D: prompt or proximity language cannot replace direct visible geometry');
  assert.equal(correctedIdentity.downstreamOverrideAllowed, false);
});

test('10.13.128 retains a directly observed free electrical termination even when the intended receptacle is not visible', () => {
  const freeEnd = reconcile([finding({ candidateId: 'connector-free', connectionState: 'DISCONNECTED_VERIFIED', seatingStatus: 'SEPARATION_OR_GAP_VISIBLE', findingType: 'CLEAR_DEFECT', severity: 'HIGH', visibleEvidence: 'Connector shows exposed mating interface with harness terminated but not connected to a visible interface.', findingConfidence: 90, connectionStateConfidence: 90 })]);
  assert.equal(freeEnd.connectionAssessments[0].connectionState, 'DISCONNECTED_VERIFIED');
  assert.equal(freeEnd.connectionAssessments[0].findingType, 'CLEAR_DEFECT');
  assert.equal(freeEnd.finalEvidencePromotion.promotedCount, 1);
});

test('10.13.130 reconciles and promotes direct connection evidence without vehicle context', () => {
  const disconnected = finding({ candidateId: 'egr-connector', observedObject: 'EGR solenoid connector', connectionState: 'DISCONNECTED_VERIFIED', seatingStatus: 'SEPARATION_OR_GAP_VISIBLE', findingType: 'CLEAR_DEFECT', severity: 'HIGH', visibleEvidence: 'A visible air gap separates the electrical connector from its matching receptacle.', findingConfidence: 96, connectionStateConfidence: 96 });
  const reconciled = reconcileVisualFindings({ status: 'OBSERVED_CONDITION', connectionAssessments: [disconnected] }, { vehicleContextState: 'UNAVAILABLE' });
  const conflict = evaluateCrossFindingConflicts(reconciled);
  const promotion = promoteFinalEvidence(reconciled, conflict);
  assert.equal(reconciled.reconciliation.reason, 'RECONCILE_OK');
  assert.equal(reconciled.reconciliation.vehicleContextAvailable, false);
  assert.equal(reconciled.reconciliation.vehicleMismatch, null);
  assert.equal(conflict.status, 'PASS');
  assert.equal(conflict.hasUnresolvedConflict, false);
  assert.equal(promotion.status, 'PASS');
  assert.equal(promotion.eligible, true);
  assert.equal(promotion.evidence[0].visibleState, 'DISCONNECTED');
  assert.equal(promotion.evidence[0].contextLimited, true);
});

test('10.13.130 represents a real state contradiction without throwing or promoting', () => {
  const disconnected = finding({ candidateId: 'same-target', observedObject: 'EGR valve connector', connectionState: 'DISCONNECTED_VERIFIED', seatingStatus: 'SEPARATION_OR_GAP_VISIBLE', findingType: 'CLEAR_DEFECT', visibleEvidence: 'A visible air gap separates the electrical connector from its matching receptacle.', findingConfidence: 95, connectionStateConfidence: 95 });
  const connected = finding({ candidateId: 'same-target', observedObject: 'EGR solenoid connector', connectionState: 'CONNECTED_VERIFIED', seatingStatus: 'NO_GAP_OR_SEPARATION_VISIBLE', findingType: 'NO_DEFECT_VISIBLE', visibleEvidence: 'Both connector halves are fully seated, the latch is engaged, and no abnormal gap is visible.', findingConfidence: 95, connectionStateConfidence: 95 });
  const reconciled = reconcileVisualFindings({ status: 'OBSERVED_CONDITION', connectionAssessments: [disconnected, connected] }, { vehicleContextState: 'UNAVAILABLE' });
  const conflict = evaluateCrossFindingConflicts(reconciled);
  const promotion = promoteFinalEvidence(reconciled, conflict);
  assert.equal(conflict.status, 'PASS');
  assert.equal(conflict.hasUnresolvedConflict, true);
  assert.equal(conflict.conflicts[0].type, 'CONNECTION_STATE_CONTRADICTION');
  assert.equal(promotion.status, 'BLOCKED_CONFLICT');
  assert.equal(promotion.promotedCount, 0);
});
