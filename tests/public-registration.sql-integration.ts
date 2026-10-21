import {chromium} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {localEmailLinks} from '../src/email/LocalEmailLinks.ts';
import {BinaryBitmap,HybridBinarizer,RGBLuminanceSource,QRCodeReader,DecodeHintType} from '@zxing/library';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {request} from 'node:http';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';

let rawInput='';for await(const part of process.stdin)rawInput+=part;
const receptionAccount=JSON.parse(await readFile(join(homedir(),'.gatepass','development-logins','staff.json'),'utf8')).find((row:any)=>row.staffId==='REC001');
assert.ok(receptionAccount);
const input=JSON.parse(rawInput),jar=new Map<string,string>(),intakes=new Map(),sessions=new Set<string>(),clientKeys=new Set<string>(),photos=new Set<string>();
const checks:string[]=[];let failure:string|undefined;let cardCredentialHash:string|undefined;let digitalCredential:string|undefined;const visits:string[]=[];
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
const child=spawn(process.execPath,[fileURLToPath(new URL('../tools/start-dummy-sso.ts',import.meta.url))],{env:{...process.env,GATEPASS_DUMMY_PORT:'18446',GATEPASS_TEST_STORAGE_ROOT:input.storageRoot},windowsHide:true,stdio:['ignore','pipe','pipe']});let rpcDiagnostic='';child.stderr.on('data',part=>{for(const line of String(part).split(/\r?\n/u))if(/^GP_RPC_FAILURE gp\.[A-Za-z]+ SQL_-?[0-9]+(?: [A-Za-z.]+)?$/u.test(line))rpcDiagnostic=line;});
async function call(path:string,body:any={},method='POST') {
  const bytes=Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
  const response=await new Promise<{status:number;body:any;headers:any;raw:Buffer}>((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:18446,path,method,headers:{host:'localhost:18446',origin:'http://localhost:18446',cookie:[...jar].map(([key,value])=>key+'='+value).join('; '),'x-csrf-token':((path.startsWith('/api/staff/')||path.startsWith('/api/guard/'))?jar.get('gp-staff-csrf'):path.startsWith('/api/reception/')?(jar.get('gp-staff-csrf')??jar.get('gp-reception-csrf')):jar.get('gp-dev-csrf'))??'','x-intake-csrf-token':jar.get('gp-dev-intake-csrf')??'',...(method==='POST'?{'content-type':Buffer.isBuffer(body)?'image/jpeg':'application/json','content-length':bytes.length}:{})}},res=>{const chunks:Buffer[]=[];res.on('data',part=>chunks.push(part));res.on('end',()=>{const raw=Buffer.concat(chunks);let data:any;try{data=JSON.parse(raw.toString());}catch{data=raw.toString();}resolve({status:res.statusCode!,body:data,headers:res.headers,raw});});});req.on('error',reject);req.end(method==='POST'?bytes:undefined);
  });
  for(const value of response.headers['set-cookie']??[]) {
    const [name,...parts]=value.split(';')[0].split('=');const content=parts.join('=');
    if(content)jar.set(name,content);else jar.delete(name);
    if(name==='gp-dev-intake'&&content){const intake=JSON.parse(Buffer.from(content.split('.')[0],'base64url').toString());intakes.set(intake.intakeId,{intakeId:intake.intakeId,tokenHash:digest(Buffer.from(intake.intakeToken,'base64url'))});}
    if(['gp-dev-session','gp-reception-session','gp-staff-session'].includes(name)&&content)sessions.add(digest(Buffer.from(content,'base64url')));
  }
  return response;
}
async function check(name:string,work:()=>Promise<void>){try{await writeFile(new URL('../tmp/registration-audit-progress.txt',import.meta.url),name);await work();checks.push(name);}catch(error){throw new Error(name+': '+((error as Error).stack??String(error)));}}
async function start(type:string){assert.equal((await call('/api/registration/reset')).status,200);assert.equal((await call('/api/registration/start',{requestType:type})).status,200);const result=await call('/api/registration/options');assert.equal(result.status,200,JSON.stringify(result.body));return result.body;}
async function submit(body:any){clientKeys.add(body.clientKey);return call('/api/registration/submit',body);}
try {
  await new Promise<void>((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('LISTENER_TIMEOUT')),30000);child.stdout.on('data',part=>{output+=part;if(output.includes('GatePass employee portal:')){clearTimeout(timer);resolve();}});child.on('error',reject);child.on('exit',()=>{clearTimeout(timer);reject(new Error('LISTENER_EXIT'));});});
  await check('office entry serves shared original Noida background, two flow choices and nonce-protected scripts',async()=>{
    const page=await call('/office/noida',{},'GET');assert.equal(page.status,200);assert.match(page.body,/SSI Employee/u);assert.match(page.body,/Visitor/u);assert.ok(!page.body.includes('__APP_STYLES__'));assert.ok(!page.body.includes('__OFFICE_NAME__'));assert.match(page.body,/--gp-canvas/u);
    new Script(/<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(page.body)![1]);
    assert.equal(page.headers['permissions-policy'],'camera=(self), microphone=(), geolocation=()');assert.match(page.headers['content-security-policy'],/img-src 'self'/u);
    const asset=await call('/assets/office-background.png',{},'GET');assert.equal(asset.status,200);assert.equal(digest(asset.raw),digest(await readFile(new URL('../assets/locations/office-background.png',import.meta.url))));
  });
  let options:any,project:any,host:any;
  await check('public visitor intake resolves office, current date and project options from SQL',async()=>{options=await start('EXTERNAL');assert.equal(options.locationCode,'NOIDA');assert.ok(options.projects.length);project=options.projects[0];});
  await check('host name/email search is limited to requested project and office',async()=>{
    const result=await call('/api/registration/options',{projectLocationId:project.projectLocationId,search:'employee'});assert.equal(result.status,200,JSON.stringify(result.body));assert.ok(result.body.hosts.length);host=result.body.hosts[0];assert.ok(host.officialEmail.endsWith('@example.com'));
    assert.equal((await call('/api/registration/options',{projectLocationId:'999999999',search:'employee'})).status,403);
  });
  const sharp=createRequire(import.meta.url)(process.env.GATEPASS_SHARP_PATH??join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','sharp'));
  const image=await sharp({create:{width:160,height:200,channels:3,background:'#776655'}}).jpeg().toBuffer();
  const people=[];
  for(let index=0;index<2;index++){const uploaded=await call('/api/registration/photo',image);assert.equal(uploaded.status,200);photos.add(uploaded.body.photoAssetId);people.push({clientPersonKey:randomUUID(),photoAssetId:uploaded.body.photoAssetId,name:'Integration Visitor '+index,phone:'+91987654321'+index,email:'visitor'+index+'@example.com'});}
  const tomorrow=new Date(Date.parse(options.currentDate+'T12:00:00.000Z')+86400000).toISOString().slice(0,10);
  const payload={clientKey:randomUUID(),requestType:'EXTERNAL',projectLocationId:project.projectLocationId,hostEmployeeId:host.employeeId,reason:'Business meeting',visitDate:tomorrow,people};
  await check('visitor cannot override QR office, send raw timestamps or use a past date',async()=>{
    assert.equal((await submit({...payload,locationId:options.locationId})).status,400);
    assert.equal((await submit({...payload,validUntilUtc:'2099-01-01T00:00:00.000Z'})).status,400);
    assert.equal((await submit({...payload,visitDate:'2000-01-01'})).status,400);
  });
  await check('final SQL submission rejects a host who does not belong to requested project',async()=>{
    const directory=JSON.parse(await readFile(new URL('../database/development/directory-fixtures.json',import.meta.url),'utf8'));
    const wrong=directory.employees.find((row:any)=>row.isActive&&!row.projectCodes.includes(project.projectCode));assert.ok(wrong);
    const result=await submit({...payload,hostEmployeeId:wrong.employeeId});assert.ok([403,503].includes(result.status),JSON.stringify(result.body));
  });
  await check('future-date group visitor submission creates two independent pending visits and same-key retry returns them',async()=>{
    const first=await submit(payload);assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.visits.length,2);assert.ok(first.body.visits.every((row:any)=>row.status==='PENDING'));
    const retry=await submit(payload);assert.equal(retry.status,200);assert.deepEqual(retry.body.visits,first.body.visits);for(const row of first.body.visits)visits.push(row.visitRequestId);
  });
  await check('changing office entry cannot silently move an existing intake to another office',async()=>{
    assert.equal((await call('/office/pune',{},'GET')).status,200);assert.equal((await call('/api/registration/options')).status,403);assert.equal((await call('/office/noida',{},'GET')).status,200);
  });
  let employee:any;
  await check('email sign-in resolves existing synthetic SSO identity and assigned projects',async()=>{
    const accounts=await call('/api/dev/sso/employees');const account=accounts.body.employees.find((row:any)=>row.employeeId==='EMP014');assert.ok(account);
    const result=await call('/api/dev/sso/login',{email:account.officialEmail,password:'Sopra@123'});assert.equal(result.status,200,JSON.stringify(result.body));employee=result.body.employee;assert.equal(employee.employeeId,'EMP014');assert.ok(employee.projects.length);
  });
  let digitalId:string;
  await check('employee rejects every supplied date and creates today-only approved Digital ID',async()=>{
    options=await start('DIGITAL_ID');const uploaded=await call('/api/registration/photo',image);assert.equal(uploaded.status,200);photos.add(uploaded.body.photoAssetId);
    const body={clientKey:randomUUID(),requestType:'DIGITAL_ID',reason:'Forgot my card',digitalIdReason:'FORGOT',people:[{clientPersonKey:randomUUID(),photoAssetId:uploaded.body.photoAssetId}]};
    assert.equal((await submit({...body,visitDate:options.currentDate})).status,400);
    assert.equal((await submit({...body,visitDate:options.maxVisitDate})).status,400);
    const result=await submit(body);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.visits[0].status,'APPROVED');digitalId=result.body.visits[0].visitRequestId;visits.push(digitalId);
    const detail=await call('/api/employee/digital-id/detail',{visitRequestId:digitalId});assert.equal(detail.status,200);assert.ok(detail.body.validUntilUtc.endsWith('T18:30:00.000Z'));
  });
  await check('owner downloads actual landscape PNG with the issued scannable QR and no source secrets',async()=>{
    const result=await call('/api/employee/digital-id/image',{visitRequestId:digitalId});assert.equal(result.status,200,JSON.stringify(result.body));
    assert.deepEqual(Object.keys(result.body).sort(),['fileName','imageBase64','mimeType']);assert.equal(result.body.mimeType,'image/png');assert.equal(result.headers['cache-control'],'no-store');
    const png=Buffer.from(result.body.imageBase64,'base64'),metadata=await sharp(png).metadata();assert.equal(metadata.width,1712);assert.equal(metadata.height,1080);
    const crop=await sharp(png).extract({left:1248,top:264,width:416,height:416}).resize(832,832).png().toBuffer();
    let credential:string|undefined;
    for(const angle of [0,90,180,270]){
      const raw=await sharp(crop).rotate(angle).flatten({background:'white'}).removeAlpha().greyscale().raw().toBuffer({resolveWithObject:true});
      const luminance=new RGBLuminanceSource(new Uint8ClampedArray(raw.data.buffer,raw.data.byteOffset,raw.data.byteLength),raw.info.width,raw.info.height);
      try{credential=new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(luminance)),new Map([[DecodeHintType.TRY_HARDER,true]])).getText();break;}catch{/* Independent detector may select a false finder in one orientation. */}
    }
    assert.ok(credential,'Downloaded card QR could not be decoded');
    assert.match(credential,/^[A-Za-z0-9_-]{43}$/u);cardCredentialHash=digest(Buffer.from(credential,'base64url'));digitalCredential=credential;
    await writeFile(new URL('../tmp/own-card-preview.png',import.meta.url),png);
    assert.equal((await call('/api/employee/digital-id/image',{visitRequestId:digitalId,employeeId:'EMP001'})).status,400);
    assert.equal((await call('/api/employee/digital-id/image',{visitRequestId:visits[0]})).status,403);
  });
  await check('extra employee project request has an independent pending approval and keeps Digital ID approved',async()=>{
    options=await start('EMPLOYEE_PROJECT');const own=new Set(employee.projects.map((row:any)=>row.projectCode));const extra=options.projects.find((row:any)=>!own.has(row.projectCode));assert.ok(extra);
    const lookup=await call('/api/registration/options',{projectLocationId:extra.projectLocationId,search:'employee'});assert.equal(lookup.status,200);assert.ok(lookup.body.hosts.length);
    const uploaded=await call('/api/registration/photo',image);assert.equal(uploaded.status,200);photos.add(uploaded.body.photoAssetId);
    const result=await submit({clientKey:randomUUID(),requestType:'EMPLOYEE_PROJECT',reason:'Project discussion',projectLocationId:extra.projectLocationId,hostEmployeeId:lookup.body.hosts[0].employeeId,people:[{clientPersonKey:randomUUID(),photoAssetId:uploaded.body.photoAssetId}]});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.visits[0].status,'PENDING');visits.push(result.body.visits[0].visitRequestId);
    assert.equal((await call('/api/employee/digital-id/detail',{visitRequestId:digitalId})).body.status,'APPROVED');
  });
  await check('another authenticated employee cannot download the first employee card',async()=>{
    const other=await call('/api/dev/sso/login',{email:'employee1@example.com',password:'Sopra@123'});assert.equal(other.status,200);
    const denied=await call('/api/employee/digital-id/image',{visitRequestId:digitalId});assert.equal(denied.status,403);assert.ok(!denied.raw.toString().includes('imageBase64'));
    await call('/api/dev/sso/logout');assert.equal((await call('/api/employee/digital-id/image',{visitRequestId:digitalId})).status,401);
  });
  await check('guard workspace derives assignments from SQL and scopes office access',async()=>{
    const guard=JSON.parse(await readFile(join(homedir(),'.gatepass','development-logins','guards.json'),'utf8')).find((r:any)=>r.guardId==='GRD001');assert.ok(guard);
    const login=await call('/api/staff/login',{login:guard.loginId,password:guard.password});assert.equal(login.status,200,JSON.stringify(login.body));assert.ok(login.body.workspaces.some((w:any)=>w.path==='/guard'));
    const ctx=await call('/api/guard/context');assert.equal(ctx.status,200,JSON.stringify(ctx.body));assert.equal(ctx.body.locations.length,1);assert.equal(ctx.body.locations[0].locationName,'Noida');
    const page=await call('/guard',{},'GET');assert.equal(page.status,200);assert.equal(page.headers['permissions-policy'],'camera=(self), microphone=(), geolocation=()');assert.ok(page.body.includes('id="scan-video"'));new Script(/<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(page.body)![1]);
    const projects=await call('/api/guard/projects',{locationId:ctx.body.locations[0].locationId});assert.equal(projects.status,200,JSON.stringify(projects.body));assert.ok(projects.body.projects.length>1);assert.equal(projects.body.canHandleDigitalId,true);
    assert.equal((await call('/api/guard/projects',{locationId:ctx.body.locations[0].locationId===1?2:1})).status,403);
    assert.equal((await call('/api/admin/context')).status,403);
  });
  await check('Digital ID uses explicit project duty, independent movement, and read-only common verification',async()=>{
    const ctx=await call('/api/guard/context'),locationId=ctx.body.locations[0].locationId;
    const roster=await call('/api/guard/duties',{locationId});assert.equal(roster.status,200,JSON.stringify(roster.body));
    const projectDuty=roster.body.duties.find((d:any)=>d.kind==='PROJECT'&&d.name==='Project 1'),commonDuty=roster.body.duties.find((d:any)=>d.kind==='COMMON');assert.ok(projectDuty&&commonDuty);
    const scope={locationId,dutyKind:'PROJECT',dutyId:projectDuty.dutyId},commonScope={locationId,dutyKind:'COMMON',dutyId:commonDuty.dutyId};
    const queueInput={...scope,queue:'EXPECTED',search:'',offset:0};
    const expected=await call('/api/guard/visitors',queueInput);assert.equal(expected.status,200,JSON.stringify(expected.body));assert.ok(expected.body.visitors.some((v:any)=>v.visitRequestId===digitalId));assert.ok(!expected.body.visitors.some((v:any)=>visits.slice(0,2).includes(v.visitRequestId)));
    const ownProjects=expected.body.visitors.find((v:any)=>v.visitRequestId===digitalId).employeeProjects;assert.equal(ownProjects.available,true);assert.equal(ownProjects.total,employee.projects.length);
    const extraDuty=roster.body.duties.find((d:any)=>d.kind==='PROJECT'&&d.name==='Project 2');assert.ok(extraDuty);
    const extraScope={locationId,dutyKind:'PROJECT',dutyId:extraDuty.dutyId};
    const projectDetail=await call('/api/guard/detail',{...extraScope,visitRequestId:visits[3]});assert.equal(projectDetail.status,200,JSON.stringify(projectDetail.body));assert.match(projectDetail.body.hostName,/^Employee /u);assert.equal(projectDetail.body.canEnter,false);
    const commonPending=await call('/api/guard/detail',{...commonScope,visitRequestId:visits[3]});assert.equal(commonPending.status,200,JSON.stringify(commonPending.body));assert.equal(commonPending.body.commonAccessAllowed,true);assert.equal(commonPending.body.canEnter,false);assert.equal(commonPending.body.verificationOnly,true);
    assert.equal((await call('/api/guard/visitors',{...queueInput,dutyId:'01'})).status,400);assert.equal((await call('/api/guard/visitors',{...queueInput,dutyId:'9223372036854775807'})).status,403);
    assert.equal((await call('/api/guard/visitors',{locationId,queue:'EXPECTED',search:'',offset:0})).status,400);
    const verified=await call('/api/guard/verify',{...scope,credential:digitalCredential,correlationId:randomUUID()});assert.equal(verified.status,200,JSON.stringify(verified.body));assert.equal(verified.body.outcome,'VALID');assert.equal(verified.body.visit.canEnter,true);
    const v=verified.body.visit;const photoResult=await call('/api/guard/photo',{...scope,visitRequestId:digitalId});assert.equal(photoResult.status,200,JSON.stringify(photoResult.body));
    const entry={...scope,clientKey:randomUUID(),visitRequestId:digitalId,accessPassId:v.accessPassId,eventType:'ENTRY',entryMethod:'SCAN',credential:digitalCredential};
    assert.equal((await call('/api/guard/movement',{...entry,dutyKind:'COMMON',dutyId:commonDuty.dutyId})).status,400);
    assert.equal((await call('/api/guard/movement',{...entry,dutyId:'999999999'})).status,403);
    const marked=await call('/api/guard/movement',entry);assert.equal(marked.status,200,JSON.stringify(marked.body));assert.equal(marked.body.isInside,true);assert.deepEqual((await call('/api/guard/movement',entry)).body,marked.body);
    const insideQueue=await call('/api/guard/visitors',{...queueInput,queue:'INSIDE'});assert.equal(insideQueue.status,200,JSON.stringify(insideQueue.body));assert.ok(insideQueue.body.visitors.some((v:any)=>v.visitRequestId===digitalId&&v.isInside));
    const commonRead=await call('/api/guard/detail',{...commonScope,visitRequestId:digitalId});assert.equal(commonRead.status,200);assert.equal(commonRead.body.commonAccessAllowed,true);assert.equal(commonRead.body.isInside,false);assert.equal(commonRead.body.canEnter,false);assert.equal(commonRead.body.canExit,false);
    const otherGuard=JSON.parse(await readFile(join(homedir(),'.gatepass','development-logins','guards.json'),'utf8')).find((r:any)=>r.guardId==='GRD005');assert.equal((await call('/api/staff/login',{login:otherGuard.loginId,password:otherGuard.password})).status,200);const otherQueue=await call('/api/guard/visitors',{...queueInput,queue:'INSIDE'});assert.equal(otherQueue.status,200);assert.ok(!otherQueue.body.visitors.some((v:any)=>v.visitRequestId===digitalId));
    const originalGuard=JSON.parse(await readFile(join(homedir(),'.gatepass','development-logins','guards.json'),'utf8')).find((r:any)=>r.guardId==='GRD001');assert.equal((await call('/api/staff/login',{login:originalGuard.loginId,password:originalGuard.password})).status,200);
    const inside=await call('/api/guard/detail',{...scope,visitRequestId:digitalId});assert.equal(inside.body.canExit,true);assert.ok(inside.body.movements.some((m:any)=>m.eventType==='ENTRY'&&m.guardName==='Guard 1'));
    const exited=await call('/api/guard/movement',{...entry,clientKey:randomUUID(),eventType:'EXIT'});assert.equal(exited.status,200,JSON.stringify(exited.body));assert.equal(exited.body.isInside,false);
    assert.ok(!(await call('/api/guard/visitors',{...queueInput,queue:'INSIDE'})).body.visitors.some((v:any)=>v.visitRequestId===digitalId));
    assert.equal((await call('/api/staff/logout')).status,200);assert.equal((await call('/api/guard/context')).status,401);
  });
  let receptionContext:any,receptionVisit:any;
  await check('common staff entry opens reception with a local scoped staff account',async()=>{
    const deep=await call('/reception',{},'GET');assert.equal(deep.status,303);assert.equal(deep.headers.location,'/');
    const page=await call('/',{},'GET');assert.equal(page.status,200);assert.match(page.body,/Email or Staff ID/u);assert.ok(!page.body.includes('SSI Employee'));assert.ok(!page.body.includes('__SCRIPT__'));new Script(/<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(page.body)![1]);
    const login=await call('/api/staff/login',{login:receptionAccount.loginId,password:receptionAccount.password});assert.equal(login.status,200,JSON.stringify(login.body));assert.equal(login.body.workspaces[0].path,'/reception');assert.ok(login.body.grants.some((g:any)=>g.roleCode==='RECEPTION'&&g.scopeName==='Noida'));assert.ok(jar.has('gp-staff-session'));assert.ok(!Object.hasOwn(login.body,'sessionToken'));
    const me=await call('/api/reception/me');assert.equal(me.status,200,JSON.stringify(me.body));receptionContext=me.body;assert.equal(me.body.locations.length,1);assert.equal(me.body.locations[0].locationCode,'NOIDA');assert.equal(me.body.locations[0].canPrint,true);
    assert.equal((await call('/api/staff/me',{role:'INDIA_ADMIN'})).status,400);
    assert.equal((await call('/reception',{},'GET')).status,200);
  });
  await check('reception daily search and status filtering remain inside assigned office',async()=>{
    const locationId=receptionContext.locations[0].locationId;
    const all=await call('/api/reception/list',{locationId,visitDate:tomorrow,search:'Integration Visitor',status:'PENDING'});assert.equal(all.status,200,JSON.stringify(all.body));assert.equal(all.body.visits.length,2);receptionVisit=all.body.visits[0];assert.equal(receptionVisit.printCount,0);
    assert.equal((await call('/api/reception/list',{locationId:locationId===1?2:1,visitDate:tomorrow})).status,403);
    const empty=await call('/api/reception/list',{locationId,search:'nobody-'+randomUUID()});assert.equal(empty.status,200,JSON.stringify(empty.body));assert.equal(empty.body.visits.length,0);
    assert.equal((await call('/api/reception/list',{locationId,actorId:randomUUID()})).status,400);
  });
  await check('pending reception preview and photo read create no print job',async()=>{
    const detail=await call('/api/reception/detail',{visitRequestId:receptionVisit.visitRequestId});assert.equal(detail.status,200);assert.equal(detail.body.status,'PENDING');
    const photo=await call('/api/reception/photo',{visitRequestId:receptionVisit.visitRequestId});assert.equal(photo.status,200);assert.equal(photo.body.mimeType,'image/jpeg');
    const preview=await call('/api/reception/preview',{visitRequestId:receptionVisit.visitRequestId});assert.equal(preview.status,200,JSON.stringify(preview.body));assert.equal(preview.body.mimeType,'image/png');const metadata=await sharp(Buffer.from(preview.body.imageBase64,'base64')).metadata();assert.equal(metadata.width,1712);
    assert.equal((await call('/api/reception/list',{locationId:receptionContext.locations[0].locationId,visitDate:tomorrow,search:receptionVisit.publicReference})).body.visits[0].printCount,0);
  });
  await check('pending card print request is idempotent, dispatched once and reprint is separately audited',async()=>{
    const body={clientKey:randomUUID(),visitRequestId:receptionVisit.visitRequestId,expectedPassId:receptionVisit.accessPassId,printerLabel:'Integration browser handoff'};
    const first=await call('/api/reception/print/request',body);assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.printReason,'FIRST');
    assert.equal((await call('/api/reception/print/request',body)).body.printJobId,first.body.printJobId);
    const rendered=await call('/api/reception/print/render',{printJobId:first.body.printJobId});assert.equal(rendered.status,200,JSON.stringify(rendered.body));assert.equal(rendered.body.status,'DISPATCHED');const svg=Buffer.from(rendered.body.imageBase64,'base64').toString();assert.ok(svg.includes('Sopra Steria QR icon'));assert.ok(svg.includes('Integration Visitor'));
    assert.equal((await call('/api/reception/print/render',{printJobId:first.body.printJobId})).status,409);
    const reprint=await call('/api/reception/print/request',{...body,clientKey:randomUUID()});assert.equal(reprint.status,200);assert.equal(reprint.body.printReason,'REPRINT');assert.notEqual(reprint.body.printJobId,first.body.printJobId);
    assert.equal((await call('/api/reception/print/render',{printJobId:reprint.body.printJobId})).status,200);
    const result=await call('/api/reception/list',{locationId:receptionContext.locations[0].locationId,visitDate:tomorrow,search:receptionVisit.publicReference});assert.equal(result.body.visits[0].printCount,2);
    assert.equal((await call('/api/staff/logout')).status,200);assert.equal((await call('/api/reception/me')).status,401);
  });
   let approval:any,denial:any,externalLink:string;
   await check('email approval link GET is inert and forwarded links do not grant host authority',async()=>{
     const page=await call('/approval/'+visits[0],{},'GET');assert.equal(page.status,200);new Script(/<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(page.body)![1]);assert.match(page.headers['cache-control'],/no-store/u);assert.match(page.body,/Visit approval|email-request|Request details/u);assert(!page.body.includes('My Requests'));
     const directory=JSON.parse(await readFile(new URL('../database/development/directory-fixtures.json',import.meta.url),'utf8'));
     const wrong=directory.employees.find((p:any)=>p.isActive&&p.employeeId!==host.employeeId);assert.equal((await call('/api/dev/sso/login',{email:wrong.officialEmail,password:'Sopra@123'})).status,200);
     assert.equal((await call('/api/email/host/detail',{visitRequestId:visits[0]})).status,403);
     assert.equal((await call('/api/dev/sso/login',{email:host.officialEmail,password:'Sopra@123'})).status,200);
     const r=await call('/api/email/host/detail',{visitRequestId:visits[0]});assert.equal(r.status,200,JSON.stringify(r.body));approval=r.body;assert.equal(approval.status,'PENDING');assert.equal(approval.canDecide,true);
     assert.equal((await call('/api/email/host/photo',{visitRequestId:visits[0]})).status,200);
   });
   await check('host email approval uses exact snapshot and idempotency while other participant stays pending',async()=>{
     const data={visitRequestId:visits[0],clientKey:randomUUID(),snapshotVersion:approval.snapshotVersion,snapshotHash:approval.snapshotHash,decision:'APPROVED'};
     assert.equal((await call('/api/email/host/decide',{...data,snapshotHash:'0'.repeat(64)})).status,409);
     const first=await call('/api/email/host/decide',data);assert.equal(first.status,200,JSON.stringify(first.body));assert.deepEqual((await call('/api/email/host/decide',data)).body,first.body);
     assert.equal((await call('/api/email/host/decide',{...data,decision:'DENIED'})).status,409);
     const other=await call('/api/email/host/detail',{visitRequestId:visits[1]});assert.equal(other.status,200);denial=other.body;assert.equal(denial.status,'PENDING');
   });
   await check('host email rejection is independent and approved credential status remains current',async()=>{
     const r=await call('/api/email/host/decide',{visitRequestId:visits[1],clientKey:randomUUID(),snapshotVersion:denial.snapshotVersion,snapshotHash:denial.snapshotHash,decision:'DENIED'});assert.equal(r.status,200,JSON.stringify(r.body));
     assert.equal((await call('/api/email/host/detail',{visitRequestId:visits[0]})).body.status,'APPROVED');assert.equal((await call('/api/email/host/detail',{visitRequestId:visits[1]})).body.passStatus,'DENIED');
   });
   await check('signed external email status and PNG retrieval reject tampering without requiring an employee session',async()=>{
     assert.equal((await call('/api/dev/sso/logout')).status,200);const codec=await localEmailLinks(input.storageRoot);
     const link=await codec.issue({v:1,visit:visits[0],emailHash:createHash('sha256').update(people.find(p=>p.name===approval.personName)!.email.toLowerCase(),'utf16le').digest('hex'),snapshot:approval.snapshotHash.toLowerCase(),expires:Date.parse(approval.validUntilUtc)+86400000});
     externalLink=link;const detail=await call('/api/email/external/detail',{link});assert.equal(detail.status,200,JSON.stringify(detail.body));assert.equal(detail.body.status,'APPROVED');assert.equal('snapshotHash' in detail.body,false);
     assert.equal((await call('/api/email/external/detail',{link:link+'x'})).status,403);assert.equal((await call('/api/email/external/detail',{visitRequestId:visits[0]})).status,400);
     const png=await call('/api/email/external/image',{link});assert.equal(png.status,200,JSON.stringify(png.body));assert.equal(png.body.mimeType,'image/png');assert.equal((await sharp(Buffer.from(png.body.imageBase64,'base64')).metadata()).width,1712);
     assert.equal((await call('/api/email/request/detail',{visitRequestId:digitalId})).status,401);
   });
   await check('email-linked browser shows the current card, downloads PNG and reauthenticates the host without a dashboard',async()=>{
    let stage='launch';const browser=await chromium.launch({headless:true});try{
     const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});const page=await context.newPage();
     stage='open-holder';await page.goto('http://localhost:18446/request/'+visits[0]+'#link='+externalLink);stage='holder-card';await page.locator('#card').waitFor({state:'visible',timeout:60000});assert.equal(await page.locator('#message').innerText(),'Approved');assert.equal(await page.locator('#login').isVisible(),false);assert(!page.url().includes('#'));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
     stage='holder-accessibility';const accessibility=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(accessibility.violations.map(v=>v.id),[],'Email accessibility: '+accessibility.violations.map(v=>v.id).join(','));
     stage='holder-download';const download=page.waitForEvent('download',{timeout:60000});await page.locator('#download').click();assert.equal((await download).suggestedFilename(),'GatePass-'+visits[0]+'.png');
     stage='host-login';let decisions=0;page.on('request',r=>{if(r.url().includes('/api/email/host/decide'))decisions++;});await page.goto('http://localhost:18446/approval/'+visits[0]+'#decision=APPROVED');await page.locator('#login').waitFor({state:'visible'});await page.locator('#email').fill(host.officialEmail);await page.locator('#password').fill('Sopra@123');await page.locator('#sign-in').click();stage='host-detail';await page.locator('#request').waitFor({state:'visible',timeout:60000});assert.equal(await page.locator('#message').innerText(),'Approved');assert.equal(await page.locator('#actions').isVisible(),false);assert.equal(decisions,0);
    }catch(e){throw new Error('Email browser verification failed at '+stage+' ('+(e as Error).name+').');}finally{await browser.close();}
   });
  if(input.uiReviewReady){
    await writeFile(input.uiReviewReady,JSON.stringify({intakes:[...intakes.values()],visits,port:18446,synthetic:true}));
    const deadline=Date.now()+1200000;while(true){try{await access(input.uiReviewReady+'.done');break;}catch{if(Date.now()>deadline)throw new Error('UI_REVIEW_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,250));}}
  }
} catch(error) {failure=((error as Error)?.message||(error as Error)?.name||String(error)||'UNKNOWN_TEST_FAILURE')+(rpcDiagnostic?' ['+rpcDiagnostic+']':'');}
finally {
  if(child.exitCode===null){child.kill();await new Promise<void>(resolve=>child.once('exit',()=>resolve()));}
  process.stdout.write(JSON.stringify({status:failure?'FAIL':'PASS',failure,cases:checks.length,checks,intakes:[...intakes.values()],ownedSessionHashes:[...sessions],clientKeys:[...clientKeys],photos:[...photos],visits,cardCredentialHash,actualSql:true,actualHttp:true,realSso:false,mailSent:false}));
  if(failure)process.exitCode=1;
}
