const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const verifiedContexts = new WeakSet();

export class AuthorizationError extends Error {
  constructor(status, code) {
    super(code);
    this.name = 'AuthorizationError';
    this.status = status;
    this.code = code;
  }
}

export function isVerifiedTenantContext(value) { return Boolean(value && verifiedContexts.has(value)); }

const reject = (status, code) => { throw new AuthorizationError(status, code); };

function config(env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || typeof key !== 'string' || !key.trim()) {
    reject(503, 'identity_not_configured');
  }
  return { url, key };
}

async function requestJson(fetcher, url, options) {
  try {
    const response = await fetcher(url, options);
    let json = null;
    try { json = await response.json(); } catch { /* malformed provider responses fail closed */ }
    return { response, json };
  } catch {
    reject(503, 'identity_provider_unavailable');
  }
}

/** Verifies the bearer with Supabase Auth, then resolves current membership under the user's RLS JWT. */
export async function requireTenantAccess(req, {
  env = process.env,
  fetcher = globalThis.fetch,
  tenantId = req?.headers?.['x-nitros-tenant-id'],
  permission,
  device
} = {}) {
  if (typeof fetcher !== 'function') reject(503, 'identity_provider_unavailable');
  const { url, key } = config(env);
  const match = /^Bearer\s+([^\s]+)$/i.exec(String(req?.headers?.authorization || ''));
  if (!match) reject(401, 'authentication_required');
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) reject(400, 'invalid_tenant_id');
  const bearer = match[1];
  const headers = { apikey: key, Authorization: `Bearer ${bearer}`, Accept: 'application/json' };

  const auth = await requestJson(fetcher, `${url}/auth/v1/user`, { method: 'GET', headers });
  if (auth.response.status === 401 || auth.response.status === 403) reject(401, 'authentication_invalid_or_expired');
  if (!auth.response.ok || typeof auth.json?.id !== 'string' || !UUID.test(auth.json.id)) reject(503, 'identity_provider_unavailable');
  const userId = auth.json.id;

  const membershipUrl = new URL(`${url}/rest/v1/tenant_memberships`);
  membershipUrl.search = new URLSearchParams({
    select: 'id,tenant_id,user_id,role,status', tenant_id: `eq.${tenantId}`,
    user_id: `eq.${userId}`, status: 'eq.active', limit: '1'
  }).toString();
  const result = await requestJson(fetcher, membershipUrl, { method: 'GET', headers });
  if (result.response.status === 401 || result.response.status === 403) reject(403, 'tenant_membership_denied');
  if (!result.response.ok || !Array.isArray(result.json)) reject(503, 'membership_lookup_unavailable');
  const membership = result.json.find(row => row?.tenant_id === tenantId && row?.user_id === userId && row?.status === 'active');
  if (!membership) reject(403, 'tenant_membership_denied');

  let permissions = [];
  if (membership.role === 'owner') {
    permissions = ['records.read','records.write','records.delete','membership.read','membership.manage','backup.read','backup.manage','billing.read','audit.read'];
  } else if (permission || device) {
    const permissionUrl = new URL(`${url}/rest/v1/tenant_permissions`);
    permissionUrl.search = new URLSearchParams({ select:'permission_code',tenant_id:`eq.${tenantId}`,membership_id:`eq.${membership.id}` }).toString();
    const checked = await requestJson(fetcher, permissionUrl, { method:'GET', headers });
    if (!checked.response.ok || !Array.isArray(checked.json)) reject(503,'permission_lookup_unavailable');
    permissions = checked.json.map(row => row?.permission_code).filter(code => ['records.read','records.write','records.delete','membership.read','membership.manage','backup.read','backup.manage','billing.read','audit.read'].includes(code));
  }
  if (permission) {
    if (typeof permission !== 'string' || !/^[a-z]+\.[a-z]+$/.test(permission)) reject(400, 'invalid_permission');
    if (!permissions.includes(permission)) reject(403, 'tenant_permission_denied');
  }

  let deviceContext = {};
  if (device !== undefined) {
    if (!UUID.test(device?.id || '') || !/^[a-f0-9]{64}$/.test(device?.publicKeySha256 || '')) reject(400,'invalid_device_binding');
    const deviceUrl = new URL(`${url}/rest/v1/tenant_devices`);
    deviceUrl.search = new URLSearchParams({
      select:'id,tenant_id,membership_id,public_key_sha256,status', id:`eq.${device.id}`,
      tenant_id:`eq.${tenantId}`, membership_id:`eq.${membership.id}`,
      public_key_sha256:`eq.${device.publicKeySha256}`, status:'eq.active', limit:'1'
    }).toString();
    const checked = await requestJson(fetcher,deviceUrl,{method:'GET',headers});
    if (!checked.response.ok || !Array.isArray(checked.json)) reject(503,'device_lookup_unavailable');
    const authorizedDevice=checked.json.find(row=>row?.id===device.id&&row?.tenant_id===tenantId&&row?.membership_id===membership.id&&row?.public_key_sha256===device.publicKeySha256&&row?.status==='active');
    if (!authorizedDevice) reject(403,'device_not_authorized');
    deviceContext={deviceId:authorizedDevice.id,deviceKeySha256:authorizedDevice.public_key_sha256};
  }
  const context=Object.freeze({userId,tenantId,membershipId:membership.id,role:membership.role,permissions:Object.freeze(permissions),...deviceContext});
  verifiedContexts.add(context);
  return context;
}
