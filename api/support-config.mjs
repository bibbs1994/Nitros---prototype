const HOST=/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;
const PROJECT=/^https:\/\/[a-z0-9-]+\.supabase\.co$/i;

export default function handler(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const host=String(process.env.NITROS_STAGING_HOST||'').trim().toLowerCase();
  if(process.env.NITROS_STAGING_DEPLOYMENT!=='true'||!HOST.test(host)||String(req.headers?.host||'').trim().toLowerCase()!==host)return res.status(404).json({error:'Support Center is unavailable on this host.'});
  const origin=`https://${host}`,requestOrigin=req.headers?.origin;
  if(requestOrigin&&requestOrigin!==origin)return res.status(403).json({error:'Request origin is not approved.'});
  const projectUrl=String(process.env.SUPABASE_URL||'').replace(/\/+$/,''),projectRef=String(process.env.NITROS_STAGING_SUPABASE_REF||'').trim().toLowerCase();
  const anonKey=process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY;
  let actualRef='';try{actualRef=new URL(projectUrl).hostname.replace(/\.supabase\.co$/i,'').toLowerCase()}catch{}
  if(!PROJECT.test(projectUrl)||!projectRef||actualRef!==projectRef||typeof anonKey!=='string'||!anonKey.trim())return res.status(503).json({error:'Isolated Support Center authentication is not configured.'});
  const vapidPublicKey=String(process.env.SUPPORT_VAPID_PUBLIC_KEY||'');
  const pushConfigured=Boolean(vapidPublicKey&&process.env.SUPPORT_VAPID_PRIVATE_KEY&&process.env.SUPPORT_VAPID_SUBJECT&&process.env.SUPABASE_SERVICE_ROLE_KEY&&process.env.SUPPORT_PUSH_CRON_SECRET);
  return res.status(200).json({projectUrl,anonKey,origin,vapidPublicKey,pushConfigured});
}
