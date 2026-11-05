import { createHash, randomUUID } from 'node:crypto';
import { isVerifiedTenantContext, requireTenantAccess } from '../../auth/supabase-tenant-auth.mjs';

const HOST=/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;
const PROJECT=/^https:\/\/[a-z0-9-]+\.supabase\.co$/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_JSON=3_000_000;

export class SupportHttpError extends Error {
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}

export function publicError(error){
  if(error instanceof SupportHttpError)return {status:error.status,body:{error:error.message,code:error.code}};
  if(error?.status===401||error?.status===403)return {status:error.status,body:{error:'Your account is not authorized for this shop or ticket.',code:'SUPPORT_ACCESS_DENIED'}};
  return {status:503,body:{error:'Support service is temporarily unavailable. Your ticket data was not confirmed saved.',code:'SUPPORT_SERVICE_UNAVAILABLE'}};
}

export function sendJson(res,status,body){
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  return res.status(status).json(body);
}

function config(env,req){
  const host=String(env.NITROS_STAGING_HOST||'').trim().toLowerCase();
  const requestHost=String(req?.headers?.host||'').trim().toLowerCase();
  const projectUrl=String(env.SUPABASE_URL||'').replace(/\/+$/,'');
  const projectRef=String(env.NITROS_STAGING_SUPABASE_REF||'').trim().toLowerCase();
  const key=env.SUPABASE_ANON_KEY||env.SUPABASE_PUBLISHABLE_KEY;
  let actualRef='';try{actualRef=new URL(projectUrl).hostname.replace(/\.supabase\.co$/i,'').toLowerCase()}catch{}
  if(env.NITROS_STAGING_DEPLOYMENT!=='true'||!HOST.test(host)||requestHost!==host)throw new SupportHttpError(404,'SUPPORT_STAGING_UNAVAILABLE','Support Center is unavailable on this host.');
  if(!PROJECT.test(projectUrl)||!projectRef||actualRef!==projectRef||typeof key!=='string'||!key.trim())
    throw new SupportHttpError(503,'SUPPORT_CONFIGURATION_REQUIRED','Isolated Support Center authentication is not configured.');
  const origin=`https://${host}`;
  if(req?.headers?.origin&&req.headers.origin!==origin)throw new SupportHttpError(403,'SUPPORT_ORIGIN_DENIED','This request origin is not approved.');
  return {host,origin,projectUrl,key};
}

function token(req){const match=/^Bearer\s+([^\s]+)$/i.exec(String(req?.headers?.authorization||''));if(!match)throw new SupportHttpError(401,'AUTHENTICATION_REQUIRED','Sign in to use the Support Center.');return match[1]}

export async function requestIdentity(req,{env=process.env,fetcher=globalThis.fetch}={}){
  const cfg=config(env,req),bearer=token(req);
  let response;try{response=await fetcher(`${cfg.projectUrl}/auth/v1/user`,{headers:{apikey:cfg.key,Authorization:`Bearer ${bearer}`,Accept:'application/json'}})}catch{throw new SupportHttpError(503,'IDENTITY_PROVIDER_UNAVAILABLE','Sign-in could not be verified. Try again when online.')}
  const user=await response.json().catch(()=>null);
  if(response.status===401||response.status===403)throw new SupportHttpError(401,'SESSION_EXPIRED','Your sign-in expired. Sign in again.');
  if(!response.ok||!UUID.test(user?.id||''))throw new SupportHttpError(503,'IDENTITY_PROVIDER_UNAVAILABLE','Sign-in could not be verified. Try again later.');
  return { ...cfg,bearer,userId:user.id,userEmail:typeof user.email==='string'?user.email:'' };
}

export async function requireShop(req,{env=process.env,fetcher=globalThis.fetch,permission}={}){
  const cfg=config(env,req),bearer=token(req);
  let context;try{context=await requireTenantAccess(req,{env,fetcher,permission})}catch(error){throw error}
  if(!isVerifiedTenantContext(context))throw new SupportHttpError(403,'SUPPORT_ACCESS_DENIED','Your account is not authorized for this shop.');
  return {...cfg,bearer,userId:context.userId,tenantId:context.tenantId,membershipId:context.membershipId,role:context.role};
}

export function requestTenantId(req){
  const id=String(req?.headers?.['x-nitros-tenant-id']||'');
  if(!UUID.test(id))throw new SupportHttpError(400,'SHOP_SELECTION_REQUIRED','Select an authorized shop to continue.');
  return id;
}

export async function jsonBody(req){
  let value=req?.body;
  if(typeof value==='string'){if(Buffer.byteLength(value)>MAX_JSON)throw new SupportHttpError(413,'REQUEST_TOO_LARGE','This support request is too large.');try{value=JSON.parse(value)}catch{throw new SupportHttpError(400,'INVALID_JSON','The support request could not be read.') }}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new SupportHttpError(400,'INVALID_JSON','The support request could not be read.');
  if(Buffer.byteLength(JSON.stringify(value))>MAX_JSON)throw new SupportHttpError(413,'REQUEST_TOO_LARGE','This support request is too large.');
  return value;
}

export function supabaseUrl(ctx,path,query={}){
  const url=new URL(`${ctx.projectUrl}${path}`);
  for(const [key,value] of Object.entries(query))if(value!==undefined&&value!==null)url.searchParams.set(key,String(value));
  return url;
}

export async function supabaseRequest(ctx,path,{method='GET',query,body,prefer,fetcher=globalThis.fetch,storage=false}={}){
  const base=storage?`${ctx.projectUrl}/storage/v1${path}`:supabaseUrl(ctx,path,query);
  const headers={apikey:ctx.key,Authorization:`Bearer ${ctx.bearer}`,Accept:'application/json'};
  if(body!==undefined){headers['Content-Type']='application/json'}
  if(prefer)headers.Prefer=prefer;
  let response;try{response=await fetcher(base,{method,headers,body:body===undefined?undefined:JSON.stringify(body)})}catch{throw new SupportHttpError(503,'SUPPORT_STORAGE_UNAVAILABLE','Support storage could not be reached. Try again when online.')}
  const text=await response.text().catch(()=>''),data=text?(()=>{try{return JSON.parse(text)}catch{return null}})():null;
  if(!response.ok){
    if(response.status===401||response.status===403)throw new SupportHttpError(response.status,'SUPPORT_ACCESS_DENIED','Your account is not authorized for this support data.');
    if(response.status===404)throw new SupportHttpError(404,'SUPPORT_RECORD_NOT_FOUND','The support record was not found.');
    throw new SupportHttpError(503,'SUPPORT_STORAGE_UNAVAILABLE','Support storage could not complete the request. No success was confirmed.');
  }
  return {data,response};
}

export function handleFailure(res,error){const safe=publicError(error);return sendJson(res,safe.status,safe.body)}
export function validateUuid(value,code='INVALID_ID'){if(typeof value!=='string'||!UUID.test(value))throw new SupportHttpError(400,code,'A valid support record identifier is required.');return value}
export function sha256(value){return createHash('sha256').update(value).digest('hex')}
export function randomId(){return randomUUID()}
export function text(value,max){if(typeof value!=='string')return '';return value.trim().slice(0,max)}
export function roleIsAdmin(ctx){return ctx.role==='owner'}
