import test from 'node:test';
import assert from 'node:assert/strict';
import { requireTenantAccess, AuthorizationError, isVerifiedTenantContext } from '../auth/supabase-tenant-auth.mjs';

const env={SUPABASE_URL:'https://nitros-staging.supabase.co',SUPABASE_ANON_KEY:'synthetic-publishable-key'};
const userId='11111111-1111-4111-8111-111111111111',tenantId='22222222-2222-4222-8222-222222222222';
const req={headers:{authorization:'Bearer synthetic-access-token','x-nitros-tenant-id':tenantId,'x-user-id':'33333333-3333-4333-8333-333333333333'}};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

test('missing configuration and missing bearer fail closed',async()=>{
  await assert.rejects(requireTenantAccess(req,{env:{},fetcher:async()=>json({})}),e=>e.status===503&&e.code==='identity_not_configured');
  await assert.rejects(requireTenantAccess({headers:{}},{env,fetcher:async()=>json({})}),e=>e.status===401&&e.code==='authentication_required');
});

test('Supabase-verified user and current RLS membership define the tenant context',async()=>{
  const calls=[];
  const context=await requireTenantAccess(req,{env,fetcher:async(url,options)=>{
    calls.push({url:String(url),options});
    if(String(url).endsWith('/auth/v1/user'))return json({id:userId});
    return json([{id:'44444444-4444-4444-8444-444444444444',tenant_id:tenantId,user_id:userId,role:'technician',status:'active'}]);
  }});
  assert.deepEqual(context,{userId,tenantId,membershipId:'44444444-4444-4444-8444-444444444444',role:'technician',permissions:[]});
  assert.equal(isVerifiedTenantContext(context),true);
  assert.equal(isVerifiedTenantContext({ ...context }),false);
  assert.equal(new URL(calls[1].url).searchParams.get('user_id'),`eq.${userId}`);
  assert.equal(calls[1].url.includes(req.headers['x-user-id']),false);
  assert.equal(calls[1].options.headers.Authorization,req.headers.authorization);
});

test('wrong or revoked membership and missing permissions are denied',async()=>{
  const fetcher=async url=>String(url).endsWith('/auth/v1/user')?json({id:userId}):json([]);
  await assert.rejects(requireTenantAccess(req,{env,fetcher}),e=>e.status===403&&e.code==='tenant_membership_denied');
  await assert.rejects(requireTenantAccess(req,{env,fetcher:async url=>String(url).endsWith('/auth/v1/user')?json({id:userId}):json([{tenant_id:tenantId,user_id:userId,status:'revoked'}])}),e=>e.status===403);
  let permissionCalled=false;
  await assert.rejects(requireTenantAccess(req,{env,permission:'backup.manage',fetcher:async url=>{
    if(String(url).endsWith('/auth/v1/user'))return json({id:userId});
    if(String(url).includes('/tenant_permissions')){permissionCalled=true;return json([])}
    return json([{id:'44444444-4444-4444-8444-444444444444',tenant_id:tenantId,user_id:userId,role:'technician',status:'active'}]);
  }}),e=>e.status===403&&e.code==='tenant_permission_denied');
  assert.equal(permissionCalled,true);
});

test('mocked Individual A/B and Shop A/B accounts cannot resolve another tenant membership',async()=>{
  const pairs=[
    ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','individual-a'],
    ['33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','individual-b'],
    ['55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666','shop-a'],
    ['77777777-7777-4777-8777-777777777777','88888888-8888-4888-8888-888888888888','shop-b']
  ];
  const fixture=new Map(pairs.map(([user,tenant,role])=>[`${user}:${tenant}`,{id:'99999999-9999-4999-8999-999999999999',tenant_id:tenant,user_id:user,role:'owner',status:'active',label:role}]));
  const fetcher=async(url,options)=>{
    const parsed=new URL(String(url));
    if(parsed.pathname==='/auth/v1/user') {
      const token=String(options.headers.Authorization||'').replace(/^Bearer\s+/i,'');
      return json({id:pairs.some(([user])=>user===token)?token:userId});
    }
    const user=parsed.searchParams.get('user_id')?.slice(3),tenant=parsed.searchParams.get('tenant_id')?.slice(3);
    const membership=fixture.get(`${user}:${tenant}`);
    return json(membership?[membership]:[]);
  };
  for(const [user,tenant] of pairs){
    const response=await requireTenantAccess({headers:{authorization:`Bearer ${user}`, 'x-nitros-tenant-id':tenant}},{env,fetcher});
    assert.equal(response.userId,user); assert.equal(response.tenantId,tenant);
  }
  for(const [user] of pairs.slice(0,3)){
    const unrelated=pairs.find(([candidate])=>candidate!==user);
    await assert.rejects(requireTenantAccess({headers:{authorization:`Bearer ${user}`,'x-nitros-tenant-id':unrelated[1]}},{env,fetcher}),e=>e.status===403&&e.code==='tenant_membership_denied');
  }
});

test('provider/network failure is sanitized and does not echo bearer material',async()=>{
  await assert.rejects(requireTenantAccess(req,{env,fetcher:async()=>{throw new Error('synthetic-access-token')}}),e=>{
    assert.ok(e instanceof AuthorizationError); assert.equal(e.status,503); assert.equal(e.message.includes('synthetic-access-token'),false); return true;
  });
});
