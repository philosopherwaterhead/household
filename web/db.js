import { initialData,SCHEMA_VERSION,validateSnapshot } from "./core.js";
const COLLECTIONS=["accounts","entries","observations","audit","processed"];
const STORES=[...COLLECTIONS,"meta"];
let dbPromise;
export function openDB(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const r=indexedDB.open("local-ledger-v1",1);
    r.onupgradeneeded=()=>{const db=r.result;for(const s of [...STORES,"settings"])db.createObjectStore(s,{keyPath:s==="meta"||s==="settings"?"key":"id"});};
    r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error("別のタブを閉じてから再読み込みしてください"));
    r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();dbPromise=null;};resolve(r.result);};
  });return dbPromise;
}
export async function readData(){
  const db=await openDB();return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORES,"readonly"),data={schemaVersion:SCHEMA_VERSION,meta:{}};
    for(const name of STORES){const r=tx.objectStore(name).getAll();r.onsuccess=()=>{if(name==="meta")for(const x of r.result)data.meta[x.key]=x.value;else data[name]=r.result;};}
    tx.oncomplete=()=>resolve(data);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error("保存が中断されました"));
  });
}
export async function changeData(change){
  const db=await openDB();return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORES,"readwrite"),data={schemaVersion:SCHEMA_VERSION,meta:{}};let count=0,result,problem;
    for(const name of STORES){const r=tx.objectStore(name).getAll();r.onsuccess=()=>{
      if(name==="meta")for(const x of r.result)data.meta[x.key]=x.value;else data[name]=r.result;
      if(++count!==STORES.length)return;
      try{
        if(!data.meta.ledgerId)Object.assign(data,initialData());
        result=change(data);if(result?.then)throw new Error("保存処理の内部では非同期処理を実行できません");
        data.meta.revision=(data.meta.revision??0)+1;
        validateSnapshot(data);
        for(const s of COLLECTIONS){const st=tx.objectStore(s);st.clear();for(const item of data[s])st.put(item);}
        const meta=tx.objectStore("meta");meta.clear();for(const[key,value]of Object.entries(data.meta))meta.put({key,value});
      }catch(e){problem=e;tx.abort();}
    };}
    tx.oncomplete=()=>resolve({data,result});tx.onerror=()=>reject(problem??tx.error);tx.onabort=()=>reject(problem??tx.error??new Error("保存が中断されました"));
  });
}
export async function ensureData(){const d=await readData();if(d.meta.ledgerId)return d;return(await changeData(()=>{})).data;}
export async function getSetting(key){const db=await openDB();return new Promise((resolve,reject)=>{const r=db.transaction("settings","readonly").objectStore("settings").get(key);r.onsuccess=()=>resolve(r.result?.value??null);r.onerror=()=>reject(r.error);});}
export async function putSetting(key,value){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction("settings","readwrite");tx.objectStore("settings").put({key,value});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
export async function restoreData(snapshot){validateSnapshot(snapshot);return changeData(data=>{const oldRevision=data.meta.revision;Object.assign(data,structuredClone(snapshot));data.meta.revision=Math.max(oldRevision,snapshot.meta.revision);});}
