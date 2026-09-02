import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import {
  analyzeSemanticImage,
  buildGuaranteedStructuredCondition,
  recoverPartialVisualCondition,
  recoverVisualConditionFromObservation
} from '../semantic-analyzer-core.mjs';

const unable = () => ({ status: 'UNABLE_TO_INSPECT', conditionConfidence: null, rawConditionConfidence: null, normalizedConditionConfidence: null, observedCondition: [], possibleConcerns: [], connectionAssessments: [], noVisibleConcernMessage: '', unableToInspectReason: 'Dedicated condition request timed out.', visibleEvidence: [], recommendedVerification: [], safetyDrivabilityImpact: null });
const connector = (overrides = {}) => ({ id: 'OBJ-001', type: 'electrical_connector', location: 'lower-left area of image', evidence: 'The harness ends at a visible connector body whose exposed mating face is suspended in open space.', confidence: 92, occluded: false, harnessTermination: 'YES', matingStatus: 'FREE_UNMATED', connectionState: 'DISCONNECTED_CONFIRMED', physicalStateConfidence: 92, ownershipConfidence: 45, candidateReceptacle: '', exposedMatingInterface: true, matingFaceVisibility: 'VISIBLE', physicalInsertionObserved: 'FALSE', physicalSeparationObserved: 'TRUE', freeTerminationObserved: 'TRUE', exposedMatingInterfaceObserved: 'TRUE', candidateReceptacleObserved: 'FALSE', gapObserved: 'TRUE', visibleGeometricMatingContinuity: 'FALSE', insertionGeometryEvidence: '', separationGeometryEvidence: 'The connector is visibly separated and ends in open space.', freeTerminationEvidence: 'The harness terminates at a visible free connector end with an exposed mating face.', rawObservationProvenance: 'Direct whole-image connector geometry.', connectorBodyVisible: 'TRUE', matingFaceVisible: 'TRUE', receivingReceptacleVisible: 'FALSE', continuousInsertionPathVisible: 'FALSE', connectorFreeInSpace: 'TRUE', ...overrides });
const abnormal = (state, evidence, objectId = 'OBJ-001', priorityRank = 1) => ({ objectId, state, evidence, confidence: 92, priorityRank, recommendedVerification: 'Physically verify the visible mating or mounting relationship.' });
const observation = ({ objects = [connector()], relationships = [], abnormalFindings = [abnormal('FREE_UNMATED_ELECTRICAL_TERMINATION', 'Electrical connector is visibly free and unmated in open space.')] } = {}) => ({ status: 'READY', objects, relationships, abnormalFindings, summary: 'Whole-image physical sweep completed.' });

test('10.13.138 A — a visible free connector survives dedicated condition timeout without exact identity', () => {
  const recovered = recoverVisualConditionFromObservation(unable(), observation());
  const structured = buildGuaranteedStructuredCondition(recovered, observation(), null);
  assert.equal(recovered.status, 'OBSERVED_CONDITION');
  assert.equal(recovered.connectionAssessments[0].connectionState, 'DISCONNECTED_VERIFIED');
  assert.match(recovered.connectionAssessments[0].visibleEvidence, /visibly free and unmated/i);
  assert.equal(structured.inspectionCompleted, true);
  assert.equal(structured.componentIdentity, null);
});

test('10.13.138 B — partial seating remains distinct from connected and disconnected states', () => {
  const partialObject = connector({ matingStatus: 'PARTIALLY_SEATED', connectionState: 'PARTIALLY_SEATED', physicalSeparationObserved: 'TRUE', freeTerminationObserved: 'FALSE', connectorFreeInSpace: 'FALSE', freeTerminationEvidence: '', separationGeometryEvidence: 'The connector is inserted unevenly and a visible gap remains at one edge.' });
  const raw = observation({ objects: [partialObject], abnormalFindings: [abnormal('PARTIALLY_SEATED', 'The connector is inserted unevenly with incomplete latch engagement and a visible edge gap.')] });
  const recovered = recoverVisualConditionFromObservation(unable(), raw);
  assert.equal(recovered.connectionAssessments[0].connectionState, 'PARTIALLY_SEATED');
  assert.equal(recovered.connectionAssessments[0].findingType, 'POSSIBLE_CONCERN');
  assert.notEqual(recovered.connectionAssessments[0].connectionState, 'DISCONNECTED_VERIFIED');
});

test('10.13.138 C — affirmative connected geometry never becomes a disconnected defect', () => {
  const connected = { ...unable(), status: 'NO_VISIBLE_CONCERN_DETECTED', unableToInspectReason: null, conditionConfidence: 90, normalizedConditionConfidence: 90, visibleEvidence: ['The connector is fully inserted into the receptacle with continuous mating geometry and the latch is visibly engaged.'], connectionAssessments: [{ observedObject: 'electrical_connector', location: 'center of image', seatingStatus: 'NO_GAP_OR_SEPARATION_VISIBLE', findingType: 'NO_DEFECT_VISIBLE', severity: 'LOW', findingConfidence: 90, connectionState: 'CONNECTED_VERIFIED', connectionStateConfidence: 90, visibleEvidence: 'The connector is fully inserted into the receptacle with continuous mating geometry and the latch is visibly engaged.', matingComponentVisible: true, directDamageVisible: false, missingContext: null, recommendedVerification: 'Physically verify latch retention.', safetyDrivabilityImpact: null }] };
  const raw = observation({ objects: [connector({ matingStatus: 'MATED', connectionState: 'CONNECTED_CONFIRMED', physicalInsertionObserved: 'TRUE', physicalSeparationObserved: 'FALSE', freeTerminationObserved: 'FALSE', gapObserved: 'FALSE', visibleGeometricMatingContinuity: 'TRUE', insertionGeometryEvidence: 'The connector enters and is surrounded by the receptacle boundary along one continuous insertion axis.', separationGeometryEvidence: '', freeTerminationEvidence: '', connectorFreeInSpace: 'FALSE', receivingReceptacleVisible: 'TRUE', continuousInsertionPathVisible: 'TRUE' })], relationships: [{ id: 'REL-001', sourceId: 'OBJ-001', targetId: 'OBJ-001', state: 'CONNECTED_CONFIRMED', evidence: 'Continuous connector-to-receptacle insertion geometry is visible.', confidence: 90 }], abnormalFindings: [] });
  const recovered = recoverVisualConditionFromObservation(connected, raw);
  assert.equal(recovered.connectionAssessments[0].connectionState, 'CONNECTED_VERIFIED');
  assert.equal(recovered.connectionAssessments.some(item => item.findingType === 'CLEAR_DEFECT'), false);
});

test('10.13.138 D — the guaranteed result retains multiple whole-image abnormalities', () => {
  const damagedBracket = { ...connector(), id: 'OBJ-002', type: 'mounting_bracket', location: 'upper-right area of image', evidence: 'A bracket is visibly cracked across its mounting ear.', harnessTermination: 'NOT_APPLICABLE', matingStatus: 'NOT_APPLICABLE', connectionState: 'NOT_APPLICABLE' };
  const raw = observation({ objects: [connector(), damagedBracket], abnormalFindings: [abnormal('FREE_UNMATED_ELECTRICAL_TERMINATION', 'Electrical connector is visibly free and unmated in open space.'), abnormal('DAMAGED', 'The upper-right mounting bracket has a directly visible crack.', 'OBJ-002', 2)] });
  const recovered = recoverVisualConditionFromObservation(unable(), raw);
  const structured = buildGuaranteedStructuredCondition(recovered, raw, null);
  assert.equal(structured.visibleFindings.some(item => /free and unmated/i.test(item.evidence)), true);
  assert.equal(structured.visibleFindings.some(item => /visible crack/i.test(item.evidence)), true);
  assert.equal(structured.evidence.length >= 2, true);
});

test('10.13.138 E — exact identification failure cannot erase visible physical evidence', () => {
  const raw = observation();
  const recovered = recoverVisualConditionFromObservation(unable(), raw);
  const structured = buildGuaranteedStructuredCondition(recovered, raw, { status: 'FAILED', primaryComponent: 'Unable to determine exact component', componentConfidence: null, uncertaintyReason: 'Dedicated component response incomplete.' });
  assert.equal(structured.inspectionCompleted, true);
  assert.match(structured.visibleFindings[0].evidence, /free and unmated/i);
  assert.match(structured.uncertainty.join(' '), /component response incomplete/i);
});

test('10.13.138 preserves an independently valid physical finding when a secondary returned item is malformed', () => {
  const partial = recoverPartialVisualCondition({
    status: 'OBSERVED_CONDITION',
    conditionConfidence: 91,
    visibleEvidence: ['The electrical connector is visibly separated from its receptacle.'],
    connectionAssessments: [
      { location: 'lower-left area of image', seatingStatus: 'SEPARATION_OR_GAP_VISIBLE', findingType: 'CLEAR_DEFECT', severity: 'HIGH', findingConfidence: 91, visibleEvidence: 'The electrical connector is visibly separated from its matching receptacle by a clear air gap.', matingComponentVisible: true, directDamageVisible: true, missingContext: null, recommendedVerification: 'Inspect both halves and reconnect if appropriate.', safetyDrivabilityImpact: null },
      { location: '', findingType: 'CLEAR_DEFECT' }
    ]
  });
  assert.ok(partial);
  assert.equal(partial.connectionAssessments.length, 1);
  assert.equal(partial.status, 'OBSERVED_CONDITION');
  assert.match(partial.consistencyCorrections.join(' '), /preserved after a secondary response field failed validation/i);
});

const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return status >= 400 ? payload : { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }] }; } });

test('10.13.138 accepts direct visible separation without inventing operational severity', async () => {
  const bytes = await sharp({ create: { width: 120, height: 90, channels: 3, background: { r: 40, g: 50, b: 60 } } }).png().toBuffer();
  const body = { transactionId: 'undetermined-severity-condition', imageHash: createHash('sha256').update(bytes).digest('hex'), mimeType: 'image/png', imageBase64: bytes.toString('base64') };
  const classifier = { category: 'AUTOMOTIVE_COMPONENT_OR_VEHICLE', confidence: 99, objects: ['electrical connector'], evidence: ['An automotive electrical connector and harness are visible.'], description: 'Automotive connector close-up.', automotiveEvidence: ['An electrical connector and harness are visible.'], graphEvidence: [], documentEvidence: [] };
  const directCondition = { status: 'OBSERVED_CONDITION', conditionConfidence: 0.99, observedCondition: ['A connector assembly is visibly separated and unmated.'], possibleConcerns: [], connectionAssessments: [{ location: 'center of image', seatingStatus: 'SEPARATION_OR_GAP_VISIBLE', findingType: 'CLEAR_DEFECT', severity: 'UNDETERMINED', findingConfidence: 0.99, visibleEvidence: 'The opposing mating geometry is visible, but a directly visible air gap remains and the mating face is exposed.', matingComponentVisible: true, directDamageVisible: false, missingContext: 'Exact connector function is not shown.', recommendedVerification: 'Physically verify the connector relationship.', safetyDrivabilityImpact: 'Unable to determine from the image because the circuit function is unidentified.' }], noVisibleConcernMessage: '', unableToInspectReason: null, visibleEvidence: ['A directly visible air gap remains between the opposing mating interfaces.'], recommendedVerification: ['Physically verify the connector relationship.'], safetyDrivabilityImpact: 'Potential impact cannot be established without knowing the connector function.' };
  const conditionStages = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    const stage = request.text.format.name;
    if (stage === 'nitros_image_semantics') return response(classifier);
    if (stage === 'nitros_visual_condition_inspection' || stage === 'nitros_visual_condition_retry') { conditionStages.push(stage); return response(directCondition); }
    if (stage === 'nitros_raw_visual_observation' || stage === 'nitros_vehicle_area_relationship') return response({ error: { message: 'Simulated optional stage failure.' } }, 503);
    if (stage === 'nitros_candidate_regions') return response({ candidates: [] });
    if (stage === 'nitros_automotive_component') return { ok: true, status: 200, async json() { return { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }; } };
    throw new Error(`Unhandled stage ${stage}`);
  };
  const result = await analyzeSemanticImage(body, { apiKey: 'test-only-placeholder', fetchImpl, enableVisualObservation: true });
  assert.deepEqual(conditionStages, ['nitros_visual_condition_inspection']);
  assert.equal(result.semanticResult.visualConditionInspection.status, 'OBSERVED_CONDITION');
  assert.equal(result.semanticResult.visualConditionInspection.connectionAssessments[0].severity, 'UNDETERMINED');
  assert.equal(result.serverDiagnostic.visualConditionCoreResultSource, 'FAST_PASS');
  assert.ok(result.serverDiagnostic.visualConditionTrace.includes('VISUAL_CONDITION_PARSE_SUCCESS'));
  assert.equal(result.serverDiagnostic.visualConditionTrace.includes('VISUAL_CONDITION_RETRY_START'), false);
});

test('10.13.138 distinguishes an incomplete HTTP 200 from timeout and uses the reserved retry', async () => {
  const bytes = await sharp({ create: { width: 120, height: 90, channels: 3, background: { r: 40, g: 50, b: 60 } } }).png().toBuffer();
  const body = { transactionId: 'incomplete-condition-recovery', imageHash: createHash('sha256').update(bytes).digest('hex'), mimeType: 'image/png', imageBase64: bytes.toString('base64') };
  const classifier = { category: 'AUTOMOTIVE_COMPONENT_OR_VEHICLE', confidence: 99, objects: ['electrical connector'], evidence: ['An automotive electrical connector and harness are visible.'], description: 'Automotive connector close-up.', automotiveEvidence: ['An electrical connector and harness are visible.'], graphEvidence: [], documentEvidence: [] };
  const condition = { status: 'OBSERVED_CONDITION', conditionConfidence: 91, observedCondition: ['A connector is visibly separated from its matching receptacle by a clear air gap.'], possibleConcerns: [], connectionAssessments: [{ location: 'lower-left area of image', seatingStatus: 'SEPARATION_OR_GAP_VISIBLE', findingType: 'CLEAR_DEFECT', severity: 'HIGH', findingConfidence: 91, visibleEvidence: 'A connector is visibly separated from its matching receptacle by a clear air gap.', matingComponentVisible: true, directDamageVisible: true, missingContext: null, recommendedVerification: 'Inspect both halves and reconnect if appropriate.', safetyDrivabilityImpact: null }], noVisibleConcernMessage: '', unableToInspectReason: null, visibleEvidence: ['A connector is visibly separated from its matching receptacle by a clear air gap.'], recommendedVerification: ['Inspect both halves and reconnect if appropriate.'], safetyDrivabilityImpact: null };
  const conditionRequests = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    const stage = request.text.format.name;
    if (stage === 'nitros_image_semantics') return response(classifier);
    if (stage === 'nitros_visual_condition_inspection') {
      conditionRequests.push(request);
      return { ok: true, status: 200, async json() { return { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'reasoning', summary: [] }] }; } };
    }
    if (stage === 'nitros_visual_condition_retry') { conditionRequests.push(request); return response(condition); }
    if (stage === 'nitros_raw_visual_observation' || stage === 'nitros_vehicle_area_relationship') return response({ error: { message: 'Simulated optional stage failure.' } }, 503);
    if (stage === 'nitros_candidate_regions') return response({ candidates: [] });
    if (stage === 'nitros_automotive_component') return { ok: true, status: 200, async json() { return { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'reasoning', summary: [] }] }; } };
    throw new Error(`Unhandled stage ${stage}`);
  };
  const result = await analyzeSemanticImage(body, { apiKey: 'test-only-placeholder', fetchImpl, enableVisualObservation: true });
  assert.equal(result.semanticResult.visualConditionInspection.status, 'OBSERVED_CONDITION');
  assert.equal(result.serverDiagnostic.visualConditionFirstResponseStatus, 'incomplete');
  assert.equal(result.serverDiagnostic.visualConditionFirstIncompleteReason, 'max_output_tokens');
  assert.equal(result.serverDiagnostic.visualConditionRetryResponseStatus, 'completed');
  assert.equal(result.serverDiagnostic.visualConditionFirstRequestTimeout, false);
  assert.equal(result.serverDiagnostic.visualConditionMalformedResponse, false);
  assert.equal(result.serverDiagnostic.visualConditionCoreResultSource, 'FAST_RETRY');
  assert.ok(result.serverDiagnostic.visualConditionTrace.includes('VISUAL_CONDITION_PARSE_FAILURE'));
  assert.ok(result.serverDiagnostic.visualConditionTrace.includes('VISUAL_CONDITION_RETRY_SUCCESS'));
  assert.equal(conditionRequests[0].max_output_tokens, 3_000);
  assert.equal(conditionRequests[1].max_output_tokens, 2_400);
  for (const request of conditionRequests) {
    assert.deepEqual(request.reasoning, { effort: 'low' });
    assert.equal(request.input[0].content.find(item => item.type === 'input_image').detail, 'original');
  }
});

test('10.13.138 F — production orchestration reserves recovery time and returns structured evidence inside the deployed budget', async () => {
  const bytes = await sharp({ create: { width: 120, height: 90, channels: 3, background: { r: 40, g: 50, b: 60 } } }).png().toBuffer();
  const body = { transactionId: 'timeout-recovery-production', imageHash: createHash('sha256').update(bytes).digest('hex'), mimeType: 'image/png', imageBase64: bytes.toString('base64') };
  const classifier = { category: 'AUTOMOTIVE_COMPONENT_OR_VEHICLE', confidence: 99, objects: ['electrical connector'], evidence: ['An automotive electrical connector and harness are visible.'], description: 'Automotive connector close-up.', automotiveEvidence: ['An electrical connector and harness are visible.'], graphEvidence: [], documentEvidence: [] };
  const raw = observation();
  const stages = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    const stage = request.text.format.name;
    stages.push(stage);
    if (stage === 'nitros_visual_condition_inspection' || stage === 'nitros_visual_condition_retry') throw Object.assign(new Error('Simulated stage deadline.'), { name: 'TimeoutError' });
    if (stage === 'nitros_image_semantics') return response(classifier);
    if (stage === 'nitros_raw_visual_observation') return response(raw);
    if (stage === 'nitros_candidate_regions') return response({ candidates: [] });
    if (stage === 'nitros_automotive_component') return { ok: true, status: 200, async json() { return { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'reasoning', summary: [] }] }; } };
    if (stage === 'nitros_vehicle_area_relationship') return response({ error: { message: 'Simulated optional enrichment failure.' } }, 503);
    throw new Error(`Unhandled stage ${stage}`);
  };
  const originalInfo = console.info;
  console.info = () => {};
  try {
    const result = await analyzeSemanticImage(body, { apiKey: 'test-only-placeholder', fetchImpl, enableVisualObservation: true });
    const inspection = result.semanticResult.visualConditionInspection;
    assert.deepEqual(stages.slice(0, 4), ['nitros_image_semantics', 'nitros_visual_condition_inspection', 'nitros_visual_condition_retry', 'nitros_raw_visual_observation']);
    assert.equal(inspection.inspectionCompleted, true);
    assert.equal(inspection.status, 'OBSERVED_CONDITION');
    assert.match(inspection.visibleFindings[0].evidence, /free and unmated/i);
    assert.equal(result.serverDiagnostic.visualConditionCoreResultSource, 'RAW_WHOLE_IMAGE_OBSERVATION');
    for (const event of ['VISUAL_CONDITION_START','VISUAL_CONDITION_TIMEOUT','VISUAL_CONDITION_ABORT','VISUAL_CONDITION_RETRY_START','VISUAL_CONDITION_RETRY_TIMEOUT','VISUAL_CONDITION_TOTAL_MS']) assert.ok(result.serverDiagnostic.visualConditionTrace.includes(event), `missing ${event}`);
    assert.equal(result.serverDiagnostic.visualConditionFirstAttemptTimeoutMs, 55_000);
    assert.equal(result.serverDiagnostic.visualConditionRetryTimeoutMs, 40_000);
    assert.equal(result.serverDiagnostic.analyzerBudgetMs, 280_000);
    assert.equal(result.serverDiagnostic.responseReturnReserveMs, 10_000);
    assert.ok(result.serverDiagnostic.analyzerTotalMs < result.serverDiagnostic.analyzerBudgetMs);
    const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    const client = readFileSync(new URL('../image-analysis-ad.js', import.meta.url), 'utf8');
    assert.equal(vercel.functions['api/semantic-image-analysis.mjs'].maxDuration, 300);
    assert.match(client, /const SEMANTIC_REQUEST_TIMEOUT_MS=290_000/);
    assert.ok(result.serverDiagnostic.analyzerBudgetMs < 290_000 && 290 < vercel.functions['api/semantic-image-analysis.mjs'].maxDuration);
  } finally { console.info = originalInfo; }
});

test('10.13.138 G — the 10.13.137 downstream handoff remains canonical and non-overridable', () => {
  const core = readFileSync(new URL('../semantic-analyzer-core.mjs', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../image-analysis-ad.js', import.meta.url), 'utf8');
  assert.match(core, /downstreamOverrideAllowed: false/);
  assert.match(core, /mergeCanonicalComponentEvidence\(visualConditionInspection,componentIdentification\)/);
  assert.match(core, /promoteFinalEvidence\(visualConditionInspection,conflictEvaluation\)/);
  assert.match(core, /version: '10\.13\.138'/);
  for (const field of ['inspectionCompleted','visibleConditionAssessed','visibleFindings','observedObjects','physicalRelationships','structuredEvidence','uncertainty']) assert.match(client, new RegExp(field));
});
