import {PlanningMailRenderer} from '../src/email/PlanningMailRenderer.ts';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {LocalDevelopmentApiClient} from '../src/development/LocalDevelopmentApiClient.ts';
import {PlanningNotificationWorker,planningMailJob} from '../src/email/PlanningNotificationWorker.ts';
import {GraphMailTransport} from '../src/email/GraphMailTransport.ts';
if(process.env.NODE_ENV!=='test'||process.env.GATEPASS_SSO_MODE!=='dummy'||process.env.GATEPASS_DIRECTORY_MODE!=='mock')throw Error('ISOLATED_PLANNING_TEST_ONLY');
const pointer=JSON.parse(await readFile(new URL('../tmp/planning-browser-fixture.json',import.meta.url),'utf8')),
 fixture=JSON.parse(await readFile(new URL('../tmp/planning-mail-fixture.json',import.meta.url),'utf8'));
if(pointer.database!==fixture.database||fixture.createdBy!=='PlanningMailPersistenceCases'||!/^GatePass_Verification_[a-f0-9]{32}$/u.test(fixture.database))throw Error('OWNED_MAIL_FIXTURE_REQUIRED');
const client=new LocalDevelopmentApiClient(()=>spawn('pwsh',['-NoProfile','-File','tools/Planning.TestBridge.ps1','-Database',fixture.database],{windowsHide:true,stdio:['pipe','pipe','pipe']}),1),sent:{to:string;header:string}[]=[];
try{
 const preview=JSON.parse(await client.callProcedure('gp.PreviewPlanningNotifications',{PlanId:{type:'guid',value:fixture.planId}}));assert.equal(preview.messages.length,6);
 const fetcher:typeof fetch=async(url,options)=>{assert.equal(String(url),'https://graph.microsoft.com/v1.0/users/no-reply%40example.invalid/sendMail');const body=JSON.parse(options!.body as string);assert.equal(body.message.toRecipients.length,1);assert.equal(body.saveToSentItems,true);sent.push({to:body.message.toRecipients[0].emailAddress.address,header:body.message.internetMessageHeaders[0].value});return new Response(null,{status:202});};
 const logo=await readFile(new URL('../assets/brand/sopra-steria-logo.png',import.meta.url)),worker=new PlanningNotificationWorker(client,new GraphMailTransport('no-reply@example.invalid',async()=>'synthetic-test-token',fetcher),new PlanningMailRenderer('https://gatepass.example.invalid',logo));
 await mkdir(new URL('../output/planning-mail/',import.meta.url),{recursive:true});
 for(const row of preview.messages){const job=planningMailJob(row.job),message=worker.render(job);assert.equal(message.to,job.recipientEmail);assert(!message.html.includes('PRIVATE_PURPOSE_MUST_NOT_MAIL'));assert(!message.html.includes('private-guest@example.invalid'));if(job.audience==='FYI')assert(!message.html.includes('href='));if(job.audience==='ARRANGEMENT')assert(!message.html.includes('Beta-private'));const html=message.html.replace('cid:gatepass-company-logo','data:image/png;base64,'+message.inlineLogo);await writeFile(new URL('../output/planning-mail/'+job.audience.toLowerCase()+'-'+job.noticeId+'.html',import.meta.url),html);}
 const first=await worker.runOnce(fixture.planId.toLowerCase()),second=await worker.runOnce(fixture.planId.toLowerCase()),third=await worker.runOnce(fixture.planId.toLowerCase());
 assert.equal(first.length+second.length,6);assert.equal(third.length,0);assert([...first,...second].every(r=>r.status==='SENT'));assert.equal(sent.length,6);assert.equal(new Set(sent.map(m=>m.header)).size,6);
 assert.deepEqual(sent.map(m=>m.to).sort(),preview.messages.map((r:any)=>r.job.recipientEmail).sort());
 const groupFixture=JSON.parse(await readFile(new URL('../tmp/planning-group-mail-fixture.json',import.meta.url),'utf8'));
 assert.equal(groupFixture.database,pointer.database);assert.equal(groupFixture.createdBy,'VisitGroupPersistenceCases');
 const groupPreview=JSON.parse(await client.callProcedure('gp.PreviewPlanningNotifications',{PlanId:{type:'guid',value:groupFixture.planId}}));
 const emailJobs=groupPreview.messages.filter((row:any)=>row.job.recipientEmail==='group-mail@example.invalid');assert.equal(emailJobs.length,1);assert.equal(emailJobs[0].job.canReview,false);assert.equal(emailJobs[0].job.audience,'FYI');
 assert(!worker.render(emailJobs[0].job).html.includes('href='));
 const before=sent.length;const groupResult=await worker.runOnce(groupFixture.planId);assert(groupResult.every(row=>row.status==='SENT'));assert.equal(sent.slice(before).filter(row=>row.to==='group-mail@example.invalid').length,1);assert.equal((await worker.runOnce(groupFixture.planId)).length,0);
 console.log('PASS: explicit group notification email dispatched once through real worker and Graph adapter with a mock provider, without identity, review link or project data.');
 console.log('PASS: six scoped planning messages rendered, dispatched through the real worker/SQL/Graph adapter with a mock HTTP provider, and acknowledged once; a second pass sends nothing. No network email was sent.');
}finally{await client.close();}
