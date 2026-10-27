import {test,expect,type APIRequestContext} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const origin='http://localhost:18447';
function fixture(run:string,action:string){return execFileSync('pwsh',['-NoProfile','-File','tests/browser/ProjectGroupBoundaryFixture.ps1','-RunId',run,'-Action',action],{encoding:'utf8',timeout:60000});}
async function csrf(client:APIRequestContext){return(await client.storageState()).cookies.find(c=>c.name==='gp-staff-csrf')?.value??'';}
async function call(client:APIRequestContext,action:string,data:any){return client.post(origin+'/api/admin/'+action,{data,headers:{Origin:origin,'X-CSRF-Token':await csrf(client)}});}
function deniedBodies(f:any,groupId:string){return[
 ['project-groups',{locationId:1}],
 ['project-group',{locationId:1,action:'SAVE',name:f.prefix+' Rejected Create',projectLocationIds:[f.pair],reason:'Owned negative create authorization check',clientKey:randomUUID()}],
 ['project-group',{locationId:1,action:'SAVE',groupId,revision:1,name:f.prefix+' Rejected',projectLocationIds:[f.pair],reason:'Owned negative authorization check',clientKey:randomUUID()}],
 ['project-group-guard',{locationId:1,action:'ASSIGN',groupId,revision:1,guardUserId:f.guard,reason:'Owned negative authorization check',clientKey:randomUUID()}]
 ] as const;}
test('actual group HTTP endpoints deny guard, reception, project-only, CSRF and unauthenticated requests',async({playwright})=>{
 test.setTimeout(120000);const run=randomUUID(),clients:APIRequestContext[]=[];let ready=false;
 try{
  const f=JSON.parse(fixture(run,'Create'));ready=true;
  const login=async(name:string)=>{const c=await playwright.request.newContext();clients.push(c);const r=await c.post(origin+'/api/staff/login',{data:{login:name,password:'Sopra@123'},headers:{Origin:origin}});expect(r.status()).toBe(200);return c;};
  const admin=await login(f.login);const created=await call(admin,'project-group',{locationId:1,action:'SAVE',name:f.prefix+' Local Entry',projectLocationIds:[f.beta],reason:'Owned endpoint authorization coverage',clientKey:randomUUID()});expect(created.status()).toBe(200);const group=(await created.json()).groupId;
  const before=JSON.parse(fixture(run,'Inspect'));
  for(const name of [f.guardLogin,f.receptionLogin]){const c=await login(name);for(const [action,body] of deniedBodies(f,group)){const r=await call(c,action,body);expect(r.status(),name+' '+action).toBe(403);}}
  for(const [action,body] of deniedBodies(f,group)){const badCsrf=await admin.post(origin+'/api/admin/'+action,{data:body,headers:{Origin:origin,'X-CSRF-Token':'x'.repeat(43)}});expect(badCsrf.status()).toBe(403);}
  const anonymous=await playwright.request.newContext();clients.push(anonymous);for(const [action,body] of deniedBodies(f,group)){const r=await call(anonymous,action,body);expect(r.status()).toBe(401);expect(await r.json()).toEqual({error:'NOT_AUTHENTICATED'});}
  for(const [action,body] of deniedBodies(f,group)){expect((await call(admin,action,{...body,locationId:f.otherLocationId})).status()).toBe(403);expect((await call(admin,action,{...body,actorUserId:f.guard})).status()).toBe(400);}
  fixture(run,'ProjectOnly');for(const [action,body] of deniedBodies(f,group)){const r=await call(admin,action,body);expect(r.status(),action).toBe(403);}
  expect(JSON.parse(fixture(run,'Inspect'))).toEqual(before);
 }finally{for(const c of clients)await c.dispose();if(ready)fixture(run,'Cleanup');}
});
test('actual group HTTP endpoints reject foreign office/group IDs and another existing group binding',async({playwright})=>{
 test.setTimeout(120000);const run=randomUUID();let ready=false;const client=await playwright.request.newContext();
 try{
  const f=JSON.parse(fixture(run,'Create'));ready=true;expect((await client.post(origin+'/api/staff/login',{data:{login:f.login,password:'Sopra@123'},headers:{Origin:origin}})).status()).toBe(200);
  const groups=[];for(const name of ['One','Two']){const r=await call(client,'project-group',{locationId:1,action:'SAVE',name:f.prefix+' '+name,projectLocationIds:[f.beta],reason:'Owned group identity test',clientKey:randomUUID()});expect(r.status()).toBe(200);const g=await r.json();const a=await call(client,'project-group-guard',{locationId:1,action:'ASSIGN',groupId:g.groupId,revision:g.revision,guardUserId:f.guard,reason:'Owned group identity test',clientKey:randomUUID()});expect(a.status()).toBe(200);groups.push(await a.json());}
  const read=async()=>{const r=await call(client,'project-groups',{locationId:1});expect(r.status()).toBe(200);return r.json();};const before=await read();
  const foreign=await call(client,'project-groups',{locationId:f.otherLocationId});expect(foreign.status()).toBe(403);expect(await foreign.json()).toEqual({error:'NOT_AUTHORIZED'});
  for(const groupId of [f.foreignGroup,groups[0].groupId]){const r=await call(client,'project-group',{locationId:groupId===f.foreignGroup?1:f.otherLocationId,groupId,revision:1,action:'ARCHIVE',reason:'Owned foreign identity denial',clientKey:randomUUID()});expect(r.status()).toBe(403);expect(await r.json()).toEqual({error:'NOT_AUTHORIZED'});}
  const wrongBinding=await call(client,'project-group-guard',{locationId:1,groupId:groups[0].groupId,revision:groups[0].revision,action:'REMOVE',groupAssignmentId:groups[1].groupAssignmentId,reason:'Owned foreign binding denial',clientKey:randomUUID()});expect(wrongBinding.status()).toBe(409);expect(await read()).toEqual(before);
 }finally{await client.dispose();if(ready)fixture(run,'Cleanup');}
});
test('an expired existing admin session cannot read or mutate groups through HTTP',async({playwright})=>{
 test.setTimeout(120000);const run=randomUUID();let ready=false;const client=await playwright.request.newContext();
 try{const f=JSON.parse(fixture(run,'Create'));ready=true;expect((await client.post(origin+'/api/staff/login',{data:{login:f.login,password:'Sopra@123'},headers:{Origin:origin}})).status()).toBe(200);fixture(run,'Expire');for(const [action,body] of deniedBodies(f,f.foreignGroup)){expect((await call(client,action,body)).status()).toBe(403);}}
 finally{await client.dispose();if(ready)fixture(run,'Cleanup');}
});
test('GP-0612 actual HTTP ENTRY rejects an already verified pass after group membership revocation',async({playwright})=>{
 test.setTimeout(120000);const run=randomUUID();let ready=false;const admin=await playwright.request.newContext(),guard=await playwright.request.newContext();
 try{
  const f=JSON.parse(fixture(run,'Create'));ready=true;
  for(const [client,login] of [[admin,f.login],[guard,f.guardLogin]] as const)expect((await client.post(origin+'/api/staff/login',{data:{login,password:'Sopra@123'},headers:{Origin:origin}})).status()).toBe(200);
  const create=await call(admin,'project-group',{locationId:1,action:'SAVE',name:f.prefix+' Revoke Entry',projectLocationIds:[f.beta],reason:'Owned scan revoke test',clientKey:randomUUID()});expect(create.status()).toBe(200);const group=await create.json();
  const assigned=await call(admin,'project-group-guard',{locationId:1,action:'ASSIGN',groupId:group.groupId,revision:group.revision,guardUserId:f.guard,reason:'Owned scan revoke test',clientKey:randomUUID()});expect(assigned.status()).toBe(200);const binding=await assigned.json();
  const scope={locationId:1,dutyKind:'PROJECT',dutyId:f.beta},headers={Origin:origin,'X-CSRF-Token':await csrf(guard)};
  const verified=await guard.post(origin+'/api/guard/verify',{data:{...scope,credential:f.credential,correlationId:randomUUID()},headers});expect(verified.status()).toBe(200);const scan=await verified.json();expect(scan.outcome).toBe('VALID');expect(scan.visit.canEnter).toBe(true);
  const removed=await call(admin,'project-group',{locationId:1,action:'SAVE',groupId:group.groupId,revision:binding.revision,name:f.prefix+' Revoke Entry',projectLocationIds:[f.pair],reason:'Owned revoke after verification',clientKey:randomUUID()});expect(removed.status()).toBe(200);
  const entry=await guard.post(origin+'/api/guard/movement',{data:{...scope,clientKey:randomUUID(),visitRequestId:scan.visit.visitRequestId,accessPassId:scan.visit.accessPassId,eventType:'ENTRY',entryMethod:'SCAN',credential:f.credential},headers});expect(entry.status()).toBe(403);
  expect(JSON.parse(fixture(run,'Inspect'))).toMatchObject({accessEvents:0,visitsInside:0});
  expect((await guard.post(origin+'/api/guard/duties',{data:{locationId:1},headers})).status()).toBe(200);
 }finally{await admin.dispose();await guard.dispose();if(ready)fixture(run,'Cleanup');}
});
