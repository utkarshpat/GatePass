import test from 'node:test';
import assert from 'node:assert/strict';
import {LoadDiagnostics} from '../src/development/LoadDiagnostics.ts';

test('bounded latency telemetry reflects recent load rather than first 10000 samples forever',()=>{
 const d=new LoadDiagnostics();
 try{
  for(let i=0;i<10000;i++)d.record({procedure:'gp.ReadGuardQueue',queueMs:1,rpcMs:10,bridge:{executeMs:8}});
  for(let i=0;i<10000;i++)d.record({procedure:'gp.ReadGuardQueue',queueMs:1,rpcMs:1000,bridge:{executeMs:900}});
  const row=d.snapshot().rpc[0];
  assert.equal(row.count,20000);
  assert.equal(row.timings.rpcMs.samples,10000);
  assert.equal(row.timings.rpcMs.p95Ms,1000);
  assert.equal(row.timings.executeMs.p95Ms,900);
  d.snapshot(true);
  assert.equal(d.snapshot().rpc.length,0);
 }finally{d.close();}
});

test('rolling metric cursors stay independent, full error counts survive wraps and reset clears both',()=>{
 const d=new LoadDiagnostics();try{
  for(let i=0;i<25005;i++)d.record({procedure:'gp.ReadGuardQueue',queueMs:i,rpcMs:i,sqlError:1205,...(i%2===0?{bridge:{executeMs:i}}:{})});
  const snapshot=d.snapshot(),row=snapshot.rpc[0];assert.deepEqual(snapshot.latencySamplePolicy,{kind:'rolling',maximumSamplesPerMetric:10000});assert.equal(row.count,25005);assert.equal(row.errors['1205'],25005);
  assert.equal(row.timings.rpcMs.samples,10000);assert.equal(row.timings.rpcMs.meanMs,(15005+25004)/2);assert.equal(row.timings.executeMs.samples,10000);assert.equal(row.timings.executeMs.meanMs,(5006+25004)/2);
  d.snapshot(true);d.record({procedure:'gp.ReadGuardQueue',queueMs:1,rpcMs:2});const after=d.snapshot().rpc[0];assert.equal(after.count,1);assert.deepEqual(after.errors,{});assert.equal(after.timings.rpcMs.samples,1);assert.equal(after.timings.rpcMs.p95Ms,2);
 }finally{d.close();}
});
