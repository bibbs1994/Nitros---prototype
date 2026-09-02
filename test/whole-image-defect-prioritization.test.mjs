import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCanonicalVisualState,
  buildVehicleAreaRelationshipFallback,
  buildVisualEvidenceLedger,
  calibrateVisualInspectionConfidence,
  normalizeAutomotiveComponentResult,
  rankVisualCandidates,
  reconcileVehicleAreaRelationship,
  reconcileVisualFindings,
  selectGlobalVisualCandidates,
  validateVehicleAreaRelationship
} from '../semantic-analyzer-core.mjs';

const finding = (overrides = {}) => ({
  findingId: overrides.candidateId || 'finding',
  location: 'Center of image',
  observedObject: 'Visible component',
  seatingStatus: 'NOT_RELIABLY_VISIBLE',
  findingType: 'CLEAR_DEFECT',
  severity: 'MODERATE',
  findingConfidence: 80,
  connectionState: 'INDETERMINATE',
  connectionStateConfidence: 80,
  visibleEvidence: 'A directly visible physical defect is present.',
  matingComponentVisible: false,
  directDamageVisible: true,
  missingContext: 'Internal condition requires physical verification.',
  recommendedVerification: 'Inspect the reported area physically.',
  safetyDrivabilityImpact: null,
  ...overrides
});

const condition = (connectionAssessments, conditionConfidence = 90) => ({
  status: 'OBSERVED_CONDITION',
  conditionConfidence,
  observedCondition: connectionAssessments.map(item => item.visibleEvidence),
  possibleConcerns: [],
  connectionAssessments,
  noVisibleConcernMessage: '',
  unableToInspectReason: null,
  visibleEvidence: connectionAssessments.map(item => item.visibleEvidence),
  recommendedVerification: connectionAssessments.map(item => item.recommendedVerification),
  safetyDrivabilityImpact: null
});

const disconnected = (id = 'connector', location = 'Upper-right background') => finding({
  findingId: id,
  candidateId: id,
  location,
  observedObject: 'Electrical connector',
  seatingStatus: 'SEPARATION_OR_GAP_VISIBLE',
  severity: 'HIGH',
  findingConfidence: 88,
  connectionState: 'DISCONNECTED_VERIFIED',
  connectionStateConfidence: 88,
  visibleEvidence: 'The electrical connector body is visibly separated from its matching receptacle with a clear air gap and exposed mating face.',
  matingComponentVisible: true,
  missingContext: 'Exact circuit ownership is not visible.'
});

const rustyClamp = finding({
  findingId: 'rusty-clamp',
  candidateId: 'rusty-clamp',
  location: 'Center foreground',
  observedObject: 'Hose clamp',
  severity: 'LOW',
  findingConfidence: 97,
  visibleEvidence: 'The clamp has visible orange rust and surface corrosion.',
  recommendedVerification: 'Clean and inspect the clamp.'
});

test('10.13.139 A — a disconnected connector outranks a rusty foreground clamp', () => {
  const result = reconcileVisualFindings(condition([rustyClamp, disconnected()]));
  assert.equal(result.connectionAssessments[0].findingId, 'connector');
  assert.equal(result.connectionAssessments[0].defectKind, 'DISCONNECTED_CONNECTION');
  assert.equal(result.connectionAssessments[0].primaryFinding, true);
  assert.equal(result.connectionAssessments[1].defectKind, 'CORROSION');
  assert.deepEqual(result.visualCandidateSet.map(item => item.findingId), ['connector', 'rusty-clamp']);
});

test('10.13.139 B — oxidation can remain primary when no functional defect is supported', () => {
  const ranked = rankVisualCandidates([rustyClamp, finding({ findingId: 'unknown', findingType: 'UNVERIFIED_CONDITION', severity: 'UNDETERMINED', findingConfidence: 60, directDamageVisible: false, visibleEvidence: 'The rear connection interface is obscured and cannot be verified.' })]);
  assert.equal(ranked[0].findingId, 'rusty-clamp');
  assert.equal(ranked[0].defectKind, 'CORROSION');
});

test('10.13.139 C — partial seating remains distinct and outranks cosmetic corrosion', () => {
  const partial = finding({ findingId: 'partial-plug', candidateId: 'partial-plug', location: 'Lower-left', observedObject: 'Electrical connector', seatingStatus: 'POSSIBLE_IMPROPER_SEATING', findingType: 'POSSIBLE_CONCERN', severity: 'MODERATE', findingConfidence: 78, connectionState: 'PARTIALLY_SEATED', connectionStateConfidence: 78, visibleEvidence: 'The connector is unevenly inserted with a visible partial insertion gap and exposed connector neck.' });
  const result = reconcileVisualFindings(condition([rustyClamp, partial]));
  assert.equal(result.connectionAssessments[0].findingId, 'partial-plug');
  assert.equal(result.connectionAssessments[0].connectionState, 'PARTIALLY_SEATED');
  assert.equal(result.connectionAssessments[0].defectKind, 'PARTIAL_CONNECTION');
});

test('10.13.139 D — uncertain connector ownership is preserved without a forced exact identity', () => {
  const component = normalizeAutomotiveComponentResult({ status: 'UNCERTAIN', primaryComponent: 'Electrical connector — exact circuit ownership not confirmed', componentConfidence: 44, system: 'Electrical', secondaryComponents: [], supportingEvidence: ['A free electrical connector and harness termination are visible.'], possibleAlternatives: [], likelyConnectionsOrDestinations: [], uncertaintyReason: 'No labeled destination or defining component housing is visible.', drivetrainDiscrimination: {} });
  const state = buildCanonicalVisualState(component, reconcileVisualFindings(condition([disconnected()])));
  assert.equal(component.status, 'UNCERTAIN');
  assert.equal(component.identificationLevel, 'UNCERTAIN_CANDIDATE');
  assert.match(state.componentIdentity.primaryComponent, /exact circuit ownership not confirmed/i);
  assert.doesNotMatch(state.componentIdentity.primaryComponent, /sensor|solenoid|module/i);
  const broadEngineArea = normalizeAutomotiveComponentResult({ status: 'UNCERTAIN', primaryComponent: 'Engine block', componentConfidence: 70, system: 'Engine', secondaryComponents: [], supportingEvidence: ['A cast housing is partially visible beside an underhood wiring harness.'], possibleAlternatives: [], likelyConnectionsOrDestinations: [], uncertaintyReason: 'No defining component face is visible.', drivetrainDiscrimination: {} }, { semanticResult: { automotiveEvidence: ['The image shows the engine compartment and underhood wiring.'] } });
  assert.equal(broadEngineArea.primaryComponent, 'Engine-compartment assembly — exact component not confirmed');
  assert.equal(broadEngineArea.identificationLevel, 'BROAD_ASSEMBLY_ONLY');
});

test('10.13.139 E — multiple loose or disconnected candidates survive ranking', () => {
  const looseHarness = finding({ findingId: 'loose-harness', candidateId: 'loose-harness', location: 'Lower-right background', observedObject: 'Wire harness', findingConfidence: 81, connectionState: 'LOOSE_OR_SUSPECT', visibleEvidence: 'The wire harness is visibly loose and unsecured against the bracket, with chafing at the contact point.' });
  const secondDisconnect = disconnected('hose-gap', 'Upper-left middle ground');
  secondDisconnect.observedObject = 'Vacuum hose';
  secondDisconnect.visibleEvidence = 'The vacuum hose end is visibly separated from the open port with a clear air gap.';
  const result = reconcileVisualFindings(condition([looseHarness, disconnected(), secondDisconnect]));
  assert.equal(result.connectionAssessments.length, 3);
  assert.deepEqual(new Set(result.connectionAssessments.map(item => item.findingId)), new Set(['loose-harness', 'connector', 'hose-gap']));
  assert.equal(result.connectionAssessments.filter(item => item.primaryFinding).length, 1);
  assert.equal(result.recommendedVerification.length, 2);
  assert.ok(result.recommendedVerification.every(item => /confirm|verify|inspect/i.test(item)));
});

test('10.13.139 F — a broken hose outranks cosmetic clamp corrosion', () => {
  const brokenHose = finding({ findingId: 'broken-hose', candidateId: 'broken-hose', location: 'Lower-center', observedObject: 'Coolant hose', findingConfidence: 76, visibleEvidence: 'The rubber hose is visibly broken with a split and collapsed wall.' });
  const ranked = rankVisualCandidates([rustyClamp, brokenHose]);
  assert.equal(ranked[0].findingId, 'broken-hose');
  assert.equal(ranked[0].defectKind, 'PHYSICAL_DAMAGE');
});

test('10.13.139 G — whole-image abnormality state defeats normal foreground order and model tie order', () => {
  const observation = {
    objects: [
      { id: 'OBJ-001', type: 'foreground hose', location: 'Center foreground' },
      { id: 'OBJ-002', type: 'background electrical connector', location: 'Upper-right background' },
      { id: 'OBJ-003', type: 'middle-ground clamp', location: 'Lower-left middle ground' }
    ],
    abnormalFindings: [
      { objectId: 'OBJ-003', state: 'LOOSE', priorityRank: 1 },
      { objectId: 'OBJ-002', state: 'DISCONNECTED', priorityRank: 8 }
    ]
  };
  assert.deepEqual(selectGlobalVisualCandidates(observation).map(item => item.id), ['OBJ-002', 'OBJ-003', 'OBJ-001']);
});

test('10.13.139 H — confidence cannot exceed the primary evidence used by the conclusion', () => {
  const direct = calibrateVisualInspectionConfidence({ ...condition([disconnected()], 96), connectionAssessments: rankVisualCandidates([disconnected()]) }, { componentIdentification: { status: 'UNCERTAIN', componentConfidence: 35 }, relationship: { relationshipDiagnosticStatus: 'INDETERMINATE', locationConfidence: 40 } });
  assert.equal(direct.conditionConfidence, 88);
  assert.equal(direct.confidenceCalibration.primaryFindingDirectFunctionalEvidence, true);
  const cosmetic = calibrateVisualInspectionConfidence({ ...condition([rustyClamp], 95), connectionAssessments: rankVisualCandidates([rustyClamp]) }, { componentIdentification: { status: 'UNCERTAIN', componentConfidence: 45 }, relationship: { relationshipDiagnosticStatus: 'INDETERMINATE', locationConfidence: 40 } });
  assert.equal(cosmetic.conditionConfidence, 40);
  assert.equal(cosmetic.confidenceCalibration.reason, 'CAPPED_BY_CRITICAL_EVIDENCE');
});

test('10.13.139 I — semantic evidence is rendered once across downstream evidence sections', () => {
  const repeated = 'The connector is visibly separated from its matching receptacle by a clear air gap.';
  const ledger = buildVisualEvidenceLedger({
    condition: { connectionAssessments: [disconnected()], recommendedVerification: ['Inspect the connector latch.'] },
    componentIdentification: { supportingEvidence: [repeated] },
    relationship: { locationEvidence: [`Clear air gap visibly separates the connector from its matching receptacle.`] },
    semanticResult: { evidence: [repeated, 'An engine-compartment wiring harness is visible.'] }
  });
  const allEvidence = [...ledger.directFindingEvidence, ...ledger.componentEvidence, ...ledger.locationEvidence, ...ledger.analyzerEvidence];
  assert.equal(allEvidence.filter(item => /clear air gap/i.test(item)).length, 1);
  assert.ok(ledger.duplicateEvidenceSuppressed >= 2);
});

test('10.13.139 relationship outcomes distinguish established, no-abnormal, indeterminate, and degraded states', () => {
  const base = { status: 'READY', vehicleAreaLocation: 'Engine compartment', locationConfidence: 80, locationEvidence: ['Engine bay geometry is visible.'], vehicleContextSupport: [], primaryVisibleAssembly: 'Engine-compartment assembly', observedItems: [], expectedComponentCheck: {}, whatPreventsConfirmation: 'Hidden interfaces are not visible.', recommendedNextPhotoVerification: 'Capture a side angle.' };
  const noAbnormal = validateVehicleAreaRelationship(base);
  assert.equal(noAbnormal.relationshipOutcome, 'NO_ABNORMAL_RELATIONSHIP_FOUND');
  const indeterminate = validateVehicleAreaRelationship({ ...base, status: 'INSUFFICIENT_CONTEXT' });
  assert.equal(indeterminate.relationshipDiagnosticStatus, 'INDETERMINATE');
  const established = reconcileVehicleAreaRelationship(noAbnormal, reconcileVisualFindings(condition([disconnected()])));
  assert.equal(established.relationshipOutcome, 'RELATIONSHIP_ESTABLISHED');
  assert.equal(established.relationshipDiagnosticStatus, 'PASS');
  const degraded = buildVehicleAreaRelationshipFallback({ componentIdentification: { status: 'UNCERTAIN', primaryComponent: 'Visible connector family', supportingEvidence: ['An electrical connector is visible.'] }, semanticResult: {} });
  assert.equal(degraded.relationshipDiagnosticStatus, 'DEGRADED');
  assert.equal(degraded.relationshipOutcome, 'FALLBACK_PRESERVED');
});
