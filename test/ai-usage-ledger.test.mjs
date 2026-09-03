import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageLedgerRepository, buildUsageEvent } from '../ai-usage-ledger.mjs';

test('usage ledger records one idempotent photo operation with provider usage when available', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'nitros-usage-')), 'ledger.json'), repo = new UsageLedgerRepository(file);
  const body = { transactionId: 'analysis-1', vehicleContext: { activeCaseId: 'case-1', repairOrderId: 'RO-7', vin: '1HGCM82633A004352' } };
  const event = buildUsageEvent({ body, result: { usageTelemetry: { model: 'gpt-5.6-sol', reasoningEffort: 'max', imageCount: 1, requestCount: 3, durationMs: 800, tokens: { inputTokens: 20, cachedInputTokens: 4, outputTokens: 5, totalTokens: 25 }, providerUsage: [{ inputTokens: 20 }] } } });
  assert.equal(event.estimatedCostUsd, 0.0001656);
  await repo.record(event); await repo.record(event);
  const report = await repo.report();
  assert.equal(report.current.all.requests, 1); assert.equal(report.byCase[0].name, 'RO-7'); assert.equal(report.recent[0].totalTokens, 25);
});

test('unknown pricing remains unavailable and does not become a zero budget spend', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'nitros-usage-')), 'ledger.json'), repo = new UsageLedgerRepository(file);
  await repo.record(buildUsageEvent({ body: { transactionId: 'unknown-price' }, result: { usageTelemetry: { model: 'unknown-model', models: ['unknown-model'], tokens: { inputTokens: 10, outputTokens: 2 }, requestCount: 1, imageCount: 1 } } }));
  const report = await repo.report();
  assert.equal(report.current.thisMonth.estimatedCostUnavailableCount, 1); assert.equal(report.budget.used, null); assert.equal(report.budget.projected, null);
});

test('returned provider model wins over the configured request model and reasoning usage is retained', () => {
  const event = buildUsageEvent({ body: { transactionId: 'actual-model' }, result: { usageTelemetry: { model: 'gpt-5.6-sol', models: ['gpt-5.6-sol'], tokens: { inputTokens: 10, outputTokens: 3, reasoningTokens: 2 }, requestCount: 1, imageCount: 1 } } });
  assert.equal(event.model, 'gpt-5.6-sol'); assert.deepEqual(event.models, ['gpt-5.6-sol']);
});

test('failed usage has no invented cost or token totals', () => {
  const event = buildUsageEvent({ body: { transactionId: 'failed-1' }, error: Object.assign(new Error('timeout'), { code: 'OPENAI_TIMEOUT' }) });
  assert.equal(event.status, 'FAILED'); assert.equal(event.estimatedCostUsd, null); assert.equal(event.totalTokens, null); assert.equal(event.errorClassification, 'OPENAI_TIMEOUT');
});

test('a successful retry replaces its failed idempotency placeholder rather than adding a second event', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'nitros-usage-')), 'ledger.json'), repo = new UsageLedgerRepository(file);
  await repo.record(buildUsageEvent({ body: { transactionId: 'retry-1' }, error: Object.assign(new Error('timeout'), { code: 'OPENAI_TIMEOUT' }) }));
  await repo.record(buildUsageEvent({ body: { transactionId: 'retry-1' }, result: { usageTelemetry: { model: 'gpt-5.6-sol', tokens: {}, requestCount: 1, imageCount: 1, durationMs: 12 } } }));
  const report = await repo.report(); assert.equal(report.current.all.requests, 1); assert.equal(report.recent[0].status, 'SUCCEEDED');
});
