import { timingSafeEqual } from 'node:crypto';
import { RedisUsageLedgerRepository } from '../../durable-ai-usage-ledger.mjs';
import { sanitizeUsageValue } from '../../ai-usage-ledger.mjs';

const FILTERS = ['from', 'to', 'repairOrderId', 'caseId', 'operationCategory', 'model', 'status'];

function authorized(request, adminToken) {
  if (!adminToken || typeof request.headers?.authorization !== 'string') return false;
  const expected = Buffer.from(`Bearer ${adminToken}`);
  const supplied = Buffer.from(request.headers.authorization);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function queryFilters(query = {}) {
  return Object.fromEntries(FILTERS.flatMap(key => {
    const raw = Array.isArray(query[key]) ? query[key][0] : query[key];
    const value = typeof raw === 'string' ? raw.trim().slice(0, 200) : '';
    return value ? [[key, value]] : [];
  }));
}

function cleanSettings(body = {}) {
  const allowed = ['monthlyBudgetUsd', 'warningPercent', 'criticalPercent', 'hardStopEnabled'];
  return Object.fromEntries(allowed.filter(key => Object.hasOwn(body, key)).map(key => [
    key,
    key === 'hardStopEnabled' ? body[key] === true : Number(body[key])
  ]));
}

export function createAdminUsageHandler({ ledger, adminToken = process.env.NITROS_ADMIN_TOKEN } = {}) {
  if (!ledger) throw new TypeError('A usage ledger is required.');
  return async function adminUsageHandler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!authorized(request, adminToken)) return response.status(401).json({ error: 'Admin authorization is required.', code: 'ADMIN_AUTH_REQUIRED' });
    if (!['GET', 'PATCH'].includes(request.method)) {
      response.setHeader('Allow', 'GET, PATCH');
      return response.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
    }
    if (!ledger.configured) return response.status(503).json({ error: 'Durable AI usage ledger is not configured.', code: 'LEDGER_STORAGE_UNCONFIGURED', ...(typeof ledger.health === 'function' ? ledger.health() : { storageMode: 'production-durable-redis', storageStatus: 'NOT_CONFIGURED', configurationSource: 'NOT_CONFIGURED' }) });
    try {
      const health = typeof ledger.checkHealth === 'function' ? await ledger.checkHealth() : ledger.health();
      if (health.storageStatus !== 'CONFIGURED') return response.status(503).json({ error: 'Durable AI usage ledger is unavailable.', code: 'LEDGER_STORAGE_FAILED', ...health });
      if (request.method === 'GET') return response.status(200).json(sanitizeUsageValue({ ...await ledger.report(queryFilters(request.query)), ...health }));
      const settings = cleanSettings(request.body || {});
      if (Object.values(settings).some(value => typeof value === 'number' && (!Number.isFinite(value) || value < 0))) return response.status(400).json({ error: 'Budget settings are invalid.', code: 'INVALID_BUDGET_SETTINGS', ...health });
      await ledger.updateSettings(settings);
      return response.status(200).json(sanitizeUsageValue({ ...await ledger.report(), ...health }));
    } catch {
      const health = typeof ledger.health === 'function' ? ledger.health() : { storageMode: 'production-durable-redis', configurationSource: 'NOT_CONFIGURED' };
      return response.status(503).json({ error: 'Durable AI usage ledger is unavailable.', code: 'LEDGER_STORAGE_FAILED', ...health, storageStatus: 'DEGRADED' });
    }
  };
}

export default createAdminUsageHandler({ ledger: new RedisUsageLedgerRepository() });
