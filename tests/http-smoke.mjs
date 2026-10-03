import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {digest} from "../web/crypto.js";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const temp=await fs.mkdtemp(path.join(os.tmpdir(),"ledger-http-")),port=process.env.LEDGER_HTTP_PORT??"8793",base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,["scripts/dev.mjs"],{cwd:root,env:{...process.env,PORT:port,DEV_MOUNT:"/book/",LEDGER_DEV_DB:path.join(temp,"test.db")},stdio:["ignore","pipe","pipe"]});
let log="";server.stdout.on("data",v=>log+=v);server.stderr.on("data",v=>log+=v);
const request=(route,options={})=>fetch(base+route,options);
try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Local server did not start")),10000);server.stdout.on("data",()=>{if(log.includes("Local viewer:")){clearTimeout(timer);resolve();}});server.on("exit",code=>{clearTimeout(timer);reject(new Error(`Local server exited: ${code}`));});});
  assert.equal((await request("/health")).status,200);
  const page=await request("/book/");assert.equal(page.status,200);assert.match(await page.text(),/手元の家計簿/);
  for(const name of ["index.html","app.js","core.js","db.js","crypto.js","sync.js","sw.js","style.css","manifest.webmanifest","icon.svg"]){const response=await request("/book/"+name);assert.equal(response.status,200,name);assert.ok((await response.text()).length>0);}
  assert.equal((await request("/api/drafts")).status,401);
  const viewerHeaders={Authorization:"Bearer local-demo-viewer-token-change-me-32chars","Content-Type":"application/json",Origin:base};
  const catalog=await request("/api/catalog",{method:"POST",headers:viewerHeaders,body:JSON.stringify({ledgerId:"http-fixture-ledger",accounts:[{id:"card-10",name:"HTTP確認用カード",type:"credit",withdrawalDay:10}]})});assert.equal(catalog.status,200);assert.equal(catalog.headers.get("access-control-allow-origin"),base);
  const client=await(await request("/oauth/register",{method:"POST",body:JSON.stringify({redirect_uris:["https://chatgpt.com/callback"],token_endpoint_auth_method:"none"})})).json();
  const verifier="http-test-"+"a".repeat(45),params=new URLSearchParams({client_id:client.client_id,redirect_uri:"https://chatgpt.com/callback",response_type:"code",resource:base+"/mcp",scope:"ledger:read ledger:write",code_challenge:await digest(verifier),code_challenge_method:"S256",state:"fixture"});
  const html=await(await request("/oauth/authorize?"+params)).text(),csrf=html.match(/name="csrf" value="([^"]+)"/)[1],id=html.match(/name="request_id" value="([^"]+)"/)[1];
  const accepted=await request("/oauth/authorize",{method:"POST",redirect:"manual",headers:{Origin:base,Cookie:`ledger_csrf=${csrf}`},body:new URLSearchParams({request_id:id,csrf,password:"local-demo-password-change-me"})});assert.equal(accepted.status,302);
  const token=await(await request("/oauth/token",{method:"POST",body:new URLSearchParams({grant_type:"authorization_code",client_id:client.client_id,redirect_uri:"https://chatgpt.com/callback",resource:base+"/mcp",code:new URL(accepted.headers.get("location")).searchParams.get("code"),code_verifier:verifier})})).json();assert.ok(token.access_token);
  const queued=await(await request("/mcp",{method:"POST",headers:{Authorization:`Bearer ${token.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"queue_transaction",arguments:{requestId:"http-fixture-notice-0",sourceMessageId:"http-fixture",transaction:{kind:"expense",date:"2026-10-03",accountId:"card-10",amountYen:1000,merchant:"架空のHTTP確認店舗"}}}})})).json();assert.equal(queued.result.isError,false);
  const drafts=await(await request("/api/drafts",{headers:viewerHeaders})).json();assert.equal(drafts.drafts.length,1);assert.equal(drafts.drafts[0].payload.amountYen,1000);
  assert.equal((await request("/api/ack",{method:"POST",headers:viewerHeaders,body:JSON.stringify({ids:[drafts.drafts[0].id]})})).status,200);
  assert.equal((await(await request("/api/drafts",{headers:viewerHeaders})).json()).drafts.length,0);
  console.log("HTTP checks passed: GitHub Pages subpath assets, OAuth, MCP input queue, CORS, authenticated fetch, acknowledgment.");
}finally{
  if(server.exitCode===null){const ended=new Promise(resolve=>server.once("exit",resolve));server.kill("SIGTERM");await ended;}
  await fs.rm(temp,{recursive:true,force:true});
}
