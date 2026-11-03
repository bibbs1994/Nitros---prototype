const HOST_PATTERN=/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;

export default function handler(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Vary','Origin');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});

  const configuredHost=String(process.env.NITROS_STAGING_HOST||'').trim().toLowerCase();
  const requestHost=String(req.headers?.host||'').trim().toLowerCase().split(':')[0];
  const origin=req.headers?.origin;
  if(!HOST_PATTERN.test(configuredHost)||requestHost!==configuredHost)return res.status(404).json({error:'Staging semantic analysis is unavailable'});
  if(origin&&origin!==`https://${configuredHost}`)return res.status(403).json({error:'Origin not approved'});
  if(process.env.NITROS_STAGING_SEMANTIC_ANALYSIS_ENABLED!=='true'||typeof process.env.OPENAI_API_KEY!=='string'||!process.env.OPENAI_API_KEY.trim())
    return res.status(503).json({error:'Staging semantic analysis is not configured'});

  res.setHeader('Content-Type','application/json; charset=utf-8');
  return res.status(200).json({semanticEndpoint:'/api/semantic-image-analysis'});
}
