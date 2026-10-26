import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {ProjectGroupService} from '../src/administration/ProjectGroupService.ts';
import {AdminConsoleService} from '../src/administration/AdminConsoleService.ts';
import {createServiceActions} from '../src/transport/Composition.ts';
const session={sessionToken:randomBytes(32).toString('base64url'),csrfToken:randomBytes(32).toString('base64url')};
const guard=randomUUID(),operation=randomUUID();
const save={locationId:1,clientKey:randomUUID(),reason:'Floor coverage',action:'SAVE',name:'Floor 11 Main',projectLocationIds:['2','1']};
const assign={locationId:1,clientKey:randomUUID(),reason:'Gate duty',action:'ASSIGN',groupId:'3',revision:2,guardUserId:guard};
const group={groupId:'3',name:'Floor 11 Main',revision:2,projects:[{projectLocationId:'1',projectName:'Alpha',projectCode:'A'}],assignments:[{groupAssignmentId:'4',userId:guard,guardName:'Guard',validFromUtc:'2026-10-26T00:00:00.000Z'}]};

test('group reads sanitize output and bind only the authenticated office',async()=>{
 const s=new ProjectGroupService({async callProcedure(n,p){assert.equal(n,'gp.GetAdminProjectGroups');assert.equal(p.LocationId.value,1);assert.equal((p.SessionHash.value as Buffer).length,32);return JSON.stringify({groups:[{...group,private:'drop'}],internal:'drop'});}});
 const r:any=await s.execute(session,'project-groups',{locationId:1});assert.deepEqual(r,{groups:[{...group,assignments:[{...group.assignments[0],validUntilUtc:null}]}]});
});
test('create and edit bind canonical members and revisions; results exclude raw SQL fields',async()=>{
 for(const edit of [false,true]){
  const s=new ProjectGroupService({async callProcedure(n,p){assert.equal(n,'gp.ManageProjectGroup');assert.equal(p.ProjectLocationIdsJson.value,'["1","2"]');assert.equal(p.ProjectGroupId.value,edit?'3':null);assert.equal(p.ExpectedRevision.value,edit?2:null);return JSON.stringify({operationId:operation,groupId:'3',revision:3,action:'SAVE',secret:'drop'});}});
  assert.deepEqual(await s.execute(session,'project-group',{...save,...(edit?{groupId:'3',revision:2}:{})}),{operationId:operation,groupId:'3',revision:3,action:'SAVE'});
 }
});
test('archive and group assignment removal use explicit source identity',async()=>{
 const s=new ProjectGroupService({async callProcedure(n,p){assert.equal(p.ProjectLocationIdsJson?.value??null,null);assert.equal(p.Action.value,n==='gp.ManageProjectGroup'?'ARCHIVE':'REMOVE');return JSON.stringify({operationId:operation,groupId:'3',revision:4,action:p.Action.value,groupAssignmentId:'4'});}});
 assert.equal((await s.execute(session,'project-group',{locationId:1,clientKey:randomUUID(),reason:'Close gate',action:'ARCHIVE',groupId:'3',revision:3}) as any).action,'ARCHIVE');
 assert.equal((await s.execute(session,'project-group-guard',{...assign,guardUserId:undefined,action:'REMOVE',groupAssignmentId:'4'}) as any).groupAssignmentId,'4');
});
test('group assignments retain end dates and fresh identity bindings',async()=>{
 const until='2026-10-27T00:00:00.000Z';
 for(const end of [undefined,until]){
  const s=new ProjectGroupService({async callProcedure(n,p){assert.equal(n,'gp.ManageProjectGroupGuard');assert.equal(p.GuardUserId.value,guard);assert.equal(p.ValidUntilUtc.value,end??null);return JSON.stringify({operationId:operation,groupId:'3',revision:3,action:'ASSIGN',groupAssignmentId:'4'});}});
  assert.equal((await s.execute(session,'project-group-guard',{...assign,...(end?{validUntilUtc:end}:{})}) as any).groupAssignmentId,'4');
 }
});
test('forged identity, malformed IDs, duplicate or oversized members fail before SQL',async()=>{
 let calls=0;const s=new ProjectGroupService({async callProcedure(){calls++;return'{}';}});
 const cases:any[]=[null,[],{},Object.create({locationId:1}),{...save,actorUserId:guard},{...save,locationId:0},{...save,clientKey:'bad'},{...save,reason:'\n'},{...save,name:''},{...save,name:'x'.repeat(101)},{...save,projectLocationIds:[]},{...save,projectLocationIds:['1','1']},{...save,projectLocationIds:['0001']},{...save,projectLocationIds:['9223372036854775808']},{...save,projectLocationIds:Array.from({length:51},(_,i)=>String(i+1))},{...save,groupId:'3'},{...save,revision:1},{...save,groupId:'3',revision:0},{...save,action:'DELETE'},{...save,action:'ARCHIVE',groupId:'3',revision:1}];
 for(const c of cases)await assert.rejects(s.execute(session,'project-group',c),{code:'INVALID_INPUT'});
 for(const c of [{...assign,guardUserId:'bad'},{...assign,groupAssignmentId:'4'},{...assign,validUntilUtc:'bad'},{...assign,revision:undefined},{...assign,action:'REMOVE'},{...assign,action:'REMOVE',guardUserId:undefined,groupAssignmentId:'0'},{...assign,action:'DELETE'}])await assert.rejects(s.execute(session,'project-group-guard',c),{code:'INVALID_INPUT'});
 for(const c of [{locationId:1,extra:true},{locationId:'1'}])await assert.rejects(s.execute(session,'project-groups',c),{code:'INVALID_INPUT'});
 assert.equal(calls,0);
});
test('malformed group projections never enable a partial or forged roster',async()=>{
 const invalid:any[]=[{}, {groups:{}},{groups:Array(101).fill(group)},{groups:[group,group]},{groups:[{...group,groupId:'0'}]},{groups:[{...group,revision:'2'}]},{groups:[{...group,projects:[]}]},{groups:[{...group,projects:[group.projects[0],group.projects[0]]}]},{groups:[{...group,projects:[{...group.projects[0],projectCode:''}]}]},{groups:[{...group,assignments:[{...group.assignments[0],userId:'bad'}]}]},{groups:[{...group,assignments:[{...group.assignments[0],validUntilUtc:'bad'}]}]},{groups:[{...group,assignments:[group.assignments[0],group.assignments[0]]}]}];
 for(const r of invalid)await assert.rejects(new ProjectGroupService({async callProcedure(){return JSON.stringify(r);}}).execute(session,'project-groups',{locationId:1}),{code:'UNAVAILABLE'});
});
test('mutation output must match requested group and operation before reporting success',async()=>{
 for(const r of [[],null,{}, {operationId:operation,groupId:'4',revision:3,action:'ASSIGN',groupAssignmentId:'4'}, {operationId:operation,groupId:'3',revision:3,action:'REMOVE',groupAssignmentId:'4'}, {operationId:operation,groupId:'3',revision:3,action:'ASSIGN'}])await assert.rejects(new ProjectGroupService({async callProcedure(){return JSON.stringify(r);}}).execute(session,'project-group-guard',assign),{code:'UNAVAILABLE'});
});
test('denials and conflicts stay explicit; group mutations never automatically retry',async()=>{
 for(const [n,code] of [[52001,'NOT_AUTHORIZED'],[52002,'INVALID_INPUT'],[52003,'CONFLICT'],[52004,'CONFLICT'],[52005,'CONFLICT'],[1205,'UNAVAILABLE']] as const){let calls=0;const s=new ProjectGroupService({async callProcedure(){calls++;throw{number:n};}});await assert.rejects(s.execute(session,'project-group',save),{code});assert.equal(calls,1);}
});
test('admin assignment projection preserves group provenance without leaking private fields',async()=>{
 const a={assignmentId:'5',userId:guard,guardName:'Guard',validFromUtc:'2026-10-26T00:00:00.000Z',groupAssignmentId:'4',groupId:'3',groupName:'Floor 11 Main'};
 const s=new AdminConsoleService({async callProcedure(){return JSON.stringify({assignments:[{...a,private:'drop'}],hasMore:false});}});
 assert.deepEqual(await s.read(session,'assignments',{projectLocationId:'1'}),{assignments:[{...a,validUntilUtc:null}],cursor:null});
 await assert.rejects(new AdminConsoleService({async callProcedure(){return JSON.stringify({assignments:[{...a,groupId:'bad'}],hasMore:false});}}).read(session,'assignments',{projectLocationId:'1'}),{code:'UNAVAILABLE'});
});
test('production and development console paths route groups through the same service contract',async()=>{
 let calls=0;const client={async callProcedure(n:string){calls++;assert.equal(n,'gp.GetAdminProjectGroups');return'{"groups":[]}';}};
 assert.deepEqual(await new AdminConsoleService(client).groups(session,'project-groups',{locationId:1}),{groups:[]});
 const actions=createServiceActions(client);assert.deepEqual(await actions.get('/api/admin/project-groups')!(session,{locationId:1}),{groups:[]});assert.equal(calls,2);
});
