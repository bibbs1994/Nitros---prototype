import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requireShop } from '../api/_lib/support-center.mjs';
import sharp from 'sharp';
import { decodeScreenshot, sanitizeScreenshot } from '../api/support-attachments.mjs';
import { createCipheriv, createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';
import { createVapidAuthorization, encryptPushPayload } from '../support-web-push.mjs';
import { dispatchSupportPush } from '../api/support-push-dispatch.mjs';

const root=new URL('../',import.meta.url),read=path=>readFileSync(new URL(path,root),'utf8');
const tenantId='123e4567-e89b-42d3-a456-426614174000',userId='223e4567-e89b-42d3-a456-426614174000',otherTenant='323e4567-e89b-42d3-a456-426614174000';
const env={NITROS_STAGING_DEPLOYMENT:'true',NITROS_STAGING_HOST:'nitros-mobile-staging.example.test',NITROS_STAGING_SUPABASE_REF:'nitros-mobile-staging',SUPABASE_URL:'https://nitros-mobile-staging.supabase.co',SUPABASE_ANON_KEY:'public-staging-key'};

test('Support APIs require same-origin staging configuration and a verified tenant membership',async()=>{
  const calls=[];const fetcher=async(url,options)=>{calls.push(String(url));if(String(url).endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:userId,email:'synthetic@example.test'}),{status:200});if(String(url).includes('/tenant_memberships?'))return new Response(JSON.stringify([{id:'423e4567-e89b-42d3-a456-426614174000',tenant_id:tenantId,user_id:userId,role:'technician',status:'active'}]),{status:200});throw new Error('unexpected request')};
  const req={headers:{host:'nitros-mobile-staging.example.test',origin:'https://nitros-mobile-staging.example.test',authorization:'Bearer synthetic-user-token','x-nitros-tenant-id':tenantId}};
  const context=await requireShop(req,{env,fetcher});assert.equal(context.tenantId,tenantId);assert.equal(context.userId,userId);assert.equal(context.role,'technician');assert.equal(calls.length,2);
  await assert.rejects(requireShop({...req,headers:{...req.headers,'x-nitros-tenant-id':otherTenant}},{env,fetcher}),error=>error.status===403);
  await assert.rejects(requireShop({...req,headers:{...req.headers,host:'nitros-prototype.vercel.app',origin:'https://nitros-prototype.vercel.app'}},{env,fetcher}),error=>error.status===404);
  await assert.rejects(requireShop({...req,headers:{...req.headers,origin:'https://attacker.example'}},{env,fetcher}),error=>error.status===403);
});

test('tenant foundation and support migration enforce ownership, admin actions, history, unread acknowledgements, and private media',()=>{
  const foundation=read('supabase/migrations/202611020001_tenant_foundation.sql'),sql=read('supabase/migrations/202611020002_support_center.sql');
  assert.match(sql,/unique\s*\(tenant_id,created_by,client_submission_id\)/i);
  assert.match(sql,/check\s*\(status\s+in\s*\('Open','In Progress','Closed'\)\)/i);
  assert.match(sql,/support_read_read_admin[\s\S]*?admin_user_id=auth\.uid\(\)[\s\S]*?support_is_admin/i);
  assert.match(sql,/support_read_write_admin[\s\S]*?with check\(admin_user_id=auth\.uid\(\) and public\.support_is_admin/i);
  assert.match(sql,/created_by=auth\.uid\(\) or public\.support_is_admin\(tenant_id\)/i);
  assert.match(sql,/support_ticket_events/);assert.match(sql,/support_push_outbox/);assert.match(sql,/support_admin_unread_count/);
  assert.match(sql,/public=false/);assert.match(sql,/file_size_limit,allowed_mime_types/);
  assert.match(sql,/support_attachment_object_read[\s\S]*?state='ready'/i);
  assert.match(sql,/finalize_support_attachment[\s\S]*?storage\.objects/i);
  assert.match(foundation,/create table public\.tenant_memberships/i);assert.match(foundation,/public\.has_tenant_permission/i);
});

test('customer and administrator interfaces use server APIs, explicit roles, durable acknowledgement, and exact three statuses',()=>{
  const page=read('support-center.html'),client=read('support-center.mjs'),portal=read('support-portal.mjs'),api=read('api/admin-support-tickets.mjs');
  for(const status of ['Open','In Progress','Closed'])assert.ok(page.includes(status));
  assert.match(client,/tenant\.role==='owner'/);assert.match(client,/Acknowledge notification/);assert.ok(client.includes('/api/admin-support-tickets'));
  assert.ok(client.includes('/api/support-tickets'));assert.ok(client.includes('/api/support-attachments'));assert.match(client,/BroadcastChannel/);
  assert.match(api,/roleIsAdmin\(ctx\)/);assert.match(api,/support_admin_unread_count/);
  assert.match(portal,/owners=memberships\.filter\(item=>item\.role==='owner'\)/);assert.match(portal,/supportCenterHomeUnread/);
  assert.doesNotMatch(client,/nitros_support_tickets_v1|192\.168\.4\.24/);
});

test('offline ticket queue isolates records by authenticated tenant and user and reuses idempotency identifiers',()=>{
  const queue=read('support-offline-queue.mjs'),client=read('support-center.mjs'),sql=read('supabase/migrations/202611020002_support_center.sql');
  assert.match(queue,/factory\.open\(DB_NAME,1\)/);assert.match(queue,/ownerKey:`\$\{entry\.tenantId\}:\$\{entry\.userId\}`/);
  assert.match(queue,/index\('owner'\)\.getAll\(`\$\{tenantId\}:\$\{userId\}`\)/);
  assert.match(client,/navigator\.onLine/);assert.match(client,/supportOfflineQueue\.put\(entry\)/);assert.match(client,/clientSubmissionId/);
  assert.match(sql,/on conflict\(tenant_id,created_by,client_submission_id\) do nothing/i);
});

test('screenshots accept only bounded supported images, re-encode them, and reject malformed or oversized payloads',async()=>{
  const good=await sharp({create:{width:1,height:1,channels:3,background:'#1266aa'}}).png().toBuffer();assert.deepEqual(decodeScreenshot('image/png',good.toString('base64')),good);
  const sanitized=await sanitizeScreenshot('image/png',good);assert.ok(sanitized.length>0);assert.equal((await sharp(sanitized).metadata()).format,'png');
  assert.throws(()=>decodeScreenshot('image/svg+xml',good),error=>error.status===400);
  assert.throws(()=>decodeScreenshot('image/png','not/base64!'),error=>error.status===400);
  assert.throws(()=>decodeScreenshot('image/jpeg',Buffer.alloc(2_097_153,1).toString('base64')),error=>error.status===413);
  await assert.rejects(sanitizeScreenshot('image/png',Buffer.from('not an image')),error=>error.code==='INVALID_IMAGE_CONTENT');
});

test('Web Push VAPID authentication signs the endpoint origin and the payload is encrypted',()=>{
  const vapid=createECDH('prime256v1');vapid.generateKeys();const publicKey=vapid.getPublicKey().toString('base64url'),privateKey=vapid.getPrivateKey().toString('base64url');
  const authorization=createVapidAuthorization('https://push.example.test/opaque',{publicKey,privateKey,subject:'mailto:support@example.test'},1000);
  const jwt=authorization.match(/^vapid t=([^,]+), k=/)?.[1];assert.ok(jwt);const [header,claims,signature]=jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(claims,'base64url')).aud,'https://push.example.test');
  const key=createPublicKey({key:{kty:'EC',crv:'P-256',x:vapid.getPublicKey().subarray(1,33).toString('base64url'),y:vapid.getPublicKey().subarray(33,65).toString('base64url')},format:'jwk'});
  assert.equal(verify('sha256',Buffer.from(`${header}.${claims}`),{key,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),true);
  const receiver=createECDH('prime256v1');receiver.generateKeys();const auth=Buffer.alloc(16,7),salt=Buffer.alloc(16,9),sender=createECDH('prime256v1');sender.generateKeys();
  const encoded=encryptPushPayload({keys:{p256dh:receiver.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}},{title:'New Nitros support ticket',ticketId:tenantId},{salt,ephemeralPrivateKey:sender.getPrivateKey()});
  assert.equal(encoded.subarray(0,16).equals(salt),true);assert.equal(encoded.readUInt32BE(16),4096);assert.equal(encoded.readUInt8(20),65);assert.ok(encoded.length>102);
  const senderPublic=encoded.subarray(21,86),shared=receiver.computeSecret(senderPublic),keyInfo=Buffer.concat([Buffer.from('WebPush: info\0'),receiver.getPublicKey(),senderPublic]);
  const ikm=Buffer.from(hkdfSync('sha256',shared,auth,keyInfo,32)),cek=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16)),nonce=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12));
  const encrypted=encoded.subarray(86),decipher=createDecipheriv('aes-128-gcm',cek,nonce);decipher.setAuthTag(encrypted.subarray(-16));
  const plaintext=Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()]);
  assert.equal(plaintext.at(-1),2);assert.deepEqual(JSON.parse(plaintext.subarray(0,-1).toString()),{title:'New Nitros support ticket',ticketId:tenantId});
});

test('push outbox dispatch uses server-only credentials, sends a generic payload, and confirms delivery',async()=>{
  const vapid=createECDH('prime256v1');vapid.generateKeys();const publicKey=vapid.getPublicKey().toString('base64url'),privateKey=vapid.getPrivateKey().toString('base64url');
  const receiver=createECDH('prime256v1');receiver.generateKeys();const endpoint='https://push.example.test/endpoint-secret';let ticketBody='';const writes=[];
  const fetcher=async(url,options={})=>{
    const value=String(url);
    if(value.includes('/support_push_outbox?')&&options.method!=='PATCH')return new Response(JSON.stringify([{id:tenantId,tenant_id:otherTenant,ticket_id:tenantId,recipient_user_id:userId,attempts:0}]),{status:200});
    if(value.includes('/support_push_subscriptions?'))return new Response(JSON.stringify([{id:userId,endpoint,endpoint_sha256:'a'.repeat(64),p256dh:receiver.getPublicKey().toString('base64url'),auth_key:Buffer.alloc(16,5).toString('base64url')}]),{status:200});
    if(value===endpoint){ticketBody=Buffer.from(options.body).toString('base64');return new Response(null,{status:201})}
    if(value.includes('/support_push_outbox?id=eq.')){writes.push(JSON.parse(options.body));return new Response(null,{status:204})}
    throw new Error('unexpected synthetic request');
  };
  const result=await dispatchSupportPush({env:{...env,SUPABASE_SERVICE_ROLE_KEY:'synthetic-server-only-role-key',SUPPORT_VAPID_PUBLIC_KEY:publicKey,SUPPORT_VAPID_PRIVATE_KEY:privateKey,SUPPORT_VAPID_SUBJECT:'mailto:support@example.test'},fetcher,tenantId:otherTenant,ticketId:tenantId});
  assert.deepEqual(result,{processed:1,delivered:1,retried:0,expiredSubscriptions:0});assert.equal(writes[0].status,'delivered');assert.ok(ticketBody.length>0);
  const requests=read('api/support-push-dispatch.mjs');assert.match(requests,/SUPABASE_SERVICE_ROLE_KEY/);assert.match(requests,/SUPPORT_PUSH_CRON_SECRET/);assert.doesNotMatch(read('support-center.mjs'),/SUPABASE_SERVICE_ROLE_KEY|SUPPORT_VAPID_PRIVATE_KEY/);
});
