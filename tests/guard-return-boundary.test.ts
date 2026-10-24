import test from'node:test';import assert from'node:assert/strict';import{randomBytes}from'node:crypto';import{ActionCentreService}from'../src/operations/ActionCentreService.ts';
const session={sessionToken:randomBytes(32).toString('base64url'),csrfToken:randomBytes(32).toString('base64url')},scope={workspace:'GUARD',locationId:1,dutyKind:'PROJECT',dutyId:'1'};
test('guard cannot request the reception return-follow-up category, including direct API payloads',async()=>{
 let calls=0;const service=new ActionCentreService({async callProcedure(){calls++;return'{}';}});
 await assert.rejects(service.read(session,{...scope,category:'UNRETURNED'}),{code:'NOT_AUTHORIZED'});assert.equal(calls,0);
});
test('guard follow-up counts cannot disclose a reception return backlog from a malformed SQL response',async()=>{
 let unreturned=0;const service=new ActionCentreService({async callProcedure(){return JSON.stringify({category:'PENDING',checkedAtUtc:'2026-10-24T00:00:00.000Z',counts:{pending:0,expiredInside:0,unreturned},items:[],hasMore:false});}});
 assert.deepEqual((await service.read(session,{...scope,category:'PENDING'})).counts,{pending:0,expiredInside:0,unreturned:0});
 unreturned=12;await assert.rejects(service.read(session,{...scope,category:'PENDING'}),{code:'UNAVAILABLE'});
});
