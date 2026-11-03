const HOST_PATTERN=/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;
const SUPABASE_URL_PATTERN=/^https:\/\/[a-z0-9-]+\.supabase\.co$/i;

export default function handler(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Vary','Origin');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});

  const configuredHost=String(process.env.NITROS_STAGING_HOST||'').trim().toLowerCase();
  const requestHost=String(req.headers?.host||'').trim().toLowerCase();
  const origin=req.headers?.origin;
  if(!HOST_PATTERN.test(configuredHost)||requestHost!==configuredHost)return res.status(404).json({error:'Staging authentication is unavailable'});
  const approvedOrigin=`https://${configuredHost}`;
  if(origin&&origin!==approvedOrigin)return res.status(403).json({error:'Origin not approved'});

  const projectUrl=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
  const expectedProjectRef=String(process.env.NITROS_STAGING_SUPABASE_REF||'').trim().toLowerCase();
  const publishableKey=process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY;
  let actualProjectRef='';
  try{actualProjectRef=new URL(projectUrl).hostname.replace(/\.supabase\.co$/i,'').toLowerCase();}catch{}
  if(!SUPABASE_URL_PATTERN.test(projectUrl)||!expectedProjectRef||actualProjectRef!==expectedProjectRef||typeof publishableKey!=='string'||!publishableKey.trim())
    return res.status(503).json({error:'Staging authentication is not configured'});
  res.setHeader('Content-Type','application/json; charset=utf-8');
  return res.status(200).json({projectUrl,publishableKey,approvedOrigin});
}
