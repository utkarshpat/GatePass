import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/app/reception-print-state.js',import.meta.url),'utf8');
function coordinator(api:any){const c:any={};vm.createContext(c);vm.runInContext(source,c);return new c.ReceptionPrintCoordinator(api);}
const visit=randomUUID(),pass=randomUUID(),id=randomUUID();
function job(status:string){return{printJobId:id,visitRequestId:visit,accessPassId:pass,status,printReason:'FIRST'};}
test('reception checks live status before render and never retries an already dispatched artifact',async()=>{
 const calls:string[]=[];const c=coordinator(async(action:string)=>{calls.push(action);return job(action==='print/request'?'REQUESTED':'DISPATCHED');});
 await assert.rejects(c.handoff(visit,pass,randomUUID),(e:any)=>e.dispatched===true);assert.deepEqual(calls,['print/request','print/status']);assert.equal(c.pending.size,0);
});
test('lost render response reconciles dispatch and next intentional reprint uses a new key',async()=>{
 const keys:string[]=[];let status='REQUESTED',fail=true;const c=coordinator(async(action:string,p:any)=>{
  if(action==='print/request'){keys.push(p.clientKey);status='REQUESTED';return job('REQUESTED');}
  if(action==='print/status')return job(status);
  status='DISPATCHED';if(fail)throw new Error('Response lost');return{printJobId:id,status:'DISPATCHED',mimeType:'image/png',imageBase64:'image'};
 });
 await assert.rejects(c.handoff(visit,pass,randomUUID),(e:any)=>e.dispatched===true);assert.equal(c.pending.size,0);fail=false;await c.handoff(visit,pass,randomUUID);assert.notEqual(keys[0],keys[1]);
});
test('unconfirmed network failure preserves operation key for retry; terminal failed job clears it',async()=>{
 const keys:string[]=[];let fail=true,status='REQUESTED';const c=coordinator(async(action:string,p:any)=>{
  if(action==='print/request'){keys.push(p.clientKey);if(fail)throw new Error('Connection lost');return job('REQUESTED');}
  if(action==='print/status')return job(status);throw new Error('Render failed');
 });
 await assert.rejects(c.handoff(visit,pass,randomUUID));assert.equal(c.pending.size,1);fail=false;status='FAILED';await assert.rejects(c.handoff(visit,pass,randomUUID));assert.equal(keys[0],keys[1]);assert.equal(c.pending.size,0);
});
test('wrong visit/pass live receipt prevents render and preserves unresolved operation',async()=>{
 let rendered=false;const c=coordinator(async(action:string)=>{if(action==='print/render')rendered=true;return action==='print/status'?{...job('REQUESTED'),accessPassId:randomUUID()}:job('REQUESTED');});
 await assert.rejects(c.handoff(visit,pass,randomUUID));assert.equal(rendered,false);assert.equal(c.pending.size,1);c.clear();assert.equal(c.pending.size,0);
});
