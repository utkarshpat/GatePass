import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {loadPwaAssets} from '../src/app/PwaAssets.ts';
const worker=await readFile(new URL('../src/app/service-worker.js',import.meta.url),'utf8');
function harness(){
 const listeners=new Map<string,Function>(),stores=new Map<string,Map<string,any>>(),requests:any[]=[],deleted:string[]=[];let offline=false;
 const open=async(name:string)=>{if(!stores.has(name))stores.set(name,new Map());const values=stores.get(name)!;return{async addAll(items:any[]){for(const item of items){requests.push(item);values.set(new URL(item.url).pathname,{staticPath:new URL(item.url).pathname});}},async match(path:string){return values.get(path);}};};
 class LocalRequest extends Request{constructor(input:any,init:any){super(typeof input==='string'?new URL(input,'https://gatepass.test').href:input,init);}}
 runInNewContext(worker,{URL,Request:LocalRequest,Response,self:{location:{origin:'https://gatepass.test'},clients:{claim:async()=>{}},addEventListener:(name:string,fn:Function)=>listeners.set(name,fn)},caches:{open,keys:async()=>[...stores.keys()],delete:async(name:string)=>{deleted.push(name);return stores.delete(name);}},fetch:async(req:any)=>{requests.push(req);if(offline)throw Error('offline');return{network:true};}});
 return{listeners,stores,requests,deleted,offline(){offline=true;},async install(){let pending:any;listeners.get('install')!({waitUntil:(p:any)=>pending=p});await pending;},async fetch(path:string,options:any={}){let response:any;listeners.get('fetch')!({request:{url:'https://gatepass.test'+path,method:'GET',mode:'cors',...options},respondWith:(p:any)=>response=p});return response?await response:undefined;}};
}
test('worker only precaches explicit public assets, without cookies or page content',async()=>{
 const h=harness();await h.install();assert.equal(h.requests.length,6);assert.ok(h.requests.every(r=>r.credentials==='omit'&&r.cache==='reload'));const paths=[...h.stores.values()][0];assert.ok(paths.has('/pwa/offline.html'));assert.ok([...paths.keys()].every(p=>p.startsWith('/pwa/')));
});
test('API, POST, protected images and arbitrary assets never use worker caching',async()=>{
 const h=harness();await h.install();for(const[path,options]of [['/api/reception/photo',{}],['/api/employee/digital-id/image',{method:'POST'}],['/reception',{method:'POST'}],['/private/photo.png',{}],['/assets/office-background.png',{}],['/pwa/icon-192.png?token=secret',{}]] as const)assert.equal(await h.fetch(path,options),undefined);assert.equal(h.requests.length,6);
});
test('failed navigation receives only the generic offline page, never previous authenticated HTML',async()=>{
 const h=harness();await h.install();h.offline();let response:any;
 // A native Request supplies the browser navigation's URL and HTTP method; mode is exposed by the event wrapper.
 const request=new Request('https://gatepass.test/reception');Object.defineProperty(request,'mode',{value:'navigate'});
 h.listeners.get('fetch')!({request,respondWith:(p:any)=>response=p});assert.deepEqual(await response,{staticPath:'/pwa/offline.html'});assert.equal(h.requests.at(-1).cache,'no-store');assert.equal([...h.stores.values()][0].size,6);
});
test('activation removes only older GatePass caches and does not force waiting workers to activate',async()=>{
 const h=harness();h.stores.set('gatepass-static-old',new Map());h.stores.set('another-app',new Map());await h.install();let pending:any;h.listeners.get('activate')!({waitUntil:(p:any)=>pending=p});await pending;assert.deepEqual(h.deleted,['gatepass-static-old']);assert.ok(h.stores.has('another-app'));
});
test('PWA assets have correct MIME, worker scope and bounded exact-path routing',async()=>{
 const serve=await loadPwaAssets();const headers:any={};let body:any;const res={setHeader:(k:string,v:any)=>headers[k]=v,end:(value:any)=>body=value} as any;
 assert.equal(serve({method:'GET',url:'/manifest.webmanifest'} as any,res),true);assert.match(headers['Content-Type'],/manifest\+json/);const manifest=JSON.parse(body.toString());assert.equal(manifest.name,'GatePass');assert.equal(manifest.start_url,'/');assert.equal(manifest.display,'standalone');assert.equal(manifest.icons.length,3);
 assert.equal(serve({method:'GET',url:'/service-worker.js'} as any,res),true);assert.equal(headers['Cache-Control'],'no-cache');assert.equal(headers['Service-Worker-Allowed'],'/');
 for(const path of ['/pwa/../../secret','/pwa/icon-192.png?secret=1','/api/reception/photo'])assert.equal(serve({method:'GET',url:path} as any,res),false);
 assert.equal(serve({method:'POST',url:'/service-worker.js'} as any,res),false);
 for(const icon of [...manifest.icons,{src:'/pwa/apple-touch-icon.png',sizes:'180x180'}]){assert.equal(serve({method:'GET',url:icon.src} as any,res),true);assert.equal(body.readUInt32BE(16),Number(icon.sizes.split('x')[0]));assert.equal(body.readUInt32BE(20),Number(icon.sizes.split('x')[1]));}
});
