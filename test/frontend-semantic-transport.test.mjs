import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [analyzer, html, serviceWorker, endpoint, core] = await Promise.all([
  readFile(new URL('image-analysis-ad.js', root), 'utf8'),
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('sw.js', root), 'utf8'),
  readFile(new URL('api/semantic-image-analysis.mjs', root), 'utf8'),
  readFile(new URL('semantic-analyzer-core.mjs', root), 'utf8')
]);

test('BD app build keeps the proven AO analyzer and production endpoint', () => {
  assert.match(analyzer, /const BUILD='10\.12\.7AO'/);
  assert.match(html, /10\.12\.7BD/);
  assert.match(html, /src="\.\/image-analysis-ad\.js"/);
  assert.match(html, /nitros-semantic-endpoint" content="https:\/\/nitros-prototype\.vercel\.app\/api\/semantic-image-analysis/);
  assert.match(serviceWorker, /const VERSION = '10\.12\.7BD'/);
  assert.doesNotMatch(`${analyzer}\n${html}\n${serviceWorker}`, /10\.12\.7A[FGHIJKLMN]/);
});

test('semantic request preserves the production payload and classification gates', () => {
  assert.match(analyzer, /method:'POST'/);
  assert.match(analyzer, /JSON\.stringify\(\{transactionId:runId,imageHash,mimeType,imageBase64\}\)/);
  assert.match(analyzer, /'Content-Type':'application\/json'/);
  assert.doesNotMatch(analyzer, /Authorization\s*:/);
  assert.match(analyzer, /category==='AUTOMOTIVE_GRAPH'&&graphEvidence\.length<2/);
  assert.match(analyzer, /category==='AUTOMOTIVE_COMPONENT_OR_VEHICLE'&&!automotiveEvidence\.length/);
});

test('analysis payload is a single bounded metadata-free JPEG copy', () => {
  assert.match(analyzer, /ANALYSIS_STAGES=Object\.freeze\(\[\{longDimension:1536,quality:\.78\},\{longDimension:1280,quality:\.72\},\{longDimension:1024,quality:\.68\}\]\)/);
  assert.match(analyzer, /imageOrientation:'from-image'/);
  assert.match(analyzer, /canvas\.toBlob\([^;]+,'image\/jpeg',quality\)/);
  assert.match(analyzer, /MAX_SEMANTIC_REQUEST_BYTES=3\.25\*1024\*1024/);
  assert.match(analyzer, /run\.analysisBytes\.slice\(0\)/);
  assert.match(analyzer, /run\.bytes=sourceBuffer\.slice\(0\)/);
  assert.match(analyzer, /payloadImageCount:1/);
  assert.equal((analyzer.match(/imageBase64\}/g)||[]).length, 1);
  assert.equal((core.match(/type: 'input_image'/g)||[]).length, 3);
  assert.equal((core.match(/image_url:/g)||[]).length, 3);
  assert.match(core, /requiredFields = \['transactionId', 'imageHash', 'mimeType', 'imageBase64'\]/);
});

test('payload diagnostics and payload-specific failure are explicit', () => {
  for (const field of ['originalDimensions','originalImageBytes','analysisDimensions','analysisJpegQuality','encodedPayloadBytes','payloadImageCount','compressionStage']) assert.ok(analyzer.includes(field), `missing ${field}`);
  assert.match(analyzer, /TRANSPORT\/PAYLOAD FAILURE/);
  assert.match(analyzer, /Image could not be prepared for analysis\./);
  assert.match(analyzer, /Semantic classification:<\/strong> Not performed/);
});

test('semantic confidence is normalized once and exposed safely in Developer Mode', () => {
  assert.match(core, /export function normalizeSemanticConfidence\(rawConfidence\)/);
  assert.match(core, /if \(numeric <= 1\) numeric \*= 100/);
  assert.match(core, /rawConfidence: raw\.confidence \?\? null/);
  assert.match(core, /normalizedConfidence/);
  assert.doesNotMatch(analyzer, /Math\.round\(confidence\)/);
  assert.match(analyzer, /rawConfidence:raw\.rawConfidence\?\?null/);
  assert.match(analyzer, /result\.confidence===null\?'Not provided'/);
  assert.match(html, /id="nitrosRawConfidence"/);
  assert.match(html, /id="nitrosNormalizedConfidence"/);
  assert.match(analyzer, /fileInput\.onchange=.*handleFile\(selected\)/);
  assert.match(analyzer, /oliverImportCameraFile'\)\.onchange=.*handleFile\(selected\)/);
  assert.doesNotMatch(analyzer, /confidence\s*(?:\|\||\?\?)\s*(?:0\.01|1)\b/);
});

test('BD diagnostic imports publish validated image results and attachment metadata to the active case handler',()=>{
  assert.match(analyzer,/CustomEvent\('nitros:diagnostic-import'.*kind:'image-analysis'.*analysis:routed/);
  assert.match(analyzer,/publishImport\(\{kind:'text-data'.*parsedData/);
  assert.match(analyzer,/publishImport\(\{kind:'pdf-attachment'.*usableContent:false.*missingInformation/);
  assert.match(html,/addEventListener\('nitros:diagnostic-import'.*handleRepairInformationImport\(event\.detail\)/);
  assert.match(html,/NitrosDiagnosticV10120=.*importRepairInformation:handleRepairInformationImport/);
});

test('specific component UI is automotive-gated, independently normalized, and hash-bound', () => {
  assert.match(core, /semanticResult\.category === 'AUTOMOTIVE_COMPONENT_OR_VEHICLE'/);
  assert.match(core, /Component confidence must be independent from category confidence/);
  assert.match(core, /status: 'FAILED'/);
  assert.match(analyzer, /category!=='AUTOMOTIVE_COMPONENT_OR_VEHICLE'\)return null/);
  assert.match(analyzer, /normalizedComponentConfidence/);
  assert.match(analyzer, /raw\.semanticRequestId!==run\.analyzer\.requestId\|\|raw\.imageHash!==run\.imageHash/);
  assert.match(core, /semanticRequestId: transactionId, imageHash/);
  assert.match(analyzer, /SPECIFIC COMPONENT IDENTIFICATION/);
  assert.match(analyzer, /Automotive category confirmed/);
  assert.match(analyzer, /Identifying specific component/);
  assert.match(analyzer, /Component result received/);
  assert.match(analyzer, /Component confidence normalized/);
  assert.match(html, /id="nitrosPrimaryComponent"/);
  assert.match(html, /id="nitrosComponentHashMatch"/);
});

test('drivetrain discrimination uses structured spatial and power-flow evidence', () => {
  for (const value of ['TRANSFER_CASE','DIFFERENTIAL','TRANSMISSION','TRANSAXLE','engineConnection','transmissionConnection','longitudinalShafts','lateralAxleOutputs','axleTubes','location','powerFlowRole','distinguishingFeaturesComplete','competingCandidate']) assert.ok(core.includes(value), `missing ${value}`);
  assert.match(core, /Math\.min\(84, normalizedConfidence\)/);
  assert.match(core, /perimeter bolts, under-vehicle location, or a nearby driveshaft alone are insufficient/);
  assert.match(core, /TRANSFER CASE evidence includes a separate gearbox directly attached to or behind the transmission/);
  assert.match(core, /TRANSAXLE evidence includes an integrated transmission\/final-drive assembly/);
  assert.match(core, /Primary drivetrain identification conflicts with the discrimination result/);
});

test('wiring diagrams are structurally gated and expose one-step guided test state', () => {
  assert.match(core, /'AUTOMOTIVE_WIRING_DIAGRAM'/);
  assert.match(core, /Automotive words or OCR text alone are insufficient/);
  assert.match(core, /Wiring diagram classification lacks structural schematic evidence/);
  assert.match(core, /VERIFY → TEST → ISOLATE → REPAIR → CONFIRM/);
  assert.match(core, /unsupported numeric specification/);
  assert.match(analyzer, /category==='AUTOMOTIVE_WIRING_DIAGRAM'/);
  assert.match(analyzer, /START GUIDED COMPONENT TEST/);
  assert.match(analyzer, /componentTestSession/);
  assert.match(analyzer, /evaluateGuidedResult\(step,measurement\)/);
  assert.match(analyzer, /completedTests\.push/);
  assert.match(analyzer, /Wiring diagram result does not match the current image request/);
  assert.match(html, /id="nitrosComponentTestSessionId"/);
});

test('AO guided electrical testing does not verify a fault from one ambiguous reading', () => {
  assert.match(analyzer, /numeric!==null.*status:'INCONCLUSIVE'/);
  assert.match(analyzer, /That reading alone does not verify a fault/);
  assert.match(analyzer, /Fault not yet verified\. Additional circuit testing required/);
  assert.match(analyzer, /verificationSupported\(session,step\)/);
  assert.match(analyzer, /failed\.length>=2/);
  assert.match(analyzer, /confidenceState:'NOT TESTED'/);
  for (const state of ['NOT TESTED','TESTING','SUSPECTED','SUPPORTED BY TEST RESULTS','VERIFIED','PASSED']) assert.ok(analyzer.includes(state), `missing confidence state ${state}`);
});

test('AO guided tests capture exact conditions and a structured evidence log', () => {
  for (const field of ['testNumber','component','circuitPin','ignitionState','connectorState','meterMode','redLeadLocation','blackLeadLocation','technicianReading','expectedBehavior','interpretation','result','timestamp']) assert.ok(analyzer.includes(field), `missing evidence field ${field}`);
  assert.match(analyzer, /guided-test-confirm/);
  assert.match(analyzer, /Confirm the exact test conditions before the reading can be interpreted/);
  assert.match(analyzer, /Diagnostic evidence log/);
  assert.match(analyzer, /START GUIDED COMPONENT TEST/);
});

test('AO neutral circuit paths and electrical safety gates are enforced', () => {
  assert.match(core, /circuitPaths/);
  assert.match(core, /Circuit function not reliably confirmed from supplied diagram/);
  assert.match(core, /Do not label a two-wire resistive sensor as conventional power and ground/);
  assert.match(core, /attempts resistance or continuity testing without an explicit de-energized condition/);
  assert.match(analyzer, /TEST BLOCKED — INVALID TEST CONDITION/);
  assert.match(analyzer, /Circuit must be de-energized before resistance\/continuity testing/);
  assert.match(analyzer, /<strong>Circuit paths:<\/strong>/);
  assert.doesNotMatch(analyzer, /<strong>Power path:<\/strong>/);
  assert.doesNotMatch(analyzer, /<strong>Ground path:<\/strong>/);
});

test('AO wiring parser defensively normalizes legacy semantic field shapes', () => {
  assert.match(core, /export function normalizeWiringField/);
  assert.match(core, /\['path','steps','nodes','components','testPoints','connectors'\]/);
  assert.match(core, /normalizeWiringField\(raw\.powerPath\)/);
  assert.match(core, /normalizeWiringField\(raw\.groundPath\)/);
  assert.match(core, /normalizeWiringField\(raw\.controlPath \?\? raw\.signalPath\)/);
  assert.match(analyzer, /const powerPath=normalizeField\(raw\.powerPath\),groundPath=normalizeField\(raw\.groundPath\)/);
  assert.match(analyzer, /Normalized power path/);
  assert.match(analyzer, /Visible test points/);
  assert.doesNotMatch(analyzer, /stringArray\(raw\[field\],field\)/);
  assert.match(html, /version:'10\.12\.7BD'/);
});

test('transport diagnostics cover lifecycle, timing, and categorized failures', () => {
  for (const category of ['CONFIGURATION_ERROR','NETWORK_ERROR','CORS_ERROR','HTTP_ERROR','TIMEOUT_ERROR','REQUEST_ABORTED','PAYLOAD_ERROR','RESPONSE_PARSE_ERROR','SEMANTIC_API_ERROR','UNKNOWN_TRANSPORT_ERROR']) {
    assert.ok(analyzer.includes(category), `missing ${category}`);
  }
  for (const field of ['requestId','stage','endpoint','method','payloadGenerated','encodedPayloadBytes','fetchStarted','responseReceived','httpStatus','httpStatusText','responseType','responseContentType','parseResult','imagePreparationMs','payloadEncodingMs','requestStartMs','responseReceivedMs','responseParsingMs','totalMs']) {
    assert.ok(analyzer.includes(field), `missing ${field}`);
  }
  assert.match(analyzer, /createSemanticDiagnostic\(mimeType\)/);
  assert.match(analyzer, /requestId:createId\('sem'\)/);
  assert.match(analyzer, /NO HTTP RESPONSE RECEIVED/);
  assert.match(analyzer, /SEMANTIC ANALYSIS FAILED/);
  assert.match(analyzer, /SEMANTIC_NETWORK_ERROR:/);
  assert.match(analyzer, /SEMANTIC_PARSE_ERROR:/);
  assert.match(analyzer, /SEMANTIC_RESULT_MISSING:/);
});

test('classification is gated by response, schema, request ID, and image hash', () => {
  for (const state of ['REQUEST_SENT','RESPONSE_RECEIVED','RESPONSE_HTTP_OK','RESPONSE_PARSED','SEMANTIC_CONTENT_FOUND','CLASSIFICATION_STARTED','CLASSIFICATION_COMPLETE']) {
    assert.ok(analyzer.includes(state), `missing ${state}`);
  }
  assert.match(analyzer, /runId:run\.analyzer\.requestId/);
  assert.match(analyzer, /raw\.transactionId!==run\.analyzer\.requestId/);
  assert.match(analyzer, /payload\?\.transactionId===runId/);
  assert.match(analyzer, /payload\?\.imageHash===imageHash/);
  assert.match(analyzer, /expectedSemanticFieldsPresent:true/);
  assert.match(analyzer, /pipeline:\{\.\.\.diagnostic\.pipeline,SEMANTIC_CONTENT_FOUND:'PASS'\}/);
});

test('visible stages reflect confirmed browser, Vercel, OpenAI, parse, and object evidence', () => {
  for (const label of ['Building semantic request','Contacting Vercel endpoint','Vercel endpoint response','OpenAI request','OpenAI response','Parsing semantic response','Semantic objects received','Classifying','Fresh-result verification','Complete']) {
    assert.ok(analyzer.includes(label), `missing ${label}`);
  }
  assert.match(analyzer, /if\(diag\.payloadGenerated\)set\(2,'PASS'\)/);
  assert.match(analyzer, /if\(diag\.responseReceived\)\{set\(3,'PASS'\);set\(4,'PASS'\)\}/);
  assert.match(analyzer, /if\(server\.openaiResponseReceived&&server\.openaiResponseOk\)set\(5,'PASS'\)/);
  assert.doesNotMatch(analyzer, /if\(server\.openaiRequestAttempted\)set\(5,'PASS'\)/);
  assert.match(analyzer, /if\(server\.semanticOutputPresent\)set\(8,'PASS'\)/);
});

test('CORS preflight explicitly allows the production request headers', () => {
  assert.match(endpoint, /Access-Control-Allow-Headers', 'Content-Type, Cache-Control'/);
  assert.doesNotMatch(endpoint, /Access-Control-Allow-Origin', '\*'/);
});

test('semantic transport has a bounded client timeout while preserving image-reset aborts', () => {
  assert.match(analyzer, /SEMANTIC_REQUEST_TIMEOUT_MS=60_000/);
  assert.match(analyzer, /new DOMException\('Semantic analysis timeout','TimeoutError'\)/);
  assert.match(analyzer, /signal\?\.addEventListener\('abort',forwardAbort,\{once:true\}\)/);
  assert.match(analyzer, /clearTimeout\(requestTimer\)/);
});

test('response diagnostics retain sanitized structure without semantic values', () => {
  for (const field of ['responseCharacters','responseBytes','responseOk','topLevelKeys','semanticResultKeys','missingSemanticPaths','responseId','responseTransactionId','responseImageHash']) {
    assert.ok(analyzer.includes(field), `missing ${field}`);
  }
  assert.match(analyzer, /RESPONSE_NOT_JSON/);
  assert.match(analyzer, /safeResponsePreview\(payload,responseText\)/);
  assert.match(analyzer, /semanticResultPresent:Boolean\(semantic\)/);
});

test('diagnostics redact credentials and limit response previews to safe structure', () => {
  assert.match(analyzer, /Bearer \[REDACTED\]/);
  assert.match(analyzer, /\[REDACTED_API_KEY\]/);
  assert.match(analyzer, /\[REDACTED_IMAGE_DATA\]/);
  assert.match(analyzer, /semanticResultKeys:semantic\?Object\.keys\(semantic\)\.sort\(\):\[\]/);
  assert.match(analyzer, /sanitizeDiagnosticText\(responseText,500\)/);
  assert.doesNotMatch(analyzer, /safe=\{[^}]*semanticResult:semantic/);
  assert.doesNotMatch(html, /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/);
});

test('developer panel and preview remain contained on mobile', () => {
  assert.match(html, /SEMANTIC ANALYZER TRANSPORT DIAGNOSTIC/);
  assert.match(html, /id="nitrosSemanticTransportDiagnostic"/);
  assert.match(html, /white-space:pre-wrap/);
  assert.match(html, /overflow-x:hidden/);
  assert.match(html, /\.oliver-import-preview img\{height:auto;object-fit:contain\}/);
});

test('service worker keeps the existing navigation-only network-first behavior', () => {
  assert.match(serviceWorker, /if \(request\.method !== 'GET'\) return/);
  assert.match(serviceWorker, /if \(!isNavigation && !isAppShellHtml\) return/);
  assert.match(serviceWorker, /fetch\(request, \{ cache: 'no-store' \}\)/);
  assert.match(serviceWorker, /caches\.match\(APP_SHELL/);
});
