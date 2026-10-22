import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomBytes,randomUUID} from 'node:crypto';
import {EmailLinkCodec} from '../src/email/EmailLinkCodec.ts';
import {EmailWorkflowService} from '../src/email/EmailWorkflowService.ts';
import {EmailPublicRoutes} from '../src/transport/EmailPublicRoutes.ts';
import {NotificationEmailWorker} from '../src/email/NotificationEmailWorker.ts';
const now=Date.now(),visit=randomUUID(),other=randomUUID(),snapshot='a'.repeat(64),hash='b'.repeat(64),secret=randomBytes(32);
const source={async active(){return{id:'k_'+'a'.repeat(32),key:Buffer.from(secret)};},async resolve(){return Buffer.from(secret);}};
function req(url:string,body:unknown,cookie?:string){return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{url,headers:{'content-type':'application/json',...(cookie?{cookie}:{})}}) as any;}
function fixture(){
 let clock=now,calls=0,visible=true;const codec=new EmailLinkCodec(source,()=>clock);
 const service=new EmailWorkflowService({async callProcedure(){calls++;if(!visible)throw{number:54101};return JSON.stringify({visitRequestId:visit,status:'PENDING',passStatus:'PENDING',personName:'Visitor',publicReference:'V-test',locationName:'Noida',projectName:'Project 1',hostName:'Host',reason:'Meet',validFromUtc:new Date(now).toISOString(),validUntilUtc:new Date(now+86400000).toISOString()});}},codec);
 let renders=0;
 const routes=new EmailPublicRoutes(service,{async image(){renders++;return{mimeType:'image/png' as const,fileName:'pass.png',imageBase64:'sample'};}});
 return{codec,routes,service,clock:(value:number)=>{clock=value;},hide:()=>{visible=false;},calls:()=>calls,renders:()=>renders};
}
test('external holder exchange installs an individual path-scoped HttpOnly session and reload uses only that proof',async()=>{
 const f=fixture(),link=await f.codec.issue({v:1,visit,emailHash:hash,snapshot,expires:now+86400000});let header='';
 const result=await f.routes.handle(req('/api/email/external/session',{link}),{setHeader(name:string,value:string){assert.equal(name,'Set-Cookie');header=value;}} as any);
 assert.deepEqual(result,{visitRequestId:visit});assert(header.includes('; HttpOnly; SameSite=Strict; Secure'));assert(header.includes('; Path=/api/email/external/'+visit+'/'));
 assert(!JSON.stringify(result).includes(link));const cookie=header.split(';')[0];
 assert.equal((await f.routes.handle(req('/api/email/external/'+visit+'/detail',{},cookie),{} as any) as any).status,'PENDING');
 assert.equal((await f.routes.handle(req('/api/email/external/'+visit+'/image',{},cookie),{} as any) as any).mimeType,'image/png');assert.equal(f.renders(),1);
 assert(!f.routes.handles('/api/email/external/'+visit+'/decide'));assert(!f.routes.handles('/api/email/external/not-a-uuid/detail'));
 const before=f.calls();await assert.rejects(f.routes.handle(req('/api/email/external/'+other+'/detail',{},cookie),{} as any),{status:403});assert.equal(f.calls(),before);
 for(const url of ['/api/email/external/'+visit+'/detail','/api/email/external/'+visit+'/image']){
  await assert.rejects(f.routes.handle(req(url,{}),{} as any),{status:403});
  await assert.rejects(f.routes.handle(req(url,{link},cookie),{} as any),{status:400});
  await assert.rejects(f.routes.handle(req(url,{},cookie+'; '+cookie),{} as any),{status:400});
  await assert.rejects(f.routes.handle(req(url,{},'__Secure-gp-holder=%zz'),{} as any),{status:403});
 }
 f.hide();await assert.rejects(f.routes.handle(req('/api/email/external/'+visit+'/detail',{},cookie),{} as any),{code:'NOT_AUTHORIZED'});
});
test('expired/tampered holder proofs never install a cookie or reach media rendering',async()=>{
 const f=fixture(),link=await f.codec.issue({v:1,visit,emailHash:hash,snapshot,expires:now+1000});let writes=0;
 const res={setHeader(){writes++;}} as any;
 for(const body of [{},{link:12},{link:'x'.repeat(1025)},{link,scope:'HOST'}])await assert.rejects(f.routes.handle(req('/api/email/external/session',body),res),{status:400});
 await assert.rejects(f.routes.handle(req('/api/email/external/session',{link:link+'x'}),res),{code:'NOT_AUTHORIZED'});
 f.clock(now+1001);
 await assert.rejects(f.routes.handle(req('/api/email/external/session',{link}),res),{code:'NOT_AUTHORIZED'});
 await assert.rejects(f.routes.handle(req('/api/email/external/'+visit+'/image',{},'__Secure-gp-holder='+link),res),{code:'NOT_AUTHORIZED'});
 assert.equal(writes,0);assert.equal(f.renders(),0);
});
test('local holder cookie has the same HttpOnly/path scope without the production Secure prefix',async()=>{
 const f=fixture(),link=await f.codec.issue({v:1,visit,emailHash:hash,snapshot,expires:now+86400000});let header='';
 const routes=new EmailPublicRoutes(f.service,undefined,{localHttp:true});
 await routes.handle(req('/api/email/external/session',{link}),{setHeader(_name:string,value:string){header=value;}} as any);
 assert(header.startsWith('gp-dev-holder='));assert(header.includes('; HttpOnly'));assert(!header.includes('; Secure'));
 assert.equal((await routes.handle(req('/api/email/external/'+visit+'/detail',{},header.split(';')[0]),{} as any) as any).visitRequestId,visit);
});
test('external receipt supports maximum 90-day booking plus midnight/grace while rejecting unbounded lifetimes',async()=>{
 const codec=new EmailLinkCodec(source,()=>now);
 const max={v:1 as const,visit,emailHash:hash,snapshot,expires:now+92*86400000};
 assert.deepEqual(await codec.verify(await codec.issue(max)),max);
 await assert.rejects(codec.issue({...max,expires:max.expires+1}),/EMAIL_LINK_UNAVAILABLE/);
 const worker=new NotificationEmailWorker({callProcedure:async()=>''},{getEmployee:async()=>null,getManager:async()=>null},{send:async()=>({})},codec,'https://gatepass.example');
 for(const days of [0,30,45,90]){
  const mail=await worker.render({notificationId:1,visitRequestId:visit,templateCode:'REQUEST_RECEIVED',recipientKind:'EMAIL',recipientEmail:'visitor@example.com',details:{visitRequestId:visit,requestType:'EXTERNAL',personName:'Visitor',publicReference:'V-test',purpose:'Meet',validFromUtc:new Date(now+days*86400000).toISOString(),validUntilUtc:new Date(now+(days+1)*86400000).toISOString(),recipientEmailHash:hash,snapshotHash:snapshot}});
  const proof=/#link=([^"&]+)/u.exec(mail.html)![1];assert.equal((await codec.verify(proof)).expires,now+(days+2)*86400000);
 }
});
