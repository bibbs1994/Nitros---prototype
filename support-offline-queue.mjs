const DB_NAME='nitros-support-center-v1',STORE='ticket-outbox';

function openDatabase(factory=globalThis.indexedDB){
  if(!factory)return Promise.reject(new Error('Offline ticket storage is unavailable in this browser.'));
  return new Promise((resolve,reject)=>{
    const request=factory.open(DB_NAME,1);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(STORE)){const store=db.createObjectStore(STORE,{keyPath:'clientSubmissionId'});store.createIndex('owner','ownerKey',{unique:false})}};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Offline ticket storage could not be opened.'));
  });
}

export function createSupportOfflineQueue({indexedDB=globalThis.indexedDB}={}){
  async function transact(mode,work){const db=await openDatabase(indexedDB);return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);let result;try{result=work(store)}catch(error){reject(error);db.close();return}tx.oncomplete=()=>{db.close();resolve(result)};tx.onerror=()=>{db.close();reject(new Error('Offline ticket could not be saved.'))};tx.onabort=()=>{db.close();reject(new Error('Offline ticket storage was interrupted.'))}})}
  return Object.freeze({
    put(entry){if(!entry?.clientSubmissionId||!entry?.tenantId||!entry?.userId)throw new Error('Offline ticket identity is incomplete.');return transact('readwrite',store=>store.put({...entry,ownerKey:`${entry.tenantId}:${entry.userId}`,updatedAt:new Date().toISOString()}))},
    async list(tenantId,userId){const db=await openDatabase(indexedDB);return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),request=tx.objectStore(STORE).index('owner').getAll(`${tenantId}:${userId}`);request.onsuccess=()=>resolve(request.result||[]);request.onerror=()=>reject(new Error('Offline ticket queue could not be read.'));tx.oncomplete=()=>db.close();tx.onerror=()=>{db.close();reject(new Error('Offline ticket queue could not be read.'))}})},
    remove(clientSubmissionId){return transact('readwrite',store=>store.delete(clientSubmissionId))}
  });
}

export const supportOfflineQueue=createSupportOfflineQueue();
