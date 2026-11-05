import { handleFailure, requestTenantId, requireShop, roleIsAdmin, sendJson, sha256, supabaseRequest, validateUuid } from './_lib/support-center.mjs';

const B64URL=/^[A-Za-z0-9_-]{16,256}$/;
function safeEndpoint(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname.length>3&&url.href.length<=2048?url.href:''}catch{return ''}}

export default async function handler(req,res){
  try{
    const tenantId=requestTenantId(req),ctx=await requireShop(req);
    if(ctx.tenantId!==tenantId||!roleIsAdmin(ctx))return sendJson(res,403,{error:'Administrator access is required to manage owner notifications.',code:'ADMIN_ACCESS_REQUIRED'});
    if(req.method==='POST'){
      const body=req.body&&typeof req.body==='object'?req.body:null;
      const endpoint=safeEndpoint(body?.endpoint),p256dh=String(body?.keys?.p256dh||''),authKey=String(body?.keys?.auth||'');
      if(!endpoint||!B64URL.test(p256dh)||!B64URL.test(authKey))return sendJson(res,400,{error:'Push subscription is invalid.',code:'INVALID_PUSH_SUBSCRIPTION'});
      await supabaseRequest(ctx,'/rest/v1/support_push_subscriptions?on_conflict=tenant_id,user_id,endpoint_sha256',{method:'POST',body:{tenant_id:tenantId,user_id:ctx.userId,endpoint,endpoint_sha256:sha256(endpoint),p256dh,auth_key:authKey,user_agent:String(req.headers?.['user-agent']||'').slice(0,300),last_seen_at:new Date().toISOString(),revoked_at:null},prefer:'resolution=merge-duplicates,return=minimal'});
      return sendJson(res,201,{saved:true});
    }
    if(req.method==='DELETE'){
      const endpointHash=String(req.query?.endpointHash||'');if(!/^[a-f0-9]{64}$/.test(endpointHash))return sendJson(res,400,{error:'Subscription identifier is invalid.',code:'INVALID_SUBSCRIPTION_ID'});
      await supabaseRequest(ctx,'/rest/v1/support_push_subscriptions',{method:'PATCH',query:{tenant_id:`eq.${tenantId}`,user_id:`eq.${ctx.userId}`,endpoint_sha256:`eq.${endpointHash}`},body:{revoked_at:new Date().toISOString()}});
      return sendJson(res,200,{revoked:true});
    }
    return sendJson(res,405,{error:'Method not allowed',code:'METHOD_NOT_ALLOWED'});
  }catch(error){return handleFailure(res,error)}
}
