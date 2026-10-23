import type {EmailSql} from './EmailWorkflowService.ts';
import type {EmailLinkCodec} from './EmailLinkCodec.ts';
import {visitorDetails} from '../registration/VisitorDetails.ts';
import {isUuid,isUtc} from '../visits/SqlVisitReadRepository.ts';
import {outlookCardScript} from './OutlookApprovalCard.ts';
import type {OutlookApprovalCard} from './OutlookApprovalCard.ts';
import {notificationEmailLayout} from './NotificationEmailLayout.ts';
import {photoTemplates} from './NotificationPhotoService.ts';
import type {MailPhoto,NotificationPhotos} from './NotificationPhotoService.ts';
const deviceLabels:Record<string,string>={LAPTOP:'Laptop',TABLET:'Tablet / iPad',PEN_DRIVE:'Pen Drive',CAMERA:'Camera',OTHER:'Other'};
export type MailMessage={notificationId:string;to:string;subject:string;html:string;inlineLogo?:string;personPhoto?:{mimeType:MailPhoto['mimeType'];contentBytes:string}};
export interface MailTransport{send(message:MailMessage):Promise<{providerMessageId?:string}>}
export interface MailDirectory{getEmployee(id:string):Promise<{isActive:boolean;officialEmail:string}|null>;getManager(id:string):Promise<{isActive:boolean;officialEmail:string}|null>}
export class MailFailure extends Error{code:string;constructor(code:string){super(code);this.code=code;}}
const email=(s:unknown):s is string=>typeof s==='string'&&s.length<=320&&/^[^\s<>\x00-\x1f\x7f@]+@[^\s<>\x00-\x1f\x7f@]+\.[^\s<>\x00-\x1f\x7f@]+$/u.test(s);
const templates=['HOST_APPROVAL_REQUEST','TEMP_ID_MANAGER_NOTICE','VISIT_DECIDED','PASS_DELIVERY','PASS_REISSUED','REQUEST_RECEIVED'];
const validId=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0;
export class NotificationEmailWorker{
 #sql:EmailSql;#directory:MailDirectory;#transport:MailTransport;#links:EmailLinkCodec;#origin:string;#logo:string|undefined;#outlook:OutlookApprovalCard|undefined;#photos:NotificationPhotos|undefined;
 constructor(sql:EmailSql,directory:MailDirectory,transport:MailTransport,links:EmailLinkCodec,origin:string,logo?:Buffer,outlook?:OutlookApprovalCard,photos?:NotificationPhotos){const u=new URL(origin);if(u.origin!==origin||u.protocol!=='https:'&&!(u.protocol==='http:'&&u.hostname==='localhost'&&['test','development'].includes(process.env.NODE_ENV??'')))throw new Error('INVALID_EMAIL_ORIGIN');this.#sql=sql;this.#directory=directory;this.#transport=transport;this.#links=links;this.#origin=origin;this.#outlook=outlook;this.#photos=photos;if(logo){if(!Buffer.isBuffer(logo)||logo.length>524288||!logo.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw new Error('INVALID_EMAIL_BRAND');this.#logo=logo.toString('base64');}}
 async #rpc(name:string,p:Record<string,any>){return JSON.parse(await this.#sql.callProcedure(name,p));}
 async render(job:any,photo?:MailPhoto|null):Promise<MailMessage>{
  if(!job||!validId(job.notificationId)||!templates.includes(job.templateCode)||!isUuid(job.visitRequestId)||!job.details||!['EMPLOYEE','MANAGER','EMAIL'].includes(job.recipientKind))throw new MailFailure('RENDER_FAILED');
  const d=job.details;if(!isUuid(d.visitRequestId)||d.visitRequestId.toLowerCase()!==job.visitRequestId.toLowerCase()||!isUtc(d.validFromUtc)||!isUtc(d.validUntilUtc)||typeof d.personName!=='string'||d.personName.length>200||typeof d.publicReference!=='string'||d.publicReference.length>40||typeof d.purpose!=='string'||d.purpose.length>1000)throw new MailFailure('RENDER_FAILED');
  let extras:ReturnType<typeof visitorDetails>;try{extras=visitorDetails(d.companyName,d.deviceTypes);}catch{throw new MailFailure('RENDER_FAILED');}
  let to=job.recipientEmail;
  if(job.recipientKind!=='EMAIL'){if(typeof job.recipientEmployeeId!=='string')throw new MailFailure('DIRECTORY_UNAVAILABLE');let person;try{person=await(job.recipientKind==='MANAGER'?this.#directory.getManager(job.recipientEmployeeId):this.#directory.getEmployee(job.recipientEmployeeId));}catch{throw new MailFailure('DIRECTORY_UNAVAILABLE');}if(!person?.isActive)throw new MailFailure('DIRECTORY_UNAVAILABLE');to=person.officialEmail;}
  if(!email(to))throw new MailFailure('INVALID_RECIPIENT');
  const approval=job.templateCode==='HOST_APPROVAL_REQUEST',notice=job.templateCode==='TEMP_ID_MANAGER_NOTICE'||job.templateCode==='PASS_REISSUED';
  let href=this.#origin+(approval?'/approval/':'/request/')+job.visitRequestId.toLowerCase();
  if(!approval&&!notice&&job.recipientKind==='EMAIL'){
   if(!/^[a-f0-9]{64}$/iu.test(d.recipientEmailHash)||!/^[a-f0-9]{64}$/iu.test(d.snapshotHash))throw new MailFailure('RENDER_FAILED');
   href=this.#origin+'/request/'+job.visitRequestId.toLowerCase()+'#link='+await this.#links.issue({v:1,visit:job.visitRequestId.toLowerCase(),emailHash:d.recipientEmailHash.toLowerCase(),snapshot:d.snapshotHash.toLowerCase(),expires:Date.parse(d.validUntilUtc)+86400000});
  }
  const title=approval?'Approval requested':job.templateCode==='TEMP_ID_MANAGER_NOTICE'?'Digital ID issued':job.templateCode==='VISIT_DECIDED'?(d.visitStatus==='APPROVED'?'Visit approved':'Visit declined'):job.templateCode==='PASS_REISSUED'?'Pass replaced':job.templateCode==='PASS_DELIVERY'?'Your visitor pass':['TEMP_ID','DIGITAL_ID'].includes(d.requestType)?'Your Digital ID':'Visit request received';
  let personPhoto:MailMessage['personPhoto'];
  if(photo&&photoTemplates.includes(job.templateCode)){
   if(!Buffer.isBuffer(photo.bytes)||!photo.bytes.length||photo.bytes.length>5242880||!['image/jpeg','image/png','image/webp'].includes(photo.mimeType))throw new MailFailure('RENDER_FAILED');
   personPhoto={mimeType:photo.mimeType,contentBytes:photo.bytes.toString('base64')};
  }
  const html=notificationEmailLayout({title,approval,manager:job.templateCode==='TEMP_ID_MANAGER_NOTICE',notice,status:d.visitStatus,personName:d.personName,companyName:extras.companyName,devices:extras.deviceTypes?.length?extras.deviceTypes.map(code=>deviceLabels[code]).join(', '):undefined,publicReference:d.publicReference,locationName:d.locationName,projectName:d.projectName,hostName:d.hostName,purpose:d.purpose,validFromUtc:d.validFromUtc,validUntilUtc:d.validUntilUtc,href,logo:!!this.#logo,photo:!!personPhoto});
  const card=approval&&this.#outlook?outlookCardScript(await this.#outlook.render(job,to)):'';
  const content=card?html.replace('</head>',card+'</head>'):html;
  return{notificationId:String(job.notificationId),to,subject:title+' · '+d.personName.replace(/[\r\n\x00-\x1f\x7f]/gu,' ').slice(0,80)+(d.locationName?' · '+String(d.locationName).replace(/[\r\n\x00-\x1f\x7f]/gu,' ').slice(0,80):''),html:content,...(this.#logo?{inlineLogo:this.#logo}:{}),...(personPhoto?{personPhoto}:{})};
 }
 async runOnce(){const jobs=await this.#rpc('gp.ClaimNotifications',{BatchSize:{type:'int',value:5},LeaseSeconds:{type:'int',value:120}});if(!Array.isArray(jobs)||jobs.length>5)throw new MailFailure('INTERNAL_ERROR');const results=[];
  for(const claim of jobs){if(!validId(claim.notificationId)||!isUuid(claim.claimToken))throw new MailFailure('INTERNAL_ERROR');results.push(await this.deliver(claim));}return results;
 }
 async deliver(claim:{notificationId:number;claimToken:string}){
  if(!validId(claim.notificationId)||!isUuid(claim.claimToken))throw new MailFailure('INTERNAL_ERROR');const p={NotificationId:{type:'bigint' as const,value:String(claim.notificationId)},ClaimToken:{type:'guid' as const,value:claim.claimToken}};
  try{const job=await this.#rpc('gp.GetNotificationEmail',p);if(job.status==='CANCELLED')return{notificationId:claim.notificationId,status:'CANCELLED'};if(job.status!=='READY'||job.notificationId!==claim.notificationId)throw new MailFailure('RENDER_FAILED');
   let photo:MailPhoto|null|undefined,message:MailMessage;
   try{photo=this.#photos&&photoTemplates.includes(job.templateCode)?await this.#photos.read(claim,job.visitRequestId):undefined;message=await this.render(job,photo);}finally{photo?.bytes.fill(0);}
   await this.#rpc('gp.RenewNotificationLease',{...p,LeaseSeconds:{type:'int',value:120}});
   const fresh=await this.#rpc('gp.GetNotificationEmail',p);if(fresh.status==='CANCELLED')return{notificationId:claim.notificationId,status:'CANCELLED'};if(fresh.status!=='READY'||JSON.stringify(fresh.details)!==JSON.stringify(job.details)||fresh.recipientEmployeeId!==job.recipientEmployeeId||fresh.recipientEmail!==job.recipientEmail)throw new MailFailure('DIRECTORY_UNAVAILABLE');
   const accepted=await this.#transport.send(message);
   return await this.#rpc('gp.CompleteNotification',{...p,Outcome:{type:'text',value:'SENT'},ProviderMessageId:{type:'text',value:accepted.providerMessageId??null}});
  }catch(e){const code=e instanceof MailFailure&&['DIRECTORY_UNAVAILABLE','PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE','PROVIDER_REJECTED','RENDER_FAILED','INVALID_RECIPIENT','INTERNAL_ERROR'].includes(e.code)?e.code:Number((e as any)?.number)===52004?'DIRECTORY_UNAVAILABLE':'INTERNAL_ERROR';
   // A stale lease cannot acknowledge or overwrite a recovered job. Failure codes never include provider data.
   if(Number((e as any)?.number)===52003)throw new MailFailure('LEASE_UNAVAILABLE');
   try{return await this.#rpc('gp.CompleteNotification',{...p,Outcome:{type:'text',value:'FAILED'},ErrorCode:{type:'text',value:code}});}catch{throw new MailFailure('LEASE_UNAVAILABLE');}
  }
 }
}
