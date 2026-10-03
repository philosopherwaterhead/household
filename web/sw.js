const CACHE="local-ledger-shell-v1";
const ASSETS=["./","./index.html","./style.css","./app.js","./core.js","./db.js","./crypto.js","./sync.js","./manifest.webmanifest","./icon.svg"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener("activate",event=>event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith("local-ledger-shell-")&&name!==CACHE)await caches.delete(name);await self.clients.claim();})()));
self.addEventListener("fetch",event=>{
  const url=new URL(event.request.url);if(event.request.method!=="GET"||url.origin!==self.location.origin||/\/(api|oauth|mcp)(\/|$)/.test(url.pathname))return;
  if(event.request.mode==="navigate")event.respondWith(fetch(event.request).catch(()=>caches.match(new URL("./index.html",self.registration.scope))));
  else event.respondWith((async()=>{const cached=await caches.match(event.request);if(cached)return cached;return fetch(event.request);})());
});
