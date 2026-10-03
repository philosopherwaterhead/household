import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {D1Local} from "../scripts/d1.mjs";
import worker from "../relay/worker.js";
import {digest,newBackupKey,encryptSnapshot,unbase64url} from "../web/crypto.js";
import {initialData} from "../web/core.js";
async function fixture(){const DB=new D1Local();DB.exec(await fs.readFile(new URL("../relay/migrations/0001_initial.sql",import.meta.url),"utf8"));const env={DB,PUBLIC_BASE_URL:"https://relay.example",VIEWER_ORIGIN:"https://viewer.example",VIEWER_TOKEN:"test-viewer-token-32-characters-long",OWNER_PASSWORD:"test-owner-password-24-characters"};
  const fetch=(p,options={})=>worker.fetch(new Request(env.PUBLIC_BASE_URL+p,options),env);
  const api=(p,value)=>fetch(p,{method:value?"POST":"GET",headers:{Authorization:`Bearer ${env.VIEWER_TOKEN}`,"Content-Type":"application/json",Origin:env.VIEWER_ORIGIN},body:value?JSON.stringify(value):undefined});
  const mcp=(name,args,token)=>fetch("/mcp",{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args??{}}})});
  return{env,fetch,api,mcp};
}
async function authorize(f,scope="ledger:read ledger:write ledger:backup"){
  const client=await(await f.fetch("/oauth/register",{method:"POST",body:JSON.stringify({redirect_uris:["https://chatgpt.com/callback"],token_endpoint_auth_method:"none"})})).json(),verifier="a".repeat(50),challenge=await digest(verifier);
  const params=new URLSearchParams({client_id:client.client_id,redirect_uri:"https://chatgpt.com/callback",response_type:"code",resource:"https://relay.example/mcp",scope,code_challenge:challenge,code_challenge_method:"S256",state:"state-value"});
  const page=await f.fetch("/oauth/authorize?"+params),html=await page.text(),csrf=html.match(/name="csrf" value="([^"]+)"/)[1],id=html.match(/name="request_id" value="([^"]+)"/)[1];
  const result=await f.fetch("/oauth/authorize",{method:"POST",headers:{Origin:f.env.PUBLIC_BASE_URL,Cookie:`ledger_csrf=${csrf}`},body:new URLSearchParams({request_id:id,csrf,password:f.env.OWNER_PASSWORD})});assert.equal(result.status,302);
  const location=new URL(result.headers.get("Location"));assert.equal(location.searchParams.get("state"),"state-value");assert.equal(location.searchParams.get("iss"),f.env.PUBLIC_BASE_URL);
  const request={grant_type:"authorization_code",client_id:client.client_id,redirect_uri:"https://chatgpt.com/callback",resource:"https://relay.example/mcp",code:location.searchParams.get("code"),code_verifier:verifier};
  return{client,request};
}
test("private data requires authentication and scope; MCP cannot approve records",async()=>{
  const f=await fixture();assert.equal((await f.fetch("/api/drafts")).status,401);assert.equal((await f.mcp("get_account_catalog")).status,401);
  const{request}=await authorize(f,"ledger:read"),token=await(await f.fetch("/oauth/token",{method:"POST",body:new URLSearchParams(request)})).json();
  const result=await(await f.mcp("queue_transaction",{requestId:"x",transaction:{}},token.access_token)).json();assert.equal(result.result.isError,true);
  const approve=await(await f.mcp("approve_transaction",{},token.access_token)).json();assert.equal(approve.result.isError,true);
  assert.equal((await f.fetch("/api/drafts",{headers:{Origin:"https://evil.example",Authorization:`Bearer ${f.env.VIEWER_TOKEN}`}})).status,403);f.env.DB.close();
});
test("OAuth enforces resource and PKCE, consumes codes once, and rotates refresh tokens",async()=>{
  const f=await fixture(),{client,request}=await authorize(f);
  assert.equal((await f.fetch("/oauth/token",{method:"POST",body:new URLSearchParams({...request,resource:"https://other.example/mcp"})})).status,400);
  assert.equal((await f.fetch("/oauth/token",{method:"POST",body:new URLSearchParams({...request,code_verifier:"b".repeat(50)})})).status,400);
  const token=await(await f.fetch("/oauth/token",{method:"POST",body:new URLSearchParams(request)})).json();assert.ok(token.access_token);
  assert.equal((await f.fetch("/oauth/token",{method:"POST",body:new URLSearchParams(request)})).status,400);
  const refresh={grant_type:"refresh_token",client_id:client.client_id,resource:f.env.PUBLIC_BASE_URL+"/mcp",refresh_token:token.refresh_token};const rotated=await(await f.fetch("/oauth/token",{method:"POST",body:new URLSearchParams(refresh)})).json();assert.notEqual(rotated.refresh_token,token.refresh_token);
  assert.equal((await f.fetch("/oauth/token",{method:"POST",body:new URLSearchParams(refresh)})).status,400);f.env.DB.close();
});
test("queued retries are idempotent and acknowledgment removes plaintext payloads",async()=>{
  const f=await fixture(),data=initialData();await f.api("/api/catalog",{ledgerId:data.meta.ledgerId,accounts:data.accounts});const{request}=await authorize(f),token=await(await f.fetch("/oauth/token",{method:"POST",body:new URLSearchParams(request)})).json();
  const args={requestId:"email123-line0",sourceMessageId:"email123",transaction:{kind:"expense",date:"2026-10-03",accountId:"card-10",amountYen:1000,merchant:"店舗"}};
  const first=await(await f.mcp("queue_transaction",args,token.access_token)).json(),again=await(await f.mcp("queue_transaction",args,token.access_token)).json();assert.equal(first.result.structuredContent.id,again.result.structuredContent.id);
  assert.equal((await(await f.api("/api/drafts")).json()).drafts.length,1);
  await f.api("/api/ack",{ids:[first.result.structuredContent.id]});assert.equal((await(await f.api("/api/drafts")).json()).drafts.length,0);
  const row=await f.env.DB.prepare("SELECT * FROM drafts").first();assert.equal(row.payload,"{}");assert.equal(row.source,null);
  const retry=await(await f.mcp("queue_transaction",args,token.access_token)).json();assert.equal(retry.result.structuredContent.alreadyImported,true);
  const altered=await(await f.mcp("queue_transaction",{...args,transaction:{...args.transaction,amountYen:2000}},token.access_token)).json();assert.equal(altered.result.isError,true);f.env.DB.close();
});
test("encrypted backup versions cannot be overwritten by stale data and Gmail MIME preserves bytes",async()=>{
  const f=await fixture(),data=initialData(),key=await newBackupKey("backup-test-passphrase");data.meta.revision=2;const envelope=await encryptSnapshot(data,key),hash=await digest(JSON.stringify(data));
  assert.equal((await f.api("/api/backup",{envelope,dataHash:hash})).status,200);
  assert.equal((await f.api("/api/backup",{envelope:{...envelope,revision:1},dataHash:hash})).status,409);
  assert.equal((await f.api("/api/backup",{envelope,dataHash:await digest("different-data")})).status,409);
  const{request}=await authorize(f),token=await(await f.fetch("/oauth/token",{method:"POST",body:new URLSearchParams(request)})).json();const email=(await(await f.mcp("prepare_backup_email",{},token.access_token)).json()).result.structuredContent;
  assert.equal(email.to,"me");assert.equal(email.payload.parts[1].content_disposition,"attachment");assert.deepEqual(JSON.parse(new TextDecoder().decode(unbase64url(email.payload.parts[1].body.base64_url_content))),envelope);f.env.DB.close();
});
