import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import handler from '../api/semantic-image-analysis.mjs';
import { MAX_JSON_BYTES, publicError, resetRateLimitsForTests } from '../backend-http-security.mjs';
import { analyzeSemanticImage } from '../semantic-analyzer-core.mjs';

const ORIGIN = 'https://bibbs1994.github.io';

function responseMock() {
  return {
    headers: {}, statusCode: 200, payload: undefined, ended: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { this.ended = true; return this; }
  };
}

function request(overrides = {}) {
  return {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.10' },
    body: '{}',
    ...overrides
  };
}

test.beforeEach(() => resetRateLimitsForTests());

test('rejects malformed method', async () => {
  const response = responseMock();
  await handler(request({ method: 'GET' }), response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.payload.code, 'METHOD_NOT_ALLOWED');
});

test('accepts allowed-origin preflight only', async () => {
  const response = responseMock();
  await handler(request({ method: 'OPTIONS' }), response);
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['access-control-allow-origin'], ORIGIN);
});

test('rejects an unexpected origin', async () => {
  const response = responseMock();
  await handler(request({ headers: { origin: 'https://example.invalid', 'content-type': 'application/json' } }), response);
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.code, 'ORIGIN_FORBIDDEN');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
});

test('rejects an oversized declared request', async () => {
  const response = responseMock();
  await handler(request({ headers: { origin: ORIGIN, 'content-type': 'application/json', 'content-length': String(MAX_JSON_BYTES + 1) } }), response);
  assert.equal(response.statusCode, 413);
  assert.equal(response.payload.code, 'REQUEST_TOO_LARGE');
});

test('rejects invalid JSON', async () => {
  const response = responseMock();
  await handler(request({ body: '{not-json' }), response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.code, 'INVALID_JSON');
});

test('rejects missing required fields before OpenAI transport', async () => {
  const response = responseMock();
  await handler(request({ body: JSON.stringify({ transactionId: 'case-1' }) }), response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.code, 'INVALID_REQUEST');
});

test('rate limits repeated beta requests', async () => {
  let response;
  for (let index = 0; index < 13; index += 1) {
    response = responseMock();
    await handler(request({ body: '{}' }), response);
  }
  assert.equal(response.statusCode, 429);
  assert.equal(response.payload.code, 'RATE_LIMITED');
});

test('valid request reaches mocked server-side OpenAI path without secret disclosure', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const body = {
    transactionId: 'case-1',
    imageHash: createHash('sha256').update(bytes).digest('hex'),
    mimeType: 'image/png',
    imageBase64: bytes.toString('base64')
  };
  let called = false;
  const result = await analyzeSemanticImage(body, {
    apiKey: 'test-only-placeholder',
    fetchImpl: async (_url, options) => {
      called = true;
      assert.match(options.headers.Authorization, /^Bearer /);
      return {
        ok: true,
        status: 200,
        async json() {
          return { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
            category: 'GENERAL_NON_AUTOMOTIVE_PHOTO', confidence: 95, objects: ['test object'], evidence: ['visible test evidence'],
            description: 'A test response.', automotiveEvidence: [], graphEvidence: [], documentEvidence: []
          }) }] }] };
        }
      };
    }
  });
  assert.equal(called, true);
  assert.equal(JSON.stringify(result).includes('test-only-placeholder'), false);
});

test('raw upstream errors are sanitized', () => {
  const failure = publicError(Object.assign(new Error('internal upstream detail'), { statusCode: 502 }));
  assert.deepEqual(failure, { status: 502, body: { error: 'Image analysis is temporarily unavailable.', code: 'ANALYSIS_UNAVAILABLE' } });
});
