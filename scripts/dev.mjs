import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import worker from "../relay/worker.js";
import {D1Local} from "./d1.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),webRoot=path.join(root,"web"),port=Number(process.env.PORT??8787),mount=process.env.DEV_MOUNT??"/";
if(!mount.startsWith("/")||!mount.endsWith("/"))throw new Error("DEV_MOUNT must start and end with /");
await fs.mkdir(path.join(root,"relay/.local"),{recursive:true});
const DB=new D1Local(process.env.LEDGER_DEV_DB??path.join(root,"relay/.local/ledger.db"));DB.exec(await fs.readFile(path.join(root,"relay/migrations/0001_initial.sql"),"utf8"));
let vars;try{vars=await fs.readFile(path.join(root,"relay/.dev.vars"),"utf8");}catch{vars=await fs.readFile(path.join(root,"relay/.dev.vars.example"),"utf8");}
const secrets=Object.fromEntries(vars.split("\n").filter(line=>line.trim()&&!line.startsWith("#")).map(line=>{const i=line.indexOf("=");return[line.slice(0,i),line.slice(i+1)];}));
const env={DB,...secrets,PUBLIC_BASE_URL:`http://127.0.0.1:${port}`,VIEWER_ORIGIN:`http://127.0.0.1:${port}`};
const types={".html":"text/html;charset=UTF-8",".js":"text/javascript;charset=UTF-8",".css":"text/css;charset=UTF-8",".svg":"image/svg+xml",".webmanifest":"application/manifest+json"};
const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,env.PUBLIC_BASE_URL);
  if(/^\/(api|oauth|mcp|\.well-known|health)(\/|$)/.test(url.pathname)){
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2_000_000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
    const request=new Request(url,{method:req.method,headers:req.headers,body:["GET","HEAD"].includes(req.method)?undefined:Buffer.concat(chunks)});
    const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(!url.pathname.startsWith(mount)){res.writeHead(404);res.end();return;}
  const relative=decodeURIComponent(url.pathname.slice(mount.length))||"index.html",local=path.resolve(webRoot,relative);
  if(!local.startsWith(webRoot+path.sep)){res.writeHead(403);res.end();return;}
  const bytes=await fs.readFile(local);res.writeHead(200,{"Content-Type":types[path.extname(local)]??"application/octet-stream","Cache-Control":"no-cache"});res.end(bytes);
}catch(e){res.writeHead(e.code==="ENOENT"?404:500);res.end("Local development request failed");}});
server.listen(port,"127.0.0.1",()=>console.log(`Local viewer: ${env.PUBLIC_BASE_URL}${mount}`));
process.on("SIGTERM",()=>{server.close();DB.close();});process.on("SIGINT",()=>{server.close();DB.close();});
