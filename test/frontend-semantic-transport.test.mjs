import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [analyzer, html, serviceWorker] = await Promise.all([
  readFile(new URL('image-analysis-ad.js', root), 'utf8'),
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('sw.js', root), 'utf8')
]);

test('AG build identifiers and production endpoint are consistent', () => {
  assert.match(analyzer, /const BUILD='10\.12\.7AG'/);
  assert.match(html, /Version 10\.12\.7AG/);
  assert.match(html, /image-analysis-ad\.js\?v=10\.12\.7AG/);
  assert.match(html, /nitros-semantic-endpoint" content="https:\/\/nitros-prototype\.vercel\.app\/api\/semantic-image-analysis/);
  assert.match(serviceWorker, /const VERSION = '10\.12\.7AG'/);
  assert.doesNotMatch(`${analyzer}\n${html}\n${serviceWorker}`, /10\.12\.7AF/);
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
  assert.match(analyzer, /requestId:createId\('SA'\)/);
  assert.match(analyzer, /NO HTTP RESPONSE RECEIVED/);
  assert.match(analyzer, /SEMANTIC ANALYSIS FAILED/);
});

test('diagnostics redact credentials and omit potentially sensitive response content', () => {
  assert.match(analyzer, /Bearer \[REDACTED\]/);
  assert.match(analyzer, /\[REDACTED_API_KEY\]/);
  assert.match(analyzer, /\[REDACTED_IMAGE_DATA\]/);
  assert.match(analyzer, /successful response may contain image-derived content/);
  assert.match(analyzer, /unparsed response body may contain sensitive content/);
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
