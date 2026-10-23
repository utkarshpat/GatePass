import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {PrivateDirectory} from '../src/storage/PrivateDirectory.ts';
import {NotificationEmailWorker} from '../src/email/NotificationEmailWorker.ts';
import {EmailLinkCodec} from '../src/email/EmailLinkCodec.ts';
import sharp from 'sharp';
/** Pure synthetic previews. This command never claims SQL jobs or calls Graph. */
try{
 if(process.env.NODE_ENV==='production')throw new Error('LOCAL_PREVIEW_ONLY');process.env.NODE_ENV='development';
 const key=randomBytes(32),id='k_'+randomUUID().replaceAll('-','');const codec=new EmailLinkCodec({active:async()=>({id,key:Buffer.from(key)}),resolve:async()=>Buffer.from(key)});
 const directory={getEmployee:async()=>({isActive:true,officialEmail:'employee1@example.com'}),getManager:async()=>({isActive:true,officialEmail:'manager1@example.com'})};
 const logo=await readFile(new URL('../assets/brand/sopra-steria-logo.png',import.meta.url));
 const photo={mimeType:'image/jpeg' as const,bytes:await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="400"><rect width="320" height="400" fill="#eef2f6"/><circle cx="160" cy="125" r="65" fill="#8795ab"/><path d="M35 360v-45a125 115 0 0 1 250 0v45" fill="#8795ab"/><text x="160" y="385" text-anchor="middle" font-family="Arial" font-size="16" fill="#475467">SYNTHETIC PREVIEW</text></svg>')).jpeg().toBuffer()};
 const worker=new NotificationEmailWorker({callProcedure:async()=>{throw new Error('PREVIEW_HAS_NO_SQL');}},directory,{send:async()=>{throw new Error('PREVIEW_HAS_NO_TRANSPORT');}},codec,'http://localhost:8443',logo);
 const output=await PrivateDirectory.create(join(homedir(),'.gatepass','email-previews'),[resolve('.')]);
 const scenarios=[['host-approval','HOST_APPROVAL_REQUEST','EMPLOYEE',false],['manager-notice','TEMP_ID_MANAGER_NOTICE','MANAGER',true],['employee-receipt','REQUEST_RECEIVED','EMPLOYEE',true],['visitor-receipt','REQUEST_RECEIVED','EMAIL',false]] as const;
 for(const [index,[name,templateCode,recipientKind,digitalId]] of scenarios.entries()){
  const visit=randomUUID();const now=Date.now();
  const message=await worker.render({notificationId:index+1,visitRequestId:visit,templateCode,recipientKind,recipientEmployeeId:'EMP001',recipientEmail:recipientKind==='EMAIL'?'visitor@example.com':undefined,details:{visitRequestId:visit,publicReference:'PREVIEW-'+(index+1),requestType:digitalId?'TEMP_ID':'EXTERNAL',personName:digitalId?'Sample Employee':'Kunal Verma',companyName:digitalId?undefined:'NovaWorks Technologies',deviceTypes:digitalId?undefined:['LAPTOP'],purpose:'Project discussion and visitor meeting',locationName:'Noida',projectName:digitalId?undefined:'Project 1',hostName:digitalId?undefined:'Employee 19',visitStatus:digitalId?'APPROVED':'PENDING',snapshotHash:'a'.repeat(64),recipientEmailHash:'b'.repeat(64),validFromUtc:new Date(now).toISOString(),validUntilUtc:new Date(now+3600000).toISOString()}},photo);
  await output.write(name+'.html',Buffer.from(message.html.replace('cid:gatepass-company-logo','data:image/png;base64,'+message.inlineLogo).replace('cid:gatepass-person-photo','data:'+message.personPhoto!.mimeType+';base64,'+message.personPhoto!.contentBytes)),true);
  const boundary='gp_'+randomUUID().replaceAll('-','');const wrap=(s:string)=>s.match(/.{1,76}/gu)?.join('\r\n')??'';
  const eml=['From: GatePass <gatepass@example.invalid>','To: '+message.to,'Subject: =?UTF-8?B?'+Buffer.from(message.subject).toString('base64')+'?=','MIME-Version: 1.0','Content-Type: multipart/related; boundary="'+boundary+'"','','--'+boundary,'Content-Type: text/html; charset=utf-8','Content-Transfer-Encoding: base64','',wrap(Buffer.from(message.html).toString('base64')),'--'+boundary,'Content-Type: image/png','Content-Transfer-Encoding: base64','Content-ID: <gatepass-company-logo>','Content-Disposition: inline; filename="sopra-steria.png"','',wrap(message.inlineLogo!), '--'+boundary,'Content-Type: '+message.personPhoto!.mimeType,'Content-Transfer-Encoding: base64','Content-ID: <gatepass-person-photo>','Content-Disposition: inline; filename="person-photo.jpg"','',wrap(message.personPhoto!.contentBytes),'--'+boundary+'--',''].join('\r\n');
  await output.write(name+'.eml',Buffer.from(eml),true);
 }
 key.fill(0);photo.bytes.fill(0);console.log('Synthetic HTML/Outlook email previews with person photos: '+output.root+' (no SQL jobs claimed; no messages sent).');
}catch{console.error('EMAIL_PREVIEW_UNAVAILABLE');process.exitCode=1;}
