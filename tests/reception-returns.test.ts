import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {ReceptionService} from '../src/reception/ReceptionService.ts';
const session={sessionToken:randomBytes(32).toString('base64url'),csrfToken:randomBytes(32).toString('base64url')};
const body=()=>({clientKey:randomUUID(),visitRequestId:randomUUID(),expectedPassId:randomUUID()});
test('pass return binds visit and current credential with a stable client key and projects only a receipt',async()=>{
 const input=body();let calls=0;const s=new ReceptionService({async callProcedure(name,p){calls++;assert.equal(name,'gp.ReturnReceptionPass');assert.equal(p.ClientKey.value,input.clientKey);assert.equal(p.ExpectedPassId.value,input.expectedPassId);assert.equal(p.VisitRequestId.value,input.visitRequestId);assert.equal((p.SessionHash.value as Buffer).length,32);return JSON.stringify({visitRequestId:input.visitRequestId,accessPassId:input.expectedPassId,returnedAtUtc:'2026-10-22T12:00:00.000Z',privateActor:'drop'});}});
 const r=await s.returnPass(session,input);assert.equal(r.returnedAtUtc,'2026-10-22T12:00:00.000Z');assert.equal(Object.keys(r).length,3);assert.equal(calls,1);
});
test('return rejects invalid and caller supplied identity fields before SQL',async()=>{
 let calls=0;const s=new ReceptionService({async callProcedure(){calls++;return '{}';}});
 for(const input of [{...body(),actorId:randomUUID()},{...body(),expectedPassId:'bad'},{...body(),clientKey:null},{visitRequestId:randomUUID()}])await assert.rejects(s.returnPass(session,input),{code:'INVALID_INPUT'});
 assert.equal(calls,0);
});
test('return redacts failures and distinguishes inside, changed and unauthorized operations',async()=>{
 for(const [number,code] of [[54504,'INSIDE_PROJECT'],[54503,'CONFLICT'],[54502,'INVALID_INPUT'],[53501,'NOT_AUTHORIZED'],[52001,'NOT_AUTHORIZED'],[1,'UNAVAILABLE']]){
 const s=new ReceptionService({async callProcedure(){throw{number};}});await assert.rejects(s.returnPass(session,body()),{code});}
 const input=body();for(const result of [{visitRequestId:randomUUID(),accessPassId:input.expectedPassId,returnedAtUtc:'2026-10-22T12:00:00.000Z'},{visitRequestId:input.visitRequestId,accessPassId:input.expectedPassId,returnedAtUtc:'bad'}])await assert.rejects(new ReceptionService({async callProcedure(){return JSON.stringify(result);}}).returnPass(session,input),{code:'UNAVAILABLE'});
});
test('pending return listing sends a typed office scoped queue selector and validates it',async()=>{
 let calls=0;const s=new ReceptionService({async callProcedure(name,p){calls++;assert.equal(name,'gp.ListReceptionVisits');assert.equal(p.PendingReturns.value,true);return JSON.stringify({visits:[],visitDate:'2026-10-22',hasMore:false,pendingReturnCount:7});}});
 assert.equal((await s.list(session,{locationId:1,pendingReturns:true})).pendingReturnCount,7);
 await assert.rejects(s.list(session,{locationId:1,pendingReturns:'all'}),{code:'INVALID_INPUT'});assert.equal(calls,1);
});
