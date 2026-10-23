import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes,randomUUID} from 'node:crypto';import {Readable} from 'node:stream';
import {EmailLinkCodec} from '../src/email/EmailLinkCodec.ts';import {EmailWorkflowService} from '../src/email/EmailWorkflowService.ts';import {EmailPublicRoutes} from '../src/transport/EmailPublicRoutes.ts';import {NotificationEmailWorker} from '../src/email/NotificationEmailWorker.ts';
const now=Date.now(),visit=randomUUID(),pass=randomUUID(),hash='a'.repeat(64),snapshot='b'.repeat(64),key=randomBytes(32),source={active:async()=>({id:'k_'+'a'.repeat(32),key:Buffer.from(key)}),resolve:async()=>Buffer.from(key)};
const codec=new EmailLinkCodec(source,()=>now),data={v:1 as const,visit,emailHash:hash,snapshot,expires:now+3600000};
const detail={visitRequestId:visit,accessPassId:pass,canCancel:true,status:'APPROVED',passStatus:'ACTIVE',personName:'Visitor',publicReference:'V-test',locationName:'Noida',projectName:'Project',hostName:'Host',reason:'Meeting',validFromUtc:new Date(now).toISOString(),validUntilUtc:new Date(now+3600000).toISOString()};
function req(path:string,body:unknown,cookie?:string){return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{url:path,headers:{'content-type':'application/json',cookie}}) as any;}
test('revoke capabilities cannot be exchanged with read-only status, QR or another request',async()=>{
 const status=await codec.issue(data),revoke=await codec.issueRevoke(data);assert.deepEqual(await codec.verifyRevoke(revoke),data);await assert.rejects(codec.verifyRevoke(status));await assert.rejects(codec.verify(revoke));await assert.rejects(codec.verifyRevoke(revoke+'x'));await assert.rejects(new EmailLinkCodec(source,()=>now+3600001).verifyRevoke(revoke));
 let calls=0;const service=new EmailWorkflowService({callProcedure:async()=>{calls++;return JSON.stringify(detail);}},codec),routes=new EmailPublicRoutes(service);let writes=0;
 await assert.rejects(routes.handle(req('/api/email/external/session',{link:status,revokeLink:await codec.issueRevoke({...data,visit:randomUUID()})}),{setHeader(){writes++;}} as any),{status:403});assert.equal(writes,0);
 await assert.rejects(service.externalRevoke({link:status,clientKey:randomUUID(),expectedPassId:pass,confirm:true}),{code:'NOT_AUTHORIZED'});assert.equal(calls,1);
});
test('holder revocation requires its own HttpOnly capability, explicit confirmation and exact current pass',async()=>{
 const calls:any[]=[];const service=new EmailWorkflowService({async callProcedure(name,p){calls.push({name,p});return JSON.stringify(name==='gp.ReadEmailRequest'?detail:{operationId:randomUUID(),visitRequestId:visit,accessPassId:pass,status:'CANCELLED',wasInsideAtCancellation:true});}},codec),routes=new EmailPublicRoutes(service);
 const link=await codec.issue(data),revokeLink=await codec.issueRevoke(data);let headers:string[]=[];await routes.handle(req('/api/email/external/session',{link,revokeLink}),{setHeader(_n:string,v:string[]){headers=v;}} as any);assert.equal(headers.length,2);assert(headers.every(v=>v.includes('; HttpOnly; SameSite=Strict; Secure')&&v.includes('/'+visit+'/')));const cookie=headers.map(v=>v.split(';')[0]).join('; ');
 assert.equal((await routes.handle(req('/api/email/external/'+visit+'/detail',{},headers[0].split(';')[0]),{} as any) as any).canCancel,false);assert.equal((await routes.handle(req('/api/email/external/'+visit+'/detail',{},cookie),{} as any) as any).canCancel,true);
 const path='/api/email/external/'+visit+'/revoke',input={clientKey:randomUUID(),expectedPassId:pass,confirm:true};
 await assert.rejects(routes.handle(req(path,input,headers[0].split(';')[0]),{} as any),{status:403});await assert.rejects(routes.handle(req('/api/email/external/'+randomUUID()+'/revoke',input,cookie),{} as any),{status:403});
 const before=calls.length;for(const change of [{confirm:false},{confirm:undefined},{expectedPassId:'bad'},{clientKey:'bad'}])await assert.rejects(routes.handle(req(path,{...input,...change},cookie),{} as any),{code:'INVALID_INPUT'});assert.equal(calls.length,before);
 const r:any=await routes.handle(req(path,input,cookie),{} as any);assert.equal(r.status,'CANCELLED');assert.equal(r.wasInsideAtCancellation,true);assert.equal(calls.at(-1).name,'gp.RevokeEmailRequest');assert.equal(calls.at(-1).p.ExpectedPassId.value,pass);assert.equal(calls.at(-1).p.RecipientEmailHash.value.toString('hex'),hash);
});
test('employee self revoke checks OWN authority before attempting cancellation',async()=>{
 const calls:any[]=[];const service=new EmailWorkflowService({async callProcedure(name,p){calls.push({name,p});throw{number:52801};}},codec);const session={sessionToken:randomBytes(32).toString('base64url'),csrfToken:randomBytes(32).toString('base64url')};
 await assert.rejects(service.revoke(session,{visitRequestId:visit,expectedPassId:pass,clientKey:randomUUID(),confirm:true}),{code:'NOT_AUTHORIZED'});assert.equal(calls.length,1);assert.equal(calls[0].name,'gp.GetVisitDetail');assert.equal(calls[0].p.View.value,'OWN');
});
test('self emails include explicit revoke links while host and manager notifications do not',async()=>{
 const worker=new NotificationEmailWorker({callProcedure:async()=>''},{getEmployee:async()=>({isActive:true,officialEmail:'employee@example.com'}),getManager:async()=>({isActive:true,officialEmail:'manager@example.com'})},{send:async()=>({})},codec,'https://gatepass.example');
 const job={notificationId:1,visitRequestId:visit,templateCode:'REQUEST_RECEIVED',recipientKind:'EMAIL',recipientEmail:'visitor@example.com',recipientEmployeeId:'E1',details:{...detail,requestType:'EXTERNAL',visitStatus:'APPROVED',purpose:'Meeting',snapshotHash:snapshot,recipientEmailHash:hash}};
 const mail=await worker.render(job),revoke=/&amp;revoke=([^"&]+)/u.exec(mail.html)![1];assert.deepEqual(await codec.verifyRevoke(revoke),{...data,expires:now+25*3600000});assert.match(mail.html,/Didn't request this\?/u);
 const employee=await worker.render({...job,recipientKind:'EMPLOYEE',details:{...job.details,requestType:'TEMP_ID'}});assert.match(employee.html,/#revoke=confirm/u);
 for(const templateCode of ['HOST_APPROVAL_REQUEST','TEMP_ID_MANAGER_NOTICE'])assert(!(await worker.render({...job,templateCode,recipientKind:templateCode==='TEMP_ID_MANAGER_NOTICE'?'MANAGER':'EMPLOYEE'})).html.includes('Revoke pass'));
 for(const visitStatus of ['DENIED','CANCELLED'])assert(!(await worker.render({...job,details:{...job.details,visitStatus}})).html.includes('Revoke pass'));
});
