import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { estimateCost } from './usage-pricing.mjs';

const numberOrNull = value => Number.isFinite(value) ? value : null;
const text = (value, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) || null : null;
const usage = value => value && typeof value === 'object' ? value : {};
const forbiddenSensitiveKey = /(?:api[_-]?key|authorization|credential|password|secret|token)$/i;
const recognizableSecretValue = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,})/i;

export function sanitizeUsageValue(value) {
  if (typeof value === 'string' && recognizableSecretValue.test(value)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(sanitizeUsageValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([name]) => !forbiddenSensitiveKey.test(name))
    .map(([name, item]) => [name, sanitizeUsageValue(item)]));
}

export function buildUsageEvent({ body = {}, result, error, now = new Date() } = {}) {
  const telemetry = result?.usageTelemetry || {};
  const token = usage(telemetry.tokens);
  const models = [...new Set((Array.isArray(telemetry.models) ? telemetry.models : [telemetry.model || result?.serverDiagnostic?.openaiModel]).map(value => text(value, 100)).filter(Boolean))];
  const model = models.length === 1 ? models[0] : models.length > 1 ? 'MULTIPLE' : null;
  const inputTokens = numberOrNull(token.inputTokens), cachedInputTokens = numberOrNull(token.cachedInputTokens), outputTokens = numberOrNull(token.outputTokens), reasoningTokens = numberOrNull(token.reasoningTokens);
  const totalTokens = numberOrNull(token.totalTokens) ?? ([inputTokens, outputTokens].every(Number.isFinite) ? inputTokens + outputTokens : null);
  const vehicle = body.vehicleContext && typeof body.vehicleContext === 'object' ? body.vehicleContext : {};
  const status = error ? 'FAILED' : 'SUCCEEDED';
  const providerCallStatus = text(telemetry.status, 20) || status;
  const providerRequestId = text(telemetry.providerRequestId, 160);
  const logicalOperationId = text(body.transactionId, 128);
  const upstreamCallIndex = Number.isInteger(telemetry.upstreamCallIndex) && telemetry.upstreamCallIndex >= 0 ? telemetry.upstreamCallIndex : 0;
  const actualProviderCostUsd = numberOrNull(telemetry.actualProviderCostUsd);
  const estimatedCostUsd = estimateCost({ model, inputTokens, cachedInputTokens, outputTokens, serviceTier: telemetry.serviceTier, longContext: telemetry.longContext });
  const id = `aiu_${randomUUID()}`;
  return sanitizeUsageValue({
    id, timestamp: now.toISOString(), userAccountId: null,
    caseId: text(vehicle.activeCaseId), repairOrderId: text(vehicle.repairOrderId), vehicleId: text(vehicle.vehicleId), vin: text(vehicle.vin, 17),
    operationCategory: 'photo_inspection', sourceScreen: 'image_analysis', provider: 'openai', model, models,
    reasoningEffort: text(telemetry.reasoningEffort || result?.serverDiagnostic?.openaiReasoningEffort, 40), imageCount: numberOrNull(telemetry.imageCount) ?? 1, inputType: 'image',
    inputTokens, cachedInputTokens, outputTokens, reasoningTokens, totalTokens,
    providerUsage: telemetry.providerUsage ?? null,
    estimatedCostUsd, actualProviderCostUsd, costType: actualProviderCostUsd !== null ? 'ACTUAL_PROVIDER_COST' : estimatedCostUsd !== null ? 'ESTIMATED_CALCULATED_COST' : 'UNAVAILABLE',
    durationMs: numberOrNull(telemetry.durationMs), status, providerCallStatus, errorClassification: error ? text(error?.serverDiagnostic?.errorCategory || error?.code || 'ANALYSIS_FAILED', 100) : null,
    requestId: logicalOperationId, logicalOperationId, providerRequestId, upstreamCallIndex,
    idempotencyKey: providerRequestId ? `provider:${providerRequestId}` : logicalOperationId ? `operation:${logicalOperationId}:provider-call:${upstreamCallIndex}` : `event:${id}`,
    upstreamRequestCount: numberOrNull(telemetry.requestCount) ?? 1
  });
}

export class UsageLedgerRepository {
  constructor(file) { this.file = file; this.queue = Promise.resolve(); }
  async data() { try { const parsed = JSON.parse(await readFile(this.file, 'utf8')); return { events: Array.isArray(parsed.events) ? parsed.events.map(sanitizeUsageValue) : [], settings: sanitizeUsageValue(parsed.settings || {}) }; } catch (e) { if (e.code === 'ENOENT') return { events: [], settings: {} }; throw e; } }
  async persist(data) { await mkdir(dirname(this.file), { recursive: true }); const temporary = `${this.file}.tmp`; await writeFile(temporary, JSON.stringify(data, null, 2)); await rename(temporary, this.file); }
  async record(rawEvent) { let value; const event = sanitizeUsageValue(rawEvent); this.queue = this.queue.then(async () => { const data = await this.data(); const index = data.events.findIndex(item => item.idempotencyKey === event.idempotencyKey); if (index >= 0) { value = data.events[index]; return; } data.events.push(event); await this.persist(data); value = event; }); await this.queue; return value; }
  async report({ from, to, repairOrderId, caseId, operationCategory, model, status } = {}) { const data = await this.data(), events = data.events.filter(e=>(!from||e.timestamp>=from)&&(!to||e.timestamp<=to)&&(!repairOrderId||e.repairOrderId===repairOrderId)&&(!caseId||e.caseId===caseId)&&(!operationCategory||e.operationCategory===operationCategory)&&(!model||e.model===model)&&(!status||e.status===status)).sort((a,b) => b.timestamp.localeCompare(a.timestamp)); const now = new Date(), day = now.toISOString().slice(0,10), month = day.slice(0,7), week = new Date(now - 6*864e5).toISOString().slice(0,10); const cost = e => Number.isFinite(e.actualProviderCostUsd) ? e.actualProviderCostUsd : Number.isFinite(e.estimatedCostUsd) ? e.estimatedCostUsd : null;
    const scope = predicate => events.filter(predicate), summary = list => { const operationIds=new Set(list.map(e=>e.logicalOperationId||e.requestId||e.id)),priced=list.filter(e=>cost(e)!==null),operationStatus=new Map();for(const e of list){const id=e.logicalOperationId||e.requestId||e.id;if(!operationStatus.has(id))operationStatus.set(id,e.status)}const successfulRequests=[...operationStatus.values()].filter(value=>value==='SUCCEEDED').length,failedRequests=[...operationStatus.values()].filter(value=>value==='FAILED').length,photoOperations=new Set(list.filter(e=>e.operationCategory==='photo_inspection').map(e=>e.logicalOperationId||e.requestId||e.id)),actualCostCount=list.filter(e=>Number.isFinite(e.actualProviderCostUsd)).length,estimatedCostCount=list.filter(e=>!Number.isFinite(e.actualProviderCostUsd)&&Number.isFinite(e.estimatedCostUsd)).length,actualSpend=list.reduce((n,e)=>n+(Number.isFinite(e.actualProviderCostUsd)?e.actualProviderCostUsd:0),0),estimatedSpend=list.reduce((n,e)=>n+(!Number.isFinite(e.actualProviderCostUsd)&&Number.isFinite(e.estimatedCostUsd)?e.estimatedCostUsd:0),0),accountedSpend=actualSpend+estimatedSpend,unavailableCostCount=list.length-priced.length,completeCost=list.length>0&&unavailableCostCount===0,cases=new Set(list.map(e=>e.repairOrderId||e.caseId).filter(Boolean)); return { accountedSpend, actualSpend, estimatedSpend, actualCostCount, estimatedCostCount, unavailableCostCount, estimatedCostUnavailableCount:unavailableCostCount, requests:operationIds.size, providerRequests:list.length, successfulRequests, failedRequests, photos:photoOperations.size, averageRequest:operationIds.size&&completeCost?accountedSpend/operationIds.size:null, averagePhotoInspection:photoOperations.size&&completeCost?accountedSpend/photoOperations.size:null, averageCase:cases.size&&completeCost?accountedSpend/cases.size:null }; };
    const all=summary(events), today=summary(scope(e=>e.timestamp.slice(0,10)===day)), thisWeek=summary(scope(e=>e.timestamp.slice(0,10)>=week)), thisMonth=summary(scope(e=>e.timestamp.slice(0,7)===month));
    const group = key => Object.entries(events.reduce((map,e)=>{const k=(key === 'day' ? e.timestamp.slice(0,10) : key === 'case' ? e.repairOrderId||e.caseId : e[key]) || 'Unattributed';(map[k]??=[]).push(e);return map;},{})).map(([name,list])=>({name,...summary(list)})).sort((a,b)=>b.accountedSpend-a.accountedSpend);
    const settings={ monthlyBudgetUsd: 40, warningPercent: 70, criticalPercent: 90, hardStopEnabled: false, ...data.settings }; const used=thisMonth.estimatedCostUnavailableCount ? null : thisMonth.accountedSpend, remaining=used===null?null:Math.max(0,settings.monthlyBudgetUsd-used), elapsed=Math.max(1,now.getDate()), projected=used===null||!thisMonth.requests?null:used/elapsed*new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    return { generatedAt:now.toISOString(), settings, current:{today,thisWeek,thisMonth,all}, budget:{used,remaining,consumedPercent:used===null||!settings.monthlyBudgetUsd?null:used/settings.monthlyBudgetUsd*100,projected}, byModel:group('model'), byOperation:group('operationCategory'), byCase:group('case'), byLogicalOperation:group('logicalOperationId'), daily:group('day'), recent:events.slice(0,30), highestCost:events.slice().sort((a,b)=>(cost(b) ?? -1)-(cost(a) ?? -1)).slice(0,10) };
  }
  async updateSettings(settings) { this.queue=this.queue.then(async()=>{const data=await this.data(); data.settings={...data.settings,...settings}; await this.persist(data);}); return this.queue; }
}
