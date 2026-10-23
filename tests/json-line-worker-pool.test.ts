import test from 'node:test';import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {JsonLineWorkerPool} from '../src/development/JsonLineWorkerPool.ts';
class FakeChild extends EventEmitter{
 stdin=new PassThrough();stdout=new PassThrough();stderr=new PassThrough();killed=false;
 ref(){return this;}unref(){return this;}kill(){this.killed=true;queueMicrotask(()=>this.emit('close',0));return true;}
}
function fixture(t:TestContext,options:ConstructorParameters<typeof JsonLineWorkerPool>[1]={}){
 const children:FakeChild[]=[],sent:{child:FakeChild;id:string;request:any}[]=[];
 const pool=new JsonLineWorkerPool(()=>{const child=new FakeChild();children.push(child);child.stdin.on('data',part=>sent.push({child,...JSON.parse(part.toString())}));return child as unknown as ChildProcessWithoutNullStreams;},options);
 t.after(()=>pool.close());
 const reply=(index:number,result:Record<string,unknown>)=>{const call=sent[index];call.child.stdout.write(JSON.stringify({id:call.id,result})+'\n');};
 return{pool,children,sent,reply};
}
test('sequential requests reuse one process and fragmented Unicode responses retain their request binding',async t=>{
 const f=fixture(t,{maximumWorkers:1});const first=f.pool.call({action:'inspect'}),second=f.pool.call({action:'touch'});
 assert.equal(f.children.length,1);assert.equal(f.sent.length,1);
 const bytes=Buffer.from(JSON.stringify({id:f.sent[0].id,result:{name:'किरण'}})+'\n'),split=bytes.indexOf(Buffer.from('क'))+1;
 f.children[0].stdout.write(bytes.subarray(0,split));f.children[0].stdout.write(bytes.subarray(split));
 assert.deepEqual(await first,{name:'किरण'});assert.equal(f.sent.length,2);f.reply(1,{ok:true});assert.deepEqual(await second,{ok:true});assert.notEqual(f.sent[0].id,f.sent[1].id);
});
test('worker count is bounded and waiting requests progress when a worker becomes free',async t=>{
 const f=fixture(t,{maximumWorkers:2}),reads=[f.pool.call({n:1}),f.pool.call({n:2}),f.pool.call({n:3})];
 assert.equal(f.children.length,2);assert.equal(f.sent.length,2);f.reply(1,{n:2});assert.equal(f.sent.length,3);assert.equal(f.sent[2].request.n,3);f.reply(2,{n:3});f.reply(0,{n:1});assert.deepEqual(await Promise.all(reads),[{n:1},{n:2},{n:3}]);
});
test('a wrong response ID rejects the affected request and never replays it or hands late data to the next caller',async t=>{
 const f=fixture(t,{maximumWorkers:1});const first=assert.rejects(f.pool.call({action:'create'}),/UNAVAILABLE/u),second=f.pool.call({action:'inspect'});
 const old=f.sent[0];old.child.stdout.write(JSON.stringify({id:'wrong',result:{ok:true}})+'\n');await first;
 assert.equal(old.child.killed,true);assert.equal(f.sent.filter(x=>x.request.action==='create').length,1);assert.equal(f.children.length,2);
 old.child.stdout.write(JSON.stringify({id:old.id,result:{person:'old response'}})+'\n');f.reply(1,{person:'current response'});assert.deepEqual(await second,{person:'current response'});
});
test('malformed, oversized, array and duplicate output fail closed',async t=>{
 for(const bad of ['invalid json',JSON.stringify({id:'valid',result:[]}),JSON.stringify({id:'valid',result:{}})+'\nextra','x'.repeat(1048577)]){
  const f=fixture(t,{maximumWorkers:1}),rejection=assert.rejects(f.pool.call({action:'logout'}),/UNAVAILABLE/u);
  f.children[0].stdout.write(bad.replace('valid',f.sent[0].id)+'\n');await rejection;assert.equal(f.children[0].killed,true);assert.equal(f.sent.length,1);f.pool.close();
 }
});
test('execution timeout destroys its worker without replaying an ambiguous mutation',async t=>{
 const f=fixture(t,{maximumWorkers:1,requestMs:20});await assert.rejects(f.pool.call({action:'create'}),/UNAVAILABLE/u);assert.equal(f.sent.length,1);assert.equal(f.children[0].killed,true);
 const next=f.pool.call({action:'inspect'});f.reply(1,{ok:true});assert.deepEqual(await next,{ok:true});
});
test('queue capacity and queued-request deadlines are bounded independently of an active operation',async t=>{
 const f=fixture(t,{maximumWorkers:1,maximumQueued:1,queueMs:20,requestMs:1000});
 const active=assert.rejects(f.pool.call({action:'inspect'}),/UNAVAILABLE/u),queued=assert.rejects(f.pool.call({action:'touch'}),/BUSY/u);
 await assert.rejects(f.pool.call({action:'list'}),/BUSY/u);await queued;assert.equal(f.sent.length,1);f.pool.close();await active;
});
test('close rejects pending and queued work, and future requests cannot spawn a process',async t=>{
 const f=fixture(t,{maximumWorkers:1});const first=assert.rejects(f.pool.call({a:1}),/UNAVAILABLE/u),second=assert.rejects(f.pool.call({a:2}),/UNAVAILABLE/u);
 f.pool.close();await Promise.all([first,second]);await assert.rejects(f.pool.call({a:3}),/UNAVAILABLE/u);assert.equal(f.children.length,1);assert.equal(f.children[0].killed,true);
});
test('idle helpers retire and a later request creates a new worker',async t=>{
 const f=fixture(t,{maximumWorkers:1,idleMs:20});const first=f.pool.call({a:1});f.reply(0,{ok:true});await first;
 await new Promise(resolve=>setTimeout(resolve,35));assert.equal(f.children[0].killed,true);const second=f.pool.call({a:2});f.reply(1,{ok:true});await second;assert.equal(f.children.length,2);
});
test('invalid configuration and oversized/circular input are rejected before spawning',async t=>{
 assert.throws(()=>new JsonLineWorkerPool(()=>{throw Error('unused');},{maximumWorkers:0}));const f=fixture(t);await assert.rejects(f.pool.call({text:'x'.repeat(8192)}),/UNAVAILABLE/u);
 const circular:any={};circular.self=circular;await assert.rejects(f.pool.call(circular),/UNAVAILABLE/u);assert.equal(f.children.length,0);
});
