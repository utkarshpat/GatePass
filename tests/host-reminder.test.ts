import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {HostReminderService} from '../src/email/HostReminderService.ts';
const session={sessionToken:randomBytes(32).toString('base64url'),csrfToken:randomBytes(32).toString('base64url')};
const visitRequestId=randomUUID();
const result={outcome:'QUEUED',mailStatus:'QUEUED',eligible:true,lastQueuedAtUtc:'2026-10-22T07:00:00.000Z',nextReminderAtUtc:'2026-10-22T07:05:00.000Z'};
test('reminder binds the signed-in identity, view and immutable request; strips private output',async()=>{
 const service=new HostReminderService({async callProcedure(name,p){assert.equal(name,'gp.RemindVisitHost');assert.equal(p.View.value,'RECEPTION');assert.equal((p.SessionHash.value as Buffer).length,32);assert.equal(p.VisitRequestId.value,visitRequestId);return JSON.stringify({...result,recipientEmail:'private'});}});
 assert.deepEqual(await service.run(session,{visitRequestId,clientKey:randomUUID()},'RECEPTION'),result);
});
test('guard reminders require a project duty and cannot accept an email or impersonated host',async()=>{
 let count=0;const service=new HostReminderService({async callProcedure(){count++;return JSON.stringify(result);}});
 for(const d of [{visitRequestId},{visitRequestId,locationId:1,dutyKind:'COMMON',dutyId:'1'},{visitRequestId,locationId:1,dutyKind:'PROJECT',dutyId:'1',email:'other@example.com'}])await assert.rejects(service.run(session,d,'GUARD'));
 assert.equal(count,0);assert.deepEqual(await service.run(session,{visitRequestId,locationId:1,dutyKind:'PROJECT',dutyId:'1'},'GUARD'),result);
});
test('reminder state conflicts, denial and malformed output fail closed',async()=>{
 for(const [number,status] of [[52001,403],[53501,403],[52003,409],[52004,409],[52002,400],[99999,503]]){const service=new HostReminderService({async callProcedure(){throw {number};}});await assert.rejects(service.run(session,{visitRequestId},'RECEPTION'),{status});}
 const service=new HostReminderService({async callProcedure(){return JSON.stringify({...result,mailStatus:'DELIVERED'});}});await assert.rejects(service.run(session,{visitRequestId},'RECEPTION'),{status:503});
});
