import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { estimateCost } from './usage-pricing.mjs';

const numberOrNull = value => Number.isFinite(value) ? value : null;
const text = (value, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) || null : null;
const usage = value => value && typeof value === 'object' ? value : {};
export function buildUsageEvent({ body = {}, result, error, now = new Date() } = {}) {
  const telemetry = result?.usageTelemetry || {};
  const token = usage(telemetry.tokens);
  const model = text(telemetry.model || result?.serverDiagnostic?.openaiModel, 100);
  const inputTokens = numberOrNull(token.inputTokens), cachedInputTokens = numberOrNull(token.cachedInputTokens), outputTokens = numberOrNull(token.outputTokens);
  const totalTokens = numberOrNull(token.totalTokens) ?? ([inputTokens, outputTokens].every(Number.isFinite) ? inputTokens + outputTokens : null);
  const vehicle = body.vehicleContext && typeof body.vehicleContext === 'object' ? body.vehicleContext : {};
  const status = error ? 'FAILED' : 'SUCCEEDED';
  return {
    id: `aiu_${randomUUID()}`, timestamp: now.toISOString(), userAccountId: null,
    caseId: text(vehicle.activeCaseId), repairOrderId: text(vehicle.repairOrderId), vehicleId: text(vehicle.vehicleId), vin: text(vehicle.vin, 17),
    operationCategory: 'photo_inspection', sourceScreen: 'image_analysis', provider: 'openai', model,
    reasoningEffort: text(telemetry.reasoningEffort || result?.serverDiagnostic?.openaiReasoningEffort, 40), imageCount: numberOrNull(telemetry.imageCount) ?? 1, inputType: 'image',
    inputTokens, cachedInputTokens, outputTokens, totalTokens,
    providerUsage: telemetry.providerUsage ?? null,
    estimatedCostUsd: error ? null : estimateCost({ model, inputTokens, cachedInputTokens, outputTokens }), actualProviderCostUsd: null,
    durationMs: numberOrNull(telemetry.durationMs), status, errorClassification: error ? text(error?.serverDiagnostic?.errorCategory || error?.code || 'ANALYSIS_FAILED', 100) : null,
    requestId: text(body.transactionId, 128), upstreamRequestCount: numberOrNull(telemetry.requestCount) ?? 0
  };
}

export class UsageLedgerRepository {
  constructor(file) { this.file = file; this.queue = Promise.resolve(); }
  async data() { try { const parsed = JSON.parse(await readFile(this.file, 'utf8')); return { events: Array.isArray(parsed.events) ? parsed.events : [], settings: parsed.settings || {} }; } catch (e) { if (e.code === 'ENOENT') return { events: [], settings: {} }; throw e; } }
  async persist(data) { await mkdir(dirname(this.file), { recursive: true }); const temporary = `${this.file}.tmp`; await writeFile(temporary, JSON.stringify(data, null, 2)); await rename(temporary, this.file); }
  async record(event) { let value; this.queue = this.queue.then(async () => { const data = await this.data(); const index = data.events.findIndex(item => item.requestId === event.requestId); if (index >= 0) { const prior = data.events[index]; if (prior.status === 'FAILED' && event.status === 'SUCCEEDED') { data.events[index] = { ...event, id: prior.id }; await this.persist(data); value = data.events[index]; } else value = prior; return; } data.events.push(event); await this.persist(data); value = event; }); await this.queue; return value; }
  async report() { const data = await this.data(), events = data.events.slice().sort((a,b) => b.timestamp.localeCompare(a.timestamp)); const now = new Date(), day = now.toISOString().slice(0,10), month = day.slice(0,7), week = new Date(now - 6*864e5).toISOString().slice(0,10); const cost = e => Number.isFinite(e.estimatedCostUsd) ? e.estimatedCostUsd : 0;
    const scope = predicate => events.filter(predicate), summary = list => ({ spend: list.reduce((n,e)=>n+cost(e),0), requests:list.length, photos:list.filter(e=>e.operationCategory==='photo_inspection').length, averageRequest:list.length?list.reduce((n,e)=>n+cost(e),0)/list.length:0 });
    const all=summary(events), today=summary(scope(e=>e.timestamp.slice(0,10)===day)), thisWeek=summary(scope(e=>e.timestamp.slice(0,10)>=week)), thisMonth=summary(scope(e=>e.timestamp.slice(0,7)===month));
    const group = key => Object.entries(events.reduce((map,e)=>{const k=(key === 'day' ? e.timestamp.slice(0,10) : e[key]) || 'Unattributed';(map[k]??=[]).push(e);return map;},{})).map(([name,list])=>({name,...summary(list)})).sort((a,b)=>b.spend-a.spend);
    const settings={ monthlyBudgetUsd: 40, warningPercent: 70, criticalPercent: 90, hardStopEnabled: false, ...data.settings }; const used=thisMonth.spend, remaining=Math.max(0,settings.monthlyBudgetUsd-used), elapsed=Math.max(1,now.getDate()), projected=used/elapsed*new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    return { generatedAt:now.toISOString(), settings, current:{today,thisWeek,thisMonth,all}, budget:{used,remaining,consumedPercent:settings.monthlyBudgetUsd?used/settings.monthlyBudgetUsd*100:0,projected}, byModel:group('model'), byOperation:group('operationCategory'), byCase:group('repairOrderId'), daily:group('day'), recent:events.slice(0,30), highestCost:events.slice().sort((a,b)=>cost(b)-cost(a)).slice(0,10) };
  }
  async updateSettings(settings) { this.queue=this.queue.then(async()=>{const data=await this.data(); data.settings={...data.settings,...settings}; await this.persist(data);}); return this.queue; }
}
