import { validatePackage, LIMITS } from './backup-core.mjs';
export const ENCRYPTED_LIMIT = 90 * 1024 * 1024;
const aad = new TextEncoder().encode('nitros-encrypted-backup:v1:AES-256-GCM');
const b64 = bytes => { let s=''; for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384)); return btoa(s); };
function bytes(s) { if(typeof s!=='string'||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))throw new Error('Invalid encrypted encoding');return Uint8Array.from(atob(s),c=>c.charCodeAt(0)); }
export function newRecoveryKey() { return b64(crypto.getRandomValues(new Uint8Array(32))); }
async function importKey(text) { const raw=bytes(text.trim());if(raw.length!==32)throw new Error('A 32-byte generated recovery key is required');return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']); }
export async function encryptBackup(envelope, recoveryKey) {
  await validatePackage(envelope);
  const iv=crypto.getRandomValues(new Uint8Array(12)), key=await importKey(recoveryKey);
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,new TextEncoder().encode(JSON.stringify(envelope)));
  return {format:'nitros-encrypted-backup',version:1,algorithm:'AES-256-GCM',iv:b64(iv),ciphertext:b64(new Uint8Array(ciphertext))};
}
export async function decryptBackup(input, recoveryKey) {
  const text=typeof input==='string'?input:JSON.stringify(input);
  if(new TextEncoder().encode(text).length>ENCRYPTED_LIMIT)throw new Error('Encrypted file exceeds 90 MiB limit');
  let p;try{p=JSON.parse(text)}catch{throw new Error('Invalid encrypted JSON')}
  if(p?.format!=='nitros-encrypted-backup'||p.version!==1||p.algorithm!=='AES-256-GCM')throw new Error('Unsupported encrypted format');
  const iv=bytes(p.iv),data=bytes(p.ciphertext);if(iv.length!==12||data.length<16||data.length>LIMITS.packageBytes+16)throw new Error('Invalid ciphertext size');
  const key=await importKey(recoveryKey);let clear;
  try{clear=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,data)}catch{throw new Error('Wrong recovery key or damaged encrypted backup')}
  const checked=await validatePackage(new TextDecoder('utf-8',{fatal:true}).decode(clear));return checked.envelope;
}
