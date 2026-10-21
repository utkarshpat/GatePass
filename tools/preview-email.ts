import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {PrivateDirectory} from '../src/storage/PrivateDirectory.ts';
import {NotificationEmailWorker} from '../src/email/NotificationEmailWorker.ts';
import {EmailLinkCodec} from '../src/email/EmailLinkCodec.ts';
/** Pure synthetic previews. This command never claims SQL jobs or calls Graph. */
try{
 if(process.env.NODE_ENV==='production')throw new Error('LOCAL_PREVIEW_ONLY');process.env.NODE_ENV='development';
 const key=randomBytes(32),id='k_'+randomUUID().replaceAll('-','');const codec=new EmailLinkCodec({active:async()=>({id,key:Buffer.from(key)}),resolve:async()=>Buffer.from(key)});
 const directory={getEmployee:async()=>({isActive:true,officialEmail:'employee1@example.com'}),getManager:async()=>({isActive:true,officialEmail:'manager1@example.com'})};
 const logo=await readFile(new URL('../assets/brand/sopra-steria-logo.png',import.meta.url));
 const worker=new NotificationEmailWorker({callProcedure:async()=>{throw new Error('PREVIEW_HAS_NO_SQL');}},directory,{send:async()=>{throw new Error('PREVIEW_HAS_NO_TRANSPORT');}},codec,'http://localhost:8443',logo);
 const output=await PrivateDirectory.create(join(homedir(),'.gatepass','email-previews'),[resolve('.')]);
 for(const [index,templateCode] of ['HOST_APPROVAL_REQUEST','TEMP_ID_MANAGER_NOTICE','REQUEST_RECEIVED'].entries()){
  const name=['host-approval','manager-notice','request-receipt'][index];const visit=randomUUID();const now=Date.now();
  const message=await worker.render({notificationId:index+1,visitRequestId:visit,templateCode,recipientKind:index===1?'MANAGER':'EMPLOYEE',recipientEmployeeId:'EMP001',details:{visitRequestId:visit,publicReference:'PREVIEW-'+(index+1),requestType:index===1?'TEMP_ID':'EXTERNAL',personName:'Sample Visitor',purpose:'Business meeting',locationName:'Noida',projectName:index===1?undefined:'Project 1',hostName:index===1?undefined:'Employee 1',visitStatus:index===1?'APPROVED':'PENDING',validFromUtc:new Date(now).toISOString(),validUntilUtc:new Date(now+3600000).toISOString()}});
  await output.write(name+'.html',Buffer.from(message.html.replace('cid:gatepass-company-logo','data:image/png;base64,'+message.inlineLogo)),true);
  const boundary='gp_'+randomUUID().replaceAll('-','');const wrap=(s:string)=>s.match(/.{1,76}/gu)?.join('\r\n')??'';
  const eml=['From: GatePass <gatepass@example.invalid>','To: '+message.to,'Subject: =?UTF-8?B?'+Buffer.from(message.subject).toString('base64')+'?=','MIME-Version: 1.0','Content-Type: multipart/related; boundary="'+boundary+'"','','--'+boundary,'Content-Type: text/html; charset=utf-8','Content-Transfer-Encoding: base64','',wrap(Buffer.from(message.html).toString('base64')),'--'+boundary,'Content-Type: image/png','Content-Transfer-Encoding: base64','Content-ID: <gatepass-company-logo>','Content-Disposition: inline; filename="sopra-steria.png"','',wrap(message.inlineLogo!), '--'+boundary+'--',''].join('\r\n');
  await output.write(name+'.eml',Buffer.from(eml),true);
 }
 key.fill(0);console.log('Synthetic HTML/Outlook email previews: '+output.root+' (no SQL jobs claimed; no messages sent).');
}catch{console.error('EMAIL_PREVIEW_UNAVAILABLE');process.exitCode=1;}
