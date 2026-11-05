const SESSION_KEY='nitros_support_auth_v1';
let configPromise;
let refreshPromise=null;
const b64url=value=>btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

export async function getConfig(fetcher=fetch){
  if(!configPromise)configPromise=fetcher('/api/support-config',{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}}).then(async response=>{const data=await response.json().catch(()=>({}));if(!response.ok||!data.projectUrl||!data.anonKey||!data.origin)throw new Error(data.error||'Isolated support authentication is not configured.');if(location.origin!==data.origin)throw new Error('Support authentication origin does not match this page.');return data}).catch(error=>{configPromise=null;throw error});
  return configPromise;
}

function read(){try{const value=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');return value&&typeof value.access_token==='string'&&typeof value.refresh_token==='string'?value:null}catch{return null}}
function write(session){localStorage.setItem(SESSION_KEY,JSON.stringify({access_token:session.access_token,refresh_token:session.refresh_token,expires_at:session.expires_at||Math.floor(Date.now()/1000)+Number(session.expires_in||3600),user:session.user||null}))}
async function authRequest(path,body,fetcher=fetch){const cfg=await getConfig(fetcher);const response=await fetcher(`${cfg.projectUrl}/auth/v1/${path}`,{method:'POST',headers:{apikey:cfg.anonKey,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(response.status===400||response.status===401?'Email or password was not accepted.':'Sign-in service is temporarily unavailable.');return data}

export async function signIn(email,password,{fetcher=fetch}={}){
  if(typeof email!=='string'||!email.includes('@')||typeof password!=='string'||password.length<1)throw new Error('Enter your account email and password.');
  const session=await authRequest('token?grant_type=password',{email:email.trim(),password},fetcher);
  if(typeof session.access_token!=='string'||typeof session.refresh_token!=='string'||!session.user?.id)throw new Error('The sign-in response was incomplete. Try again.');
  write(session);return {user:session.user,expiresAt:session.expires_at};
}

export async function getSession({fetcher=fetch,refreshBeforeSeconds=45}={}){
  const session=read();if(!session)return null;
  if(Number(session.expires_at)>Math.floor(Date.now()/1000)+refreshBeforeSeconds)return session;
  if(refreshPromise)return refreshPromise;
  const refresh=async()=>{const latest=read();if(!latest)return null;if(Number(latest.expires_at)>Math.floor(Date.now()/1000)+refreshBeforeSeconds)return latest;const refreshed=await authRequest('token?grant_type=refresh_token',{refresh_token:latest.refresh_token},fetcher);if(!refreshed.access_token||!refreshed.refresh_token)throw new Error('expired');write(refreshed);return read()};
  refreshPromise=(async()=>{try{return globalThis.navigator?.locks?.request?await globalThis.navigator.locks.request('nitros-support-auth-refresh',refresh):await refresh()}catch{await signOut({fetcher});return null}finally{refreshPromise=null}})();return refreshPromise;
}

export async function signOut({fetcher=fetch}={}){
  const session=read();localStorage.removeItem(SESSION_KEY);if(session?.access_token){try{const cfg=await getConfig(fetcher);await fetcher(`${cfg.projectUrl}/auth/v1/logout`,{method:'POST',headers:{apikey:cfg.anonKey,Authorization:`Bearer ${session.access_token}`}})}catch{}}
}

export function tenantHeaders(tenantId,session){if(!tenantId||!session?.access_token)throw new Error('Select an authorized shop and sign in.');return{Authorization:`Bearer ${session.access_token}`,'X-Nitros-Tenant-Id':tenantId,Accept:'application/json'}}
export function toBase64Url(value){return b64url(value)}
