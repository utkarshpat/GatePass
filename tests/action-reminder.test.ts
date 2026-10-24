import test from'node:test';import assert from'node:assert/strict';import{randomUUID,randomBytes}from'node:crypto';import{ActionCentreService}from'../src/operations/ActionCentreService.ts';
const session={sessionToken:randomBytes(32).toString('base64url'),csrfToken:randomBytes(32).toString('base64url')},scope={workspace:'GUARD',locationId:1,dutyKind:'COMMON',dutyId:'1',visitRequestId:randomUUID(),clientKey:randomUUID()},packet={outcome:'QUEUED',mailStatus:'QUEUED',eligible:true,lastQueuedAtUtc:'2026-10-24T09:30:00.000Z',nextReminderAtUtc:'2026-10-24T09:35:00.000Z'};
test('inline reminder binds current identity, immutable visit and concrete common/project/office scope',async()=>{
 for(const data of [scope,{...scope,dutyKind:'PROJECT'},{...scope,workspace:'RECEPTION',dutyKind:'OFFICE',dutyId:'0'},{...scope,workspace:'ADMIN',dutyKind:'OFFICE',dutyId:'0'}]){
  const service=new ActionCentreService({async callProcedure(name,p){assert.equal(name,'gp.RemindPendingApproval');assert.equal((p.SessionHash.value as Buffer).length,32);assert.equal(p.Workspace.value,data.workspace);assert.equal(p.DutyKind.value,data.dutyKind);assert.equal(p.ClientKey.value,scope.clientKey);assert.equal(p.VisitRequestId.value,scope.visitRequestId);return JSON.stringify({...packet,email:'private',approvalToken:'private'});}});assert.deepEqual(await service.remind(session,data),packet);
 }
});
test('inline reminder rejects recipient/actor injection, ALL and malformed IDs before SQL',async()=>{
 let calls=0;const service=new ActionCentreService({async callProcedure(){calls++;return'{}';}});
 for(const patch of [{email:'other@example.invalid'},{actorUserId:randomUUID()},{category:'PENDING'},{workspace:'OWN'},{dutyKind:'ALL'},{dutyId:'0'},{dutyId:'9223372036854775808'},{locationId:2147483648},{visitRequestId:'bad'},{clientKey:'bad'}])await assert.rejects(service.remind(session,{...scope,...patch}),{code:'INVALID_INPUT'});assert.equal(calls,0);
});
test('inline reminder strips SQL detail from scope/conflict failures and validates queue status',async()=>{
 for(const[number,code]of [[52001,'NOT_AUTHORIZED'],[53501,'NOT_AUTHORIZED'],[52002,'INVALID_INPUT'],[52003,'CONFLICT'],[52004,'CONFLICT'],[99999,'UNAVAILABLE']] as const){await assert.rejects(new ActionCentreService({async callProcedure(){throw{number,message:'private SQL and email'};}}).remind(session,scope),{code,message:code});}
 for(const patch of [{outcome:'SENT'},{mailStatus:'DELIVERED'},{eligible:'true'},{nextReminderAtUtc:'bad'}])await assert.rejects(new ActionCentreService({async callProcedure(){return JSON.stringify({...packet,...patch});}}).remind(session,scope),{code:'UNAVAILABLE'});
});
