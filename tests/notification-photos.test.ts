import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {NotificationPhotoService} from '../src/email/NotificationPhotoService.ts';
import {NotificationEmailWorker} from '../src/email/NotificationEmailWorker.ts';
import {GraphMailTransport} from '../src/email/GraphMailTransport.ts';
import {EmailLinkCodec} from '../src/email/EmailLinkCodec.ts';

const visit=randomUUID(),photoId=randomUUID(),claim={notificationId:1,claimToken:randomUUID()};
const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1cAAAAASUVORK5CYII=','base64');
const metadata=()=>({visitRequestId:visit,available:true,photoAssetId:photoId,storageKey:'intakes/'+'a'.repeat(32)+'/'+photoId.replaceAll('-','')+'.png',byteLength:photo.length,contentHash:createHash('sha256').update(photo).digest('hex'),mimeType:'image/png'});
test('notification photo is bounded to the claimed visit and reauthorized after private file work',async()=>{
 let reads=0,calls=0;const service=new NotificationPhotoService({async callProcedure(name,p){calls++;assert.equal(name,'gp.ResolveNotificationPhoto');assert.equal(p.NotificationId.value,'1');assert.equal(p.ClaimToken.value,claim.claimToken);return JSON.stringify(metadata());}},{async read(key,limit){reads++;assert.equal(key,metadata().storageKey);assert.equal(limit,photo.length);return Buffer.from(photo);}});
 const result=await service.read(claim,visit);assert.deepEqual(result?.bytes,photo);assert.equal(result?.mimeType,'image/png');assert.equal(calls,2);assert.equal(reads,1);result?.bytes.fill(0);
});
test('photo metadata cannot select a different visit or escape its private intake path',async()=>{
 for(const change of [{visitRequestId:randomUUID()},{storageKey:'../secret.jpg'},{byteLength:5242881},{mimeType:'image/svg+xml'},{contentHash:'bad'},{photoAssetId:'bad'}]){
  let reads=0;const service=new NotificationPhotoService({callProcedure:async()=>JSON.stringify({...metadata(),...change})},{async read(){reads++;return photo;}});
  await assert.rejects(service.read(claim,visit),/NOTIFICATION_PHOTO_UNAVAILABLE/u);assert.equal(reads,0);
 }
});
test('missing photos render without a broken CID and stale or changed photo reads fail closed',async()=>{
 let reads=0;const missing=new NotificationPhotoService({callProcedure:async()=>JSON.stringify({visitRequestId:visit,available:false})},{async read(){reads++;return photo;}});assert.equal(await missing.read(claim,visit),null);assert.equal(reads,0);
 for(const second of ['denied','changed','hash']){
  let calls=0;const service=new NotificationPhotoService({async callProcedure(){calls++;if(calls===2&&second==='denied')throw new Error('private SQL path');return JSON.stringify({...metadata(),...(calls===2?{contentHash:'a'.repeat(64)}:{})});}},{read:async()=>second==='hash'?Buffer.alloc(photo.length):Buffer.from(photo)});
  await assert.rejects(service.read(claim,visit),e=>String(e)==='Error: NOTIFICATION_PHOTO_UNAVAILABLE');
 }
 const invalid=new NotificationPhotoService({callProcedure:async()=>{throw new Error('not called');}},{read:async()=>photo});await assert.rejects(invalid.read({...claim,notificationId:0},visit));
});
const key=randomBytes(32),keyId='k_'+'a'.repeat(32),links=new EmailLinkCodec({active:async()=>({id:keyId,key:Buffer.from(key)}),resolve:async()=>Buffer.from(key)});
const directory={getEmployee:async()=>({isActive:true,officialEmail:'host@example.com'}),getManager:async()=>({isActive:true,officialEmail:'manager@example.com'})};
const job=(templateCode:string)=>({notificationId:1,status:'READY',visitRequestId:visit,recipientKind:templateCode==='TEMP_ID_MANAGER_NOTICE'?'MANAGER':'EMPLOYEE',recipientEmployeeId:'EMP001',templateCode,details:{visitRequestId:visit,personName:'Kunal Verma',companyName:'NovaWorks Technologies',deviceTypes:['LAPTOP'],publicReference:'V-123',requestType:templateCode==='TEMP_ID_MANAGER_NOTICE'?'TEMP_ID':'EXTERNAL',visitStatus:'PENDING',locationName:'Noida',projectName:'Project 1',hostName:'Employee 19',purpose:'Project discussion',validFromUtc:new Date().toISOString(),validUntilUtc:new Date(Date.now()+3600000).toISOString()}});
test('host manager and holder mail contain only the person photo with CID attachment and no pass card',async()=>{
 const worker=new NotificationEmailWorker({callProcedure:async()=>''},directory,{send:async()=>({})},links,'https://gatepass.example');
 for(const template of ['HOST_APPROVAL_REQUEST','TEMP_ID_MANAGER_NOTICE','REQUEST_RECEIVED','VISIT_DECIDED','PASS_DELIVERY']){
  const message=await worker.render(job(template),{bytes:photo,mimeType:'image/png'});assert.match(message.html,/cid:gatepass-person-photo/u);assert.equal(message.personPhoto?.contentBytes,photo.toString('base64'));assert(!message.html.includes('data:image'));assert(!message.html.includes('QR'));
  if(template==='TEMP_ID_MANAGER_NOTICE'){assert(!message.html.includes('/approval/'));assert(!message.html.includes('/request/'));assert.match(message.html,/INFORMATION ONLY/u);}
  let body:any;await new GraphMailTransport('gatepass@example.com',async()=>'token',async(_url,options)=>{body=JSON.parse(String(options?.body));return new Response(null,{status:202});}).send(message);
  assert.equal(body.message.attachments.length,1);assert.equal(body.message.attachments[0].contentId,'gatepass-person-photo');assert.equal(body.message.attachments[0].isInline,true);assert.equal(body.message.attachments[0].contentBytes,photo.toString('base64'));
 }
 const replaced=await worker.render(job('PASS_REISSUED'),{bytes:photo,mimeType:'image/png'});assert(!replaced.personPhoto);assert(!replaced.html.includes('cid:gatepass-person-photo'));
 const missing=await worker.render(job('HOST_APPROVAL_REQUEST'));assert(!missing.html.includes('cid:gatepass-person-photo'));
 const m=await worker.render(job('HOST_APPROVAL_REQUEST'));await assert.rejects(new GraphMailTransport('gatepass@example.com',async()=>{throw new Error('should not authenticate');}).send({...m,personPhoto:{mimeType:'image/png',contentBytes:'bad'}}),{code:'RENDER_FAILED'});
});
test('permission loss during photo work prevents provider send and successful sends clear photo buffers',async()=>{
 for(const revoked of [true,false]){
  let reads=0,sends=0,ack='';const bytes=Buffer.from(photo),current=job('HOST_APPROVAL_REQUEST');
  const worker=new NotificationEmailWorker({async callProcedure(name,p){if(name==='gp.GetNotificationEmail'){reads++;return JSON.stringify(revoked&&reads===2?{status:'CANCELLED'}:current);}if(name==='gp.CompleteNotification'){ack=String(p.Outcome.value);return JSON.stringify({status:'SENT'});}return '{}';}},directory,{async send(message){sends++;assert(message.personPhoto);return{};}},links,'https://gatepass.example',undefined,undefined,{read:async()=>({bytes,mimeType:'image/png'})});
  const result=await worker.deliver(claim);assert.equal(sends,revoked?0:1);assert.equal(result.status,revoked?'CANCELLED':'SENT');assert(bytes.every(b=>b===0));assert.equal(ack,revoked?'':'SENT');
 }
});
