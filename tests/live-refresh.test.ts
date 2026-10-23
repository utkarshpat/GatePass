import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import vm from'node:vm';
function fixture(){
 const events=new Map<string,Function>(),timers=new Map<number,Function>();let id=0;
 const context:any={document:{hidden:false,activeElement:{tagName:'BODY'},querySelector(){return null;},addEventListener(name:string,fn:Function){events.set(name,fn);},removeEventListener(name:string){events.delete(name);}},window:{addEventListener(name:string,fn:Function){events.set(name,fn);},removeEventListener(name:string){events.delete(name);}},setInterval(fn:Function){timers.set(++id,fn);return id;},clearInterval(n:number){timers.delete(n);},setTimeout(fn:Function){timers.set(++id,fn);return id;},clearTimeout(n:number){timers.delete(n);}};
 vm.createContext(context);vm.runInContext(readFileSync(new URL('../src/app/live-refresh.js',import.meta.url),'utf8')+';globalThis.Controller=LiveRefresh;globalThis.idle=workspaceIdle;',context);
 return{context,events,timers};
}
test('live refresh skips hidden/busy views, never overlaps requests and recovers after a failed read',async()=>{
 const f=fixture();let calls=0,ready=true,release=()=>{};const gate=new Promise<void>(r=>release=r);
 const live=new f.context.Controller(async()=>{calls++;await gate;},()=>ready);
 const first=live.run();await live.run();assert.equal(calls,1);release();await first;
 f.context.document.hidden=true;await live.run();assert.equal(calls,1);f.context.document.hidden=false;ready=false;await live.run();assert.equal(calls,1);
 ready=true;live.refresh=async()=>{calls++;throw Error('offline');};await live.run();live.refresh=async()=>{calls++;};await live.run();assert.equal(calls,3);live.close();
});
test('page hide suspends reads; persisted pageshow resumes; explicit close removes every timer and listener',async()=>{
 const f=fixture();let calls=0;const live=new f.context.Controller(async()=>{calls++;},()=>true);
 f.events.get('pagehide')!();await live.run();assert.equal(calls,0);assert.equal(f.timers.size,0);
 f.events.get('pageshow')!({persisted:true});await live.run();assert.equal(calls,1);live.close();await live.run();assert.equal(calls,1);assert.equal(f.events.size,0);assert.equal(f.timers.size,0);
});
test('workspace idle guard protects open dialogs and field edits',()=>{
 const f=fixture();assert.equal(f.context.idle(),true);f.context.document.activeElement.tagName='INPUT';assert.equal(f.context.idle(),false);f.context.document.activeElement.tagName='BODY';f.context.document.querySelector=()=>({open:true});assert.equal(f.context.idle(),false);
});

function streamingFixture(){
 const f=fixture();let now=1000,reads=0,connections=0,scope:any={workspace:'GUARD',locationId:1},editable=false;const streams:ReadableStreamDefaultController<Uint8Array>[]=[],requests:any[]=[];
 Object.assign(f.context,{AbortController,TextDecoder,Date:{now:()=>now},fetch:async(_url:string,options:any)=>{
  connections++;requests.push(options);const body=new ReadableStream<Uint8Array>({start(c){streams.push(c);c.enqueue(new TextEncoder().encode('event: ready\ndata: {}\n\n'));}});
  options.signal.addEventListener('abort',()=>{try{streams.at(-1)?.error(Error('aborted'));}catch{}},{once:true});
  return new Response(body,{headers:{'content-type':'text/event-stream'}});
 }});f.context.document.cookie='gp-staff-csrf=synthetic';
 const live=new f.context.Controller(async()=>{reads++;},()=>!editable,20000,()=>scope);
 const settle=async()=>{for(let i=0;i<8;i++)await new Promise<void>(r=>setImmediate(r));};
 return{...f,live,requests,streams,settle,advance(ms:number){now+=ms;},reads:()=>reads,connections:()=>connections,setScope(v:any){scope=v;},edit(v:boolean){editable=v;}};
}
test('SSE defers full idle reads to 60 seconds, batches invalidations and waits for edits',async()=>{
 const f=streamingFixture();f.live.tick();await f.settle();assert.equal(f.live.online,true);assert.equal(f.connections(),1);assert.equal(f.requests[0].method,'POST');assert.equal(f.requests[0].headers['X-CSRF-Token'],'synthetic');
 f.advance(1000);f.live.tick();await f.settle();assert.equal(f.reads(),1);
 f.advance(59000);f.live.tick();await f.settle();assert.equal(f.reads(),1);f.advance(1000);f.live.tick();await f.settle();assert.equal(f.reads(),2);
 f.edit(true);for(let i=0;i<30;i++)f.streams[0].enqueue(new TextEncoder().encode('event: invalidate\ndata: {}\n\n'));await f.settle();f.advance(5000);f.live.tick();await f.settle();assert.equal(f.reads(),2);
 f.edit(false);f.live.tick();await f.settle();assert.equal(f.reads(),3);f.live.close();
});
test('scope changes and hidden/page-exit states abort old streams and cannot apply late signals',async()=>{
 const f=streamingFixture();f.live.tick();await f.settle();const first=f.requests[0];
 f.setScope({workspace:'GUARD',locationId:2});f.live.tick();await f.settle();assert.equal(first.signal.aborted,true);assert.equal(f.connections(),2);
 f.context.document.hidden=true;f.events.get('visibilitychange')!();assert.equal(f.requests[1].signal.aborted,true);assert.equal(f.live.online,false);
 f.context.document.hidden=false;f.live.tick();await f.settle();assert.equal(f.connections(),3);f.events.get('pagehide')!();assert.equal(f.requests[2].signal.aborted,true);f.live.close();
});
test('a failed or denied stream keeps 20-second polling and bounds reconnection attempts',async()=>{
 const f=streamingFixture();f.context.fetch=async()=>new Response('{}',{status:403});f.live.tick();await f.settle();assert.equal(f.live.online,false);
 f.advance(20000);f.live.tick();await f.settle();assert.equal(f.reads(),1);assert.equal(f.live.blocked,JSON.stringify({workspace:'GUARD',locationId:1}));f.live.close();
 const offline=streamingFixture();let attempts=0;offline.context.fetch=async()=>{attempts++;throw Error('offline');};offline.live.tick();await offline.settle();offline.live.tick();assert.equal(attempts,1);
 offline.advance(70000);offline.live.tick();await offline.settle();assert.equal(attempts,2);assert.equal(offline.reads(),1);offline.live.close();
});
