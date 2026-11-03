export const PRODUCTION_ORIGIN = 'https://nitros-prototype.vercel.app';
const PRODUCTION_HOST = 'nitros-prototype.vercel.app';
const CLIENT_ID_PATTERN = /^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i;

function stagingOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
    if (url.origin !== value.trim() || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) return null;
    return url;
  } catch { return null; }
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const requestHost = String(req.headers?.host || '').toLowerCase();
  const host = requestHost.split(':')[0];
  const origin = req.headers?.origin;
  if (host === PRODUCTION_HOST) {
    if (origin && origin !== PRODUCTION_ORIGIN) return res.status(403).json({ error: 'Origin not approved' });
    const clientId = process.env.NITROS_GOOGLE_CLIENT_ID;
    if (typeof clientId !== 'string' || !CLIENT_ID_PATTERN.test(clientId)) return res.status(503).json({ error: 'Backup authorization is not configured' });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({ clientId, approvedOrigins: [PRODUCTION_ORIGIN] });
  }

  // Staging OAuth is opt-in, exact-origin only, and never served by a Vercel
  // Production deployment. Loopback HTTP is allowed for the isolated local server.
  const onVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const gitRef = String(process.env.VERCEL_GIT_COMMIT_REF || '').trim();
  if (onVercel && (process.env.NITROS_STAGING_DEPLOYMENT !== 'true' || (process.env.VERCEL_ENV === 'production' && (!gitRef || gitRef === 'main')))) {
    return res.status(404).json({ error: 'Google Drive backup is not configured for this origin', code: 'STAGING_ORIGIN_NOT_CONFIGURED' });
  }
  const configured = stagingOrigin(process.env.NITROS_STAGING_ORIGIN);
  if (!configured || requestHost !== configured.host.toLowerCase() || (origin && origin !== configured.origin)) {
    return res.status(404).json({ error: 'Google Drive backup is not configured for this origin', code: 'STAGING_ORIGIN_NOT_CONFIGURED' });
  }
  const clientId = process.env.NITROS_STAGING_GOOGLE_CLIENT_ID;
  if (typeof clientId !== 'string' || !CLIENT_ID_PATTERN.test(clientId)) {
    return res.status(503).json({ error: 'Staging Google OAuth Client ID is missing or invalid', code: 'STAGING_OAUTH_CLIENT_ID_UNAVAILABLE', approvedOrigins: [configured.origin], backupNamespace: 'staging' });
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json({ clientId, approvedOrigins: [configured.origin] });
}
