import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes,randomUUID} from 'node:crypto';
import {readAdminRegister,registerFields} from '../src/administration/AdminRegister.ts';
const session={sessionToken:randomBytes(32).toString('base64url'),csrfToken:randomBytes(32).toString('base64url')};
const input={locationId:1,from:'2026-10-01',to:'2026-10-31'};
const row={visitRequestId:randomUUID(),personName:'Synthetic Visitor',localVisitDate:'2026-10-22',submittedAtUtc:'2026-10-22T00:00:00.000Z',validFromUtc:'2026-10-22T00:00:00.000Z',validUntilUtc:'2026-10-23T00:00:00.000Z',status:'APPROVED',passStatus:'ACTIVE',presence:'OUTSIDE',printStatus:'NOT_PRINTED',requestType:'EXTERNAL'};
const response={rows:[row],total:1,page:1,pageSize:50,checkedAtUtc:'2026-10-22T00:00:00.000Z'};
function fixture(value:any=response){const calls:any[]=[];return{calls,client:{async callProcedure(name:string,p:any){calls.push({name,p});return JSON.stringify(value);}}};}
test('register binds identity, passes field filters and projects only public business fields',async()=>{
 const f=fixture({...response,rows:[{...row,sessionHash:'DROP',password:'DROP'}]});const r=await readAdminRegister(f.client,session,{...input,projectLocationId:'2',sort:'personName',direction:'ASC',page:1,filters:{personName:'Visitor',status:'APPROVED',deviceTypes:'LAPTOP'}});
 assert.equal(f.calls[0].name,'gp.ReadAdminVisitRegister');assert.equal(f.calls[0].p.SessionHash.value.length,32);assert.equal(f.calls[0].p.ProjectLocationId.value,'2');assert.equal(f.calls[0].p.Sort.value,'personName');assert.deepEqual(JSON.parse(f.calls[0].p.FiltersJson.value),{personName:'Visitor',status:'APPROVED',deviceTypes:'LAPTOP'});assert.deepEqual(Object.keys(r.rows[0]),['visitRequestId',...registerFields]);assert.equal(r.rows[0].companyName,null);
 const defaults=fixture();await readAdminRegister(defaults.client,session,input);assert.equal(defaults.calls[0].p.Sort.value,'submittedAtUtc');assert.equal(defaults.calls[0].p.Direction.value,'DESC');assert.equal(defaults.calls[0].p.ProjectLocationId.value,null);
});
test('register rejects forged identity, invalid scopes, dates, fields and ordering before SQL',async()=>{
 const f=fixture();const invalid=[{actorUserId:randomUUID()},{locationId:0},{locationId:2147483648},{projectLocationId:'0'},{projectLocationId:'9223372036854775808'},{projectLocationId:2},{from:'2026-02-30'},{from:'2026-11-01'},{to:'2026-11-01'},{sort:'personName;DROP'},{direction:'desc'},{page:0},{page:1.1},{page:100001},{filters:[]},{filters:null},{filters:{password:'x'}},{filters:{personName:''}},{filters:{personName:' x'}},{filters:{personName:'x\n'}},{filters:{personName:'x'.repeat(201)}},{filters:{personName:'\ud800'}},{filters:{status:'APPROVED%'}},{filters:{deviceTypes:'MAKE_MODEL'}},{filters:{personName:2}}];
 // null is deliberately rejected rather than silently widening the query.
 for(const patch of invalid)await assert.rejects(readAdminRegister(f.client,session,{...input,...patch}),{code:'INVALID_INPUT'});assert.equal(f.calls.length,0);
});
test('register maps authorization failures and rejects malformed database projections',async()=>{
 for(const number of [52001,52002,99999])await assert.rejects(readAdminRegister({async callProcedure(){throw{number};}},session,input),{code:number===52001?'NOT_AUTHORIZED':number===52002?'INVALID_INPUT':'UNAVAILABLE'});
 const invalid=[null,{}, {...response,total:-1},{...response,page:2},{...response,pageSize:100},{...response,checkedAtUtc:'bad'},{...response,total:2},{...response,rows:[{...row,visitRequestId:'bad'}]},{...response,rows:[row,row],total:2},{...response,rows:[{...row,companyName:2}]},{...response,rows:[{...row,status:'SECRET'}]},{...response,rows:[{...row,personName:''}]},{...response,rows:[{...row,returnedAtUtc:'bad'}]}];
 for(const value of invalid)await assert.rejects(readAdminRegister(fixture(value).client,session,input),{code:'UNAVAILABLE'});
 assert.equal((await readAdminRegister(fixture({...response,rows:[],total:0}).client,session,input)).total,0);
 assert.equal((await readAdminRegister(fixture({...response,rows:[],page:3}).client,session,{...input,page:3})).rows.length,0);
});
