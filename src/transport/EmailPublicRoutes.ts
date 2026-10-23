import type {IncomingMessage,ServerResponse} from 'node:http';
import {HttpFailure,readJsonBody,cookies} from './ApiHandler.ts';
import {isUuid} from '../visits/SqlVisitReadRepository.ts';
import type {AdditionalHttpRoutes} from './ApiHandler.ts';
import type {EmailWorkflowService} from '../email/EmailWorkflowService.ts';
import {OwnCardError} from '../printing/OwnDigitalIdCardService.ts';
import type {OwnDigitalIdCardService} from '../printing/OwnDigitalIdCardService.ts';
/** Purpose-separated holder capabilities. Outer HTTP adapter enforces exact origin and JSON POST. */
export class EmailPublicRoutes implements AdditionalHttpRoutes{
 #service:EmailWorkflowService;#cards:Pick<OwnDigitalIdCardService,'image'>|undefined;#localHttp:boolean;
 constructor(service:EmailWorkflowService,cards?:Pick<OwnDigitalIdCardService,'image'>,options:{localHttp?:boolean}={}){this.#service=service;this.#cards=cards;this.#localHttp=options.localHttp===true;}
 #scope(path:string){const match=/^\/api\/email\/external\/([^/]+)\/(detail|image|revoke)$/u.exec(path);return match&&isUuid(match[1])?{visit:match[1].toLowerCase(),action:match[2]}:null;}
 #cookie(req:IncomingMessage,name:string){const value=cookies(req.headers.cookie)[name];if(typeof value!=='string')throw new HttpFailure(403);try{return decodeURIComponent(value);}catch{throw new HttpFailure(403);}}
 #same(a:Awaited<ReturnType<EmailWorkflowService['linkParameters']>>,b:Awaited<ReturnType<EmailWorkflowService['linkParameters']>>){return a.VisitRequestId.value.toLowerCase()===b.VisitRequestId.value.toLowerCase()&&a.RecipientEmailHash.value.equals(b.RecipientEmailHash.value)&&a.SnapshotHash.value.equals(b.SnapshotHash.value);}
 handles(path:string){return ['/api/email/external/session','/api/email/external/detail','/api/email/external/image'].includes(path)||!!this.#scope(path);}
 async handle(req:IncomingMessage,res:ServerResponse){if(!this.handles(req.url??''))throw new HttpFailure(404);const path=req.url!,body=await readJsonBody(req),cookieName=this.#localHttp?'gp-dev-holder':'__Secure-gp-holder',revokeCookie=this.#localHttp?'gp-dev-revoke':'__Secure-gp-revoke';
  if(path==='/api/email/external/session'){
   if(Object.keys(body).some(k=>!['link','revokeLink'].includes(k))||typeof body.link!=='string'||body.link.length>1024||body.revokeLink!==undefined&&(typeof body.revokeLink!=='string'||body.revokeLink.length>1024))throw new HttpFailure(400);
   // Verify signature, current individual snapshot/recipient and SQL visibility before installing a holder cookie.
   const detail=await this.#service.external({link:body.link}),visit=String(detail.visitRequestId).toLowerCase();
   if(!isUuid(visit))throw new HttpFailure(503);
   const suffix='; Path=/api/email/external/'+visit+'/; HttpOnly; SameSite=Strict'+(this.#localHttp?'':'; Secure');
   const statusCookie=cookieName+'='+encodeURIComponent(body.link)+suffix;
   if(body.revokeLink!==undefined){const status=await this.#service.linkParameters(body.link),revoke=await this.#service.linkParameters(body.revokeLink,true);if(!this.#same(status,revoke))throw new HttpFailure(403);res.setHeader('Set-Cookie',[statusCookie,revokeCookie+'='+encodeURIComponent(body.revokeLink)+suffix]);}else res.setHeader('Set-Cookie',statusCookie);
   return{visitRequestId:visit};
  }
  const scope=this.#scope(path);let link=body.link;
  if(scope?.action==='revoke'){
   if(Object.keys(body).some(k=>!['clientKey','expectedPassId','confirm'].includes(k)))throw new HttpFailure(400);
   const revokeLink=this.#cookie(req,revokeCookie),proof=await this.#service.linkParameters(revokeLink,true);if(proof.VisitRequestId.value.toLowerCase()!==scope.visit)throw new HttpFailure(403);
   return this.#service.externalRevoke({...body,link:revokeLink});
  }
  if(scope){
   if(Object.keys(body).length)throw new HttpFailure(400);
   link=this.#cookie(req,cookieName);
   const proof=await this.#service.linkParameters(link);if(proof.VisitRequestId.value.toLowerCase()!==scope.visit)throw new HttpFailure(403);
  }else if(Object.keys(body).join('|')!=='link')throw new HttpFailure(400);
  if(path.endsWith('/detail')){
   const detail=await this.#service.external({link});let canCancel=false;
   if(scope&&detail.canCancel===true){try{canCancel=this.#same(await this.#service.linkParameters(link),await this.#service.linkParameters(this.#cookie(req,revokeCookie),true));}catch{/* Status remains readable without a valid revoke capability. */}}
   return{...detail,canCancel};
  }
  const p=await this.#service.linkParameters(link);if(!this.#cards)throw new HttpFailure(503);
  try{return await this.#cards.image({sessionToken:'',csrfToken:''},p.VisitRequestId.value,{RecipientEmailHash:p.RecipientEmailHash.value,SnapshotHash:p.SnapshotHash.value});}catch(e){throw new HttpFailure(e instanceof OwnCardError?e.status:503);}
 }
}
