import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type RequestListener} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {batch,http,openSse,requireFreePort,requireLoad,requireRace,requireSse,statistics} from '../tools/load-stress/Support.ts';
import {LoadDiagnostics} from '../src/development/LoadDiagnostics.ts';
import {mixedLoad} from '../tools/load-stress/Mixed.ts';
import {exportPressure} from '../tools/load-stress/ExportPressure.ts';

for(const finalStatus of [409,500])test('export pressure '+(finalStatus===409?'retains expected HTTP 409 and cleans its owned snapshots':'fails on unexpected finish errors'),async t=>{
 const snapshotId='11111111-1111-4111-8111-111111111111';let finalizations=0,cancellations=0;
 const port=await server(t,(req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{const d=JSON.parse(Buffer.concat(chunks).toString());res.setHeader('Content-Type','application/json');
  if(d.cancelExport){cancellations++;res.end(JSON.stringify({cancelled:true}));return;}
  if(d.finishExport){finalizations++;res.writeHead(finalStatus);res.end('{}');return;}
  res.end(JSON.stringify({exportSnapshotId:snapshotId,datasetVersion:'a'.repeat(64),page:d.page,pageSize:200,total:1000,rows:Array(200).fill({})}));
 });});
 let writes=0;const execute=()=>exportPressure(port,{}, {locationId:1,from:'2026-10-25',to:'2026-10-25'},async()=>{await delay(1);return{latencyMs:1,statusCode:200,success:true};},async()=>{writes++;await delay(2);return{latencyMs:2,statusCode:200,success:true};},5000);
 if(finalStatus===409){const r=await execute();assert.equal(writes,100);assert(r.exports.changed>0);assert.equal(r.reads.statusCodes['409'],r.exports.changed);assert.equal(r.reads.errors,0);assert.equal(cancellations,r.exports.cancelled);}
 else await assert.rejects(execute());
 assert(finalizations>0);assert(cancellations>0);
});

test('mixed load keeps writes ordered under overlapping readers and drains before returning',async()=>{
 let reading=0,maximumReaders=0,writing=false;const order:number[]=[];
 const result=await mixedLoad(async()=>{reading++;maximumReaders=Math.max(maximumReaders,reading);await delay(3);reading--;return{latencyMs:3,statusCode:200,success:true};},async index=>{assert(!writing);writing=true;assert(reading>0);await delay(5);order.push(index);writing=false;return{latencyMs:5,statusCode:200,success:true};},12,3);
 assert.deepEqual(order,Array.from({length:12},(_,n)=>n));assert.equal(maximumReaders,3);assert.equal(reading,0);assert(result.reads.total>0);requireLoad(result.reads,5000);requireLoad(result.writes,5000);
});

test('mixed load stops on uncertain writes without replay and retains read failures',async()=>{
 let attempts=0;const result=await mixedLoad(async()=>{await delay(1);throw Error('read failed');},async()=>{attempts++;await delay(3);throw Error('write outcome unknown');},100,2);
 assert.equal(attempts,1);assert.equal(result.writes.total,1);assert.equal(result.writes.errors,1);assert(result.reads.errors>0);assert.throws(()=>requireLoad(result.writes,5000));
});

async function server(t:TestContext,handle:RequestListener){
 const instance=createServer(handle);await new Promise<void>(resolve=>instance.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise<void>(resolve=>{instance.closeAllConnections();instance.close(()=>resolve());}));
 const address=instance.address();assert(address&&typeof address==='object');return address.port;
}
test('load gates reject unavailable service, excessive latency and unexpected HTTP status',async()=>{
 const result=await batch(async()=>{await delay(15);throw Error('offline');},4,2);
 assert.equal(result.errors,4);assert(result.latency.min>=10);assert.throws(()=>requireLoad(result,5000),/LOAD_UNEXPECTED_RESPONSE/u);
 const bad=await batch(async()=>({latencyMs:10,statusCode:500,success:true}),2,1);assert.throws(()=>requireLoad(bad,5000));
 const slow=await batch(async()=>({latencyMs:5001,statusCode:200,success:true}),2,1);assert.throws(()=>requireLoad(slow,5000),/LOAD_P95/u);
});
test('percentiles use nearest rank and invalid samples are rejected',()=>{
 assert.equal(statistics(Array.from({length:100},(_,n)=>n+1)).p95,95);
 assert.equal(statistics([10,20]).p50,10);assert.throws(()=>statistics([NaN]));
});
test('race success requires one committed entry, one occupant and eleven conflicts',()=>{
 const statuses=[200,...Array(11).fill(409)];requireRace(statuses,1,1);
 assert.throws(()=>requireRace([200,...Array(11).fill(500)],1,1));
 assert.throws(()=>requireRace(statuses,2,1));assert.throws(()=>requireRace(statuses,1,2));
});
test('SSE capacity cannot pass when every attempted connection was invalid',()=>{
 assert.throws(()=>requireSse([400,400,400],[200,200,429]));assert.throws(()=>requireSse([],[200,200,429]));
 requireSse([200,200,429],[200,200,429]);
});
test('HTTP deadline covers a stalled body after successful headers',async t=>{
 const port=await server(t,(_req,res)=>{res.writeHead(200);res.write('partial');});
 const start=performance.now();await assert.rejects(http(port,'/',{timeoutMs:50}),/LOAD_REQUEST_TIMEOUT/u);assert(performance.now()-start<1500);
});
test('HTTP rejects a truncated response and bounds response memory',async t=>{
 const port=await server(t,(req,res)=>{if(req.url==='/large'){res.end('x'.repeat(200));return;}res.writeHead(200,{'Content-Length':100});res.write('short');setImmediate(()=>res.destroy());});
 await assert.rejects(http(port,'/broken'),/LOAD_RESPONSE_(ABORTED|ERROR)/u);
 await assert.rejects(http(port,'/large',{maximumBytes:100}),/LOAD_RESPONSE_TOO_LARGE/u);
});
test('SSE acceptance requires a ready event and closes its owned socket',async t=>{
 let closed=false;const port=await server(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('event: ready\ndata: {}\n\n');res.on('close',()=>{closed=true;});});
 const stream=await openSse(port,{},{});assert.equal(stream.status,200);stream.close();
 for(let n=0;n<20&&!closed;n++)await delay(10);assert(closed);
});
test('SSE refuses JSON pretending to be success and times out before readiness',async t=>{
 const wrong=await server(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');});
 await assert.rejects(openSse(wrong,{},{}),/SSE_BAD_CONTENT_TYPE/u);
 const stalled=await server(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': ping\n\n');});
 await assert.rejects(openSse(stalled,{},{},50),/SSE_READY_TIMEOUT/u);
});
test('port ownership preflight rejects an existing server',async t=>{
 const port=await server(t,(_req,res)=>res.end());await assert.rejects(requireFreePort(port),/LOAD_PORT_IN_USE/u);
});
test('a busy port fails the command and writes evidence without creating SQL fixtures',async t=>{
 const port=await server(t,(_req,res)=>res.end());
 let output='';await assert.rejects(promisify(execFile)(process.execPath,['tools/run-load-stress-test.ts','--port',String(port)],{timeout:15000}),(error:any)=>{output=error.stdout;return error.code===1;});
 const runId=/LOAD_RUN ([a-f0-9-]{36})/u.exec(output)?.[1];assert(runId);
 const report=JSON.parse(await readFile(join('output/load-stress',runId,'report.json'),'utf8'));
 assert.equal(report.status,'FAIL');assert.equal(report.failure,'LOAD_PORT_IN_USE');assert.equal(report.fixture,undefined);assert.equal(report.cleanup.fixture,undefined);assert.deepEqual(report.cleanup.errors,[]);
});
test('diagnostics retain bounded stage timings without raw values and reset error counts',()=>{
 const diagnostics=new LoadDiagnostics();try{
  for(let n=0;n<10001;n++)diagnostics.record({procedure:'gp.ReadGuardQueue',queueMs:2,rpcMs:8,sqlError:1205,bridge:{executeMs:7,password:123}});
  const row=diagnostics.snapshot(true).rpc[0];assert.equal(row.count,10001);assert.equal(row.errors['1205'],10001);assert.equal(row.timings.executeMs.samples,10000);assert.equal(row.timings.password,undefined);
  assert.deepEqual(diagnostics.snapshot().rpc,[]);
 }finally{diagnostics.close();}
});
