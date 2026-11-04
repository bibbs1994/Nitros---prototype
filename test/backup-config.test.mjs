import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import handler from '../api/backup-config.mjs';
import { loadPublicConfig, PRODUCTION_ORIGIN } from '../backup/drive-config.mjs';
import { assertBackupOrigin } from '../backup/backup-browser.mjs';

const publicClientId='123456789012-synthetic-staging.apps.googleusercontent.com';
function invoke({method='GET',host='nitros-stage.example.invalid',origin='https://nitros-stage.example.invalid',env={}}={}){
  const names=['NITROS_GOOGLE_CLIENT_ID','NITROS_STAGING_GOOGLE_CLIENT_ID','NITROS_STAGING_ORIGIN','NITROS_STAGING_DEPLOYMENT','VERCEL','VERCEL_ENV','VERCEL_GIT_COMMIT_REF'];
  const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  for(const name of names){if(Object.hasOwn(env,name))process.env[name]=env[name];else delete process.env[name];}
  const response={headers:{},statusCode:200,body:null,setHeader(name,value){this.headers[name]=value;return this;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
  try{handler({method,headers:{host,origin}},response);return response;}
  finally{for(const [name,value]of Object.entries(saved)){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
}

test('production OAuth endpoint response and origin restriction remain unchanged',()=>{
  const result=invoke({host:'nitros-prototype.vercel.app',origin:PRODUCTION_ORIGIN,env:{NITROS_GOOGLE_CLIENT_ID:publicClientId,VERCEL_ENV:'production',NITROS_STAGING_ORIGIN:'https://nitros-stage.example.invalid',NITROS_STAGING_GOOGLE_CLIENT_ID:'987654321098-other.apps.googleusercontent.com'}});
  assert.equal(result.statusCode,200);
  assert.deepEqual(result.body,{clientId:publicClientId,approvedOrigins:[PRODUCTION_ORIGIN]});
  const denied=invoke({host:'nitros-prototype.vercel.app',origin:'https://attacker.example',env:{NITROS_GOOGLE_CLIENT_ID:publicClientId}});
  assert.equal(denied.statusCode,403);
});

test('explicit staging origin gets only staging OAuth config and reports missing client ID safely',()=>{
  const origin='https://nitros-stage.example.invalid';
  const env={NITROS_STAGING_ORIGIN:origin,NITROS_STAGING_GOOGLE_CLIENT_ID:publicClientId,NITROS_STAGING_DEPLOYMENT:'true',VERCEL:'1',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feature/encrypted-drive-backup',NITROS_GOOGLE_CLIENT_ID:'987654321098-production.apps.googleusercontent.com'};
  const allowed=invoke({host:'nitros-stage.example.invalid',origin,env});
  assert.equal(allowed.statusCode,200);
  assert.deepEqual(allowed.body,{clientId:publicClientId,approvedOrigins:[origin]});
  assert.equal(invoke({host:'other-stage.example.invalid',origin:'https://other-stage.example.invalid',env}).statusCode,404);
  const mismatch=invoke({host:'nitros-stage.example.invalid',origin:'https://attacker.example',env});
  assert.equal(mismatch.statusCode,404);
  const {NITROS_STAGING_DEPLOYMENT,...withoutStagingFlag}=env;
  assert.equal(invoke({host:'nitros-stage.example.invalid',origin,env:withoutStagingFlag}).statusCode,404);
  const missing=invoke({host:'nitros-stage.example.invalid',origin,env:{NITROS_STAGING_ORIGIN:origin}});
  assert.equal(missing.statusCode,503);
  assert.equal(missing.body.code,'STAGING_OAUTH_CLIENT_ID_UNAVAILABLE');
  const productionDeployment=invoke({host:'nitros-stage.example.invalid',origin,env:{...env,VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'main'}});
  assert.equal(productionDeployment.statusCode,404);
});

test('local staging origin requires exact loopback host and port',()=>{
  const origin='http://127.0.0.1:18787',env={NITROS_STAGING_ORIGIN:origin,NITROS_STAGING_GOOGLE_CLIENT_ID:publicClientId};
  assert.equal(invoke({host:'127.0.0.1:18787',origin,env}).statusCode,200);
  assert.equal(invoke({host:'127.0.0.1:18788',origin:'http://127.0.0.1:18788',env}).statusCode,404);
});

test('browser config fails closed by origin and exposes safe configuration diagnostics',async()=>{
  let calls=0;
  const denied=await loadPublicConfig({origin:'https://attacker.example',fetcher:async(_url,options)=>{calls++;assert.equal(options.credentials,'omit');return{ok:false,json:async()=>({code:'STAGING_ORIGIN_NOT_CONFIGURED'})};}});
  assert.equal(denied.clientId,null);
  assert.equal(calls,1);
  assert.match(denied.error,/not explicitly configured/i);
  const stagingOrigin='https://nitros-stage.example.invalid';
  const stage=await loadPublicConfig({origin:stagingOrigin,fetcher:async()=>({ok:true,json:async()=>({clientId:publicClientId,approvedOrigins:[stagingOrigin]})})});
  assert.equal(stage.backupNamespace,'staging');
  assert.deepEqual(stage.approvedOrigins,[stagingOrigin]);
  const invalid=await loadPublicConfig({origin:stagingOrigin,fetcher:async()=>({ok:false,json:async()=>({code:'STAGING_OAUTH_CLIENT_ID_UNAVAILABLE',approvedOrigins:[stagingOrigin],backupNamespace:'staging'})})});
  assert.equal(invalid.clientId,null);
  assert.match(invalid.error,/missing or invalid/i);
  assert.equal(invalid.backupNamespace,'staging');
  assert.equal(assertBackupOrigin(stagingOrigin,invalid),true);
  assert.throws(()=>assertBackupOrigin('https://other-stage.example.invalid',invalid),/Configure this exact staging origin/);
  const prod=await loadPublicConfig({origin:PRODUCTION_ORIGIN,fetcher:async()=>({ok:true,json:async()=>({clientId:publicClientId,approvedOrigins:[PRODUCTION_ORIGIN]})})});
  assert.equal(prod.backupNamespace,'production');
  assert.equal(assertBackupOrigin(PRODUCTION_ORIGIN,prod),true);
  const ui=await readFile(new URL('../backup/secure-ui.mjs',import.meta.url),'utf8');
  const auth=await readFile(new URL('../backup/drive-auth.mjs',import.meta.url),'utf8');
  assert.match(auth,/driveConfig\.error\|\|'Google OAuth Client ID is unavailable/);
  assert.match(ui,/message\?` \$\{message\}`:''/);
});

test('browser config distinguishes redirects, timeouts, and network/CORS failures without echoing error details',async()=>{
  const origin='https://nitros-mobile-staging.vercel.app';
  const redirect=await loadPublicConfig({origin,fetcher:async(_url,options)=>{
    assert.equal(options.redirect,'manual');
    return{type:'opaqueredirect',status:0,json:async()=>{throw new Error('must not parse redirect body')}};
  }});
  assert.match(redirect.error,/endpoint redirected/i);
  assert.equal(redirect.clientId,null);

  const timeout=await loadPublicConfig({origin,fetcher:async()=>{throw Object.assign(new Error('private detail'),{name:'AbortError'});}});
  assert.match(timeout.error,/request timed out/i);
  assert.doesNotMatch(timeout.error,/private detail/i);

  const network=await loadPublicConfig({origin,fetcher:async()=>{throw new TypeError('https://private.example/path?token=synthetic');}});
  assert.match(network.error,/network\/CORS failure/i);
  assert.doesNotMatch(network.error,/private\.example|token=synthetic/i);
});
