import test from 'node:test';import type{TestContext}from'node:test';import assert from'node:assert/strict';
import{EventEmitter}from'node:events';import{PassThrough}from'node:stream';import type{spawn}from'node:child_process';
import{LocalDevelopmentApiClient}from'../src/development/LocalDevelopmentApiClient.ts';
class FakeChild extends EventEmitter{
 stdin=new PassThrough();stdout=new PassThrough();stderr=new PassThrough();kills=0;
 constructor(){super();this.stdin.once('finish',()=>this.emit('close',0));}
 ref(){return this;}unref(){return this;}kill(){this.kills++;queueMicrotask(()=>this.emit('close',0));return true;}
}
function fixture(t:TestContext,maximumWorkers=4){
 const env={NODE_ENV:process.env.NODE_ENV,GATEPASS_SSO_MODE:process.env.GATEPASS_SSO_MODE,GATEPASS_DIRECTORY_MODE:process.env.GATEPASS_DIRECTORY_MODE};
 Object.assign(process.env,{NODE_ENV:'test',GATEPASS_SSO_MODE:'dummy',GATEPASS_DIRECTORY_MODE:'mock'});
 const children:FakeChild[]=[],calls:{child:FakeChild;procedure?:string;warmup?:boolean;parameters?:Record<string,{value:unknown}>}[]=[];
 const client=new LocalDevelopmentApiClient(()=>{const child=new FakeChild();children.push(child);child.stdin.on('data',chunk=>calls.push({child,...JSON.parse(chunk.toString())}));return child as unknown as ReturnType<typeof spawn>;},maximumWorkers);
 t.after(async()=>{await client.close();for(const[key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 const reply=(index:number,result:unknown={ok:true})=>calls[index].child.stdout.write(JSON.stringify({result:JSON.stringify(result)})+'\n');
 return{client,children,calls,reply};
}

test('development worker tuning stays bounded and queues work above the configured capacity',async t=>{
 for(const maximum of [0,9,1.5,NaN])assert.throws(()=>new LocalDevelopmentApiClient(undefined,maximum),/INVALID_DEVELOPMENT_WORKER_LIMIT/u);
 const f=fixture(t,2),requests=Array.from({length:3},()=>f.client.callProcedure('gp.GetStaffAccessContext',{}));await Promise.resolve();assert.equal(f.children.length,2);assert.equal(f.calls.length,2);f.reply(0);await new Promise<void>(r=>setImmediate(r));assert.equal(f.calls.length,3);assert.equal(f.children.length,2);f.reply(1);f.reply(2);await Promise.all(requests);
});

test('server prewarm acknowledges every configured helper before admitting a queued read',async t=>{
 const f=fixture(t,2),observed:string[]=[];f.client.onSuccess=name=>observed.push(name);f.client.onTiming=row=>observed.push(row.procedure);
 const warming=f.client.warmUp(),again=f.client.warmUp();assert.equal(warming,again);assert.equal(f.children.length,2);assert(f.calls.every(c=>c.warmup===true&&c.procedure===undefined));
 const read=f.client.callProcedure('gp.ReadGuardQueue',{});f.reply(0,{ready:true});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,2);
 f.reply(1,{ready:true});await warming;await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,3);assert.deepEqual(observed,[]);
 f.reply(2,{visitors:[]});await read;assert.deepEqual(observed,['gp.ReadGuardQueue','gp.ReadGuardQueue']);assert.equal(f.children.length,2);
});

test('prewarmed helpers survive long browsing pauses within the same bounded pool and close cleanly',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t),warming=f.client.warmUp();for(let i=0;i<4;i++)f.reply(i,{ready:true});await warming;
 for(let round=0;round<2;round++){
  t.mock.timers.tick(300000);assert(f.children.every(c=>!c.stdin.writableEnded));const at=f.calls.length;
  const reads=Array.from({length:5},()=>f.client.callProcedure('gp.ReadGuardQueue',{}));await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,at+4);assert.equal(f.children.length,4);
  f.reply(at);await new Promise(resolve=>setImmediate(resolve));for(let i=1;i<5;i++)f.reply(at+i);await Promise.all(reads);
 }
 await f.client.close();assert(f.children.every(c=>c.stdin.writableEnded&&c.kills===0));
});

for(const bad of [{ready:false},{ready:true,extra:true},{bridgeError:true,number:0}])test('invalid readiness fails the whole pool without executing a business request '+JSON.stringify(bad),async t=>{
 const f=fixture(t),warming=assert.rejects(f.client.warmUp(),/DEVELOPMENT_RPC_UNAVAILABLE/u);f.reply(0,bad);await warming;
 assert(f.calls.every(c=>c.warmup===true));assert(f.children.every(c=>c.kills===1||c.stdin.writableEnded));await assert.rejects(f.client.callProcedure('gp.SubmitRegistration',{}),/DEVELOPMENT_RPC_UNAVAILABLE/u);
});

test('timing out during prewarm drains all pending readiness without replay',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t),warming=assert.rejects(f.client.warmUp(),/DEVELOPMENT_RPC_UNAVAILABLE/u);
 t.mock.timers.tick(20000);await warming;assert(f.children.every(c=>c.kills===1));assert(f.calls.every(c=>c.warmup===true));
});

test('shutdown during prewarm rejects readiness and waiting calls without spawning replacements',async t=>{
 const f=fixture(t),warming=assert.rejects(f.client.warmUp(),/DEVELOPMENT_RPC_UNAVAILABLE/u),read=assert.rejects(f.client.callProcedure('gp.ReadGuardQueue',{}),/DEVELOPMENT_RPC_UNAVAILABLE/u);
 await f.client.close();await Promise.all([warming,read]);assert.equal(f.children.length,4);assert(f.children.every(c=>c.kills===1));assert(f.calls.every(c=>c.warmup===true));
});

test('partial startup spawn failure cleans every already-started helper',async t=>{
 fixture(t);const children:FakeChild[]=[];let attempts=0;
 const client=new LocalDevelopmentApiClient(()=>{if(++attempts===2)throw Error('spawn failed');const child=new FakeChild();children.push(child);return child as unknown as ReturnType<typeof spawn>;});t.after(()=>client.close());
 await assert.rejects(client.warmUp(),/DEVELOPMENT_RPC_UNAVAILABLE/u);assert.equal(attempts,4);assert(children.every(c=>c.kills===1));
});

test('a call waiting for startup rechecks dummy mode before dispatch',async t=>{
 const f=fixture(t),warming=f.client.warmUp(),read=assert.rejects(f.client.callProcedure('gp.ReadGuardQueue',{}),/DUMMY_SSO_DISABLED/u);
 process.env.GATEPASS_SSO_MODE='disabled';for(let i=0;i<4;i++)f.reply(i,{ready:true});await warming;await read;assert(f.calls.every(c=>c.warmup===true));
});

test('prewarm enforces dummy mode and is startup-only for an unused client',async t=>{
 const f=fixture(t);process.env.GATEPASS_SSO_MODE='disabled';assert.throws(()=>f.client.warmUp(),/DUMMY_SSO_DISABLED/u);assert.equal(f.children.length,0);process.env.GATEPASS_SSO_MODE='dummy';
 const first=f.client.callProcedure('gp.ReadGuardQueue',{});await Promise.resolve();f.reply(0);await first;
 await assert.rejects(f.client.warmUp(),/DEVELOPMENT_POOL_ALREADY_STARTED/u);assert.equal(f.children.length,1);
});

test('committed success is observed once, SQL failure is not observed and observer failure never replays a write',async t=>{
 const f=fixture(t),observed:string[]=[];f.client.onSuccess=(name)=>{observed.push(name);throw Error('Notification unavailable');};
 const first=f.client.callProcedure('gp.SubmitRegistration',{});await Promise.resolve();f.reply(0,{status:'SUBMITTED'});assert.equal(JSON.parse(await first).status,'SUBMITTED');
 const failed=assert.rejects(f.client.callProcedure('gp.SubmitRegistration',{}),(e:any)=>e.number===52001);await Promise.resolve();f.reply(1,{bridgeError:true,number:52001});await failed;
 assert.deepEqual(observed,['gp.SubmitRegistration']);assert.equal(f.calls.length,2);
});
test('one helper survives a browsing pause, then retires after its renewed 90-second idle deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);
 const first=f.client.callProcedure('gp.GetOwnDigitalIdCard',{});await Promise.resolve();f.reply(0);await first;
 t.mock.timers.tick(6500);assert.equal(f.children[0].kills,0);
 const next=f.client.callProcedure('gp.GetOwnDigitalIdCard',{});await Promise.resolve();f.reply(1);await next;assert.equal(f.children.length,1);
 t.mock.timers.tick(89999);assert.equal(f.children[0].kills,0);t.mock.timers.tick(1);assert.equal(f.children[0].stdin.writableEnded,true);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.children[0].kills,0);
 const later=f.client.callProcedure('gp.GetOwnDigitalIdCard',{});await Promise.resolve();f.reply(2);await later;assert.equal(f.children.length,2);
});
test('burst helpers retire after five seconds while one retained helper remains; a fifth call waits',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t),requests=Array.from({length:5},()=>f.client.callProcedure('gp.GetOwnDigitalIdCard',{}));
 await Promise.resolve();assert.equal(f.children.length,4);assert.equal(f.calls.length,4);f.reply(0);await requests[0];await Promise.resolve();assert.equal(f.calls.length,5);
 for(let i=1;i<5;i++)f.reply(i);await Promise.all(requests);
 t.mock.timers.tick(5000);assert.equal(f.children[0].kills,0);assert.ok(f.children.slice(1).every(c=>c.stdin.writableEnded));await new Promise(resolve=>setImmediate(resolve));
 t.mock.timers.tick(85000);assert.equal(f.children[0].stdin.writableEnded,true);await new Promise(resolve=>setImmediate(resolve));assert.ok(f.children.every(c=>c.kills===0));
});
test('closing the client rejects active and waiting work and forbids further spawning',async t=>{
 const f=fixture(t),requests=Array.from({length:5},()=>assert.rejects(f.client.callProcedure('gp.GetOwnDigitalIdCard',{}),/DEVELOPMENT_RPC_UNAVAILABLE/u));
 await Promise.resolve();f.client.close();f.client.close();await Promise.all(requests);
 assert.ok(f.children.every(c=>c.kills===1));await assert.rejects(f.client.callProcedure('gp.GetOwnDigitalIdCard',{}),/DEVELOPMENT_RPC_UNAVAILABLE/u);assert.equal(f.children.length,4);
});
test('a failed helper is destroyed once and its late events cannot affect the next helper or replay work',async t=>{
 const f=fixture(t),first=assert.rejects(f.client.callProcedure('gp.SubmitRegistration',{}),/DEVELOPMENT_RPC_UNAVAILABLE/u);await Promise.resolve();
 const old=f.children[0];old.emit('error',Error('broken pipe'));await first;
 const next=f.client.callProcedure('gp.GetOwnDigitalIdCard',{});await Promise.resolve();old.emit('close',0);old.stdout.write(JSON.stringify({result:'{"old":true}'})+'\n');
 f.reply(1,{current:true});assert.deepEqual(JSON.parse(await next),{current:true});assert.equal(old.kills,1);assert.equal(f.calls.filter(c=>c.procedure==='gp.SubmitRegistration').length,1);
});
test('environment and procedure allowlists are checked even while a helper is retained',async t=>{
 const f=fixture(t),first=f.client.callProcedure('gp.GetOwnDigitalIdCard',{});await Promise.resolve();f.reply(0);await first;
 process.env.GATEPASS_SSO_MODE='disabled';await assert.rejects(f.client.callProcedure('gp.GetOwnDigitalIdCard',{}),/DUMMY_SSO_DISABLED/u);process.env.GATEPASS_SSO_MODE='dummy';
 await assert.rejects(f.client.callProcedure('sys.sp_executesql',{}),/DEVELOPMENT_RPC_UNAVAILABLE/u);assert.equal(f.calls.length,1);
});

test('optional stage telemetry preserves SQL outcomes even if its observer fails',async t=>{
 const f=fixture(t),seen:any[]=[];f.client.onTiming=row=>{seen.push(row);throw Error('diagnostic observer failed');};
 const success=f.client.callProcedure('gp.ReadGuardQueue',{});await Promise.resolve();
 f.calls[0].child.stdout.write(JSON.stringify({result:'{"items":[]}',timing:{executeMs:5}})+'\n');
 assert.equal(await success,'{"items":[]}');assert.equal(seen[0].bridge.executeMs,5);assert.equal(seen[0].procedure,'gp.ReadGuardQueue');
 const failed=assert.rejects(f.client.callProcedure('gp.ReadGuardQueue',{}),(e:any)=>e.number===1205);await Promise.resolve();f.reply(1,{bridgeError:true,number:1205});await failed;
 assert.equal(seen[1].sqlError,1205);assert.equal(seen.length,2);
});
test('graceful retirement has a bounded fallback and cannot replay a committed call',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);
 const result=f.client.callProcedure('gp.ReadGuardQueue',{});await Promise.resolve();f.reply(0);await result;
 f.children[0].stdin.removeAllListeners('finish');const closing=f.client.close();assert.equal(f.children[0].stdin.writableEnded,true);
 t.mock.timers.tick(4999);assert.equal(f.children[0].kills,0);t.mock.timers.tick(1);await closing;assert.equal(f.children[0].kills,1);assert.equal(f.calls.length,1);
});

// Stress regression: queued jobs must drain FIFO, without replay or over-spawning.
test('large queued burst drains FIFO with one worker and no duplicate requests',async t=>{
 const f=fixture(t,1);const total=40;const requests=Array.from({length:total},(_,i)=>
  f.client.callProcedure('gp.ReadGuardQueue',{Sequence:{type:'int',value:i}}));
 await new Promise(resolve=>setImmediate(resolve));
 for(let i=0;i<total;i++){
  assert.equal(f.calls.length,i+1);
  assert.equal(f.calls[i].procedure,'gp.ReadGuardQueue');
  assert.equal(f.calls[i].parameters?.Sequence.value,i,'assert dispatch order, not only response/promise order');
  assert.equal(f.children.length,1);
  f.reply(i,{sequence:i});
  await new Promise(resolve=>setImmediate(resolve));
 }
 const values=await Promise.all(requests);
 assert.deepEqual(values.map(v=>JSON.parse(v).sequence),Array.from({length:total},(_,i)=>i));
 assert.equal(f.calls.length,total);
});

test('one free worker does not rearm unrelated waiters or extend their queue deadlines',async t=>{
 const timers=t.mock.method(globalThis,'setTimeout'),f=fixture(t,1);
 const requests=Array.from({length:40},()=>f.client.callProcedure('gp.ReadGuardQueue',{}));await new Promise(resolve=>setImmediate(resolve));
 const queueTimers=()=>timers.mock.calls.filter(call=>Number(call.arguments[1])>20000&&Number(call.arguments[1])<=30000).length;
 const before=queueTimers();assert.equal(before,39);f.reply(0);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,2);assert.equal(queueTimers(),before);
 for(let i=1;i<40;i++){f.reply(i);await new Promise(resolve=>setImmediate(resolve));}await Promise.all(requests);assert.equal(queueTimers(),before);
});

test('multiple free slots drain FIFO and worker failure advances only owned queued work',async t=>{
 const f=fixture(t,2),requests=Array.from({length:20},(_,i)=>f.client.callProcedure('gp.ReadGuardQueue',{Sequence:{type:'int',value:i}}));
 const observed=requests.map(p=>p.then(()=>true,()=>false));await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,2);
 f.children[0].emit('error',Error('owned broken pipe'));f.reply(1,{sequence:1});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,4);assert.equal(f.children.length,3);
 for(let start=2;start<20;start+=2){for(let n=start;n<Math.min(start+2,20);n++){assert.equal(f.calls[n].parameters?.Sequence.value,n);f.reply(n,{sequence:n});}await new Promise(resolve=>setImmediate(resolve));}
 const outcomes=await Promise.all(observed);assert.equal(outcomes.filter(Boolean).length,19);assert.equal(f.calls.length,20);assert.equal(f.children[0].kills,1);
});

test('queue cap remains 64 and shutdown promptly rejects every queued caller',async t=>{
 const f=fixture(t,1),outcomes:boolean[]=[],requests=Array.from({length:66},()=>f.client.callProcedure('gp.ReadGuardQueue',{}).then(()=>{outcomes.push(true);},()=>{outcomes.push(false);}));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.children.length,1);assert.equal(f.calls.length,1);assert.deepEqual(outcomes,[false],'one overflow caller must be rejected before shutdown');
 await f.client.close();await Promise.all(requests);assert.equal(outcomes.length,66);assert(outcomes.every(value=>value===false));assert.equal(f.calls.length,1);assert.equal(f.children[0].kills,1);
});
