import { encryptBackup, decryptBackup } from './secure-crypto.mjs';
self.onmessage=async ({data})=>{try{const result=await (data.action==='encrypt'?encryptBackup:decryptBackup)(data.input,data.key);self.postMessage({result})}catch(e){self.postMessage({error:e.message})}};
