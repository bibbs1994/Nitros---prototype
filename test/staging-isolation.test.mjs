import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import runtimeConfig from '../api/staging-runtime-config.mjs';
import { allowedOrigin } from '../backend-http-security.mjs';

const root=new URL('../',import.meta.url);
const [html,frontend,driveConfig,backupBrowser,authConfig]=await Promise.all([
  readFile(new URL('index.html',root),'utf8'),
  readFile(new URL('image-analysis-ad.js',root),'utf8'),
  readFile(new URL('backup/drive-config.mjs',root),'utf8'),
  readFile(new URL('backup/backup-browser.mjs',root),'utf8'),
  readFile(new URL('api/staging-auth-config.mjs',root),'utf8')
]);

function invoke(handler,{method='GET',host='nitros-stage.example.invalid',origin='https://nitros-stage.example.invalid',env={}}={}){
  const saved={};
  for(const name of ['NITROS_STAGING_HOST','NITROS_STAGING_SEMANTIC_ANALYSIS_ENABLED','OPENAI_API_KEY']){
    saved[name]=process.env[name];
    if(Object.hasOwn(env,name))process.env[name]=env[name];else delete process.env[name];
  }
  const response={headers:{},statusCode:200,body:null,setHeader(name,value){this.headers[name]=value;return this;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
  try{handler({method,headers:{host,origin}},response);return response;}
  finally{for(const [name,value]of Object.entries(saved)){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
}

test('staging semantic runtime config is host-bound, opt-in, and returns only a same-origin route',()=>{
  const enabled={NITROS_STAGING_HOST:'nitros-stage.example.invalid',NITROS_STAGING_SEMANTIC_ANALYSIS_ENABLED:'true',OPENAI_API_KEY:'synthetic-staging-key'};
  assert.equal(invoke(runtimeConfig,{host:'nitros-prototype.vercel.app',origin:'https://nitros-prototype.vercel.app',env:enabled}).statusCode,404);
  assert.equal(invoke(runtimeConfig,{env:{...enabled,NITROS_STAGING_SEMANTIC_ANALYSIS_ENABLED:'false'}}).statusCode,503);
  assert.equal(invoke(runtimeConfig,{env:{...enabled,OPENAI_API_KEY:''}}).statusCode,503);
  assert.equal(invoke(runtimeConfig,{origin:'https://attacker.example',env:enabled}).statusCode,403);
  const ok=invoke(runtimeConfig,{env:enabled});
  assert.equal(ok.statusCode,200);
  assert.deepEqual(ok.body,{semanticEndpoint:'/api/semantic-image-analysis'});
  assert.doesNotMatch(JSON.stringify(ok.body),/synthetic-staging-key/);
});

test('semantic browser config cannot use the production URL from a non-production origin',()=>{
  assert.match(html,/<meta name="nitros-semantic-endpoint" content="https:\/\/nitros-prototype\.vercel\.app\/api\/semantic-image-analysis">/);
  assert.match(frontend,/if\(!PRODUCTION_SEMANTIC_ORIGINS\.has\(location\.origin\)\)return ''/);
  assert.match(frontend,/fetch\(STAGING_SEMANTIC_CONFIG_PATH,\{method:'GET',cache:'no-store',credentials:'same-origin',redirect:'error'\}\)/);
  assert.match(frontend,/config\?\.semanticEndpoint!=='\/api\/semantic-image-analysis'/);
  assert.match(frontend,/endpoint\.origin===location\.origin/);
  assert.match(frontend,/disabled on this staging host until its isolated endpoint is configured/);
});

test('endpoint resolution uses production only on approved production origins and otherwise fails closed',async()=>{
  const start=frontend.indexOf('  const PRODUCTION_SEMANTIC_ORIGINS=');
  const end=frontend.indexOf('  function activeVehicleAnalysisContext()',start);
  assert.ok(start>=0&&end>start,'endpoint resolver source must be extractable');
  async function resolve(origin,{configStatus=200,configBody={semanticEndpoint:'/api/semantic-image-analysis'}}={}){
    const calls=[];
    const context={location:{origin},URL,Set,Promise,fetch:async(url,options)=>{calls.push({url,options});return{ok:configStatus>=200&&configStatus<300,status:configStatus,json:async()=>configBody};},document:{baseURI:origin+'/',querySelector:()=>({content:'https://nitros-prototype.vercel.app/api/semantic-image-analysis'})}};
    vm.createContext(context);
    vm.runInContext(`${frontend.slice(start,end)}\nglobalThis.testResolver={semanticEndpoint,resolveSemanticEndpoint};`,context);
    return{endpoint:await context.testResolver.resolveSemanticEndpoint(),calls};
  }
  const prod=await resolve('https://nitros-prototype.vercel.app');
  assert.equal(prod.endpoint,'https://nitros-prototype.vercel.app/api/semantic-image-analysis');
  assert.equal(prod.calls.length,0);
  const stage=await resolve('https://nitros-stage.example.invalid');
  assert.equal(stage.endpoint,'https://nitros-stage.example.invalid/api/semantic-image-analysis');
  assert.equal(stage.calls.length,1);
  assert.equal(stage.calls[0].url,'/api/staging-runtime-config');
  const disabled=await resolve('https://nitros-stage.example.invalid',{configStatus:503});
  assert.equal(disabled.endpoint,'');
  assert.equal(disabled.calls.length,1);
  const malformed=await resolve('https://nitros-stage.example.invalid',{configBody:{semanticEndpoint:'https://nitros-prototype.vercel.app/api/semantic-image-analysis'}});
  assert.equal(malformed.endpoint,'');
});

test('staging semantic API CORS is allowed only for the configured staging host and explicit feature flag',()=>{
  const names=['NITROS_STAGING_HOST','NITROS_STAGING_SEMANTIC_ANALYSIS_ENABLED'],saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  try{
    process.env.NITROS_STAGING_HOST='nitros-stage.example.invalid';
    process.env.NITROS_STAGING_SEMANTIC_ANALYSIS_ENABLED='true';
    assert.equal(allowedOrigin('https://nitros-stage.example.invalid','nitros-stage.example.invalid'),true);
    assert.equal(allowedOrigin('https://nitros-stage.example.invalid','another.example.invalid'),false);
    assert.equal(allowedOrigin('http://nitros-stage.example.invalid','nitros-stage.example.invalid'),false);
    process.env.NITROS_STAGING_SEMANTIC_ANALYSIS_ENABLED='false';
    assert.equal(allowedOrigin('https://nitros-stage.example.invalid','nitros-stage.example.invalid'),false);
    assert.equal(allowedOrigin('https://bibbs1994.github.io'),true);
  }finally{for(const [name,value]of Object.entries(saved)){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});

test('staging auth and Google Drive remain isolated from production configuration',()=>{
  assert.match(authConfig,/NITROS_STAGING_HOST/);
  assert.match(authConfig,/NITROS_STAGING_SUPABASE_REF/);
  assert.match(driveConfig,/origin === PRODUCTION_ORIGIN/);
  assert.match(driveConfig,/approvedOrigins\[0\] !== origin/);
  assert.match(driveConfig,/backupNamespace: expectedNamespace/);
  assert.match(backupBrowser,/config\.backupNamespace==='staging'/);
  assert.match(backupBrowser,/Configure this exact staging origin before using staging backup or recovery/);
  assert.match(backupBrowser,/staging: driveConfig\.backupNamespace==='staging'/);
});
