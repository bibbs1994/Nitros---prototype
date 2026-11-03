import { driveConfig } from './drive-config.mjs';
import { DRIVE_SCOPE } from './drive-backup.mjs';
let access='',expires=0;
let ready=null;
let authorizationState='disconnected';
export const accessToken=()=>{if(Date.now()<expires)return access;if(authorizationState==='connected')authorizationState='expired';access='';expires=0;return '';};
export function driveAuthorizationState(){
  if(access&&Date.now()<expires)return 'connected';
  if(authorizationState==='connected'){access='';expires=0;authorizationState='expired';}
  return authorizationState;
}
export function invalidateDriveToken(reason='disconnected'){access='';expires=0;authorizationState=reason==='expired'?'expired':'disconnected';}
export function driveAuthReadiness(){
  if(!driveConfig.clientId)return driveConfig.error||'Google OAuth Client ID is unavailable. Local encrypted backups remain available.';
  if(!driveConfig.backupNamespace)return 'Google Drive backup namespace is unavailable. Local encrypted backups remain available.';
  if(!driveConfig.approvedOrigins.includes(location.origin))return 'This website origin is not approved for Google authorization.';
  if(!globalThis.google?.accounts?.oauth2)return 'Google authorization library is unavailable or still loading. Wait for readiness or check browser blocking.';
  return 'Google authorization ready. Click Connect to grant drive.file access.';
}
export function prepareDriveAuth(){
  if(!driveConfig.clientId||!driveConfig.backupNamespace||!driveConfig.approvedOrigins.includes(location.origin))return Promise.resolve(false);
  if(globalThis.google?.accounts?.oauth2)return Promise.resolve(true);
  if(!ready)ready=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.onload=()=>resolve(true);script.onerror=()=>{ready=null;reject(new Error('Google authorization library unavailable'))};document.head.append(script)});
  return ready;
}
export async function connectDrive(){
  if(!driveConfig.clientId)throw new Error(driveConfig.error||'Google OAuth Client ID is unavailable. No account connected.');
  if(!driveConfig.backupNamespace)throw new Error('Google Drive backup namespace is unavailable. No account connected.');
  if(!driveConfig.approvedOrigins.includes(location.origin))throw new Error('This website origin is not approved for Google authorization. No account connected.');
  if(!globalThis.google?.accounts?.oauth2)throw new Error('Google authorization is still loading. Retry Connect when ready.');
  invalidateDriveToken();
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=message=>{if(done)return;done=true;clearTimeout(timer);if(message){invalidateDriveToken();reject(new Error(message));}else resolve();};
    const timer=setTimeout(()=>finish('Google authorization timed out; click Connect to retry'),120000);
    try{
      const client=google.accounts.oauth2.initTokenClient({client_id:driveConfig.clientId,scope:DRIVE_SCOPE,include_granted_scopes:false,callback:r=>{
        if(done)return;
        try{
          if(!r||r.error||!google.accounts.oauth2.hasGrantedAllScopes(r,DRIVE_SCOPE)){finish('Google authorization was not granted');return;}
          const seconds=Number(r.expires_in),until=Date.now()+(seconds-60)*1000;
          if(typeof r.access_token!=='string'||!r.access_token.trim()||!Number.isFinite(seconds)||seconds<=60||!Number.isFinite(until)){finish('Google authorization returned no usable token or expiry; reconnect');return;}
          access=r.access_token;expires=until;authorizationState='connected';finish();
        }catch{finish('Google authorization could not be validated; reconnect');}
      },error_callback:()=>finish('Google authorization closed or unavailable')});
      client.requestAccessToken({prompt:'consent'});
    }catch{finish('Google authorization could not start; check popup permissions and retry');}
  });
}
export async function disconnectDrive(){const old=access;invalidateDriveToken('disconnected');if(old&&globalThis.google?.accounts?.oauth2)await new Promise((resolve,reject)=>google.accounts.oauth2.revoke(old,r=>r.successful?resolve():reject(new Error('Local token cleared; revoke Google permission in account settings'))));}
