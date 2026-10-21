import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {LocalDevelopmentApiClient} from '../src/development/LocalDevelopmentApiClient.ts';
import {NotificationEmailWorker} from '../src/email/NotificationEmailWorker.ts';
import {EmailLinkCodec} from '../src/email/EmailLinkCodec.ts';
let raw='';for await(const part of process.stdin)raw+=part;const input=JSON.parse(raw);let providerCalls=0;const key=randomBytes(32),id='k_'+'c'.repeat(32);
try{
 const worker=new NotificationEmailWorker(new LocalDevelopmentApiClient(),{async getEmployee(employeeId){assert.equal(employeeId,input.employeeId);return{isActive:true,officialEmail:'synthetic-host@example.invalid'};},async getManager(){throw new Error('Unexpected manager lookup');}},
 {async send(message){providerCalls++;assert.equal(message.to,'synthetic-host@example.invalid');assert(message.html.includes(input.personName));assert(message.html.includes('/approval/'+input.visitId.toLowerCase()));return{providerMessageId:'TEST-CAPTURE-'+input.notificationId};}},new EmailLinkCodec({active:async()=>({id,key:Buffer.from(key)}),resolve:async()=>Buffer.from(key)}),'http://localhost:18446');
 const r=await worker.deliver({notificationId:input.notificationId,claimToken:input.claimToken});assert.equal(r.status,'SENT');assert.equal(providerCalls,1);console.log(JSON.stringify({status:'PASS',actualSql:true,providerCalls,externalMailSent:false}));
}catch{console.log(JSON.stringify({status:'FAIL',actualSql:true,providerCalls,externalMailSent:false}));process.exitCode=1;}finally{key.fill(0);}
