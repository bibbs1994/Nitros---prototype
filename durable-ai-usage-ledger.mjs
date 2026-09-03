import { UsageLedgerRepository, sanitizeUsageValue } from './ai-usage-ledger.mjs';

const key = suffix => `nitros:ai-usage:${suffix}`;
const cleanEnvironmentValue = value => typeof value === 'string' ? value.trim() : '';

export function resolveRedisConfiguration(environment = process.env) {
  const overrideUrl = cleanEnvironmentValue(environment.AI_USAGE_REDIS_REST_URL);
  const overrideToken = cleanEnvironmentValue(environment.AI_USAGE_REDIS_REST_TOKEN);
  if (overrideUrl || overrideToken) {
    return overrideUrl && overrideToken
      ? { url: overrideUrl, token: overrideToken, configurationSource: 'AI_USAGE_OVERRIDE' }
      : { url: '', token: '', configurationSource: 'NOT_CONFIGURED' };
  }
  const vercelUrl = cleanEnvironmentValue(environment.KV_REST_API_URL);
  const vercelToken = cleanEnvironmentValue(environment.KV_REST_API_TOKEN);
  return vercelUrl && vercelToken
    ? { url: vercelUrl, token: vercelToken, configurationSource: 'VERCEL_UPSTASH' }
    : { url: '', token: '', configurationSource: 'NOT_CONFIGURED' };
}

export const sanitizeUsageEvent = sanitizeUsageValue;
export class RedisUsageLedgerRepository {
  constructor(options={}) { const direct=Object.hasOwn(options,'url')||Object.hasOwn(options,'token'),resolved=direct?{url:cleanEnvironmentValue(options.url),token:cleanEnvironmentValue(options.token),configurationSource:'AI_USAGE_OVERRIDE'}:resolveRedisConfiguration(options.environment||process.env);this.url=resolved.url.replace(/\/$/,'');this.token=resolved.token;this.fetch=options.fetchImpl||fetch;this.timeoutMs=Number.isFinite(options.timeoutMs)?Math.max(250,Math.min(10000,options.timeoutMs)):2500;try{const parsed=new URL(this.url);this.validUrl=parsed.protocol==='https:'&&Boolean(parsed.hostname)&&!parsed.username&&!parsed.password}catch{this.validUrl=false}this.configurationSource=this.validUrl&&this.token?resolved.configurationSource:'NOT_CONFIGURED' }
  get configured(){return Boolean(this.validUrl&&this.token)}
  health(){return {storageMode:'production-durable-redis',storageStatus:this.configured?'CONFIGURED':'NOT_CONFIGURED',configurationSource:this.configurationSource}}
  async checkHealth(){if(!this.configured)return this.health();try{await this.command('PING');return this.health()}catch{return {storageMode:'production-durable-redis',storageStatus:'DEGRADED',configurationSource:this.configurationSource}}}
  async command(...args){if(!this.configured)throw Object.assign(new Error('Durable AI usage storage is not configured.'),{code:'LEDGER_STORAGE_UNCONFIGURED'});let response;try{response=await this.fetch(this.url,{method:'POST',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify(args),redirect:'error',signal:AbortSignal.timeout(this.timeoutMs)})}catch{throw Object.assign(new Error('Durable AI usage storage is unavailable.'),{code:'LEDGER_STORAGE_FAILED'})}const body=await response.json().catch(()=>null);if(!response.ok||!body||body.error||!Object.hasOwn(body,'result'))throw Object.assign(new Error('Durable AI usage storage returned an invalid response.'),{code:'LEDGER_STORAGE_FAILED'});return body.result}
  async record(rawEvent){const event=sanitizeUsageEvent(rawEvent),id=event.idempotencyKey||event.requestId||event.id;if(!id)throw Object.assign(new Error('Usage event idempotency identity is required.'),{code:'INVALID_USAGE_EVENT'});const eventKey=key(`event:${encodeURIComponent(id)}`),stored=await this.command('SET',eventKey,JSON.stringify(event),'NX');if(stored!==null&&stored!=='OK')throw Object.assign(new Error('Durable AI usage storage rejected the usage event.'),{code:'LEDGER_STORAGE_FAILED'});const persisted=stored===null?await this.command('GET',eventKey):JSON.stringify(event);if(typeof persisted!=='string')throw Object.assign(new Error('Persisted usage event is unavailable.'),{code:'LEDGER_STORAGE_FAILED'});let parsed;try{parsed=sanitizeUsageEvent(JSON.parse(persisted))}catch{throw Object.assign(new Error('Persisted usage event is malformed.'),{code:'LEDGER_STORAGE_FAILED'})}await this.command('ZADD',key('events'),Date.parse(parsed.timestamp)||Date.now(),eventKey);return parsed}
  async events(){const keys=await this.command('ZRANGE',key('events'),0,-1,'REV');if(!Array.isArray(keys))throw Object.assign(new Error('Durable AI usage index is malformed.'),{code:'LEDGER_STORAGE_FAILED'});if(!keys.length)return[];const values=await Promise.all(keys.map(item=>this.command('GET',item)));try{return values.filter(Boolean).map(item=>sanitizeUsageEvent(JSON.parse(item)))}catch{throw Object.assign(new Error('Durable AI usage data is malformed.'),{code:'LEDGER_STORAGE_FAILED'})}}
  async report(filters={}){const temporary=new UsageLedgerRepository('');temporary.data=async()=>({events:await this.events(),settings:this.parseSettings(await this.command('GET',key('settings')))});return temporary.report(filters)}
  parseSettings(value){if(value===null)return{};if(typeof value!=='string')throw Object.assign(new Error('Durable AI usage settings are malformed.'),{code:'LEDGER_STORAGE_FAILED'});try{const parsed=JSON.parse(value);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed}catch{throw Object.assign(new Error('Durable AI usage settings are malformed.'),{code:'LEDGER_STORAGE_FAILED'})}}
  async updateSettings(settings){const current=this.parseSettings(await this.command('GET',key('settings')));await this.command('SET',key('settings'),JSON.stringify({...current,...settings}))}
}
