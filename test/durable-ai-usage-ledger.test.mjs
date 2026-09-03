import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildUsageEvent } from '../ai-usage-ledger.mjs';
import { RedisUsageLedgerRepository, resolveRedisConfiguration } from '../durable-ai-usage-ledger.mjs';
import { createAdminUsageHandler } from '../api/admin/ai-usage.mjs';
import { persistProviderUsage, persistProviderUsageSafely } from '../api/semantic-image-analysis.mjs';

function mockRedis() {
  const values = new Map(), scores = new Map(), requests = [];
  const fetchImpl = async (url, options) => {
    const args = JSON.parse(options.body), command = String(args[0]).toUpperCase();
    requests.push({ url, headers: options.headers, args });
    let result;
    if (command === 'PING') result = 'PONG';
    else if (command === 'SET') {
      const [, key, value, mode] = args;
      if (mode === 'NX' && values.has(key)) result = null;
      else { values.set(key, value); result = 'OK'; }
    } else if (command === 'GET') result = values.get(args[1]) ?? null;
    else if (command === 'ZADD') { scores.set(args[3], Number(args[2])); result = 1; }
    else if (command === 'ZRANGE') result = [...scores].sort((a, b) => b[1] - a[1]).map(([member]) => member);
    else throw new Error(`Unsupported mock command ${command}`);
    return { ok: true, json: async () => ({ result }) };
  };
  return { values, scores, requests, fetchImpl };
}

function repository(mock = mockRedis()) {
  return { mock, ledger: new RedisUsageLedgerRepository({ url: 'https://redis.example.test', token: 'test-only-token', fetchImpl: mock.fetchImpl }) };
}

function event({ transactionId = 'operation-1', providerRequestId = 'resp_1', callIndex = 0, repairOrderId = 'RO-A', caseId = 'case-a', model = 'gpt-5.6-sol', status = 'SUCCEEDED', actualProviderCostUsd } = {}) {
  return buildUsageEvent({
    body: { transactionId, vehicleContext: { repairOrderId, activeCaseId: caseId, vehicleId: `vehicle-${repairOrderId}`, vin: '1HGCM82633A004352' } },
    result: { usageTelemetry: { providerRequestId, upstreamCallIndex: callIndex, model, status, actualProviderCostUsd, tokens: { inputTokens: 20, cachedInputTokens: 4, outputTokens: 5, reasoningTokens: 2, totalTokens: 25 }, requestCount: 1, imageCount: 1 } }
  });
}

function responseCapture() {
  return { headers: {}, statusCode: 200, body: null, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
}

test('Redis/Valkey REST adapter durably writes, reads, filters, and reports provider identity', async () => {
  const { ledger } = repository();
  const stored = await ledger.record(event());
  assert.equal(stored.providerRequestId, 'resp_1');
  assert.equal(stored.logicalOperationId, 'operation-1');
  assert.equal(stored.repairOrderId, 'RO-A');
  assert.equal((await ledger.events()).length, 1);
  const report = await ledger.report({ repairOrderId: 'RO-A' });
  assert.equal(report.current.all.requests, 1);
  assert.equal(report.current.all.providerRequests, 1);
  assert.equal(report.byCase[0].name, 'RO-A');
  assert.equal((await ledger.report({ repairOrderId: 'RO-B' })).current.all.requests, 0);
});

test('AI_USAGE Redis REST environment pair configures the explicit override source', async () => {
  const mock = mockRedis(), environment = { AI_USAGE_REDIS_REST_URL: 'https://override.redis.example.test', AI_USAGE_REDIS_REST_TOKEN: 'override-write-token-test' };
  const ledger = new RedisUsageLedgerRepository({ environment, fetchImpl: mock.fetchImpl });
  assert.equal(ledger.configured, true);
  assert.deepEqual(ledger.health(), { storageMode: 'production-durable-redis', storageStatus: 'CONFIGURED', configurationSource: 'AI_USAGE_OVERRIDE' });
  await ledger.checkHealth();
  assert.equal(mock.requests[0].url, environment.AI_USAGE_REDIS_REST_URL);
});

test('native Vercel KV REST API pair configures the Upstash source directly', async () => {
  const mock = mockRedis(), environment = { KV_REST_API_URL: 'https://vercel.redis.example.test', KV_REST_API_TOKEN: 'vercel-write-token-test' };
  const ledger = new RedisUsageLedgerRepository({ environment, fetchImpl: mock.fetchImpl });
  assert.equal(ledger.configured, true);
  assert.deepEqual(ledger.health(), { storageMode: 'production-durable-redis', storageStatus: 'CONFIGURED', configurationSource: 'VERCEL_UPSTASH' });
  await ledger.record(event());
  assert.equal((await ledger.events()).length, 1);
});

test('complete AI_USAGE pair overrides a complete Vercel Upstash pair', async () => {
  const mock = mockRedis(), environment = {
    AI_USAGE_REDIS_REST_URL: 'https://override.redis.example.test', AI_USAGE_REDIS_REST_TOKEN: 'override-write-token-test',
    KV_REST_API_URL: 'https://vercel.redis.example.test', KV_REST_API_TOKEN: 'vercel-write-token-test'
  };
  const resolved = resolveRedisConfiguration(environment), ledger = new RedisUsageLedgerRepository({ environment, fetchImpl: mock.fetchImpl });
  assert.equal(resolved.configurationSource, 'AI_USAGE_OVERRIDE');
  await ledger.checkHealth();
  assert.equal(mock.requests[0].url, environment.AI_USAGE_REDIS_REST_URL);
  assert.equal(mock.requests[0].headers.Authorization, `Bearer ${environment.AI_USAGE_REDIS_REST_TOKEN}`);
});

test('read-only Upstash token is never selected for ledger writes', async () => {
  const readOnlyOnly = new RedisUsageLedgerRepository({ environment: { KV_REST_API_URL: 'https://vercel.redis.example.test', KV_REST_API_READ_ONLY_TOKEN: 'read-only-token-test' }, fetchImpl: async () => assert.fail('fetch must not run') });
  assert.equal(readOnlyOnly.configured, false);
  assert.equal(readOnlyOnly.health().configurationSource, 'NOT_CONFIGURED');
  const mock = mockRedis(), environment = { KV_REST_API_URL: 'https://vercel.redis.example.test', KV_REST_API_TOKEN: 'write-token-test', KV_REST_API_READ_ONLY_TOKEN: 'read-only-token-test' };
  const ledger = new RedisUsageLedgerRepository({ environment, fetchImpl: mock.fetchImpl });
  await ledger.checkHealth();
  assert.equal(mock.requests[0].headers.Authorization, `Bearer ${environment.KV_REST_API_TOKEN}`);
  assert.notEqual(mock.requests[0].headers.Authorization, `Bearer ${environment.KV_REST_API_READ_ONLY_TOKEN}`);
});

test('partial override and Vercel pairs fail closed without mixing credential sources', () => {
  const configurations = [
    { AI_USAGE_REDIS_REST_URL: 'https://override.redis.example.test' },
    { AI_USAGE_REDIS_REST_TOKEN: 'override-write-token-test' },
    { KV_REST_API_URL: 'https://vercel.redis.example.test' },
    { KV_REST_API_TOKEN: 'vercel-write-token-test' },
    { AI_USAGE_REDIS_REST_URL: 'https://override.redis.example.test', KV_REST_API_URL: 'https://vercel.redis.example.test', KV_REST_API_TOKEN: 'vercel-write-token-test' }
  ];
  for (const environment of configurations) {
    const ledger = new RedisUsageLedgerRepository({ environment, fetchImpl: async () => assert.fail('fetch must not run') });
    assert.equal(ledger.configured, false);
    assert.equal(ledger.health().configurationSource, 'NOT_CONFIGURED');
  }
});

test('configuration health and errors expose safe labels but no credential values', async () => {
  const environment = { KV_REST_API_URL: 'https://private.redis.example.test', KV_REST_API_TOKEN: 'private-write-token-test' };
  const ledger = new RedisUsageLedgerRepository({ environment, fetchImpl: async () => { throw new Error('private transport detail'); } });
  const serializedHealth = JSON.stringify(await ledger.checkHealth());
  assert.match(serializedHealth, /VERCEL_UPSTASH/);
  for (const secret of Object.values(environment)) assert.doesNotMatch(serializedHealth, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await assert.rejects(ledger.events(), error => error.code === 'LEDGER_STORAGE_FAILED' && !error.message.includes('private transport detail') && !error.message.includes(environment.KV_REST_API_URL));
});

test('provider response ID is the durable idempotency key and prevents duplicate writes', async () => {
  const { ledger, mock } = repository(), original = event({ repairOrderId: 'RO-A' }), repeated = event({ transactionId: 'operation-other', repairOrderId: 'RO-B' });
  original.timestamp = '2026-09-03T10:00:00.000Z';
  repeated.timestamp = '2026-09-03T11:00:00.000Z';
  await ledger.record(original);
  const duplicate = await ledger.record(repeated);
  assert.equal(duplicate.repairOrderId, 'RO-A');
  assert.equal((await ledger.events()).length, 1);
  assert.equal([...mock.scores.values()][0], Date.parse(original.timestamp));
});

test('unique provider retries remain separate calls grouped under one logical operation', async () => {
  const { ledger } = repository();
  await ledger.record(event({ providerRequestId: 'resp_retry_1', callIndex: 0, status: 'FAILED' }));
  await ledger.record(event({ providerRequestId: 'resp_retry_2', callIndex: 1, status: 'SUCCEEDED' }));
  const report = await ledger.report();
  assert.equal(report.current.all.requests, 1);
  assert.equal(report.current.all.providerRequests, 2);
  assert.deepEqual(new Set(report.recent.map(item => item.providerRequestId)), new Set(['resp_retry_1', 'resp_retry_2']));
  assert.deepEqual(new Set(report.recent.map(item => item.providerCallStatus)), new Set(['FAILED', 'SUCCEEDED']));
});

test('internal operation-and-call-index fallback deduplicates only the same provider call', async () => {
  const { ledger } = repository();
  await ledger.record(event({ providerRequestId: null, callIndex: 0 }));
  await ledger.record(event({ providerRequestId: null, callIndex: 0 }));
  await ledger.record(event({ providerRequestId: null, callIndex: 1 }));
  const events = await ledger.events();
  assert.equal(events.length, 2);
  assert.deepEqual(new Set(events.map(item => item.upstreamCallIndex)), new Set([0, 1]));
});

test('RO, case, and vehicle attribution is immutable after switching from RO A to RO B', async () => {
  const { ledger } = repository();
  await ledger.record(event({ transactionId: 'operation-a', providerRequestId: 'resp_a', repairOrderId: 'RO-A', caseId: 'case-a' }));
  await ledger.record(event({ transactionId: 'operation-b', providerRequestId: 'resp_b', repairOrderId: 'RO-B', caseId: 'case-b' }));
  const reportA = await ledger.report({ repairOrderId: 'RO-A' }), reportB = await ledger.report({ repairOrderId: 'RO-B' });
  assert.equal(reportA.recent[0].caseId, 'case-a');
  assert.equal(reportA.recent[0].vehicleId, 'vehicle-RO-A');
  assert.equal(reportB.recent[0].caseId, 'case-b');
  assert.equal(reportB.recent[0].vehicleId, 'vehicle-RO-B');
});

test('unknown, actual, and estimated costs remain three distinct accounting states', async () => {
  const { ledger } = repository();
  await ledger.record(event({ transactionId: 'unknown', providerRequestId: 'resp_unknown', model: 'unknown-model' }));
  await ledger.record(event({ transactionId: 'actual', providerRequestId: 'resp_actual', actualProviderCostUsd: 0.0123 }));
  await ledger.record(event({ transactionId: 'estimated', providerRequestId: 'resp_estimated' }));
  const report = await ledger.report(), types = Object.fromEntries(report.recent.map(item => [item.logicalOperationId, item.costType]));
  assert.equal(types.unknown, 'UNAVAILABLE');
  assert.equal(types.actual, 'ACTUAL_PROVIDER_COST');
  assert.equal(types.estimated, 'ESTIMATED_CALCULATED_COST');
  assert.equal(report.current.all.unavailableCostCount, 1);
  assert.equal(report.current.all.actualCostCount, 1);
  assert.equal(report.current.all.estimatedCostCount, 1);
  assert.equal(report.budget.used, null);
});

test('browser request fields cannot declare authoritative provider usage or cost', () => {
  const built = buildUsageEvent({
    body: { transactionId: 'browser-authority-test', providerRequestId: 'forged-response', inputTokens: 999999, actualProviderCostUsd: 999, estimatedCostUsd: 999 },
    result: { usageTelemetry: { model: 'unknown-model', tokens: {} } }
  });
  assert.equal(built.providerRequestId, null);
  assert.equal(built.inputTokens, null);
  assert.equal(built.actualProviderCostUsd, null);
  assert.equal(built.estimatedCostUsd, null);
  assert.equal(built.costType, 'UNAVAILABLE');
});

test('missing and invalid Redis configuration are reported without contacting a datastore', async () => {
  for (const ledger of [
    new RedisUsageLedgerRepository({ url: '', token: '', fetchImpl: async () => assert.fail('fetch must not run') }),
    new RedisUsageLedgerRepository({ url: 'not-a-valid-url', token: 'token', fetchImpl: async () => assert.fail('fetch must not run') }),
    new RedisUsageLedgerRepository({ url: 'http://insecure.example.test', token: 'token', fetchImpl: async () => assert.fail('fetch must not run') }),
    new RedisUsageLedgerRepository({ url: 'https://user:password@redis.example.test', token: 'token', fetchImpl: async () => assert.fail('fetch must not run') })
  ]) {
    assert.equal(ledger.configured, false);
    assert.equal((await ledger.checkHealth()).storageStatus, 'NOT_CONFIGURED');
    await assert.rejects(ledger.events(), error => error.code === 'LEDGER_STORAGE_UNCONFIGURED');
  }
});

test('network failure and malformed datastore responses become safe degraded failures', async () => {
  const networkLedger = new RedisUsageLedgerRepository({ url: 'https://redis.example.test', token: 'token', fetchImpl: async () => { throw new Error('socket details'); } });
  assert.equal((await networkLedger.checkHealth()).storageStatus, 'DEGRADED');
  await assert.rejects(networkLedger.events(), error => error.code === 'LEDGER_STORAGE_FAILED' && !error.message.includes('socket details'));
  const malformedLedger = new RedisUsageLedgerRepository({ url: 'https://redis.example.test', token: 'token', fetchImpl: async () => ({ ok: true, json: async () => ({ unexpected: true }) }) });
  await assert.rejects(malformedLedger.events(), error => error.code === 'LEDGER_STORAGE_FAILED');
});

test('successful production persistence records each provider call with its response ID', async () => {
  const { ledger } = repository(), body = { transactionId: 'logical-77', vehicleContext: { repairOrderId: 'RO-77', activeCaseId: 'case-77' } };
  const result = { usageTelemetry: { providerUsage: [
    { providerRequestId: 'resp_77a', model: 'gpt-5.6-sol', status: 'FAILED', inputTokens: null, outputTokens: null, totalTokens: null, providerUsage: null },
    { providerRequestId: 'resp_77b', model: 'gpt-5.6-sol', status: 'SUCCEEDED', inputTokens: 30, cachedInputTokens: 5, outputTokens: 8, totalTokens: 38, providerUsage: { input_tokens: 30 } }
  ] } };
  assert.equal(await persistProviderUsage({ ledger, body, result }), 2);
  const report = await ledger.report();
  assert.equal(report.current.all.requests, 1);
  assert.equal(report.current.all.providerRequests, 2);
  assert.deepEqual(new Set(report.recent.map(item => item.providerRequestId)), new Set(['resp_77a', 'resp_77b']));
});

test('ledger-write failure is surfaced separately and does not destroy a diagnostic result', async () => {
  const diagnostic = { success: true }, result = { semanticResult: { primaryFinding: 'preserved' }, usageTelemetry: { providerUsage: [{}] } }, logged = [];
  const ledger = { configured: true, async record() { throw Object.assign(new Error('redis failed'), { code: 'LEDGER_STORAGE_FAILED' }); } };
  const status = await persistProviderUsageSafely({ ledger, body: { transactionId: 'operation-safe' }, result, diagnostic, logger: { error: (...args) => logged.push(args) } });
  assert.equal(status, 'FAILED');
  assert.equal(diagnostic.usageLedgerWriteError, 'LEDGER_STORAGE_FAILED');
  assert.equal(result.semanticResult.primaryFinding, 'preserved');
  assert.equal(logged.length, 1);
  assert.doesNotMatch(JSON.stringify(logged), /redis failed/);
});

test('API credentials and secret-like fields are neither persisted nor returned', async () => {
  const { ledger, mock } = repository();
  const recognizableKey = ['sk', 'proj', 'forbiddencredential123456'].join('-');
  const unsafe = { ...event(), apiKey: 'forbidden-api-value', authorization: 'forbidden-auth-value', providerUsage: { input_tokens: 20, accessToken: 'forbidden-token-value', nested: { clientSecret: 'forbidden-secret-value', generic: recognizableKey } } };
  await ledger.record(unsafe);
  const persisted = JSON.stringify([...mock.values.values()]), returned = JSON.stringify(await ledger.report());
  for (const secret of ['forbidden-api-value', 'forbidden-auth-value', 'forbidden-token-value', 'forbidden-secret-value', recognizableKey]) {
    assert.doesNotMatch(persisted, new RegExp(secret));
    assert.doesNotMatch(returned, new RegExp(secret));
  }
  assert.match(returned, /input_tokens/);
});

test('protected admin API rejects unauthorized access and returns safe durable data when authorized', async () => {
  let reportCalls = 0;
  const ledger = { configured: true, async checkHealth() { return { storageMode: 'production-durable-redis', storageStatus: 'CONFIGURED' }; }, async report(filters) { reportCalls++; return { filters, recent: [{ apiToken: 'must-not-return', requestId: 'safe-id' }] }; }, async updateSettings() {} };
  const handler = createAdminUsageHandler({ ledger, adminToken: 'admin-test-token' });
  const unauthorized = responseCapture();
  await handler({ method: 'GET', headers: { authorization: 'Bearer wrong' }, query: {} }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(reportCalls, 0);
  const authorized = responseCapture();
  await handler({ method: 'GET', headers: { authorization: 'Bearer admin-test-token' }, query: { repairOrderId: 'RO-7', ignored: 'no' } }, authorized);
  assert.equal(authorized.statusCode, 200);
  assert.equal(authorized.body.storageStatus, 'CONFIGURED');
  assert.deepEqual(authorized.body.filters, { repairOrderId: 'RO-7' });
  assert.doesNotMatch(JSON.stringify(authorized.body), /must-not-return/);
});

test('admin API exposes NOT_CONFIGURED and DEGRADED states without sensitive configuration', async () => {
  const missingHandler = createAdminUsageHandler({ ledger: { configured: false }, adminToken: 'admin' }), missing = responseCapture();
  await missingHandler({ method: 'GET', headers: { authorization: 'Bearer admin' } }, missing);
  assert.equal(missing.statusCode, 503);
  assert.equal(missing.body.storageStatus, 'NOT_CONFIGURED');
  const degradedHandler = createAdminUsageHandler({ ledger: { configured: true, async checkHealth() { return { storageMode: 'production-durable-redis', storageStatus: 'DEGRADED' }; } }, adminToken: 'admin' }), degraded = responseCapture();
  await degradedHandler({ method: 'GET', headers: { authorization: 'Bearer admin' } }, degraded);
  assert.equal(degraded.statusCode, 503);
  assert.equal(degraded.body.storageStatus, 'DEGRADED');
  assert.deepEqual(Object.keys(degraded.body).sort(), ['code', 'error', 'storageMode', 'storageStatus']);
});

test('production dashboard routes only to the protected API and hides totals when durable storage is unavailable', async () => {
  const dashboard = await readFile(new URL('../ai-usage-dashboard.html', import.meta.url), 'utf8');
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.match(dashboard, /fetch\('\/api\/admin\/ai-usage'/);
  assert.match(dashboard, /DURABLE STORAGE: CONFIGURED/);
  assert.match(dashboard, /DURABLE STORAGE: NOT CONFIGURED/);
  assert.match(dashboard, /DURABLE STORAGE: DEGRADED/);
  assert.match(dashboard, /DURABLE AI USAGE STORAGE NOT CONFIGURED/);
  assert.match(dashboard, /\$\('content'\)\.hidden=true/);
  assert.equal(vercel.rewrites.find(item => item.source === '/admin/ai-usage')?.destination, '/ai-usage-dashboard.html');
  assert.doesNotMatch(dashboard, /localStorage|sessionStorage|AI_USAGE_REDIS_REST_TOKEN|OPENAI_API_KEY/);
});
