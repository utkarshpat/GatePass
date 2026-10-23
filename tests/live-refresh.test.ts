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
