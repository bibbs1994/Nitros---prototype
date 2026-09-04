import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import sharp from 'sharp';
import { createLocalizedCrops, validateNormalizedRegion, validateLocalizedInspection } from '../localized-image-crop-core.mjs';
import { analyzeSemanticImage, fuseLocalizedVisualEvidence } from '../semantic-analyzer-core.mjs';

const region = { x: 0.25, y: 0.2, width: 0.2, height: 0.2 };
const candidate = { id: 'OBJ-101', type: 'electrical_connector' };
const localizedRaw = { candidate_id: 'OBJ-101', candidate_class: 'electrical_connector', localized_visual_verification: true, connection_state: 'DISCONNECTED', defect_state: 'CONFIRMED_VISIBLE_DEFECT', confidence: 91, evidence_observed: ['Visible air gap between the connector mating end and matching receptacle.'], contradictory_evidence: [], visibility_limitations: [] };

async function fixture() { return sharp({ create: { width: 1000, height: 800, channels: 3, background: { r: 20, g: 40, b: 60 } } }).png().toBuffer(); }

const response = (payload, status = 200, metadata = {}) => ({ ok: status >= 200 && status < 300, status, async json() { return { ...metadata, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }] }; } });
const drivetrain = () => ({ applicable: false, candidateType: 'OTHER', engineConnection: 'UNKNOWN', transmissionConnection: 'UNKNOWN', longitudinalShafts: 'UNKNOWN', lateralAxleOutputs: 'UNKNOWN', axleTubes: 'UNKNOWN', location: 'UNKNOWN', powerFlowRole: 'UNKNOWN', distinguishingFeaturesComplete: false, evidence: [], competingCandidate: null });
const connector = () => ({ id: 'OBJ-101', type: 'electrical_connector', location: 'center of image', evidence: 'Connector body and mating interface are visible.', confidence: 92, occluded: false, harnessTermination: 'YES', matingStatus: 'MATED', connectionState: 'CONNECTED_CONFIRMED', physicalStateConfidence: 92, ownershipConfidence: 70, candidateReceptacle: 'OBJ-102', exposedMatingInterface: true, matingFaceVisibility: 'VISIBLE', physicalInsertionObserved: 'TRUE', physicalSeparationObserved: 'FALSE', freeTerminationObserved: 'FALSE', exposedMatingInterfaceObserved: 'TRUE', candidateReceptacleObserved: 'TRUE', gapObserved: 'FALSE', visibleGeometricMatingContinuity: 'TRUE', insertionGeometryEvidence: 'The connector mating face enters the visible receptacle boundary along one continuous axis.', separationGeometryEvidence: '', freeTerminationEvidence: '', rawObservationProvenance: 'Visible connector and receptacle geometry.', connectorBodyVisible: 'TRUE', matingFaceVisible: 'TRUE', receivingReceptacleVisible: 'TRUE', continuousInsertionPathVisible: 'TRUE', connectorFreeInSpace: 'FALSE' });
const receptacle = () => ({ ...connector(), id: 'OBJ-102', type: 'electrical_receptacle', location: 'center of image', evidence: 'Receiving receptacle boundary is visible.', harnessTermination: 'NOT_APPLICABLE', candidateReceptacle: '', exposedMatingInterface: false, matingFaceVisibility: 'NOT_APPLICABLE', physicalInsertionObserved: 'NOT_APPLICABLE', physicalSeparationObserved: 'NOT_APPLICABLE', freeTerminationObserved: 'NOT_APPLICABLE', exposedMatingInterfaceObserved: 'NOT_APPLICABLE', candidateReceptacleObserved: 'NOT_APPLICABLE', gapObserved: 'NOT_APPLICABLE', visibleGeometricMatingContinuity: 'NOT_APPLICABLE', insertionGeometryEvidence: '', separationGeometryEvidence: '', freeTerminationEvidence: '', connectorBodyVisible: 'NOT_APPLICABLE', matingFaceVisible: 'NOT_APPLICABLE', receivingReceptacleVisible: 'NOT_APPLICABLE', continuousInsertionPathVisible: 'NOT_APPLICABLE', connectorFreeInSpace: 'NOT_APPLICABLE' });
const contracts = {
  nitros_image_semantics: { category: 'AUTOMOTIVE_COMPONENT_OR_VEHICLE', confidence: 96, objects: ['electrical connector'], evidence: ['A connector and harness are visible.'], description: 'Automotive electrical connection.', automotiveEvidence: ['Connector body and harness are visible in an engine-bay context.'], graphEvidence: [], documentEvidence: [] },
  nitros_raw_visual_observation: { status: 'READY', objects: [connector(), receptacle()], relationships: [{ id: 'REL-101', sourceId: 'OBJ-101', targetId: 'OBJ-102', state: 'CONNECTED_CONFIRMED', evidence: 'The connector mating face enters the visible receptacle boundary.', confidence: 92 }], abnormalFindings: [], summary: 'Two-sided mating geometry is visible.' },
  nitros_candidate_regions: { candidates: [{ candidate_id: 'OBJ-101', candidate_class: 'electrical_connector', candidate_description: 'Visible connector body', confidence: 92, inspection_priority: 1, region_basis: 'Visible connector-body bounds.', region }] },
  nitros_localized_inspection: localizedRaw,
  nitros_automotive_component: { status: 'IDENTIFIED', primaryComponent: 'Electrical connector', componentConfidence: 80, system: 'Electrical', secondaryComponents: [], supportingEvidence: ['A connector body and harness are visible.'], possibleAlternatives: [], likelyConnectionsOrDestinations: [], uncertaintyReason: null, drivetrainDiscrimination: drivetrain() },
  nitros_vehicle_area_relationship: { status: 'READY', vehicleAreaLocation: 'Electrical component close-up', locationConfidence: 82, locationEvidence: ['An electrical connector and its receiving interface are visible.'], vehicleContextSupport: [], primaryVisibleAssembly: 'Electrical connector relationship', observedItems: [{ observedItem: 'Electrical connector and receiving receptacle', itemLocationInImage: 'Center of image', nearestIdentifiableAssembly: 'Electrical component close-up', likelyRelationshipOrDestination: 'The connector and receptacle form a visible mating relationship.', relationshipConfidence: 82, visibleEvidence: 'Both sides of the mating interface are visible in the current image.', vehicleContextEvidence: '', whatCannotBeConfirmed: 'Exact component ownership cannot be established from this close-up.', recommendedNextPhotoVerification: 'Take a wider image showing harness routing and the component body.' }], expectedComponentCheck: { expectedMajorComponents: [], visiblyAccountedFor: [], possibleMissingOrRemovedComponent: 'No visually supported missing component detected.', supportingVisualEvidence: [], vehicleContextSupport: [], confidence: null, whatPreventsConfirmation: 'No active vehicle context was supplied for topology comparison.', recommendedTechnicianVerification: 'Use the current image only for the visible connection relationship.' }, whatPreventsConfirmation: 'Exact component ownership cannot be established from this close-up.', recommendedNextPhotoVerification: 'Take a wider image showing harness routing and the component body.' },
  nitros_visual_condition_inspection: { status: 'NO_VISIBLE_CONCERN_DETECTED', conditionConfidence: 88, observedCondition: [], possibleConcerns: [], connectionAssessments: [{ location: 'Center of image connector interface', seatingStatus: 'NO_GAP_OR_SEPARATION_VISIBLE', findingType: 'NO_DEFECT_VISIBLE', severity: 'LOW', findingConfidence: 88, visibleEvidence: 'The complete connector-to-receptacle mating edge is visibly seated with no gap and the retention relationship is visible.', matingComponentVisible: true, directDamageVisible: false, missingContext: null, recommendedVerification: 'Physically confirm connector latch retention before repair authorization.', safetyDrivabilityImpact: null }], noVisibleConcernMessage: 'No visible defect can be confirmed from this image. Inspect the component physically before making a repair decision.', unableToInspectReason: null, visibleEvidence: ['The connector mating interface is visibly continuous.'], recommendedVerification: ['Physically confirm connector latch retention before repair authorization.'], safetyDrivabilityImpact: null }
};

function makeContractRouter({ failLocalized = false, withProviderTelemetry = false } = {}) {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    const stage = request?.text?.format?.name;
    requests.push({ stage, request });
    if (stage === 'nitros_localized_inspection' && failLocalized) return response({ error: { message: 'Forced localized inspection failure.' } }, 503);
    if (!(stage in contracts)) throw new Error(`Unhandled production stage: ${stage}`);
    const metadata = withProviderTelemetry ? { id: `resp_${requests.length}`, model: 'gpt-5.6-sol', status: 'completed', service_tier: 'default', usage: { input_tokens: 1000 + requests.length, input_tokens_details: { cached_tokens: requests.length, cache_write_tokens: 0 }, output_tokens: 100 + requests.length, output_tokens_details: { reasoning_tokens: 50 + requests.length }, total_tokens: 1100 + requests.length, ...(requests.length === 1 ? { total_cost_usd: 0.0123 } : {}) } } : {};
    return response(structuredClone(contracts[stage]), 200, metadata);
  };
  return { fetchImpl, requests };
}

const imageBytes = (url) => Buffer.from(String(url).split(',')[1], 'base64');
const inputImages = (request) => request.input[0].content.filter((item) => item.type === 'input_image');
async function productionBody() {
  const bytes = await fixture();
  return { transactionId: 'localized-production-contract', imageHash: createHash('sha256').update(bytes).digest('hex'), mimeType: 'image/png', imageBase64: bytes.toString('base64') };
}

test('localized vision A–I uses the real crop utility, strict validator, and fusion', async () => {
  const source = await fixture();
  assert.deepEqual(validateNormalizedRegion(region), region, 'A: normalized Pass-1 region');
  const crops = await createLocalizedCrops(source, region);
  assert.deepEqual(crops.normalizedRegion, region, 'B: exact region reaches crop utility');
  assert.ok(crops.detail.length > 0 && crops.detailMetadata.width > 0, 'C: real detail crop');
  assert.ok(crops.context.length > 0 && crops.contextMetadata.width > crops.detailMetadata.width && crops.contextMetadata.height > crops.detailMetadata.height && !crops.context.equals(crops.detail), 'D: larger distinct context crop');
  assert.ok((await sharp(crops.detail).metadata()).width && (await sharp(crops.context).metadata()).width, 'E: both crops decode');
  const payload = [{ type: 'input_image', image_url: `data:image/png;base64,${crops.detail.toString('base64')}` }, { type: 'input_image', image_url: `data:image/png;base64,${crops.context.toString('base64')}` }, { type: 'input_image', image_url: `data:image/png;base64,${source.toString('base64')}` }];
  assert.equal(payload[0].image_url, `data:image/png;base64,${crops.detail.toString('base64')}`, 'F: detail bytes are Pass-2 image 1');
  assert.equal(payload[1].image_url, `data:image/png;base64,${crops.context.toString('base64')}`, 'G: context bytes are Pass-2 image 2');
  const inspection = validateLocalizedInspection(localizedRaw, candidate);
  assert.equal(inspection.candidateId, candidate.id, 'H: strict candidate-ID-preserving localized result');
  const final = fuseLocalizedVisualEvidence({ status: 'OBSERVED_CONDITION', connectionAssessments: [{ candidateId: 'OBJ-101', connectionState: 'CONNECTED_VERIFIED' }] }, [inspection]);
  assert.equal(final.localizedVisualEvidence[0].connectionState, 'DISCONNECTED_VERIFIED', 'I: localized physical evidence corrects global connection');
  assert.equal(final.localizedVisualEvidence[0].localizedDefectState, 'CONFIRMED_VISIBLE_DEFECT');
});

test('localized vision J safely retains global evidence after localized failure', () => {
  const global = { status: 'OBSERVED_CONDITION', connectionAssessments: [{ candidateId: 'OBJ-101', connectionState: 'CONNECTED_VERIFIED' }] };
  const final = fuseLocalizedVisualEvidence(global, [{ candidateId: 'OBJ-101', localizedVisualVerification: false, failureReason: 'CROP_FAILED' }]);
  assert.deepEqual(final, global);
});

test('localized vision F–I carries real crop bytes through the complete production orchestrator', async () => {
  const body = await productionBody();
  const { fetchImpl, requests } = makeContractRouter();
  const result = await analyzeSemanticImage(body, { apiKey: 'test-only-placeholder', fetchImpl, enableVisualObservation: true });
  assert.deepEqual(requests.map(({ stage }) => stage), ['nitros_image_semantics', 'nitros_visual_condition_inspection', 'nitros_raw_visual_observation', 'nitros_candidate_regions', 'nitros_localized_inspection', 'nitros_automotive_component', 'nitros_vehicle_area_relationship']);
  const localizedRequest = requests.find(({ stage }) => stage === 'nitros_localized_inspection').request;
  const images = inputImages(localizedRequest);
  assert.equal(images.length, 3, 'production Pass-2 carries detail, context, and original images');
  const source = Buffer.from(body.imageBase64, 'base64');
  const crops = await createLocalizedCrops(source, region);
  const detail = imageBytes(images[0].image_url), context = imageBytes(images[1].image_url), original = imageBytes(images[2].image_url);
  const detailMetadata = await sharp(detail).metadata(), contextMetadata = await sharp(context).metadata(), originalMetadata = await sharp(original).metadata();
  assert.ok(detail.length > 0 && detailMetadata.width === crops.detailMetadata.width && detailMetadata.height === crops.detailMetadata.height, 'F: actual Image 1 is a decodable detail crop of expected dimensions');
  assert.ok(detail.equals(crops.detail) && !detail.equals(source), 'F: actual Image 1 exactly matches the real generated detail crop, not original/location text');
  assert.ok(context.length > 0 && contextMetadata.width === crops.contextMetadata.width && contextMetadata.height === crops.contextMetadata.height, 'G: actual Image 2 is a decodable context crop of expected dimensions');
  assert.ok(context.equals(crops.context) && !context.equals(detail) && !context.equals(source), 'G: actual Image 2 exactly matches the distinct real generated context crop');
  assert.ok(contextMetadata.width > detailMetadata.width && contextMetadata.height > detailMetadata.height, 'G: context is larger than detail where source boundaries permit');
  assert.ok(original.equals(source) && originalMetadata.width === 1000 && originalMetadata.height === 800, 'Image 3 is the original source image');
  const inspection = result.semanticResult.localizedVisualInspections[0];
  assert.equal(inspection.candidateId, 'OBJ-101', 'H: localized response preserves Pass-1 candidate ID');
  assert.equal(inspection.localizedVisualVerification, true, 'H: strict localized response validates');
  assert.equal(inspection.connectionState, 'DISCONNECTED');
  const global = result.semanticResult.visualObservation.objects.find((item) => item.id === 'OBJ-101');
  assert.equal(global.connectionState, 'CONNECTED_CONFIRMED', 'I precondition: global raw analysis is connected');
  assert.equal(result.semanticResult.vehicleAreaRelationshipAnalysis.status, 'READY', 'zero-context automotive routing executes vehicle-area and relationship analysis');
  assert.equal(result.semanticResult.vehicleContextApplied.available, false, 'zero-context run reports vehicle context unavailable without suppressing visual analysis');
  assert.equal(result.serverDiagnostic.vehicleAreaRelationshipAttempted, true, 'execution telemetry records the actual zero-context relationship call');
  assert.equal(result.serverDiagnostic.vehicleContextValidation, 'NOT_AVAILABLE', 'execution telemetry reports unavailable context instead of skipped');
  assert.equal(result.serverDiagnostic.localizedVisualVerification, true, 'execution telemetry records localized verification');
  const fused = result.semanticResult.visualConditionInspection.localizedVisualEvidence[0];
  assert.equal(fused.connectionState, 'DISCONNECTED_VERIFIED', 'I: localized disconnected evidence reaches final fusion');
  assert.equal(fused.localizedDefectState, 'CONFIRMED_VISIBLE_DEFECT');
});

test('localized vision J safely falls back through the complete production orchestrator when Pass-2 fails', async () => {
  const body = await productionBody();
  const { fetchImpl, requests } = makeContractRouter({ failLocalized: true });
  const result = await analyzeSemanticImage(body, { apiKey: 'test-only-placeholder', fetchImpl, enableVisualObservation: true });
  assert.ok(requests.some(({ stage }) => stage === 'nitros_candidate_regions'), 'J precondition: locator ran');
  assert.ok(requests.some(({ stage }) => stage === 'nitros_localized_inspection'), 'J precondition: real crop-backed Pass-2 was attempted');
  assert.equal(result.semanticResult.localizedVisualInspections[0].localizedVisualVerification, false, 'J: failed Pass-2 is never represented as successful localized verification');
  assert.match(result.semanticResult.localizedVisualInspections[0].failureReason, /Localized inspection failed with HTTP 503/i, 'J: failure telemetry retains the localized error');
  assert.equal(result.semanticResult.visualObservation.objects.find((item) => item.id === 'OBJ-101').connectionState, 'CONNECTED_CONFIRMED', 'J: global observation survives forced local failure');
  assert.equal(result.semanticResult.visualConditionInspection.localizedVisualEvidence, undefined, 'J: local failure cannot override global evidence');
  assert.equal(result.semanticResult.visualConditionInspection.connectionAssessments[0].connectionState, 'CONNECTED_VERIFIED', 'J: final result remains the safe global condition result');
});

test('production vision telemetry correlates every existing call without adding or reordering provider traffic', async () => {
  const body = await productionBody();
  const { fetchImpl, requests } = makeContractRouter({ withProviderTelemetry: true });
  const result = await analyzeSemanticImage(body, { apiKey: 'test-only-placeholder', fetchImpl, enableVisualObservation: true });
  const calls = result.usageTelemetry.providerUsage;
  assert.deepEqual(requests.map(({ stage }) => stage), ['nitros_image_semantics', 'nitros_visual_condition_inspection', 'nitros_raw_visual_observation', 'nitros_candidate_regions', 'nitros_localized_inspection', 'nitros_automotive_component', 'nitros_vehicle_area_relationship']);
  assert.equal(calls.length, requests.length, 'instrumentation creates exactly one telemetry record per existing provider request');
  assert.deepEqual(calls.map(call => call.stageName), ['IMAGE_SEMANTIC_CLASSIFICATION', 'WHOLE_IMAGE_VISUAL_CONDITION', 'REGIONAL_WHOLE_IMAGE_SWEEP', 'VISUAL_CANDIDATE_LOCALIZATION', 'LOCALIZED_VISUAL_VERIFICATION', 'COMPONENT_IDENTIFICATION', 'COMPONENT_RELATIONSHIP_REASONING']);
  assert.deepEqual(calls.map(call => call.imageCount), [1, 1, 10, 1, 3, 1, 1]);
  assert.deepEqual(calls.map(call => call.providerRequestId), ['resp_1', 'resp_2', 'resp_3', 'resp_4', 'resp_5', 'resp_6', 'resp_7']);
  assert.ok(calls.every(call => call.model === 'gpt-5.6-sol' && call.httpSuccess === true && call.httpStatus === 200 && call.providerResponseStatus === 'completed'));
  assert.ok(calls.every(call => call.responseBodyParsed === true && call.schemaAccepted === true && call.schemaValidationStatus === 'ACCEPTED'));
  assert.ok(calls.every(call => call.requestStartedAt && call.responseReceivedAt && Number.isFinite(call.durationMs)));
  assert.equal(calls[0].actualProviderCostUsd, 0.0123);
  assert.equal(result.usageTelemetry.requestCount, 7);
  assert.equal(result.usageTelemetry.imageCount, 18);
  assert.deepEqual(result.usageTelemetry.tokens, { inputTokens: 7028, cachedInputTokens: 28, cacheWriteInputTokens: 0, outputTokens: 728, reasoningTokens: 378, totalTokens: 7728 });
  assert.equal(result.usageTelemetry.executionMode, 'SEQUENTIAL');
  assert.equal(result.usageTelemetry.finalOperationStatus, 'SUCCEEDED');
  assert.equal(result.usageTelemetry.retryCount, 0);
  assert.equal(result.usageTelemetry.timeoutCount, 0);
  assert.deepEqual(result.usageTelemetry.originalImageDimensions, { width: 1000, height: 800 });
  assert.equal(result.semanticResult.visualConditionInspection.localizedVisualEvidence[0].connectionState, 'DISCONNECTED_VERIFIED', 'diagnostic evidence is unchanged while telemetry is collected');
});

test('HTTP success and local schema rejection are recorded independently', async () => {
  const body = await productionBody(), diagnostic = {};
  const fetchImpl = async () => response({ category: 'INVALID_CATEGORY' }, 200, { id: 'resp_invalid_schema', model: 'gpt-5.6-sol', status: 'completed' });
  await assert.rejects(analyzeSemanticImage(body, { apiKey: 'test-only-placeholder', fetchImpl, diagnostic, enableVisualObservation: true }), /Malformed semantic response/);
  assert.equal(diagnostic.providerUsageTelemetry.length, 1);
  assert.equal(diagnostic.providerUsageTelemetry[0].httpSuccess, true);
  assert.equal(diagnostic.providerUsageTelemetry[0].httpStatus, 200);
  assert.equal(diagnostic.providerUsageTelemetry[0].status, 'SUCCEEDED');
  assert.equal(diagnostic.providerUsageTelemetry[0].schemaAccepted, false);
  assert.equal(diagnostic.providerUsageTelemetry[0].schemaValidationStatus, 'REJECTED');
});

test('missing provider usage remains unavailable instead of becoming zero telemetry', async () => {
  const body = await productionBody();
  const { fetchImpl } = makeContractRouter();
  const result = await analyzeSemanticImage(body, { apiKey: 'test-only-placeholder', fetchImpl, enableVisualObservation: true });
  assert.equal(result.usageTelemetry.tokens.inputTokens, null);
  assert.equal(result.usageTelemetry.tokens.cachedInputTokens, null);
  assert.equal(result.usageTelemetry.tokens.outputTokens, null);
  assert.equal(result.usageTelemetry.tokens.reasoningTokens, null);
  assert.equal(result.usageTelemetry.tokens.totalTokens, null);
});

test('actual localized Pass-2 production prompt rejects proximity as connection', async () => {
  const core = await readFile(new URL('../semantic-analyzer-core.mjs', import.meta.url), 'utf8');
  const endpoint = await readFile(new URL('../api/semantic-image-analysis.mjs', import.meta.url), 'utf8');
  const client = await readFile(new URL('../image-analysis-ad.js', import.meta.url), 'utf8');
  for (const requirement of ['PROXIMITY IS NOT CONNECTION', 'connector/socket', 'battery terminal/post', 'hose/port', 'return UNCERTAIN', 'absence of a detected defect is not proof']) assert.ok(core.includes(requirement));
  assert.match(core, /AUTOMOTIVE_COMPONENT_OR_VEHICLE' && \(enableVisualObservation \|\| vehicleContext\)/, 'eligible production automotive images execute relationship analysis without requiring vehicle context');
  for (const requirement of ['vehicleAreaRelationshipAttempted', 'localizedVisualVerification', 'vehicleContextMismatchStatus']) assert.ok(endpoint.includes(requirement), `production telemetry exposes ${requirement}`);
  for (const requirement of ["'NOT AVAILABLE'", "'NOT DETERMINED'", 'SKIPPED — ${reason}']) assert.ok(client.includes(requirement), `Hub trace exposes ${requirement}`);
});
