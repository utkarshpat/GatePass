/* Only this explicit public asset set is cacheable. Authenticated HTML is never cached. */
const CACHE = 'gatepass-static-v1';
const OFFLINE = '/pwa/offline.html';
const PUBLIC_ASSETS = [OFFLINE,'/pwa/offline.css','/pwa/icon-192.png','/pwa/icon-512.png','/pwa/icon-maskable-512.png','/pwa/apple-touch-icon.png'];
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(PUBLIC_ASSETS.map(path=>new Request(path,{credentials:'omit',cache:'reload'})));
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  await Promise.all((await caches.keys()).filter(name=>name.startsWith('gatepass-static-')&&name!==CACHE).map(name=>caches.delete(name)));
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 // POSTs and protected API/photo/card/report traffic go straight to the server.
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 if(request.mode==='navigate'){
  event.respondWith(fetch(new Request(request,{cache:'no-store'})).catch(async()=>{
   const offline=await (await caches.open(CACHE)).match(OFFLINE);
   return offline??new Response('Connection required. Please reconnect and retry.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  }));return;
 }
 if(url.search||!PUBLIC_ASSETS.includes(url.pathname))return;
 event.respondWith((async()=>{
  const cached=await (await caches.open(CACHE)).match(url.pathname);
  return cached??fetch(request);
 })());
});
