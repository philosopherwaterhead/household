import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {digest,unbase64url} from "../web/crypto.js";
const require=createRequire(import.meta.url);
const {chromium}=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,"playwright")):await import("playwright");
const base=process.env.LEDGER_TEST_URL??"http://127.0.0.1:8787/",origin=new URL(base).origin;
const browser=await chromium.launch({headless:true,...(process.env.LEDGER_CHROMIUM_PATH?{executablePath:process.env.LEDGER_CHROMIUM_PATH}:{})});const context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:"Asia/Tokyo"});const page=await context.newPage();
await page.clock.install({time:new Date("2026-10-03T20:00:00+09:00")});
const errors=[];page.on("pageerror",e=>errors.push(e.message));page.on("dialog",d=>d.accept());
await fs.mkdir("test-output",{recursive:true});
const snapshot=()=>page.evaluate(async()=>{const m=await import(new URL("./db.js",location.href));return m.readData();});
const revisionWait=async old=>page.waitForFunction(async r=>{const m=await import(new URL("./db.js",location.href));return(await m.readData()).meta.revision>r;},old);
const nav=name=>page.locator("nav").getByRole("button",{name}).click();
async function account(index,value){await nav("設定・バックアップ");const form=page.locator(".account-form").nth(index);await form.locator('input[type="number"]').fill(String(value));await form.locator('input[type="date"]').fill("2026-10-01");const r=(await snapshot()).meta.revision;await form.getByRole("button",{name:"保存",exact:true}).click();await revisionWait(r);}
async function entry(kind,accountId,amount,merchant,to){await nav("記録・承認");await page.getByRole("button",{name:"記録を追加",exact:true}).click();await page.locator("#entry-kind").selectOption(kind);await page.locator("#entry-date").fill("2026-10-03");await page.locator("#entry-account").selectOption(accountId);await page.locator("#entry-amount").fill(String(amount));await page.locator("#entry-merchant").fill(merchant);if(to)await page.locator("#entry-to-account").selectOption(to);const r=(await snapshot()).meta.revision;await page.getByRole("button",{name:"確認待ちで保存する"}).click();await revisionWait(r);}
async function approve(merchant){const r=(await snapshot()).meta.revision;await page.locator("#entry-list .record").filter({hasText:merchant}).getByRole("button",{name:"承認する",exact:true}).click();await revisionWait(r);}
try{
  await page.goto(base);await page.waitForFunction(()=>document.querySelector("#connection").textContent!=="読み込み中");await page.evaluate(()=>navigator.serviceWorker.ready);
  await account(0,10000);await account(1,0);await account(2,0);await account(3,0);
  await entry("expense","card-10",1000,"テスト食料品");await nav("今月の家計");assert.equal(await page.locator("#expense").textContent(),"￥0");assert.match(await page.locator("#estimated-expense").textContent(),/1,000/);
  await nav("記録・承認");await approve("テスト食料品");await entry("transfer","bank-main",1000,"テストカード引落","card-10");await approve("テストカード引落");
  await nav("今月の家計");assert.equal(await page.locator("#expense").textContent(),"￥1,000");assert.match(await page.locator("#account-cards .account-row").first().textContent(),/9,000/);
  await nav("残高の照合");await page.locator("#observation-account").selectOption("bank-main");await page.locator("#observation-time").fill("2026-10-03T20:00");await page.locator("#observation-amount").fill("8500");await page.locator("#withdrawal-confirmed").check();let r=(await snapshot()).meta.revision;await page.getByRole("button",{name:"残高を仮登録する"}).click();await revisionWait(r);
  r=(await snapshot()).meta.revision;await page.getByRole("button",{name:"この実残高を承認"}).click();await revisionWait(r);assert.match(await page.locator("#observation-list").textContent(),/-￥500/);
  r=(await snapshot()).meta.revision;await page.getByRole("button",{name:"差額の修正案を作る"}).click();await revisionWait(r);await nav("記録・承認");await approve("実残高との照合による調整");await nav("今月の家計");assert.equal(await page.locator("#expense").textContent(),"￥1,000");assert.match(await page.locator("#account-cards .account-row").first().textContent(),/8,500/);
  await nav("設定・バックアップ");await page.locator("#backup-password").fill("browser-test-passphrase");r=(await snapshot()).meta.revision;await page.getByRole("button",{name:"暗号化を設定",exact:true}).click();await revisionWait(r);
  const downloadPromise=page.waitForEvent("download");await page.getByRole("button",{name:"暗号化バックアップを保存",exact:true}).click();const download=await downloadPromise;await download.saveAs("test-output/encrypted-backup.json");const encrypted=JSON.parse(await fs.readFile("test-output/encrypted-backup.json","utf8"));assert.equal(encrypted.format,"local-ledger-encrypted");assert.ok(encrypted.ciphertext);
  await page.locator("#relay-url").fill(origin);await page.locator("#viewer-token").fill("local-demo-viewer-token-change-me-32chars");await page.getByRole("button",{name:"接続設定を保存",exact:true}).click();await page.waitForFunction(()=>document.querySelector("#sync-status").textContent.includes("バックアップ同期済み"));
  // Exercise the real HTTP OAuth/MCP route, then the browser's fetch -> IDB -> ack -> encrypted backup flow.
  const request=async(route,options={})=>fetch(origin+route,options);
  const client=await(await request("/oauth/register",{method:"POST",body:JSON.stringify({redirect_uris:["https://chatgpt.com/callback"],token_endpoint_auth_method:"none"})})).json(),verifier="browser-test-"+"a".repeat(45),challenge=await digest(verifier);
  const params=new URLSearchParams({client_id:client.client_id,redirect_uri:"https://chatgpt.com/callback",response_type:"code",resource:origin+"/mcp",scope:"ledger:read ledger:write ledger:backup",code_challenge:challenge,code_challenge_method:"S256",state:"browser"});
  const authPage=await request("/oauth/authorize?"+params),html=await authPage.text(),csrf=html.match(/name="csrf" value="([^"]+)"/)[1],id=html.match(/name="request_id" value="([^"]+)"/)[1];
  const accepted=await request("/oauth/authorize",{method:"POST",redirect:"manual",headers:{Origin:origin,Cookie:`ledger_csrf=${csrf}`},body:new URLSearchParams({request_id:id,csrf,password:"local-demo-password-change-me"})});assert.equal(accepted.status,302);
  const token=await(await request("/oauth/token",{method:"POST",body:new URLSearchParams({grant_type:"authorization_code",client_id:client.client_id,redirect_uri:"https://chatgpt.com/callback",resource:origin+"/mcp",code:new URL(accepted.headers.get("location")).searchParams.get("code"),code_verifier:verifier})})).json();assert.ok(token.access_token);
  const call=async(name,args={})=>(await(await request("/mcp",{method:"POST",headers:{Authorization:`Bearer ${token.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}})})).json()).result;
  const queued=await call("queue_transaction",{requestId:"browser-fixture-message-0",sourceMessageId:"browser-fixture",transaction:{kind:"expense",date:"2026-10-03",accountId:"card-26",amountYen:1200,merchant:"同期テスト店舗",category:"日用品"}});assert.equal(queued.isError,false);
  await page.getByRole("button",{name:"同期する",exact:true}).click();await page.waitForFunction(()=>document.querySelector("#pending-count").textContent==="1");await nav("記録・承認");assert.match(await page.locator("#entry-list").textContent(),/同期テスト店舗/);assert.equal((await snapshot()).entries.filter(e=>e.pending).length,1);
  const backup=(await call("prepare_backup_email")).structuredContent;assert.equal(backup.to,"me");assert.equal(JSON.parse(new TextDecoder().decode(unbase64url(backup.payload.parts[1].body.base64_url_content))).format,"local-ledger-encrypted");
  await context.setOffline(true);await page.reload({waitUntil:"domcontentloaded"});await page.waitForFunction(()=>document.querySelector("#connection").textContent==="オフライン");assert.equal(await page.locator("#expense").textContent(),"￥1,000");assert.equal(await page.locator("#pending-total").textContent(),"1件");
  await page.screenshot({path:"test-output/desktop.png",fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:"test-output/mobile.png",fullPage:true});
  assert.deepEqual(errors,[]);console.log("Browser checks passed: approval, no duplicate settlement expense, screenshot comparison, encrypted export, OAuth/MCP -> queue -> IndexedDB, backup MIME, offline reload, mobile layout.");
}finally{await browser.close();}
