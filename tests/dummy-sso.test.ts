import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { DummyEmployeeSso, requireDummySso } from '../src/development/DummyEmployeeSso.ts';
import type { DevelopmentSsoRepository } from '../src/development/DummyEmployeeSso.ts';
import { DummySsoRoutes } from '../src/development/DummySsoRoutes.ts';
const old = { NODE_ENV: process.env.NODE_ENV, GATEPASS_SSO_MODE: process.env.GATEPASS_SSO_MODE, GATEPASS_DIRECTORY_MODE: process.env.GATEPASS_DIRECTORY_MODE };
const employee = { employeeId: 'EMP001', displayName: 'Employee 1', officialEmail: 'employee1@example.com', managerEmployeeId: 'EMP019',
  manager: { employeeId: 'EMP019', displayName: 'Employee 19', officialEmail: 'employee19@example.com', active: true }, projects: [{ projectCode: 'DEMO-PRJ-001', projectName: 'Project 1' }] };
before(() => { process.env.NODE_ENV='test';process.env.GATEPASS_SSO_MODE='dummy';process.env.GATEPASS_DIRECTORY_MODE='mock'; });
after(() => { for (const [key,value] of Object.entries(old)) { if(value===undefined) delete process.env[key];else process.env[key]=value; } });
function fixture(override?: (action: string) => Record<string, unknown>) {
  const calls: {action:string;employeeId:string|null;sessionHash:Buffer|null;csrfHash:Buffer|null}[]=[];
  const repository: DevelopmentSsoRepository = { async execute(action,employeeId,sessionHash,csrfHash) { calls.push({action,employeeId,sessionHash,csrfHash});
    if (override) return override(action);
    if(action==='list')return {ok:true,employees:[employee]};
    return {ok:true,employee,idleExpiresAtUtc:new Date(Date.now()+900000).toISOString(),absoluteExpiresAtUtc:new Date(Date.now()+28800000).toISOString()}; } };
  return {calls,sso:new DummyEmployeeSso(repository)};
}
function req(path: string, body: unknown = {}, headers: Record<string,string>={}, peer='127.0.0.1') {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{url:'/api/dev/sso/'+path,headers:{'content-type':'application/json',...headers},socket:{remoteAddress:peer}}) as any;
}
test('dummy SSO requires all explicit development flags and rejects production', () => {
  for(const [name,value] of [['NODE_ENV','production'],['GATEPASS_SSO_MODE','real'],['GATEPASS_DIRECTORY_MODE','api']]){const original=process.env[name];process.env[name]=value;assert.throws(requireDummySso);process.env[name]=original;}
  requireDummySso();
});
test('mode is rechecked after construction',async()=>{const f=fixture();process.env.NODE_ENV='production';await assert.rejects(f.sso.list(),/DUMMY_SSO_DISABLED/u);assert.equal(f.calls.length,0);process.env.NODE_ENV='test';});
test('dummy profile contains authoritative manager ID/name/email and project affiliations',async()=>{const result=await fixture().sso.list();assert.equal(result[0].manager?.officialEmail,'employee19@example.com');assert.equal(result[0].manager?.employeeId,result[0].managerEmployeeId);assert.equal(result[0].projects[0].projectCode,'DEMO-PRJ-001');});
test('real-looking emails and mismatched managers are rejected',async()=>{for(const altered of [{...employee,officialEmail:'someone@company.com'},{...employee,manager:{...employee.manager,employeeId:'EMP020'}}])await assert.rejects(fixture(()=>({ok:true,employees:[altered]})).sso.list());});
test('session issuance sends only digests to SQL and binds an existing employee ID',async()=>{const f=fixture();const result=await f.sso.signIn('EMP001');assert.match(result.sessionToken,/^[A-Za-z0-9_-]{43}$/u);assert.equal(f.calls[0].employeeId,'EMP001');assert.equal(f.calls[0].sessionHash?.length,32);assert.notDeepEqual(f.calls[0].sessionHash,Buffer.from(result.sessionToken,'base64url'));assert.equal(result.employee.employeeId,'EMP001');});
test('arbitrary guard, email or actor login identifiers cannot issue employee sessions',async()=>{const f=fixture();for(const id of ['GRD001','employee1@example.com','EMP001;DROP TABLE gp.Users','admin',null])await assert.rejects(f.sso.signIn(id));assert.equal(f.calls.length,0);});
test('SQL denial and incorrect returned identity fail closed',async()=>{await assert.rejects(fixture(()=>({ok:false})).sso.signIn('EMP001'));await assert.rejects(fixture(()=>({ok:true,employee:{...employee,employeeId:'EMP002'},idleExpiresAtUtc:new Date(Date.now()+900000).toISOString(),absoluteExpiresAtUtc:new Date(Date.now()+28800000).toISOString()})).sso.signIn('EMP001'));});
test('guard/unknown session provenance never reaches dummy SSO SQL verification',async()=>{const f=fixture();assert.equal(await f.sso.verify({sessionToken:Buffer.alloc(32,1).toString('base64url'),csrfToken:Buffer.alloc(32,2).toString('base64url')}),false);assert.equal(f.calls.length,0);});
test('issued sessions recheck current SQL authorization and directory state',async()=>{let active=true;const f=fixture(action=>action==='create'||active?{ok:true,employee,idleExpiresAtUtc:new Date(Date.now()+900000).toISOString(),absoluteExpiresAtUtc:new Date(Date.now()+28800000).toISOString()}:{ok:false});const session=await f.sso.signIn('EMP001');assert.equal(await f.sso.verify(session),true);active=false;assert.equal(await f.sso.verify(session),false);const n=f.calls.length;assert.equal(await f.sso.verify(session),false);assert.equal(f.calls.length,n);});
test('wrong CSRF cannot use an issued session',async()=>{const f=fixture();const session=await f.sso.signIn('EMP001');assert.equal(await f.sso.verify({...session,csrfToken:Buffer.alloc(32,7).toString('base64url')}),false);assert.equal(f.calls.length,1);});

test('parallel session inspections share pending work but later requests still recheck SQL',async()=>{
 let inspect=0,release=()=>{};let gate:Promise<void>|null=new Promise(resolve=>{release=resolve;});
 const repository:DevelopmentSsoRepository={async execute(action){if(action==='inspect'){inspect++;if(gate)await gate;}return{ok:true,employee,idleExpiresAtUtc:new Date(Date.now()+900000).toISOString(),absoluteExpiresAtUtc:new Date(Date.now()+28800000).toISOString()};}};
 const sso=new DummyEmployeeSso(repository),session=await sso.signIn('EMP001');
 const reads=Array.from({length:8},()=>sso.current(session));assert.equal(inspect,1);release();gate=null;
 const people=await Promise.all(reads);assert(people.every(p=>p?.employeeId==='EMP001'));people[0]!.displayName='mutated';assert.equal(people[1]!.displayName,'Employee 1');
 await sso.current(session);assert.equal(inspect,2);
});
test('logout during a shared inspection cannot revive the local session',async()=>{
 let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
 const repository:DevelopmentSsoRepository={async execute(action){if(action==='inspect')await gate;return{ok:true,employee,idleExpiresAtUtc:new Date(Date.now()+900000).toISOString(),absoluteExpiresAtUtc:new Date(Date.now()+28800000).toISOString()};}};
 const sso=new DummyEmployeeSso(repository),session=await sso.signIn('EMP001'),reading=sso.current(session);
 await sso.sessionAction('logout',session);release();assert.equal(await reading,null);assert.equal(await sso.verify(session),false);
});
test('touch and logout use SQL; logout removes dummy provenance',async()=>{const f=fixture();const s=await f.sso.signIn('EMP001');assert.equal((await f.sso.sessionAction('touch',s)).ok,true);assert.equal((await f.sso.sessionAction('logout',s)).ok,true);assert.equal(await f.sso.verify(s),false);assert.deepEqual(f.calls.map(c=>c.action),['create','touch','logout']);});
test('HTTP login sets secure opaque cookie and excludes raw session from response JSON',async()=>{const f=fixture();let jar:string[]=[];const result=await new DummySsoRoutes(f.sso).handle(req('login',{employeeId:'EMP001',password:'Sopra@123'}),{setHeader(_k:string,v:string[]){jar=v;}} as any);assert.equal(jar.length,2);assert.match(jar[0],/HttpOnly/u);assert.ok(jar.every(c=>c.includes('Secure')&&c.includes('SameSite=Strict')));assert.equal(Object.hasOwn(result,'sessionToken'),false);assert.equal((result as any).employee.manager.officialEmail,'employee19@example.com');});
test('HTTP login succeeds even if browser sends a stale or invalid session cookie',async()=>{const f=fixture();let jar:string[]=[];const result=await new DummySsoRoutes(f.sso).handle(req('login',{employeeId:'EMP001',password:'Sopra@123'},{cookie:'__Host-gp-session=stale_or_invalid_session_token'}),{setHeader(_k:string,v:string[]){jar=v;}} as any);assert.equal(jar.length,2);assert.equal((result as any).employee.employeeId,'EMP001');});
test('dummy HTTP endpoints reject non-loopback clients and client identity claims',async()=>{const f=fixture();const routes=new DummySsoRoutes(f.sso);await assert.rejects(routes.handle(req('login',{employeeId:'EMP001',password:'Sopra@123'},{},'10.0.0.1'),{} as any));await assert.rejects(routes.handle(req('login',{employeeId:'EMP001',password:'Sopra@123',managerEmployeeId:'EMP020'}),{} as any));assert.equal(f.calls.length,0);});
test('closing local provider revokes only sessions this process issued',async()=>{const f=fixture();await f.sso.signIn('EMP001');await f.sso.close();assert.deepEqual(f.calls.map(x=>x.action),['create','logout']);});
test('production composition has no imports of dummy provider/routes',async()=>{for(const name of ['../src/transport/Composition.ts','../tools/start-api.ts']){const source=await readFile(new URL(name,import.meta.url),'utf8');assert.ok(!/import[^;]*development\//u.test(source));}const source=await readFile(new URL('../tools/start-api.ts',import.meta.url),'utf8');assert.ok(source.includes('DEVELOPMENT_AUTH_NOT_ALLOWED'));});


test('HTTP login rejects missing, incorrect and oversized passwords before issuing a session',async()=>{
  const f=fixture();const routes=new DummySsoRoutes(f.sso);
  for(const password of [undefined,null,'','wrong','sopra@123','Sopra@123 ','x'.repeat(129)]) {
    await assert.rejects(routes.handle(req('login',{email:employee.officialEmail,password}),{} as any),(e:any)=>e.status===401);
    await assert.rejects(routes.handle(req('login',{employeeId:'EMP001',password}),{} as any),(e:any)=>e.status===401);
  }
  assert.equal(f.calls.length,0);
});

test('HTTP email/password sign-in resolves the directory identity and rejects unknown emails',async()=>{
  const f=fixture();const routes=new DummySsoRoutes(f.sso);let jar:string[]=[];
  const result=await routes.handle(req('login',{email:' EMPLOYEE1@example.com ',password:'Sopra@123'}),{setHeader(_k:string,v:string[]){jar=v;}} as any);
  assert.equal((result as any).employee.employeeId,'EMP001');assert.equal(jar.length,2);
  assert.ok(!JSON.stringify(result).includes('Sopra@123'));
  await assert.rejects(routes.handle(req('login',{email:'unknown@example.com',password:'Sopra@123'}),{} as any),(e:any)=>e.status===401);
  assert.equal(f.calls.filter(x=>x.action==='create').length,1);
});
