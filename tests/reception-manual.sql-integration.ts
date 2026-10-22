import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {request} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

let rawInput='';for await(const part of process.stdin)rawInput+=part;
const receptionAccount=JSON.parse(await readFile(join(homedir(),'.gatepass','development-logins','staff.json'),'utf8')).find((row:any)=>row.staffId==='REC001');
assert.ok(receptionAccount);
const input=JSON.parse(rawInput),jar=new Map<string,string>(),intakes=new Map(),sessions=new Set<string>(),clientKeys=new Set<string>(),photos=new Set<string>();
const timings:Record<string,number>={};const checks:string[]=[];let failure:string|undefined;const visits:string[]=[];
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
const child=spawn(process.execPath,[fileURLToPath(new URL('../tools/start-dummy-sso.ts',import.meta.url))],{env:{...process.env,GATEPASS_DUMMY_PORT:'18446',GATEPASS_TEST_STORAGE_ROOT:input.storageRoot},windowsHide:true,stdio:['ignore','pipe','pipe']});let rpcDiagnostic='';child.stderr.on('data',part=>{for(const line of String(part).split(/\r?\n/u))if(/^GP_RPC_FAILURE gp\.[A-Za-z]+ SQL_-?[0-9]+(?: [A-Za-z.]+)?$/u.test(line))rpcDiagnostic=line;});
async function call(path:string,body:any={},method='POST') {
  const bytes=Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
  const response=await new Promise<{status:number;body:any;headers:any;raw:Buffer}>((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:18446,path,method,headers:{host:'localhost:18446',origin:'http://localhost:18446',cookie:[...jar].map(([key,value])=>key+'='+value).join('; '),'x-csrf-token':((path.startsWith('/api/staff/')||path.startsWith('/api/guard/'))?jar.get('gp-staff-csrf'):path.startsWith('/api/reception/')?(jar.get('gp-staff-csrf')??jar.get('gp-reception-csrf')):jar.get('gp-dev-csrf'))??'','x-intake-csrf-token':(path.startsWith('/api/reception/manual/')?jar.get('gp-reception-intake-csrf'):jar.get('gp-dev-intake-csrf'))??'','x-reception-office':(body?.testOffice??'NOIDA'),...(method==='POST'?{'content-type':Buffer.isBuffer(body)?'image/jpeg':'application/json','content-length':bytes.length}:{})}},res=>{const chunks:Buffer[]=[];res.on('data',part=>chunks.push(part));res.on('end',()=>{const raw=Buffer.concat(chunks);let data:any;try{data=JSON.parse(raw.toString());}catch{data=raw.toString();}resolve({status:res.statusCode!,body:data,headers:res.headers,raw});});});req.on('error',reject);req.end(method==='POST'?bytes:undefined);
  });
  for(const value of response.headers['set-cookie']??[]) {
    const [name,...parts]=value.split(';')[0].split('=');const content=parts.join('=');
    if(content)jar.set(name,content);else jar.delete(name);
    if(['gp-dev-intake','gp-reception-intake'].includes(name)&&content){const intake=JSON.parse(Buffer.from(content.split('.')[0],'base64url').toString());intakes.set(intake.intakeId,{intakeId:intake.intakeId,tokenHash:digest(Buffer.from(intake.intakeToken,'base64url'))});}
    if(['gp-dev-session','gp-reception-session','gp-staff-session'].includes(name)&&content)sessions.add(digest(Buffer.from(content,'base64url')));
  }
  return response;
}
async function check(name:string,work:()=>Promise<void>){try{await writeFile(new URL('../tmp/registration-audit-progress.txt',import.meta.url),name);await work();checks.push(name);}catch(error){throw new Error(name+': '+((error as Error).stack??String(error)));}}

try {
 await new Promise<void>((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('LISTENER_TIMEOUT')),30000);child.stdout.on('data',p=>{out+=p;if(out.includes('GatePass employee portal:')){clearTimeout(timer);resolve();}});child.on('exit',()=>{clearTimeout(timer);reject(new Error('LISTENER_EXIT'));});});
 const sharp=createRequire(import.meta.url)(process.env.GATEPASS_SHARP_PATH??'sharp');
 await check('manual API requires staff identity before accepting an external intake',async()=>{assert.equal((await call('/api/reception/manual/start',{requestType:'EXTERNAL'})).status,401);});
 await check('manual API rechecks the receptionist office and forbids employee impersonation',async()=>{
  const login=await call('/api/staff/login',{login:receptionAccount.loginId,password:receptionAccount.password});assert.equal(login.status,200,JSON.stringify(login.body));
  assert.equal((await call('/api/reception/manual/start',{requestType:'DIGITAL_ID'})).status,400);
  assert.equal((await call('/api/reception/manual/options',{testOffice:'CHENNAI'})).status,403);
 });
 let options:any,project:any,host:any,photoId:string,submitted:any;
 await check('manual intake uses isolated capability cookies and resolves scoped host names/emails',async()=>{
  const page=await call('/reception/register/noida',{},'GET');assert.equal(page.status,200);assert.ok(page.body.includes('data-reception-manual="true"'));assert.match(page.headers['content-security-policy'],/frame-ancestors 'self'/);
  assert.equal((await call('/api/reception/manual/start',{requestType:'EXTERNAL'})).status,200);assert.ok(jar.has('gp-reception-intake'));assert.ok(!jar.has('gp-dev-intake'));
  options=(await call('/api/reception/manual/options')).body;assert.equal(options.locationCode,'NOIDA');project=options.projects[0];
  host=(await call('/api/reception/manual/options',{projectLocationId:project.projectLocationId,search:'Employee'})).body.hosts[0];assert.ok(host?.officialEmail);
 });
 await check('manual photo upload uses actual normalization and private storage',async()=>{
  const jpg=await sharp({create:{width:600,height:800,channels:3,background:'#456789'}}).jpeg().toBuffer();const r=await call('/api/reception/manual/photo',jpg);assert.equal(r.status,200,JSON.stringify(r.body));photoId=r.body.photoAssetId;photos.add(photoId);
 });
 const key=randomUUID(),person=randomUUID();clientKeys.add(key);
 await check('manual submit is real, remains pending, retries idempotently and cannot override office',async()=>{
  const body={requestType:'EXTERNAL',clientKey:key,projectLocationId:project.projectLocationId,hostEmployeeId:host.employeeId,visitDate:options.currentDate,reason:'Synthetic manual test',people:[{clientPersonKey:person,photoAssetId:photoId,name:'Manual Reception Test',phone:'+919876543210',email:'synthetic@example.com'}]};
  assert.equal((await call('/api/reception/manual/submit',{...body,locationId:999})).status,400);
  const first=await call('/api/reception/manual/submit',body);assert.equal(first.status,200,JSON.stringify(first.body));submitted=first.body;assert.equal(submitted.visits.length,1);assert.equal(submitted.visits[0].status,'PENDING');visits.push(submitted.visits[0].visitRequestId);
  const retry=await call('/api/reception/manual/submit',body);assert.equal(retry.status,200,JSON.stringify(retry.body));assert.equal(retry.body.visits[0].visitRequestId,visits[0]);
 });
 await check('reminder status and same-key retry preserve a queued original approval',async()=>{
  const status=await call('/api/reception/remind-host',{visitRequestId:visits[0]});assert.equal(status.status,200,JSON.stringify(status.body));assert.equal(status.body.mailStatus,'QUEUED');assert.equal(status.body.eligible,true);
  const key=randomUUID(),body={visitRequestId:visits[0],clientKey:key};const first=await call('/api/reception/remind-host',body);assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.outcome,'ALREADY_QUEUED');assert.deepEqual((await call('/api/reception/remind-host',body)).body,first.body);
  assert.equal((await call('/api/reception/remind-host',{...body,email:'other@example.com'})).status,400);
 });
 await check('reception sees the real host/project/email and card without exposing source secrets',async()=>{
  const me=await call('/api/reception/me');assert.equal(me.status,200);const office=me.body.locations[0].locationId;
  const list=await call('/api/reception/list',{locationId:office,visitDate:options.currentDate,search:submitted.visits[0].publicReference});assert.equal(list.status,200,JSON.stringify(list.body));assert.equal(list.body.visits.length,1);assert.equal(list.body.visits[0].hostName,host.displayName);assert.equal(list.body.visits[0].hostEmail,host.officialEmail);assert.equal(list.body.visits[0].projectName,project.projectName);
  const detail=await call('/api/reception/detail',{visitRequestId:visits[0]});assert.equal(detail.status,200);assert.equal(detail.body.hostEmail,host.officialEmail);assert.ok(Array.isArray(detail.body.movements));
  for(const forbidden of ['storageKey','ciphertext','credentialHash','claimToken','snapshotHash'])assert.ok(!Object.hasOwn(detail.body,forbidden));
  const started=performance.now();const preview=await call('/api/reception/preview',{visitRequestId:visits[0]});assert.equal(preview.status,200,JSON.stringify(preview.body));assert.equal(preview.body.mimeType,'image/png');timings.previewMs=Math.round(performance.now()-started);
  const printStart=performance.now(),job=await call('/api/reception/print/request',{visitRequestId:visits[0],expectedPassId:detail.body.accessPassId,clientKey:randomUUID()});assert.equal(job.status,200,JSON.stringify(job.body));const print=await call('/api/reception/print/render',{printJobId:job.body.printJobId});assert.equal(print.status,200,JSON.stringify(print.body));assert.equal(print.body.status,'DISPATCHED');timings.printHandoffMs=Math.round(performance.now()-printStart);
  assert.equal((await call('/api/staff/logout')).status,200);assert.equal((await call('/api/reception/manual/options')).status,401);
 });
} catch(error){failure=String((error as Error).stack??error)+' '+rpcDiagnostic;}
finally{child.kill();await new Promise<void>(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',()=>resolve());});}
process.stdout.write(JSON.stringify({status:failure?'FAIL':'PASS',failure,cases:checks.length,checks,intakes:[...intakes.values()],ownedSessionHashes:[...sessions],clientKeys:[...clientKeys],photos:[...photos],visits,actualSql:true,actualHttp:true,mailSent:false,timings}));