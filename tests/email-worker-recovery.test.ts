import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NotificationEmailWorker} from '../src/email/NotificationEmailWorker.ts';
import {runNotificationWorker} from '../src/email/NotificationWorkerLoop.ts';

const visit=randomUUID(),now=Date.now(),claims=[1,2].map(notificationId=>({notificationId,claimToken:randomUUID()}));
const directory={getEmployee:async()=>({isActive:true,officialEmail:'synthetic@example.invalid'}),getManager:async()=>null};
const job=(notificationId:number)=>({notificationId,status:'READY',visitRequestId:visit,templateCode:'HOST_APPROVAL_REQUEST',recipientKind:'EMPLOYEE',recipientEmployeeId:'synthetic',details:{visitRequestId:visit,personName:'Synthetic Visitor',publicReference:'V-test',purpose:'Owned regression',requestType:'EXTERNAL',visitStatus:'PENDING',validFromUtc:new Date(now).toISOString(),validUntilUtc:new Date(now+3600000).toISOString()}});

for(const stage of ['read','renew','recheck','complete','failure-ack'])test(`lost claim during ${stage} does not abandon the next notification`,async()=>{
 const sends:string[]=[],calls:{name:string;id:number;outcome:unknown}[]=[];let reads=0;
 const sql={async callProcedure(name:string,p:any){
  if(name==='gp.ClaimNotifications')return JSON.stringify(claims);
  const id=Number(p.NotificationId.value);calls.push({name,id,outcome:p.Outcome?.value});
  if(id===1){
   if(name==='gp.GetNotificationEmail')reads++;
   if(stage==='read'&&name==='gp.GetNotificationEmail'||stage==='renew'&&name==='gp.RenewNotificationLease'||stage==='recheck'&&name==='gp.GetNotificationEmail'&&reads===2||stage==='complete'&&name==='gp.CompleteNotification')throw{number:52003};
   if(stage==='failure-ack'){if(name==='gp.GetNotificationEmail')return JSON.stringify({status:'READY',notificationId:1});if(name==='gp.CompleteNotification')throw{number:1205};}
  }
  return JSON.stringify(name==='gp.GetNotificationEmail'?job(id):name==='gp.CompleteNotification'?{notificationId:id,status:'SENT'}:{});
 }};
 const worker=new NotificationEmailWorker(sql,directory,{async send(message){sends.push(message.notificationId);return{};}},{} as any,'https://gatepass.example.invalid');
 assert.deepEqual(await worker.runOnce(),[{notificationId:1,status:'LEASE_UNAVAILABLE'},{notificationId:2,status:'SENT'}]);
 assert.deepEqual(sends,stage==='complete'?['1','2']:['2']);
 assert.equal(calls.filter(c=>c.id===1&&c.name==='gp.CompleteNotification').length,stage==='complete'||stage==='failure-ack'?1:0);
 assert.equal(calls.at(-1)?.id,2);
});

test('malformed claims are rejected before processing any job',async()=>{
 let reads=0;const worker=new NotificationEmailWorker({async callProcedure(name){if(name==='gp.ClaimNotifications')return JSON.stringify([claims[0],null]);reads++;return'{}';}},directory,{async send(){throw Error('Unexpected send');}},{} as any,'https://gatepass.example.invalid');
 await assert.rejects(worker.runOnce(),{code:'INTERNAL_ERROR'});assert.equal(reads,0);
});

test('daemon recovers batch failures with bounded backoff and resets it after success',async()=>{
 let attempts=0,time=0,stopping=false,retries=0;const at:number[]=[];
 await runNotificationWorker({async runOnce(){at.push(time);attempts++;if([1,2,4].includes(attempts))throw Error('Private SQL diagnostic');if(attempts===5)stopping=true;return[];}},{stopping:()=>stopping,onBatch:()=>{},onRetry:()=>{retries++;},sleep:async ms=>{time+=ms;}});
 assert.deepEqual(at,[0,1000,3000,13000,14000]);assert.equal(retries,3);
});

test('long outages cap retry delay and shutdown interrupts backoff',async()=>{
 let attempts=0,time=0,stopping=false;const at:number[]=[];
 await runNotificationWorker({async runOnce(){at.push(time);if(++attempts===9)stopping=true;throw Error('Unavailable');}},{stopping:()=>stopping,onBatch:()=>{},onRetry:()=>{},sleep:async ms=>{assert(ms<=1000);time+=ms;}});
 assert.deepEqual(at.slice(1).map((v,i)=>v-at[i]),[1000,2000,4000,8000,16000,30000,30000,30000]);
 let calls=0;stopping=false;
 await runNotificationWorker({async runOnce(){calls++;throw Error('Unavailable');}},{stopping:()=>stopping,onBatch:()=>{},onRetry:()=>{},sleep:async()=>{stopping=true;}});assert.equal(calls,1);
});

test('one-shot worker reports a batch failure and successful one-shot never sleeps',async()=>{
 const failure=Error('Unavailable');let sleeps=0;
 await assert.rejects(runNotificationWorker({async runOnce(){throw failure;}},{once:true,stopping:()=>false,onBatch:()=>{},onRetry:()=>{throw Error('Unexpected retry');},sleep:async()=>{sleeps++;}}),failure);
 let batches=0;await runNotificationWorker({async runOnce(){return[];}},{once:true,stopping:()=>false,onBatch:()=>{batches++;},onRetry:()=>{},sleep:async()=>{sleeps++;}});assert.equal(batches,1);assert.equal(sleeps,0);
});
