import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  analyzeSemanticImage,
  buildVehicleAreaRelationshipFallback,
  canonicalComponentVisualFinding,
  evaluateCrossFindingConflicts,
  mergeCanonicalComponentEvidence,
  normalizeAutomotiveComponentResult,
  promoteFinalEvidence,
  reconcileVisualFindings
} from '../semantic-analyzer-core.mjs';

const emptyCondition = () => ({ status: 'UNVERIFIED_CONDITION', conditionConfidence: null, rawConditionConfidence: null, normalizedConditionConfidence: null, observedCondition: [], possibleConcerns: [], connectionAssessments: [], noVisibleConcernMessage: '', unableToInspectReason: null, visibleEvidence: [], recommendedVerification: [], safetyDrivabilityImpact: null });

test('10.13.137 A — component name and confidence aliases normalize into one canonical contract', () => {
  const result = normalizeAutomotiveComponentResult({ status: 'IDENTIFIED', componentName: 'Alternator', confidence: '87%', category: 'Charging system', evidence: ['The alternator housing and pulley are visibly supported.'] });
  assert.equal(result.name, 'Alternator');
  assert.equal(result.primaryComponent, 'Alternator');
  assert.equal(result.confidence, 0.87);
  assert.equal(result.normalizedComponentConfidence, 87);
  assert.equal(result.confidenceStatus, 'NORMALIZED');
  assert.equal(result.status, 'IDENTIFIED');
  const relationship = buildVehicleAreaRelationshipFallback({ componentIdentification: result, semanticResult: { automotiveEvidence: result.evidence, evidence: [] } });
  assert.equal(relationship.status, 'READY');
});

test('10.13.137 B — a usable component name without confidence is preserved and downstream work continues', () => {
  const result = normalizeAutomotiveComponentResult({ status: 'UNCERTAIN', component_name: 'EGR-area electrical connector', visual_evidence: ['An electrical connector body is visible beside the valve assembly.'] });
  assert.equal(result.name, 'EGR-area electrical connector');
  assert.equal(result.confidence, null);
  assert.equal(result.confidenceStatus, 'UNKNOWN');
  assert.notEqual(result.status, 'FAILED');
  const relationship = buildVehicleAreaRelationshipFallback({ componentIdentification: result, semanticResult: { automotiveEvidence: result.evidence, evidence: [] } });
  assert.equal(relationship.status, 'READY');
  assert.match(relationship.vehicleAreaLocation, /engine|exhaust|automotive component/i);
});

test('10.13.137 C — a visibly disconnected connector survives the handoff and is promotion-eligible', () => {
  const component = normalizeAutomotiveComponentResult({ status: 'UNCERTAIN', name: 'Electrical connector', confidence_score: 0.92, vehicle_area: 'Center-right of image', visual_state: 'DISCONNECTED', state_confidence: 0.92, evidence: ['The electrical connector and matching socket are both visible with a clear air gap; the connector is visibly disconnected from the receptacle.'] });
  const finding = canonicalComponentVisualFinding(component);
  assert.equal(finding.connectionState, 'DISCONNECTED_VERIFIED');
  const reconciled = reconcileVisualFindings(mergeCanonicalComponentEvidence(emptyCondition(), component));
  const relationship = buildVehicleAreaRelationshipFallback({ componentIdentification: component, semanticResult: { automotiveEvidence: component.evidence, evidence: [] } });
  const conflicts = evaluateCrossFindingConflicts(reconciled);
  const promotion = promoteFinalEvidence(reconciled, conflicts);
  assert.equal(relationship.observedItems[0].physicalConnectionState, 'DISCONNECTED');
  assert.equal(reconciled.connectionAssessments[0].findingType, 'CLEAR_DEFECT');
  assert.equal(promotion.eligible, true);
  assert.equal(promotion.promotedCount, 1);
});

test('10.13.137 D — affirmative connected evidence never becomes a disconnected defect', () => {
  const component = normalizeAutomotiveComponentResult({ status: 'IDENTIFIED', part_name: 'Electrical connector', probability: 0.9, connection_state: 'CONNECTED', evidence: ['Both connector halves are fully mated, the connector body is fully inserted into its matching receptacle, the latch is visibly engaged, and no abnormal gap is visible.'] });
  const finding = canonicalComponentVisualFinding(component);
  assert.equal(finding.connectionState, 'CONNECTED_VERIFIED');
  const reconciled = reconcileVisualFindings(mergeCanonicalComponentEvidence(emptyCondition(), component));
  assert.equal(reconciled.connectionAssessments[0].connectionState, 'CONNECTED_VERIFIED');
  assert.equal(reconciled.connectionAssessments[0].findingType, 'NO_DEFECT_VISIBLE');
  assert.equal(reconciled.finalEvidencePromotion.promotedCount, 0);
});

test('10.13.137 E — a free connector with no visible mating point remains unverified and cannot be promoted', () => {
  const component = normalizeAutomotiveComponentResult({ status: 'UNCERTAIN', component: 'Loose harness connector', connection_state: 'DISCONNECTED', evidence: ['The electrical connector hangs free; its mating receptacle is outside the frame and cannot be identified.'] });
  const finding = canonicalComponentVisualFinding(component);
  assert.equal(finding.connectionState, 'INDETERMINATE');
  assert.equal(finding.findingType, 'UNVERIFIED_CONDITION');
  assert.match(finding.visibleEvidence, /cannot be verified/i);
  const reconciled = reconcileVisualFindings(mergeCanonicalComponentEvidence(emptyCondition(), component));
  assert.equal(reconciled.connectionAssessments[0].findingType, 'UNVERIFIED_CONDITION');
  assert.equal(reconciled.finalEvidencePromotion.promotedCount, 0);
});

test('10.13.137 observed incomplete component response recovers a canonical result without inventing confidence', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const classifier = { category: 'AUTOMOTIVE_COMPONENT_OR_VEHICLE', confidence: 93, objects: ['Electrical connector'], evidence: ['An electrical connector and adjacent harness are visible.'], description: 'Automotive connector area.', automotiveEvidence: ['An electrical connector body is visible.'], graphEvidence: [], documentEvidence: [] };
  const condition = { status: 'NO_VISIBLE_CONCERN_DETECTED', conditionConfidence: 82, observedCondition: [], possibleConcerns: [], connectionAssessments: [{ location: 'Center connector', seatingStatus: 'NO_GAP_OR_SEPARATION_VISIBLE', findingType: 'NO_DEFECT_VISIBLE', severity: 'LOW', findingConfidence: 82, visibleEvidence: 'Both connector halves are fully mated, the locking tab is visibly engaged, and no abnormal gap is visible.', matingComponentVisible: true, directDamageVisible: false, missingContext: null, recommendedVerification: 'Physically verify the connector latch and wire entry condition.', safetyDrivabilityImpact: null }], noVisibleConcernMessage: 'No obvious visible defects are confirmed from this image. Inspect the component physically before making a repair decision.', unableToInspectReason: null, visibleEvidence: ['Both connector halves are fully mated and no abnormal gap is visible.'], recommendedVerification: ['Physically verify the connector latch and wire entry condition.'], safetyDrivabilityImpact: null };
  const structured = payload => ({ ok: true, status: 200, async json() { return { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }] }; } });
  const incomplete = { ok: true, status: 200, async json() { return { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'reasoning', summary: [] }] }; } };
  const body = { transactionId: 'component-contract-incomplete', imageHash: createHash('sha256').update(bytes).digest('hex'), mimeType: 'image/png', imageBase64: bytes.toString('base64') };
  let call = 0;
  const originalInfo = console.info;
  console.info = () => {};
  try {
    const result = await analyzeSemanticImage(body, { apiKey: 'test-key', fetchImpl: async () => [structured(classifier), incomplete, structured(condition)][call++] });
    const component = result.semanticResult.componentIdentification;
    assert.equal(call, 3);
    assert.equal(component.status, 'UNCERTAIN');
    assert.equal(component.name, 'Electrical connector');
    assert.equal(component.confidence, null);
    assert.equal(component.source, 'semantic-fallback');
    assert.equal(result.serverDiagnostic.componentResponseReceived, true);
    assert.equal(result.serverDiagnostic.componentResponseOk, true);
    assert.equal(result.serverDiagnostic.componentResponseParsed, false);
    assert.equal(result.serverDiagnostic.componentResultPresent, true);
    assert.equal(result.serverDiagnostic.componentConfidenceStatus, 'UNKNOWN');
    assert.equal(result.serverDiagnostic.componentIncompleteReason, 'max_output_tokens');
  } finally {
    console.info = originalInfo;
  }
});

test('10.13.137 F — request transport, model policy, image detail, endpoint, and timeout remain unchanged', () => {
  const core = readFileSync(new URL('../semantic-analyzer-core.mjs', import.meta.url), 'utf8');
  const frontend = readFileSync(new URL('../image-analysis-ad.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.match(core, /const MODEL = process\.env\.OPENAI_VISION_MODEL \|\| 'gpt-5\.6-sol'/);
  assert.match(core, /const DEEP_VISION_REASONING = Object\.freeze\(\{ effort: 'max', mode: 'pro' \}\)/);
  assert.match(core, /const DEEP_VISION_DETAIL = 'original'/);
  assert.match(core, /max_output_tokens: 1000/);
  assert.match(frontend, /const SEMANTIC_REQUEST_TIMEOUT_MS=290_000/);
  assert.match(frontend, /fetch\(requestUrl\.href,\{method:'POST'/);
  assert.match(html, /nitros-semantic-endpoint" content="https:\/\/nitros-prototype\.vercel\.app\/api\/semantic-image-analysis/);
  assert.equal(vercel.functions['api/semantic-image-analysis.mjs'].maxDuration, 300);
});
