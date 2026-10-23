import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {OutlookActionTokenVerifier,outlookActionsAppId} from '../src/email/OutlookActionToken.ts';
import {OutlookActionCodec} from '../src/email/OutlookActionCodec.ts';
import {OutlookApprovalCard,outlookCardScript} from '../src/email/OutlookApprovalCard.ts';
import {OutlookDecisionService,OutlookDecisionError} from '../src/email/OutlookDecisionService.ts';
import {createOutlookActionHandler} from '../src/transport/OutlookActionHandler.ts';
import {SqlProcedureClient} from '../src/transport/SqlProcedureClient.ts';
import {loadOutlookActions} from '../src/email/OutlookConfiguration.ts';
import {EmailLinkCodec} from '../src/email/EmailLinkCodec.ts';
import {NotificationEmailWorker} from '../src/email/NotificationEmailWorker.ts';

const tenant=randomUUID(),appId=randomUUID(),oid=randomUUID(),visit=randomUUID(),snapshot='a'.repeat(64),providerId=randomUUID();
const config={tenantId:tenant,applicationId:appId,scope:'GatePass.Visit.Decide'},cardConfig={providerId,origin:'https://gatepass.example.com'};
const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='test-key';
const keys=createLocalJWKSet({keys:[jwk]}),verifier=new OutlookActionTokenVerifier(config,keys),key=randomBytes(32),keyId='k_'+'d'.repeat(32);
const source={active:async()=>({id:keyId,key:Buffer.from(key)}),resolve:async()=>Buffer.from(key)};
const codec=new OutlookActionCodec(source,'org/provider/origin');
const action={v:1 as const,visit,host:'EMP001',snapshot,decision:'APPROVED' as const,clientKey:randomUUID(),expires:Date.now()+3600000};
async function bearer(overrides:Record<string,unknown>={}){const now=Math.floor(Date.now()/1000);return'Bearer '+await new SignJWT({iss:'https://login.microsoftonline.com/'+tenant+'/v2.0',aud:appId,tid:tenant,oid,azp:outlookActionsAppId,scp:config.scope,ver:'2.0',iat:now,nbf:now-1,exp:now+3600,...overrides}).setProtectedHeader({alg:'RS256',kid:'test-key'}).sign(privateKey);}
test('Outlook verifies real RSA signature, configured Entra issuer/audience, delegated Actions client and stable org actor',async()=>{assert.deepEqual(await verifier.verify(await bearer()),{tenantId:tenant,objectId:oid});});
test('Outlook rejects wrong tenant audience issuer caller scope and ID/app-only/expired/future tokens',async()=>{
 for(const overrides of [{tid:randomUUID()},{aud:'https://graph.microsoft.com'},{iss:'https://substrate.office.com/sts/'},{azp:randomUUID()},{scp:'User.Read'},{scp:undefined,roles:['Decide']},{oid:'user@example.com'},{ver:'1.0'},{exp:1},{nbf:Math.floor(Date.now()/1000)+3600},{iat:Math.floor(Date.now()/1000)+3600}])await assert.rejects(verifier.verify(await bearer(overrides)),/NOT_AUTHORIZED/u);
 const valid=await bearer();await assert.rejects(verifier.verify(valid.slice(0,-8)+'tampered'));for(const value of ['',null,[],valid.replace('Bearer','Basic')])await assert.rejects(verifier.verify(value));
 assert.throws(()=>new OutlookActionTokenVerifier({...config,tenantId:'evil/path'}));
});
test('Outlook capability binds exact request host snapshot decision client key purpose origin and expiry',async()=>{
 const signed=await codec.issue(action);assert.deepEqual(await codec.verify(signed),action);
 for(const value of [signed+'x','invalid',signed.replace('k_','K_'),null])await assert.rejects(codec.verify(value));
 await assert.rejects(new OutlookActionCodec(source,'other-org').verify(signed));await assert.rejects(new OutlookActionCodec(source,'org/provider/origin',()=>action.expires+1).verify(signed));
 await assert.rejects(codec.issue({...action,expires:1}));await assert.rejects(codec.issue({...action,decision:'ROOT'} as any));await assert.rejects(codec.issue({...action,extra:1} as any));
 await assert.rejects(new EmailLinkCodec(source).verify(signed));
});
function job(){return{notificationId:1,visitRequestId:visit,templateCode:'HOST_APPROVAL_REQUEST',recipientKind:'EMPLOYEE',recipientEmployeeId:'EMP001',details:{visitRequestId:visit,snapshotHash:snapshot,validFromUtc:new Date().toISOString(),validUntilUtc:new Date(Date.now()+3600000).toISOString(),personName:'Test </script><script>evil</script>',publicReference:'V-test',locationName:'Noida',projectName:'Project 1',hostName:'Host 1',purpose:'Meeting'}};}
test('Outlook card has bound direct POST decisions, expected actor, provider ID and fallback with safe script embedding',async()=>{
 const j=job() as any;j.details.companyName='Acme Corp';j.details.deviceTypes=['LAPTOP'];
 const card=await new OutlookApprovalCard(cardConfig,codec).render(j,'host@example.com');assert.equal(card.originator,providerId);assert.deepEqual(card.expectedActors,['host@example.com']);assert.equal(card.actions.length,3);
 assert.deepEqual((card.body[1] as any).facts.slice(1,3),[{title:'Company',value:'Acme Corp'},{title:'Devices',value:'Laptop'}]);
 const decisions=[];for(const a of card.actions.slice(0,2) as any[]){assert.equal(a.type,'Action.Http');assert.equal(a.method,'POST');assert.equal(a.url,cardConfig.origin+'/api/outlook/decision');decisions.push((await codec.verify(JSON.parse(a.body).capability)).decision);}
 assert.deepEqual(decisions,['APPROVED','DENIED']);const html=outlookCardScript(card);assert.equal((html.match(/<\/script>/gu)??[]).length,1);assert(!html.includes('<script>evil'));
 assert.equal(card.hideOriginalBody,true);assert.equal((await new OutlookApprovalCard(cardConfig,codec).render(j,'host@example.com',true)).hideOriginalBody,false);
 for(const origin of ['http://localhost:8443','https://localhost','https://127.0.0.1','https://example.com/path'])assert.throws(()=>new OutlookApprovalCard({...cardConfig,origin},codec));
 await assert.rejects(new OutlookApprovalCard(cardConfig,codec).render({...job(),recipientKind:'EMAIL'},'host@example.com'));
 await assert.rejects(new OutlookApprovalCard(cardConfig,codec).render({...job(),details:{...job().details,deviceTypes:['BAD']}},'host@example.com'));
});
test('host approval worker embeds the optional Outlook card; other templates and default delivery stay ordinary HTML',async()=>{
 const sql={callProcedure:async()=>''},directory={getEmployee:async()=>({isActive:true,officialEmail:'host@example.com'}),getManager:async()=>null},links=new EmailLinkCodec(source),transport={send:async()=>({})};
 const worker=new NotificationEmailWorker(sql,directory,transport,links,cardConfig.origin,undefined,new OutlookApprovalCard(cardConfig,codec));
 assert((await worker.render(job())).html.includes('application/adaptivecard+json'));assert(!(await worker.render({...job(),templateCode:'TEMP_ID_MANAGER_NOTICE'})).html.includes('application/adaptivecard+json'));
 assert(!(await new NotificationEmailWorker(sql,directory,transport,links,cardConfig.origin).render(job())).html.includes('application/adaptivecard+json'));
 const photoMessage=await worker.render(job(),{mimeType:'image/png',bytes:Buffer.from('89504e470d0a1a0a','hex')});const card=JSON.parse(/<script type="application\/adaptivecard\+json">(.*?)<\/script>/su.exec(photoMessage.html)![1]);assert.equal(card.hideOriginalBody,false);assert.match(photoMessage.html,/cid:gatepass-person-photo/u);assert(photoMessage.personPhoto);
});
test('Outlook decision passes only verified tid/oid and signed binding to isolated SQL and preserves key replay',async()=>{
 const calls:any[]=[];const sql={async callProcedure(name:string,p:any){calls.push({name,p});return JSON.stringify({operationId:randomUUID(),visitRequestId:visit,decision:'APPROVED'});}};
 const service=new OutlookDecisionService(sql,verifier,codec),body={capability:await codec.issue(action)},auth=await bearer();await service.decide(auth,body);await service.decide(auth,body);
 assert.equal(calls[0].name,'gp.DecideOutlookVisit');assert.equal(calls[0].p.ObjectId.value,oid);assert.equal(calls[0].p.ExpectedHostEmployeeId.value,'EMP001');assert.equal(calls[0].p.ClientKey.value,calls[1].p.ClientKey.value);assert(!('SessionHash' in calls[0].p));
 await assert.rejects(service.decide('bad',body),{status:401});await assert.rejects(service.decide(auth,{...body,actor:'EMP002'}),{status:400});await assert.rejects(service.decide(auth,{capability:body.capability+'x'}),{status:403});assert.equal(calls.length,2);
 for(const [number,status] of [[52001,403],[52002,400],[52003,409],[52004,409],[52005,409],[12345,503]]){const s=new OutlookDecisionService({callProcedure:async()=>{throw{number};}},verifier,codec);await assert.rejects(s.decide(auth,body),{status});}
 await assert.rejects(new OutlookDecisionService({callProcedure:async()=> '{}'},verifier,codec).decide(auth,body),{status:503});
});
async function http(service:any,options:any={}){const req=Readable.from([Buffer.from(JSON.stringify(options.body??{capability:'signed'}))]) as any;req.method=options.method??'POST';req.url=options.url??'/api/outlook/decision';req.headers={host:'gatepass.example.com','content-type':'application/json',authorization:'Bearer token',...options.headers};req.socket={encrypted:options.encrypted??true};const headers:any={};const res:any={setHeader:(k:string,v:unknown)=>{headers[k]=v;},end:(v:string)=>{res.body=JSON.parse(v);}};await createOutlookActionHandler(service,cardConfig)(req,res);return{...res,headers};}
test('Outlook webhook accepts server action without browser cookies/Origin, refreshes card and removes decision buttons',async()=>{const r=await http({decide:async()=>({visitRequestId:visit,decision:'APPROVED'})});assert.equal(r.statusCode,200);assert.equal(r.headers['CARD-UPDATE-IN-BODY'],'true');assert.equal(r.body.actions.length,1);assert.equal(r.body.actions[0].type,'Action.OpenUrl');});
test('Outlook webhook rejects GET insecure/wrong host malformed auth and body and reports controlled action errors',async()=>{
 const service={decide:async()=>{throw new OutlookDecisionError(403);}};
 for(const [options,status] of [[{method:'GET'},405],[{encrypted:false},403],[{headers:{host:'evil'}},403],[{url:'/api/outlook/decision?token=x'},404],[{headers:{'action-authorization':'Bearer token'}},400],[{headers:{'content-type':'text/plain'}},415],[{},403]] as any[]) {const r=await http(service,options);assert.equal(r.statusCode,status);assert(r.headers['CARD-ACTION-STATUS']);assert(!JSON.stringify(r.body).includes('token'));}
});
test('Outlook SQL role is isolated from approval web sessions, media, arbitrary queries and queue authority',async()=>{
 const called:string[]=[];const client=new SqlProcedureClient({request:()=>({input(){},async execute(name:string){called.push(name);return{recordsets:[[{result:'{}'}]]};}}),close:async()=>{}},'outlook');
 for(const proc of ['gp.DecideVisit','gp.ClaimNotifications','gp.ResolveVisitPhoto','SELECT 1','gp._RequireOutlookActor'])await assert.rejects(client.callProcedure(proc,{}));
 await client.callProcedure('gp.DecideOutlookVisit',{});assert.deepEqual(called,['gp.DecideOutlookVisit']);
});
test('Outlook feature is opt-in and enabled incomplete configuration fails closed',async()=>{
 assert.equal(await loadOutlookActions({},'https://gatepass.example.com'),undefined);await assert.rejects(loadOutlookActions({GATEPASS_OUTLOOK_ACTIONS_ENABLED:'yes'},'https://gatepass.example.com'));await assert.rejects(loadOutlookActions({GATEPASS_OUTLOOK_ACTIONS_ENABLED:'true'},'https://gatepass.example.com'));
});
