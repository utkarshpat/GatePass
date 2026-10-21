import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DummyEmployeeSso, LocalDevelopmentSsoRepository } from '../src/development/DummyEmployeeSso.ts';
import { DummySsoRoutes } from '../src/development/DummySsoRoutes.ts';
import { LocalDevelopmentApiClient } from '../src/development/LocalDevelopmentApiClient.ts';
import { EmployeeDigitalIdRoutes } from '../src/development/EmployeeDigitalIdRoutes.ts';
import { createLoopbackHttpHandler } from '../src/development/LoopbackHttpHandler.ts';
import { RegistrationHttpRoutes } from '../src/transport/RegistrationHttpRoutes.ts';
import { RegistrationService } from '../src/registration/RegistrationService.ts';
import { SqlRegistrationRepository } from '../src/registration/SqlRegistrationRepository.ts';
import { SharpPhotoNormalizer } from '../src/registration/RegistrationPhoto.ts';
import { VisitReadService } from '../src/visits/VisitReadService.ts';
import { SqlVisitReadRepository } from '../src/visits/SqlVisitReadRepository.ts';
import { openLocalPrivateStorage } from '../src/storage/LocalPrivateStorage.ts';

let inputText='';for await(const part of process.stdin)inputText+=part;
const input=JSON.parse(inputText),intakes=new Map(),sessions=new Set<string>(),clientKeys=new Set<string>(),photos=new Set<string>();
const checks:string[]=[];let failure:string|undefined;let server:ReturnType<typeof createServer>|undefined;
const repository=new LocalDevelopmentSsoRepository();
const sso=new DummyEmployeeSso({async execute(action,id,session,csrf){if(action==='create'&&session)sessions.add(session.toString('hex').toUpperCase());return repository.execute(action,id,session,csrf);}});
try {
 const storage=await openLocalPrivateStorage(input.storageRoot);
 const sharp=createRequire(import.meta.url)(process.env.GATEPASS_SHARP_PATH??join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','sharp'));
 const actual=new LocalDevelopmentApiClient();
 const client={async callProcedure(name:string,p:Record<string,any>){
  if(name==='gp.CreateRegistrationIntake')intakes.set(p.IntakeId.value,{intakeId:p.IntakeId.value,tokenHash:p.TokenHash.value.toString('hex').toUpperCase()});
  if(name==='gp.RecordRegistrationPhoto')photos.add(p.PhotoAssetId.value);
  if(name==='gp.SubmitRegistration')clientKeys.add(p.ClientKey.value);
  return actual.callProcedure(name,p);
 }};
 const service=new RegistrationService(new SqlRegistrationRepository(client),storage.keys,new SharpPhotoNormalizer(sharp),storage.photos);
 const routes=[new DummySsoRoutes(sso,{localHttp:true}),new RegistrationHttpRoutes(service,randomBytes(32),sso,{localHttp:true,allowedTypes:['DIGITAL_ID']}),new EmployeeDigitalIdRoutes(sso,new VisitReadService(new SqlVisitReadRepository(client,'api')))];
 let handler:any;server=createServer((req,res)=>handler(req,res));await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
 const port=(server.address()as any).port;
 handler=createLoopbackHttpHandler(`http://localhost:${port}`,{handles:path=>routes.some(r=>r.handles(path)),handle:(req,res)=>routes.find(r=>r.handles(req.url!))!.handle(req,res)});
 const jar=new Map<string,string>();
 async function call(path:string,body:any={},extra:Record<string,string>={},update=true){
  const binary=Buffer.isBuffer(body),bytes=binary?body:Buffer.from(JSON.stringify(body));
  const result=await new Promise<{status:number;body:any;headers:any}>((resolve,reject)=>{
   const req=request({hostname:'127.0.0.1',port,path,method:'POST',headers:{host:`localhost:${port}`,origin:`http://localhost:${port}`,'content-type':binary?'image/jpeg':'application/json','content-length':bytes.length,cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'x-csrf-token':jar.get('gp-dev-csrf')??'','x-intake-csrf-token':jar.get('gp-dev-intake-csrf')??'',...extra}},res=>{let raw='';res.on('data',b=>raw+=b);res.on('end',()=>{try{resolve({status:res.statusCode!,body:JSON.parse(raw),headers:res.headers});}catch{reject(new Error('INVALID_HTTP_RESPONSE'));}});});req.on('error',reject);req.end(bytes);
  });
  if(update)for(const value of result.headers['set-cookie']??[]){const [name,...rest]=value.split(';')[0].split('=');jar.set(name,rest.join('='));}
  return result;
 }
 async function check(name:string,work:()=>Promise<void>){await work();checks.push(name);}
 const employee=await sso.signIn('EMP014');jar.set('gp-dev-session',employee.sessionToken);jar.set('gp-dev-csrf',employee.csrfToken);
 await check('employee session opens SQL intake; four active office locations are capability-bound',async()=>{
  assert.equal((await call('/api/registration/start',{requestType:'DIGITAL_ID'})).status,200);
  const r=await call('/api/registration/locations');assert.equal(r.status,200);assert.equal(r.body.locations.length,4);
  input.locationId=r.body.locations[0].locationId;
 });
 await check('missing intake CSRF and forged employee identity are rejected',async()=>{
  assert.equal((await call('/api/registration/locations',{}, {'x-intake-csrf-token':''})).status,403);
  assert.equal((await call('/api/registration/start',{requestType:'DIGITAL_ID',employeeId:'EMP001'})).status,400);
  assert.equal((await call('/api/registration/start',{requestType:'EXTERNAL'})).status,400);
 });
 await check('invalid image is rejected before private file or SQL asset creation',async()=>{assert.equal((await call('/api/registration/photo',Buffer.from('not a photo'))).status,400);assert.equal(photos.size,0);});
 const photo=await sharp({create:{width:240,height:320,channels:3,background:'#996655'}}).jpeg().toBuffer();
 let photoId:string,visitId:string,payload:any;
 await check('actual decoded photo is stored privately and only its identifier enters HTTP JSON',async()=>{
  const r=await call('/api/registration/photo',photo);assert.equal(r.status,200);photoId=r.body.photoAssetId;assert.deepEqual(Object.keys(r.body),['photoAssetId']);
  const intake=[...intakes.keys()][0];const key=`intakes/${intake.replaceAll('-','')}/${photoId.replaceAll('-','')}.jpg`;
  const stored=await storage.photos.read(key,5242880);assert.equal((await sharp(stored).metadata()).format,'jpeg');
  input.photoHash=createHash('sha256').update(stored).digest('hex').toUpperCase();
 });
 await check('concurrent same-key submissions commit one approved visit, pass and manager notification through restricted SQL role',async()=>{
  payload={clientKey:randomUUID(),requestType:'DIGITAL_ID',locationId:input.locationId,reason:'Forgot my employee card',digitalIdReason:'FORGOT',people:[{clientPersonKey:randomUUID(),photoAssetId:photoId}]};
  const [r,retry]=await Promise.all([call('/api/registration/submit',payload),call('/api/registration/submit',payload)]);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(retry.status,200,JSON.stringify(retry.body));assert.equal(r.body.visits.length,1);assert.equal(r.body.visits[0].status,'APPROVED');assert.equal(r.body.visits[0].reused,false);visitId=r.body.visits[0].visitRequestId;assert.equal(retry.body.visits[0].visitRequestId,visitId);input.visitId=visitId;
 });
 await check('same idempotency key returns the same visit; changed payload with that key conflicts',async()=>{
  const r=await call('/api/registration/submit',payload);assert.equal(r.status,200);assert.equal(r.body.visits[0].visitRequestId,visitId);
  assert.equal((await call('/api/registration/submit',{...payload,reason:'Different payload'})).status,409);
 });
 await check('OWN receipt reads live SQL validity and does not expose the QR secret or photo storage key',async()=>{
  const r=await call('/api/employee/digital-id/detail',{visitRequestId:visitId});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.requestType,'DIGITAL_ID');assert.equal(r.body.status,'APPROVED');assert.ok(Date.parse(r.body.validUntilUtc)>Date.now());assert.ok(!JSON.stringify(r.body).includes('storageKey'));assert.ok(!JSON.stringify(r.body).includes('encryptedPayload'));
 });
 await check('another signed-in employee cannot read this employee receipt or reuse their intake',async()=>{
  const other=await sso.signIn('EMP013');jar.set('gp-dev-session',other.sessionToken);jar.set('gp-dev-csrf',other.csrfToken);
  assert.equal((await call('/api/employee/digital-id/detail',{visitRequestId:visitId})).status,403);
  assert.equal((await call('/api/registration/locations')).status,403);
  jar.set('gp-dev-session',employee.sessionToken);jar.set('gp-dev-csrf',employee.csrfToken);
 });
 await check('a new form for the same employee, office and day reuses the existing Digital ID',async()=>{
  assert.equal((await call('/api/registration/reset')).status,200);
  assert.equal((await call('/api/registration/start',{requestType:'DIGITAL_ID'})).status,200);
  const uploaded=await call('/api/registration/photo',photo);assert.equal(uploaded.status,200);
  const repeated={...payload,clientKey:randomUUID(),people:[{clientPersonKey:randomUUID(),photoAssetId:uploaded.body.photoAssetId}]};
  const r=await call('/api/registration/submit',repeated);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.visits[0].visitRequestId,visitId);assert.equal(r.body.visits[0].reused,true);
 });
 await check('private file paths cannot be served by the HTTP router',async()=>{assert.equal((await call('/photos/'+photoId+'.jpg')).status,404);});
}catch(error){failure=(error as Error).message;}
finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await sso.close();process.stdout.write(JSON.stringify({status:failure?'FAIL':'PASS',failure,cases:checks.length,checks,intakes:[...intakes.values()],ownedSessionHashes:[...sessions],clientKeys:[...clientKeys],photos:[...photos],visitId:input.visitId,photoHash:input.photoHash,actualSql:true,actualHttp:true,realSso:false,mailSent:false}));if(failure)process.exitCode=1;}



