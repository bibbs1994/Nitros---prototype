export const PRODUCTION_ORIGIN = 'https://nitros-prototype.vercel.app';
const CLIENT_ID_PATTERN = /^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i;

const unavailable = (error, { approvedOrigins = [], backupNamespace = null } = {}) => Object.freeze({ clientId: null, approvedOrigins, backupNamespace, error });

export async function loadPublicConfig({ origin = globalThis.location?.origin, fetcher = globalThis.fetch } = {}) {
  if (typeof origin !== 'string') return unavailable('Google Drive configuration is unavailable in this browser.');
  const production = origin === PRODUCTION_ORIGIN;
  let parsedOrigin;
  try { parsedOrigin = new URL(origin); } catch { return unavailable('This website origin is not configured for Google Drive backup.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsedOrigin.hostname.toLowerCase());
  if (!production && parsedOrigin.protocol !== 'https:' && !(parsedOrigin.protocol === 'http:' && loopback)) {
    return unavailable('Google Drive backup requires the production origin or an explicitly configured HTTPS staging origin.');
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    let response;
    try { response = await fetcher('/api/backup-config', { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal }); }
    finally { clearTimeout(timeout); }
    const value = await response.json().catch(() => null);
    if (!response.ok) {
      const message = value?.code === 'STAGING_OAUTH_CLIENT_ID_UNAVAILABLE'
        ? 'Staging Google OAuth Client ID is missing or invalid; ask the staging owner to configure it.'
        : value?.code === 'STAGING_ORIGIN_NOT_CONFIGURED'
          ? 'This website origin is not explicitly configured for Google Drive backup.'
          : production
            ? 'Production Google Drive OAuth configuration is unavailable.'
            : 'Google Drive staging configuration is unavailable. Check the exact staging origin and server configuration.';
      if (value?.code === 'STAGING_OAUTH_CLIENT_ID_UNAVAILABLE' && value?.backupNamespace === 'staging' && Array.isArray(value?.approvedOrigins) && value.approvedOrigins.length === 1 && value.approvedOrigins[0] === origin) {
        return unavailable(message, { approvedOrigins: [origin], backupNamespace: 'staging' });
      }
      return unavailable(message);
    }
    const expectedNamespace = production ? 'production' : 'staging';
    if (typeof value?.clientId !== 'string' || !CLIENT_ID_PATTERN.test(value.clientId) || !Array.isArray(value.approvedOrigins) || value.approvedOrigins.length !== 1 || value.approvedOrigins[0] !== origin) {
      return unavailable(`${expectedNamespace === 'staging' ? 'Staging' : 'Production'} Google OAuth configuration is invalid for this exact origin.`);
    }
    return Object.freeze({ clientId: value.clientId, approvedOrigins: [origin], backupNamespace: expectedNamespace, error: '' });
  } catch {
    return unavailable('Google Drive configuration could not be loaded. Check the connection and staging server, then reload.');
  }
}

export const driveConfig = await loadPublicConfig();
