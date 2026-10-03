const encode=new TextEncoder(); const decode=new TextDecoder();
export const ITERATIONS=310000;
export function base64url(bytes) { let s="";for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }
export function unbase64url(s) { if(typeof s!=="string" || !/^[A-Za-z0-9_-]*$/.test(s))throw new Error("暗号化データの形式が不正です");return Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0)); }
export async function digest(value) {return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256",typeof value==="string"?encode.encode(value):value)));}
export async function deriveKey(password,salt,iterations=ITERATIONS) {
  if(typeof password!=="string" || password.length<12)throw new Error("復元用パスフレーズは12文字以上にしてください");
  if(!Number.isInteger(iterations)||iterations<100000||iterations>1000000)throw new Error("鍵導出の設定が不正です");
  const material=await crypto.subtle.importKey("raw",encode.encode(password),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations,hash:"SHA-256"},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
export async function newBackupKey(password) { const salt=crypto.getRandomValues(new Uint8Array(16));return {key:await deriveKey(password,salt),salt:base64url(salt),iterations:ITERATIONS}; }
const streamBytes=async(bytes,type)=>new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(type)).arrayBuffer());
const header=e=>Object.fromEntries(["format","version","generatedAt","ledgerId","revision","kdf","iterations","salt","cipher","iv","compression"].map(k=>[k,e[k]]));
export async function encryptSnapshot(data, keyInfo) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=await streamBytes(encode.encode(JSON.stringify(data)),new CompressionStream("gzip"));
  const envelope={format:"local-ledger-encrypted",version:1,generatedAt:new Date().toISOString(),ledgerId:data.meta.ledgerId,revision:data.meta.revision,kdf:"PBKDF2-SHA256",iterations:keyInfo.iterations,salt:keyInfo.salt,cipher:"AES-256-GCM",iv:base64url(iv),compression:"gzip"};
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:encode.encode(JSON.stringify(header(envelope)))},keyInfo.key,bytes);
  return {...envelope,ciphertext:base64url(new Uint8Array(encrypted))};
}
export async function decryptSnapshot(envelope,password) {
  if(envelope?.format!=="local-ledger-encrypted" || envelope.version!==1 || envelope.cipher!=="AES-256-GCM" || envelope.kdf!=="PBKDF2-SHA256" || envelope.compression!=="gzip")throw new Error("対応する暗号化バックアップではありません");
  const salt=unbase64url(envelope.salt),iv=unbase64url(envelope.iv);if(salt.length!==16||iv.length!==12)throw new Error("暗号化データの形式が不正です");
  const key=await deriveKey(password,salt,envelope.iterations);
  let raw;try{raw=await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:encode.encode(JSON.stringify(header(envelope)))},key,unbase64url(envelope.ciphertext));}catch{throw new Error("パスフレーズが違うか、ファイルが破損しています");}
  const bytes=await streamBytes(new Uint8Array(raw),new DecompressionStream("gzip"));
  if(bytes.length>20_000_000)throw new Error("復元データが大きすぎます");
  return {data:JSON.parse(decode.decode(bytes)),keyInfo:{key,salt:envelope.salt,iterations:envelope.iterations}};
}
