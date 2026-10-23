import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {requireDummySso} from './DummyEmployeeSso.ts';
import {resolvePowerShell} from '../runtime/PowerShellRuntime.mjs';
import type {MailTransport,MailMessage} from '../email/NotificationEmailWorker.ts';
import type {EmailSql} from '../email/EmailWorkflowService.ts';
import {isUuid} from '../visits/SqlVisitReadRepository.ts';

export function sandboxRecipient(value:string){
 if(typeof value!=='string'||value.length>320||!/^[^\s<>@\x00-\x1f]+@[^\s<>@\x00-\x1f]+\.[^\s<>@\x00-\x1f]+$/u.test(value)||/@example\.(com|invalid)$/iu.test(value))throw new Error('EXPLICIT_TEST_RECIPIENT_REQUIRED');return value;
}
export function sandboxTransport(provider:MailTransport,recipient:string):MailTransport{
 requireDummySso();const to=sandboxRecipient(recipient);
 return{async send(message:MailMessage){requireDummySso();return provider.send({...message,to,subject:'[GatePass TEST] '+message.subject});}};
}
/** Enforces the selected visit again on every fenced content/relevance read. */
export function sandboxSql(sql:EmailSql,visitId:string):EmailSql{
 if(!isUuid(visitId))throw new Error('SELECTED_VISIT_REQUIRED');requireDummySso();
 return{async callProcedure(name,parameters){requireDummySso();if(!['gp.GetNotificationEmail','gp.ResolveNotificationPhoto','gp.RenewNotificationLease','gp.CompleteNotification'].includes(name))throw new Error('SANDBOX_RPC_REJECTED');const raw=await sql.callProcedure(name,parameters);
  if(name==='gp.GetNotificationEmail'||name==='gp.ResolveNotificationPhoto'){const job=JSON.parse(raw);if((name==='gp.ResolveNotificationPhoto'||job.status==='READY')&&job.visitRequestId?.toLowerCase()!==visitId.toLowerCase())throw new Error('SANDBOX_VISIT_MISMATCH');}return raw;
 }};
}
export async function claimDevelopmentEmail(visitRequestId:string){
 requireDummySso();if(!isUuid(visitRequestId))throw new Error('SELECTED_VISIT_REQUIRED');
 return new Promise<{notificationId:number;claimToken:string}[]>((resolve,reject)=>{
  const child=spawn(resolvePowerShell(),['-NoProfile','-File',fileURLToPath(new URL('../../tools/Claim-DevelopmentEmail.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';let size=0;const timer=setTimeout(()=>child.kill(),30000);
  child.stdout.on('data',part=>{size+=part.length;if(size>8192)child.kill();else output+=part;});child.stderr.resume();child.stdin.on('error',()=>{});
  child.on('error',()=>{clearTimeout(timer);reject(new Error('DEVELOPMENT_MAIL_CLAIM_UNAVAILABLE'));});child.on('close',code=>{clearTimeout(timer);try{const value=JSON.parse(output);if(code!==0||!Array.isArray(value)||value.length>5||value.some(x=>!Number.isSafeInteger(x.notificationId)||x.notificationId<1||!isUuid(x.claimToken)))throw new Error();resolve(value);}catch{reject(new Error('DEVELOPMENT_MAIL_CLAIM_UNAVAILABLE'));}});
  child.stdin.end(JSON.stringify({visitRequestId}));
 });
}
