import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql=await readFile(new URL('../supabase/migrations/202611020001_tenant_foundation.sql',import.meta.url),'utf8');

test('all tables created by the staging migration explicitly enable RLS',()=>{
  const names=[...sql.matchAll(/create table public\.([a-z_]+)/gi)].map(match=>match[1]);
  assert.equal(names.length,17);
  for(const name of names) assert.match(sql,new RegExp(`alter table public\\.${name} enable row level security`,'i'),name);
  assert.match(sql,/from public,anon,authenticated/i);
  assert.doesNotMatch(sql,/service_role/i);
});

test('operational records use tenant-scoped parent relationships and permission-gated CRUD',()=>{
  assert.match(sql,/foreign key\(tenant_id,customer_id\) references public\.customers\(tenant_id,id\)/i);
  assert.match(sql,/foreign key\(tenant_id,vehicle_id\) references public\.vehicles\(tenant_id,id\)/i);
  assert.match(sql,/foreign key\(tenant_id,repair_order_id\) references public\.repair_orders\(tenant_id,id\)/i);
  for(const table of ['customers','vehicles','repair_orders','repair_order_artifacts','tenant_media']) {
    for(const operation of ['select','insert','update','delete']) assert.match(sql,new RegExp(`create policy [a-z_]+ on public\\.${table} for ${operation}`,'i'));
  }
  assert.match(sql,/public\.has_tenant_permission\(tenant_id,'records\.write'\)/i);
});

test('server-generated tenants, active membership revocation and offline expiry are bounded',()=>{
  assert.match(sql,/id uuid primary key default gen_random_uuid\(\)/i);
  assert.match(sql,/create or replace function public\.create_tenant/i);
  assert.match(sql,/create or replace function public\.revoke_tenant_membership/i);
  assert.match(sql,/set status='revoked'/i);
  assert.match(sql,/expires_at<=issued_at\+interval '24 hours'/i);
  assert.match(sql,/update public\.offline_authorizations set revoked_at=now\(\)/i);
  assert.doesNotMatch(sql,/\b(drop|truncate)\s+(table|schema|database)\b/i);
});
