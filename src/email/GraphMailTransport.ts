import {isUuid} from '../visits/SqlVisitReadRepository.ts';
import {MailFailure} from './NotificationEmailWorker.ts';
import type {MailMessage,MailTransport} from './NotificationEmailWorker.ts';
export class GraphMailFailure extends MailFailure{
 readonly httpStatus:number;readonly providerCode:string;
 constructor(code:string,status:number,providerCode:string){super(code);this.httpStatus=status;this.providerCode=providerCode;}
}
const diagnosticCodes=new Set(['ErrorSendAsDenied','ErrorAccessDenied','ErrorQuotaExceeded','ErrorSubmissionQuotaExceeded','ErrorMessageSubmissionBlocked','ErrorInvalidUser','MailboxNotEnabledForRESTAPI','ErrorMailboxNotEnabledForRESTAPI','TooManyRequests','InvalidAuthenticationToken','ErrorItemNotFound','MailboxNotFound','ErrorNonExistentMailbox','ErrorInvalidRecipients','ErrorAccountDisabled','ErrorExceededMessageLimit']);
/** Only Graph's fixed HTTPS endpoints are used; no provider response body enters diagnostics. */
export class GraphMailTransport implements MailTransport{
 #sender:string;#token:()=>Promise<string>;#fetch:typeof fetch;#mode:'application'|'delegated';
 constructor(sender:string,acquireToken:()=>Promise<string>,fetcher:typeof fetch=fetch,mode:'application'|'delegated'='application'){if(!/^[^\s<>@\x00-\x1f]+@[^\s<>@\x00-\x1f]+\.[^\s<>@\x00-\x1f]+$/u.test(sender)||sender.length>320)throw new Error('INVALID_GRAPH_SENDER');if(!['application','delegated'].includes(mode))throw new Error('INVALID_GRAPH_MODE');this.#sender=sender;this.#token=acquireToken;this.#fetch=fetcher;this.#mode=mode;}
 async send(m:MailMessage){
  const attachments:any[]=[];
  if(m.inlineLogo)attachments.push({'@odata.type':'#microsoft.graph.fileAttachment',name:'sopra-steria.png',contentType:'image/png',isInline:true,contentId:'gatepass-company-logo',contentBytes:m.inlineLogo});
  if(m.personPhoto){
   const photo=m.personPhoto,extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
   if(!Object.hasOwn(extensions,photo.mimeType)||typeof photo.contentBytes!=='string'||photo.contentBytes.length>2796204||!photo.contentBytes.length||Buffer.from(photo.contentBytes,'base64').toString('base64')!==photo.contentBytes)throw new MailFailure('RENDER_FAILED');
   attachments.push({'@odata.type':'#microsoft.graph.fileAttachment',name:'person-photo.'+extensions[photo.mimeType],contentType:photo.mimeType,isInline:true,contentId:'gatepass-person-photo',contentBytes:photo.contentBytes});
  }
  let token:string;try{token=await this.#token();if(!token||/[\r\n]/u.test(token))throw new Error();}catch{throw new MailFailure('PROVIDER_UNAVAILABLE');}let response:Response;
  try{response=await this.#fetch('https://graph.microsoft.com/v1.0/'+(this.#mode==='delegated'?'me':'users/'+encodeURIComponent(this.#sender))+'/sendMail',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({message:{subject:m.subject,body:{contentType:'HTML',content:m.html},toRecipients:[{emailAddress:{address:m.to}}],internetMessageHeaders:[{name:'X-GatePass-Notification',value:m.notificationId}],...(attachments.length?{attachments}:{})},saveToSentItems:true})});}catch(e){throw new MailFailure((e as Error)?.name==='TimeoutError'?'PROVIDER_TIMEOUT':'PROVIDER_UNAVAILABLE');}
  if(response.status!==202){let providerCode='UNSPECIFIED';try{const body=await response.json() as any;if(diagnosticCodes.has(body?.error?.code))providerCode=body.error.code;}catch{}finally{await response.body?.cancel().catch(()=>{});}throw new GraphMailFailure([400,413,422].includes(response.status)?'PROVIDER_REJECTED':'PROVIDER_UNAVAILABLE',response.status,providerCode);}await response.body?.cancel().catch(()=>{});return{};
 }
}
export function graphClientCredentials(config:{tenantId:string;clientId:string;clientSecret:string},fetcher:typeof fetch=fetch){if(!isUuid(config.tenantId)||!isUuid(config.clientId)||!config.clientSecret)throw new Error('INVALID_GRAPH_CONFIGURATION');let token='',until=0;return async()=>{if(token&&Date.now()<until)return token;const r=await fetcher('https://login.microsoftonline.com/'+config.tenantId+'/oauth2/v2.0/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'})});if(!r.ok){await r.body?.cancel().catch(()=>{});throw new MailFailure('PROVIDER_UNAVAILABLE');}const data=await r.json() as any;if(typeof data.access_token!=='string'||!Number.isFinite(data.expires_in)||data.expires_in<120||data.expires_in>86400)throw new MailFailure('PROVIDER_UNAVAILABLE');token=data.access_token;until=Date.now()+(data.expires_in-60)*1000;return token;};}
