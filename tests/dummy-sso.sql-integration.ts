import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { DummyEmployeeSso, LocalDevelopmentSsoRepository } from '../src/development/DummyEmployeeSso.ts';
import { DirectoryGateway, MockDirectorySource } from '../src/integrations/directory/DirectoryGateway.ts';
import { RegistrationService } from '../src/registration/RegistrationService.ts';
import { SqlRegistrationRepository } from '../src/registration/SqlRegistrationRepository.ts';
let text='';for await(const part of process.stdin)text+=part;const input=JSON.parse(text);
const ownedSessions=new Set<string>();const intakes:{intakeId:string;tokenHash:string}[]=[];
const cases:{name:string;passed:boolean}[]=[];let failure:string|undefined;
const digest=(token:string)=>createHash('sha256').update(Buffer.from(token,'base64url')).digest('hex').toUpperCase();
const repository=new LocalDevelopmentSsoRepository();
const sso=new DummyEmployeeSso({async execute(action,id,session,csrf){if(action==='create'&&session)ownedSessions.add(session.toString('hex').toUpperCase());return repository.execute(action,id,session,csrf);}});
const port=Number(input.port);
const child=spawn(process.execPath,[fileURLToPath(new URL('../tools/start-dummy-sso.ts',import.meta.url))],{env:{...process.env,GATEPASS_DUMMY_PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});child.stderr.resume();
function call(path:string,body:unknown={},cookie='',extraHeaders:Record<string,string>={}){
 return new Promise<{status:number;headers:any;body:any;raw:string}>((resolve,reject)=>{const bytes=Buffer.from(JSON.stringify(body));const csrf=cookie.split('; ').find(c=>c.startsWith('gp-dev-csrf='))?.split('=')[1];
 const req=request({hostname:'127.0.0.1',port,path,method:'POST',headers:{host:`localhost:${port}`,origin:`http://localhost:${port}`,'content-type':'application/json','content-length':String(bytes.length),...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{}),...extraHeaders}},res=>{let raw='';res.on('data',b=>raw+=b);res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:JSON.parse(raw),raw}));});req.on('error',reject);req.end(bytes);});
}
async function check(name:string,action:()=>Promise<void>){await action();cases.push({name,passed:true});}
try{
 await new Promise<void>((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('LOCAL_LISTENER_TIMEOUT')),15000);child.stdout.on('data',b=>{output+=b;if(output.includes('GatePass employee portal:')){clearTimeout(timer);resolve();}});child.on('error',()=>{clearTimeout(timer);reject(new Error('LOCAL_LISTENER_FAILED'));});child.on('exit',()=>{clearTimeout(timer);reject(new Error('LOCAL_LISTENER_FAILED'));});});
 await check('HTTP local picker lists 23 active dummy employees with manager and project details',async()=>{const r=await call('/api/dev/sso/employees');assert.equal(r.status,200);assert.equal(r.body.employees.length,23);const e=r.body.employees.find((x:any)=>x.employeeId==='EMP001');assert.equal(e.manager.employeeId,'EMP019');assert.equal(e.manager.officialEmail,'employee19@example.com');assert.ok(e.projects.length);});
 await check('local sign-in page serves original company branding and nonce-protected valid JavaScript',async()=>{
  const page=await new Promise<{html:string;headers:any}>((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port,path:'/',method:'GET',headers:{host:`localhost:${port}`,'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate'}},res=>{assert.equal(res.statusCode,200);let html='';res.on('data',b=>html+=b);res.on('end',()=>resolve({html,headers:res.headers}));});req.on('error',reject);req.end();});
  assert.match(page.html,/alt="Sopra Steria"/u);assert.ok(!page.html.includes('__COMPANY_LOGO__'));assert.equal(page.headers['cache-control'],'no-store');assert.match(page.headers['content-security-policy'],/script-src 'nonce-/u);assert.ok(!page.html.includes('style='));
  const script=/<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(page.html);assert.ok(script);new Script(script[1]);
 });
 await check('cross-site API calls remain rejected even though public login navigation is allowed',async()=>{
  assert.equal((await call('/api/dev/sso/login',{employeeId:'EMP001',password:'Sopra@123'},'',{'sec-fetch-site':'cross-site',origin:'http://untrusted.example'})).status,403);
  assert.equal((await call('/api/dev/sso/employees',{},'',{host:'untrusted.example'})).status,403);
 });
 let cookie='';
 await check('HTTP dummy employee login creates actual SQL session without leaking its token in JSON',async()=>{const r=await call('/api/dev/sso/login',{employeeId:'EMP001',password:'Sopra@123'});assert.equal(r.status,200);cookie=r.headers['set-cookie'].map((c:string)=>c.split(';')[0]).join('; ');const token=cookie.split('; ')[0].split('=')[1];ownedSessions.add(digest(token));assert.ok(!r.raw.includes(token));assert.equal(r.body.employee.employeeId,'EMP001');});
 await check('HTTP current profile and touch revalidate the actual SQL session',async()=>{assert.equal((await call('/api/dev/sso/me',{},cookie)).body.employee.manager.employeeId,'EMP019');assert.equal((await call('/api/dev/sso/touch',{},cookie)).status,200);});
 await check('HTTP logout revokes actual session and subsequent profile returns 401',async()=>{assert.equal((await call('/api/dev/sso/logout',{},cookie)).status,200);assert.equal((await call('/api/dev/sso/me',{},cookie)).status,401);});
 await check('inactive dummy employee cannot log in',async()=>{assert.equal((await call('/api/dev/sso/login',{employeeId:'EMP015',password:'Sopra@123'})).status,503);});
 const session=await sso.signIn('EMP001');
 await check('dummy SSO gate validates its issued session against actual SQL',async()=>{assert.equal(await sso.verify(session),true);assert.equal(await sso.verify({...session,csrfToken:Buffer.alloc(32,1).toString('base64url')}),false);});
 await check('manager notification lookup agrees with the same directory mapping',async()=>{const manager=await new DirectoryGateway(new MockDirectorySource()).getManager('EMP001');assert.equal(manager?.employeeId,session.employee.manager?.employeeId);assert.equal(manager?.officialEmail,session.employee.manager?.officialEmail);});
 const sqlClient={async callProcedure(procedure:string,parameters:Record<string,any>){
   if(procedure==='gp.CreateRegistrationIntake')intakes.push({intakeId:parameters.IntakeId.value,tokenHash:parameters.TokenHash.value.toString('hex').toUpperCase()});
   const output=await new Promise<string>((resolve,reject)=>{const rpc=spawn('pwsh',['-NoProfile','-File',fileURLToPath(new URL('./helpers/Registration.SqlBridge.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';rpc.stderr.resume();rpc.stdout.on('data',b=>out+=b);rpc.on('error',reject);rpc.on('close',code=>code===0?resolve(out):reject(new Error('RPC_FAILED')));rpc.stdin.end(JSON.stringify({mode:'rpc',server:'localhost\\SQLEXPRESS',trustLocalCertificate:true,procedure,parameters:Object.fromEntries(Object.entries(parameters).map(([key,p])=>[key,{type:p.type,value:Buffer.isBuffer(p.value)?p.value.toString('base64'):p.value}]))}));});
   const value=JSON.parse(output);if(value.bridgeError)throw {number:value.number};return output;
 }};
 await check('actual dummy employee session opens Digital ID intake through restricted API SQL role',async()=>{const registration=new RegistrationService(new SqlRegistrationRepository(sqlClient),{async active(){throw new Error('not used');},async resolve(){throw new Error('not used');}},{async normalize(){throw new Error('not used');}},{async putIfAbsent(){throw new Error('not used');}});const result=await registration.start('DIGITAL_ID',session);assert.equal(result.context.requestType,'DIGITAL_ID');assert.equal(result.context.employeeSession?.sessionToken,session.sessionToken);assert.ok(Date.parse(result.expiresAtUtc)>Date.now());});
 await check('actual dummy logout removes SSO provenance and rejects reuse',async()=>{assert.equal((await sso.sessionAction('logout',session)).ok,true);assert.equal(await sso.verify(session),false);});
}catch(error){failure=(error as Error).message??'INTEGRATION_FAILED';}
finally{await sso.close();child.kill();process.stdout.write(JSON.stringify({status:failure?'FAIL':'PASS',cases:cases.length,checks:cases,failure,ownedSessionHashes:[...ownedSessions],intakes,actualSql:true,actualHttps:false,actualHttp:true,productionDriver:false,realSso:false,mailSent:false}));if(failure)process.exitCode=1;}
