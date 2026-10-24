import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID,randomBytes}from'node:crypto';import{Readable}from'node:stream';
import{GuardDutyService}from'../src/visits/GuardDutyService.ts';import{ReceptionService}from'../src/reception/ReceptionService.ts';import{ActionCentreService}from'../src/operations/ActionCentreService.ts';import{GuardRoutes}from'../src/development/GuardRoutes.ts';import{PhotoThumbnails}from'../src/visits/PhotoThumbnails.ts';
const session={sessionToken:randomBytes(32).toString('base64url'),csrfToken:randomBytes(32).toString('base64url')},time='2026-10-24T00:00:00.000Z';
const guardInput={locationId:1,dutyKind:'ALL',queue:'EXPECTED',search:''};
const allocation={kind:'PROJECT',dutyId:'1',name:'Project Alpha'};
const visitor=()=>({visitRequestId:randomUUID(),personName:'Rohan Mehta',publicReference:'V-1',publicPassNumber:'GP-1',requestType:'EXTERNAL',projectName:'Project Alpha',status:'PENDING',passStatus:'PENDING',isInside:false,validUntilUtc:'2026-10-24T18:30:00.000Z',photoAvailable:true,submittedAtUtc:time,allocations:[allocation]});
test('guard keyset queue returns full-filter count and concrete allocations, strips private fields',async()=>{
 const rows=Array.from({length:24},visitor);let calls=0;const service=new GuardDutyService({async callProcedure(name,p){calls++;assert.equal(name,'gp.ReadGuardQueue');assert.equal(p.DutyKind.value,'ALL');assert.equal(p.DutyId.value,null);assert.equal((p.SessionHash.value as Buffer).length,32);return JSON.stringify({visitors:rows.map(v=>({...v,credential:'secret'})),total:100,hasMore:true,afterVisitRequestId:rows.at(-1)!.visitRequestId,afterSubmittedAtUtc:time});}});
 const page=await service.queue(session,guardInput);assert.equal(page.visitors.length,24);assert.equal(page.total,100);assert.deepEqual(page.cursor,{submittedAtUtc:time,visitRequestId:rows.at(-1)!.visitRequestId});assert.deepEqual(page.visitors[0].allocations,[allocation]);assert.ok(!JSON.stringify(page).includes('secret'));assert.equal(calls,1);
});
test('guard queue rejects injected actors, ALL movement scope, malformed cursors and mismatched allocations',async()=>{
 let calls=0;const client={async callProcedure(){calls++;return JSON.stringify({visitors:[visitor()],total:1,hasMore:false});}},service=new GuardDutyService(client);
 for(const patch of [{actorUserId:randomUUID()},{dutyId:'1'},{dutyKind:'PROJECT',dutyId:'0'},{cursor:{submittedAtUtc:time}},{queue:'inside'},{search:'x'.repeat(101)}])await assert.rejects(service.queue(session,{...guardInput,...patch}),{code:'INVALID_INPUT'});assert.equal(calls,0);
 await assert.rejects(service.movement(session,{...guardInput}),{code:'INVALID_INPUT'});
 await assert.rejects(service.queue(session,{...guardInput,dutyKind:'PROJECT',dutyId:'2'}),{code:'UNAVAILABLE'});
});
test('guard malformed totals, duplicate cards, missing allocations and cursor mismatches fail closed',async()=>{
 const row=visitor();for(const patch of [{total:0},{visitors:[row,row],total:2},{visitors:[{...row,allocations:[]}]},{visitors:Array.from({length:24},visitor),total:25,hasMore:true,afterSubmittedAtUtc:time,afterVisitRequestId:randomUUID()}]){
  const service=new GuardDutyService({callProcedure:async()=>JSON.stringify({visitors:[row],total:1,hasMore:false,...patch})});await assert.rejects(service.queue(session,guardInput));
 }
});
test('reception queue binds all SQL filters and uses complete matching counts independently of page size',async()=>{
 const service=new ReceptionService({async callProcedure(name,p){assert.equal(name,'gp.ReadReceptionQueue');assert.equal(p.Status.value,'REVOKED');assert.equal(p.TypeFilter.value,'VISITOR');assert.equal(p.PrintFilter.value,'PRINTED');assert.equal(p.InsideOnly.value,true);return JSON.stringify({visits:[],visitDate:'2026-10-24',hasMore:false,pendingReturnCount:17,counts:{total:0,pending:0,inside:0},private:'secret'});}});
 assert.deepEqual(await service.queue(session,{locationId:1,status:'REVOKED',typeFilter:'VISITOR',printFilter:'PRINTED',insideOnly:true}),{visits:[],visitDate:'2026-10-24',pendingReturnCount:17,cursor:null,counts:{total:0,pending:0,inside:0}});
});
test('reception queue rejects bad filters before SQL and malformed aggregate metadata',async()=>{
 let calls=0;const service=new ReceptionService({async callProcedure(){calls++;return'{}';}});
 for(const patch of [{insideOnly:1},{typeFilter:'ANY'},{printFilter:'ALL '},{actor:'admin'},{visitDate:'2026-02-30'},{cursor:{submittedAtUtc:time,visitRequestId:'bad'}}])await assert.rejects(service.queue(session,{locationId:1,...patch}),{code:'INVALID_INPUT'});assert.equal(calls,0);
 for(const counts of [{total:1,pending:2,inside:0},{total:0,pending:0,inside:-1},{total:'0',pending:0,inside:0}])await assert.rejects(new ReceptionService({callProcedure:async()=>JSON.stringify({visits:[],visitDate:'2026-10-24',hasMore:false,counts})}).queue(session,{locationId:1}),{code:'UNAVAILABLE'});
});
const actionInput={workspace:'RECEPTION',locationId:1,dutyKind:'OFFICE',dutyId:'0',category:'UNRETURNED'};
const actionPacket={category:'UNRETURNED',checkedAtUtc:time,counts:{pending:3,expiredInside:1,unreturned:15},items:[{visitRequestId:randomUUID(),personName:'Asha Rao',visitDate:'2026-10-23',publicReference:'V-A',publicPassNumber:'GP-A',submittedAtUtc:time}],hasMore:false};
test('action centre projects dated bounded rows, only scoped typed RPC, and no card credentials',async()=>{
 const service=new ActionCentreService({async callProcedure(name,p){assert.equal(name,'gp.ReadActionCentre');assert.equal(p.Workspace.value,'RECEPTION');assert.equal(p.DutyId.value,'0');return JSON.stringify({...actionPacket,secret:'secret',items:actionPacket.items.map(v=>({...v,photoKey:'private'}))});}});const r=await service.read(session,actionInput);assert.equal(r.items[0].visitDate,'2026-10-23');assert.deepEqual(r.counts,actionPacket.counts);assert.equal(r.cursor,null);assert.ok(!JSON.stringify(r).includes('private'));
});
test('action centre rejects forged identity, invalid workspace and ALL before reaching SQL',async()=>{
 let calls=0;const service=new ActionCentreService({async callProcedure(){calls++;return'{}';}});for(const patch of [{workspace:'OWN'},{actor:randomUUID()},{dutyKind:'ALL'},{dutyId:0},{category:'MAIL'},{cursor:{submittedAtUtc:time}},{workspace:'GUARD',dutyKind:'PROJECT',dutyId:'9223372036854775808'}])await assert.rejects(service.read(session,{...actionInput,...patch}),{code:'INVALID_INPUT'});assert.equal(calls,0);
});
test('action centre fails closed for duplicate rows, corrupt totals, invalid dates or cursor mismatches',async()=>{
 for(const patch of [{items:[...actionPacket.items,...actionPacket.items]},{counts:{pending:0,expiredInside:0,unreturned:0}},{items:[{...actionPacket.items[0],visitDate:'2026-02-30'}]},{hasMore:true,afterSubmittedAtUtc:time,afterVisitRequestId:randomUUID()}])await assert.rejects(new ActionCentreService({callProcedure:async()=>JSON.stringify({...actionPacket,...patch})}).read(session,actionInput),{code:'UNAVAILABLE'});
});
test('queue and action SQL denials expose only stable errors',async()=>{
 const client={async callProcedure(){throw{number:52001,message:'SQL private directory'};}};
 for(const action of [()=>new ActionCentreService(client).read(session,actionInput),()=>new GuardDutyService(client).queue(session,guardInput),()=>new ReceptionService(client).queue(session,{locationId:1})])await assert.rejects(action,e=>(e as Error).message==='NOT_AUTHORIZED');
});
test('thumbnail cache hits still reauthorize both sides of the read and reject scope loss while wiping bytes',async()=>{
 const previous={NODE_ENV:process.env.NODE_ENV,GATEPASS_SSO_MODE:process.env.GATEPASS_SSO_MODE,GATEPASS_DIRECTORY_MODE:process.env.GATEPASS_DIRECTORY_MODE};Object.assign(process.env,{NODE_ENV:'test',GATEPASS_SSO_MODE:'dummy',GATEPASS_DIRECTORY_MODE:'mock'});
 const thumbnail=new PhotoThumbnails((()=>({rotate(){return this;},resize(){return this;},jpeg(){return this;},toBuffer:async()=>Buffer.from('small')})) as any);let reads=0,denied=false;const sources:Buffer[]=[];
 const staff={session:()=>session,verify:async()=>true},duties={detail:async()=>{reads++;return{visit:denied&&reads%2===0?null:{visitRequestId:actionPacket.items[0].visitRequestId,accessPassId:'one'}};}};
 const routes=new GuardRoutes(staff as any,{} as any,{} as any,{read:async()=>{const bytes=Buffer.from('private photo');sources.push(bytes);return{bytes,mimeType:'image/jpeg'};}} as any,duties as any,undefined,undefined,thumbnail);
 const request=()=>Object.assign(Readable.from([Buffer.from(JSON.stringify({thumbnail:true,visitRequestId:actionPacket.items[0].visitRequestId}))]),{url:'/api/guard/photo',headers:{'content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'}}) as any;
 try{await routes.handle(request(),{} as any);await routes.handle(request(),{} as any);assert.equal(reads,4);denied=true;await assert.rejects(routes.handle(request(),{} as any),(e:any)=>e.status===403);assert.equal(reads,6);assert.ok(sources.every(b=>b.every(v=>v===0)));}
 finally{thumbnail.close();for(const [key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
