import { timingSafeEqual } from 'node:crypto';
import { sendWebPush } from '../support-web-push.mjs';
import { sendJson } from './_lib/support-center.mjs';

const HOST=/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i,PROJECT=/^https:\/\/[a-z0-9-]+\.supabase\.co$/i;
const equal=(left,right)=>{const a=Buffer.from(String(left||'')),b=Buffer.from(String(right||''));return a.length===b.length&&timingSafeEqual(a,b)};

function serverConfig(env=process.env,requestHost){
  const host=String(env.NITROS_STAGING_HOST||'').trim().toLowerCase(),projectUrl=String(env.SUPABASE_URL||'').replace(/\/+$/,''),ref=String(env.NITROS_STAGING_SUPABASE_REF||'').trim().toLowerCase(),serviceKey=env.SUPABASE_SERVICE_ROLE_KEY;
  let actual='';try{actual=new URL(projectUrl).hostname.replace(/\.supabase\.co$/i,'').toLowerCase()}catch{}
  if(env.NITROS_STAGING_DEPLOYMENT!=='true'||!HOST.test(host)||(requestHost&&requestHost.toLowerCase()!==host)||!PROJECT.test(projectUrl)||!ref||actual!==ref||typeof serviceKey!=='string'||!serviceKey.trim())return null;
  const vapid={publicKey:env.SUPPORT_VAPID_PUBLIC_KEY,privateKey:env.SUPPORT_VAPID_PRIVATE_KEY,subject:env.SUPPORT_VAPID_SUBJECT};
  if(!vapid.publicKey||!vapid.privateKey||!vapid.subject)return null;
  return {projectUrl,serviceKey,cronSecret:env.SUPPORT_PUSH_CRON_SECRET,vapid};
}

async function database(ctx,path,{method='GET',body,fetcher=fetch}={}){
  let response;try{response=await fetcher(`${ctx.projectUrl}/rest/v1/${path}`,{method,headers:{apikey:ctx.serviceKey,Authorization:`Bearer ${ctx.serviceKey}`,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json',Prefer:'return=minimal'})},body:body===undefined?undefined:JSON.stringify(body)})}catch{throw new Error('database_unavailable')}
  if(!response.ok)throw new Error('database_operation_failed');return response.status===204?null:response.json().catch(()=>null);
}

export async function dispatchSupportPush({env=process.env,fetcher=fetch,tenantId,ticketId,maxItems=20}={}){
  const ctx=serverConfig(env);if(!ctx)throw new Error('push_not_configured');
  const filters=tenantId&&ticketId?`&tenant_id=eq.${tenantId}&ticket_id=eq.${ticketId}`:'';
  const due=await database(ctx,`support_push_outbox?select=id,tenant_id,ticket_id,recipient_user_id,attempts&status=eq.pending&next_attempt_at=lte.${encodeURIComponent(new Date().toISOString())}&order=created_at.asc&limit=${Math.max(1,Math.min(50,maxItems))}${filters}`,{fetcher});
  const rows=Array.isArray(due)?due:[];let delivered=0,retried=0,expired=0;
  for(const row of rows){
    const subscriptions=await database(ctx,`support_push_subscriptions?select=id,endpoint,endpoint_sha256,p256dh,auth_key&tenant_id=eq.${row.tenant_id}&user_id=eq.${row.recipient_user_id}&revoked_at=is.null&limit=20`,{fetcher});let sent=false;
    for(const item of Array.isArray(subscriptions)?subscriptions:[]){
      try{
        const response=await sendWebPush({endpoint:item.endpoint,keys:{p256dh:item.p256dh,auth:item.auth_key}},
          {title:'New Nitros support ticket',body:'Open Support Center to review the new ticket.',url:'/support-center.html',ticketId:row.ticket_id},
          {vapid:ctx.vapid,fetcher});
        if(response.status===201||response.status===202){sent=true;continue}
        if(response.status===404||response.status===410){expired++;await database(ctx,`support_push_subscriptions?id=eq.${item.id}`,{method:'PATCH',body:{revoked_at:new Date().toISOString()},fetcher})}
      }catch{}
    }
    if(sent){await database(ctx,`support_push_outbox?id=eq.${row.id}`,{method:'PATCH',body:{status:'delivered',delivered_at:new Date().toISOString(),last_error_class:null},fetcher});delivered++}
    else{
      const attempts=Number(row.attempts||0)+1,failed=attempts>=8,nextAttempt=new Date(Date.now()+Math.min(60*60*1000,15_000*(2**Math.min(attempts,7)))).toISOString();
      await database(ctx,`support_push_outbox?id=eq.${row.id}`,{method:'PATCH',body:{status:failed?'failed':'pending',attempts,next_attempt_at:nextAttempt,last_error_class:Array.isArray(subscriptions)&&subscriptions.length?'PUSH_PROVIDER_UNAVAILABLE':'NO_ACTIVE_SUBSCRIPTION'},fetcher});
      if(!failed)retried++;
    }
  }
  return {processed:rows.length,delivered,retried,expiredSubscriptions:expired};
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','POST'].includes(req.method))return sendJson(res,405,{error:'Method not allowed',code:'METHOD_NOT_ALLOWED'});
  const ctx=serverConfig(process.env,String(req.headers?.host||'').toLowerCase());
  if(!ctx||typeof ctx.cronSecret!=='string'||ctx.cronSecret.length<32)return sendJson(res,503,{error:'Staging push delivery is not configured.',code:'PUSH_NOT_CONFIGURED'});
  const authorization=String(req.headers?.authorization||'').replace(/^Bearer\s+/i,'');if(!equal(authorization,ctx.cronSecret))return sendJson(res,401,{error:'Push dispatch is not authorized.',code:'PUSH_DISPATCH_UNAUTHORIZED'});
  try{return sendJson(res,200,await dispatchSupportPush({env:process.env}))}catch{return sendJson(res,503,{error:'Push dispatch could not be completed. Pending notifications remain recorded.',code:'PUSH_DISPATCH_FAILED'})}
}
