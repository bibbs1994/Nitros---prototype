import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [analyzer, html, serviceWorker, endpoint] = await Promise.all([
  readFile(new URL('image-analysis-ad.js', root), 'utf8'),
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('sw.js', root), 'utf8'),
  readFile(new URL('api/semantic-image-analysis.mjs', root), 'utf8')
]);

test('AI build identifiers and production endpoint are consistent', () => {
  assert.match(analyzer, /const BUILD='10\.12\.7AI'/);
  assert.match(html, /Version 10\.12\.7AI/);
  assert.match(html, /image-analysis-ad\.js\?v=10\.12\.7AI/);
  assert.match(html, /nitros-semantic-endpoint" content="https:\/\/nitros-prototype\.vercel\.app\/api\/semantic-image-analysis/);
  assert.match(serviceWorker, /const VERSION = '10\.12\.7AI'/);
  assert.doesNotMatch(`${analyzer}\n${html}\n${serviceWorker}`, /10\.12\.7A[FGH]/);
});

test('semantic request preserves the production payload and classification gates', () => {
  assert.match(analyzer, /method:'POST'/);
  assert.match(analyzer, /JSON\.stringify\(\{transactionId:runId,imageHash,mimeType,imageBase64\}\)/);
  assert.match(analyzer, /'Content-Type':'application\/json'/);
  assert.doesNotMatch(analyzer, /Authorization\s*:/);
  assert.match(analyzer, /category==='AUTOMOTIVE_GRAPH'&&graphEvidence\.length<2/);
  assert.match(analyzer, /category==='AUTOMOTIVE_COMPONENT_OR_VEHICLE'&&!automotiveEvidence\.length/);
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
  assert.match(analyzer, /if\(server\.openaiRequestAttempted\)set\(5,'PASS'\)/);
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
