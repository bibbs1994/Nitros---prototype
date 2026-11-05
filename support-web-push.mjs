import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto';

const fromB64url=value=>Buffer.from(String(value||''),'base64url');
const toB64url=value=>Buffer.from(value).toString('base64url');
const hkdf=(ikm,salt,info,length)=>Buffer.from(new Uint8Array(hkdfSync('sha256',ikm,salt,info,length)));

export function createVapidAuthorization(endpoint,{publicKey,privateKey,subject},nowSeconds=Math.floor(Date.now()/1000)){
  const url=new URL(endpoint);if(url.protocol!=='https:')throw new Error('invalid_push_endpoint');
  const publicBytes=fromB64url(publicKey),privateBytes=fromB64url(privateKey);
  if(publicBytes.length!==65||publicBytes[0]!==4||privateBytes.length!==32)throw new Error('invalid_vapid_key');
  if(typeof subject!=='string'||!(/^(mailto:.+|https:\/\/.+)$/.test(subject)))throw new Error('invalid_vapid_subject');
  const input={typ:'JWT',alg:'ES256'},claims={aud:url.origin,exp:nowSeconds+12*60*60,sub:subject};
  const unsigned=`${toB64url(JSON.stringify(input))}.${toB64url(JSON.stringify(claims))}`;
  const key=createPrivateKey({key:{kty:'EC',crv:'P-256',x:toB64url(publicBytes.subarray(1,33)),y:toB64url(publicBytes.subarray(33,65)),d:toB64url(privateBytes)},format:'jwk'});
  const signature=sign('sha256',Buffer.from(unsigned),{key,dsaEncoding:'ieee-p1363'});
  return `vapid t=${unsigned}.${toB64url(signature)}, k=${publicKey}`;
}

export function encryptPushPayload(subscription,payload,{salt=randomBytes(16),ephemeralPrivateKey}={}){
  const receiverPublic=fromB64url(subscription?.keys?.p256dh),authSecret=fromB64url(subscription?.keys?.auth);
  if(receiverPublic.length!==65||receiverPublic[0]!==4||authSecret.length!==16)throw new Error('invalid_push_subscription');
  const sender=createECDH('prime256v1');if(ephemeralPrivateKey)sender.setPrivateKey(ephemeralPrivateKey);else sender.generateKeys();
  const senderPublic=sender.getPublicKey(),shared=sender.computeSecret(receiverPublic);
  const keyInfo=Buffer.concat([Buffer.from('WebPush: info\0','utf8'),receiverPublic,senderPublic]);
  const ikm=hkdf(shared,authSecret,keyInfo,32);
  const cek=hkdf(ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0','utf8'),16);
  const nonce=hkdf(ikm,salt,Buffer.from('Content-Encoding: nonce\0','utf8'),12);
  const plaintext=Buffer.concat([Buffer.from(JSON.stringify(payload),'utf8'),Buffer.from([2])]);
  const cipher=createCipheriv('aes-128-gcm',cek,nonce),ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final(),cipher.getAuthTag()]);
  const header=Buffer.alloc(21);salt.copy(header,0);header.writeUInt32BE(4096,16);header.writeUInt8(senderPublic.length,20);
  return Buffer.concat([header,senderPublic,ciphertext]);
}

export async function sendWebPush(subscription,payload,{vapid,fetcher=globalThis.fetch}={}){
  const body=encryptPushPayload(subscription,payload),authorization=createVapidAuthorization(subscription.endpoint,vapid);
  return fetcher(subscription.endpoint,{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/octet-stream','Content-Encoding':'aes128gcm','TTL':'86400'},body});
}
