import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {ReceptionService} from '../src/reception/ReceptionService.ts';
const session={sessionToken:randomBytes(32).toString('base64url'),csrfToken:randomBytes(32).toString('base64url')};
const movement={accessEventId:'1',eventType:'ENTRY',entryMethod:'SCAN',guardName:'Scoped Guard',projectName:'Scoped Project',occurredAtUtc:'2026-10-22T07:00:00.000Z'};
test('reception timeline passes only current session and visit identity and projects trusted fields',async()=>{
 const service=new ReceptionService({async callProcedure(name,p){assert.equal(name,'gp.GetReceptionEmployeeTimeline');assert.deepEqual(Object.keys(p).sort(),['CsrfHash','SessionHash','VisitRequestId']);assert.equal((p.SessionHash.value as Buffer).length,32);return JSON.stringify({isInside:true,movements:[{...movement,privateKey:'must drop'}],movementsHasMore:false,rawActor:'must drop'});}});
 assert.deepEqual(await service.timeline(session,randomUUID()),{isInside:true,movements:[movement],movementsHasMore:false});
});
test('malformed or inconsistent timeline output cannot be partially trusted',async()=>{
 let packet:any;const service=new ReceptionService({async callProcedure(){return JSON.stringify(packet);}});
 for(const patch of [{isInside:'true'}, {movementsHasMore:true},{movements:[{...movement,accessEventId:'0'}]},{movements:[{...movement,eventType:'GRANT'}]},{movements:[{...movement,projectName:''}]},{movements:[{...movement,occurredAtUtc:'yesterday'}]}]){packet={isInside:false,movements:[movement],movementsHasMore:false,...patch};await assert.rejects(service.timeline(session,randomUUID()),{code:'UNAVAILABLE'});}
});
test('timeline denial and bad visit identity are never converted into empty successful history',async()=>{
 let calls=0;const service=new ReceptionService({async callProcedure(){calls++;throw{number:53501};}});await assert.rejects(service.timeline(session,'not-a-visit'),{code:'INVALID_INPUT'});assert.equal(calls,0);await assert.rejects(service.timeline(session,randomUUID()),{code:'NOT_AUTHORIZED'});
});
