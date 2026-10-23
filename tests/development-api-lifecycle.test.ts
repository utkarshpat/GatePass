import test from 'node:test';import type{TestContext}from'node:test';import assert from'node:assert/strict';
import{EventEmitter}from'node:events';import{PassThrough}from'node:stream';import type{spawn}from'node:child_process';
import{LocalDevelopmentApiClient}from'../src/development/LocalDevelopmentApiClient.ts';
class FakeChild extends EventEmitter{
 stdin=new PassThrough();stdout=new PassThrough();stderr=new PassThrough();kills=0;
 ref(){return this;}unref(){return this;}kill(){this.kills++;queueMicrotask(()=>this.emit('close',0));return true;}
}
function fixture(t:TestContext){
 const env={NODE_ENV:process.env.NODE_ENV,GATEPASS_SSO_MODE:process.env.GATEPASS_SSO_MODE,GATEPASS_DIRECTORY_MODE:process.env.GATEPASS_DIRECTORY_MODE};
 Object.assign(process.env,{NODE_ENV:'test',GATEPASS_SSO_MODE:'dummy',GATEPASS_DIRECTORY_MODE:'mock'});
 const children:FakeChild[]=[],calls:{child:FakeChild;procedure:string}[]=[];
 const client=new LocalDevelopmentApiClient(()=>{const child=new FakeChild();children.push(child);child.stdin.on('data',chunk=>calls.push({child,...JSON.parse(chunk.toString())}));return child as unknown as ReturnType<typeof spawn>;});
 t.after(()=>{client.close();for(const[key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 const reply=(index:number,result:unknown={ok:true})=>calls[index].child.stdout.write(JSON.stringify({result:JSON.stringify(result)})+'\n');
 return{client,children,calls,reply};
}

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
 t.mock.timers.tick(89999);assert.equal(f.children[0].kills,0);t.mock.timers.tick(1);assert.equal(f.children[0].kills,1);
 const later=f.client.callProcedure('gp.GetOwnDigitalIdCard',{});await Promise.resolve();f.reply(2);await later;assert.equal(f.children.length,2);
});
test('burst helpers retire after five seconds while one retained helper remains; a fifth call waits',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t),requests=Array.from({length:5},()=>f.client.callProcedure('gp.GetOwnDigitalIdCard',{}));
 await Promise.resolve();assert.equal(f.children.length,4);assert.equal(f.calls.length,4);f.reply(0);await requests[0];await Promise.resolve();assert.equal(f.calls.length,5);
 for(let i=1;i<5;i++)f.reply(i);await Promise.all(requests);
 t.mock.timers.tick(5000);assert.equal(f.children[0].kills,0);assert.ok(f.children.slice(1).every(c=>c.kills===1));
 t.mock.timers.tick(85000);assert.equal(f.children[0].kills,1);
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
