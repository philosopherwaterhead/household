import { readData,changeData,getSetting,putSetting } from "./db.js";
import { importDraft } from "./core.js";
import { encryptSnapshot,digest } from "./crypto.js";
export async function syncLedger() {
  const url=await getSetting("relayUrl"),token=await getSetting("viewerToken");
  if(!url||!token)return{configured:false};
  const parsed=new URL(url);if(parsed.protocol!=="https:" && !(parsed.protocol==="http:" && ["localhost","127.0.0.1"].includes(parsed.hostname)))throw new Error("同期先はHTTPSで指定してください");
  if(parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=="/")throw new Error("同期先はドメインのみを指定してください");
  const api=async(path,body)=>{
    const r=await fetch(new URL(path,parsed),{method:body?"POST":"GET",headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json"},cache:"no-store",body:body?JSON.stringify(body):undefined});
    const v=await r.json();if(!r.ok)throw new Error(v.error??`同期に失敗しました (${r.status})`);return v;
  };
  let data=await readData();
  await api("/api/catalog",{ledgerId:data.meta.ledgerId,accounts:data.accounts.map(({id,name,type,withdrawalDay})=>({id,name,type,withdrawalDay}))});
  const queue=await api("/api/drafts");
  let imported=0;const errors=[];
  for(const draft of queue.drafts){
    try{
      const result=await changeData(d=>importDraft(d,draft));if(!result.result?.duplicate)imported++;
      await api("/api/ack",{ids:[draft.id]});
    }catch(e){errors.push({id:draft.id,message:e.message});}
  }
  data=await readData();
  const keyInfo=await getSetting("backupKey");let backup=false;
  if(keyInfo){
    const payload=await encryptSnapshot(data,keyInfo);
    const canonical=JSON.stringify({meta:data.meta,...Object.fromEntries(["accounts","entries","observations","audit","processed"].map(k=>[k,[...data[k]].sort((a,b)=>a.id.localeCompare(b.id))]))});
    await api("/api/backup",{envelope:payload,dataHash:await digest(canonical)});backup=true;
  }
  await putSetting("lastSync",{at:new Date().toISOString(),revision:data.meta.revision,backup,errors});
  return{configured:true,imported,backup,errors};
}
