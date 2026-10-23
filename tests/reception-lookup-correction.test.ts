import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {ReceptionService} from '../src/reception/ReceptionService.ts';
const session={sessionToken:randomBytes(32).toString('base64url'),csrfToken:randomBytes(32).toString('base64url')};
const match={visitRequestId:randomUUID(),personName:'Test Visitor',publicReference:'V-TEST',publicPassNumber:'P-TEST',requestType:'EXTERNAL',status:'APPROVED',submittedAtUtc:'2026-10-21T00:00:00.000Z'};
const correction={visitRequestId:match.visitRequestId,expectedPassId:randomUUID(),expectedReturnedAtUtc:'2026-10-22T00:00:00.000Z',clientKey:randomUUID(),reason:'Marked returned by mistake'};
function fixture(result:any){const calls:any[]=[];return{calls,service:new ReceptionService({async callProcedure(name,p){calls.push({name,p});return JSON.stringify(result);}})};}
test('reception lookup binds office and hashes opaque QR bytes; public results exclude secrets',async()=>{
 const f=fixture({matches:[{...match,credentialHash:'DROP'}],hasMore:false}),credential=randomBytes(32).toString('base64url');assert.deepEqual(await f.service.lookup(session,{locationId:1,credential}),{matches:[match],cursor:null});assert.equal(f.calls[0].name,'gp.LookupReceptionVisits');assert.deepEqual(f.calls[0].p.CredentialHash.value,createHash('sha256').update(Buffer.from(credential,'base64url')).digest());assert.equal(f.calls[0].p.Search.value,null);
 await f.service.lookup(session,{locationId:1,search:' Visitor '});assert.equal(f.calls[1].p.Search.value,'Visitor');
 for(const input of [{locationId:0,search:'test'},{locationId:1},{locationId:1,search:'a'},{locationId:1,search:'x\n'},{locationId:1,credential:'bad'},{locationId:1,credential,search:'test'},{locationId:1,search:'test',actorId:randomUUID()},{locationId:1,search:'test',cursor:{} }])await assert.rejects(f.service.lookup(session,input),{code:'INVALID_INPUT'});
});
test('lookup validates bounded pages, row shape and coherent next-page cursors',async()=>{
 for(const result of [{matches:[{...match,visitRequestId:'bad'}],hasMore:false},{matches:[match,match],hasMore:false},{matches:[match],hasMore:true},{matches:[],hasMore:'yes'},{matches:[{...match,status:'SECRET'}],hasMore:false}])await assert.rejects(fixture(result).service.lookup(session,{locationId:1,search:'test'}),{code:'UNAVAILABLE'});
 const rows=Array.from({length:20},()=>({...match,visitRequestId:randomUUID()}));const last=rows.at(-1)!;const f=fixture({matches:rows,hasMore:true,afterVisitRequestId:last.visitRequestId,afterSubmittedAtUtc:last.submittedAtUtc});const r=await f.service.lookup(session,{locationId:1,search:'test',cursor:{visitRequestId:last.visitRequestId,submittedAtUtc:last.submittedAtUtc}});assert.deepEqual(r.cursor,{visitRequestId:last.visitRequestId,submittedAtUtc:last.submittedAtUtc});
});
test('return correction binds the expected receipt and reason with an idempotency key',async()=>{
 const result={visitRequestId:correction.visitRequestId,accessPassId:correction.expectedPassId,correctedAtUtc:'2026-10-22T00:01:00.000Z'},f=fixture({...result,reason:'DROP'});assert.deepEqual(await f.service.correctReturn(session,correction),result);assert.equal(f.calls[0].name,'gp.CorrectReceptionReturn');assert.equal(f.calls[0].p.ExpectedReturnedAtUtc.value,correction.expectedReturnedAtUtc);assert.equal(f.calls[0].p.ClientKey.value,correction.clientKey);
 for(const patch of [{reason:'bad'},{reason:'x'.repeat(301)},{expectedReturnedAtUtc:'bad'},{expectedPassId:'bad'},{actorId:randomUUID()}])await assert.rejects(f.service.correctReturn(session,{...correction,...patch}),{code:'INVALID_INPUT'});
 await assert.rejects(fixture({...result,accessPassId:randomUUID()}).service.correctReturn(session,correction),{code:'UNAVAILABLE'});
 for(const [number,code] of [[53501,'NOT_AUTHORIZED'],[54503,'CONFLICT'],[54504,'INSIDE_PROJECT'],[54502,'INVALID_INPUT'],[999,'UNAVAILABLE']] as const){const service=new ReceptionService({async callProcedure(){throw{number};}});await assert.rejects(service.correctReturn(session,correction),{code});}
});
