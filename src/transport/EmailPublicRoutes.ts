import type {IncomingMessage,ServerResponse} from 'node:http';
import {HttpFailure,readJsonBody,cookies} from './ApiHandler.ts';
import {isUuid} from '../visits/SqlVisitReadRepository.ts';
import type {AdditionalHttpRoutes} from './ApiHandler.ts';
import type {EmailWorkflowService} from '../email/EmailWorkflowService.ts';
import {OwnCardError} from '../printing/OwnDigitalIdCardService.ts';
import type {OwnDigitalIdCardService} from '../printing/OwnDigitalIdCardService.ts';
/** Read-only bearer endpoints. Outer HTTP adapter enforces exact origin and JSON POST. */
export class EmailPublicRoutes implements AdditionalHttpRoutes{
 #service:EmailWorkflowService;#cards:Pick<OwnDigitalIdCardService,'image'>|undefined;#localHttp:boolean;
 constructor(service:EmailWorkflowService,cards?:Pick<OwnDigitalIdCardService,'image'>,options:{localHttp?:boolean}={}){this.#service=service;this.#cards=cards;this.#localHttp=options.localHttp===true;}
 #scope(path:string){const match=/^\/api\/email\/external\/([^/]+)\/(detail|image)$/u.exec(path);return match&&isUuid(match[1])?{visit:match[1].toLowerCase(),action:match[2]}:null;}
 handles(path:string){return ['/api/email/external/session','/api/email/external/detail','/api/email/external/image'].includes(path)||!!this.#scope(path);}
 async handle(req:IncomingMessage,res:ServerResponse){if(!this.handles(req.url??''))throw new HttpFailure(404);const path=req.url!,body=await readJsonBody(req),cookieName=this.#localHttp?'gp-dev-holder':'__Secure-gp-holder';
  if(path==='/api/email/external/session'){
   if(Object.keys(body).join('|')!=='link'||typeof body.link!=='string'||body.link.length>1024)throw new HttpFailure(400);
   // Verify signature, current individual snapshot/recipient and SQL visibility before installing a holder cookie.
   const detail=await this.#service.external(body),visit=String(detail.visitRequestId).toLowerCase();
   if(!isUuid(visit))throw new HttpFailure(503);
   res.setHeader('Set-Cookie',cookieName+'='+encodeURIComponent(body.link)+'; Path=/api/email/external/'+visit+'/; HttpOnly; SameSite=Strict'+(this.#localHttp?'':'; Secure'));
   return{visitRequestId:visit};
  }
  const scope=this.#scope(path);let link=body.link;
  if(scope){
   if(Object.keys(body).length)throw new HttpFailure(400);
   link=cookies(req.headers.cookie)[cookieName];if(typeof link!=='string')throw new HttpFailure(403);
   try{link=decodeURIComponent(link);}catch{throw new HttpFailure(403);}
   const proof=await this.#service.linkParameters(link);if(proof.VisitRequestId.value.toLowerCase()!==scope.visit)throw new HttpFailure(403);
  }else if(Object.keys(body).join('|')!=='link')throw new HttpFailure(400);
  if(path.endsWith('/detail'))return this.#service.external({link});
  const p=await this.#service.linkParameters(link);if(!this.#cards)throw new HttpFailure(503);
  try{return await this.#cards.image({sessionToken:'',csrfToken:''},p.VisitRequestId.value,{RecipientEmailHash:p.RecipientEmailHash.value,SnapshotHash:p.SnapshotHash.value});}catch(e){throw new HttpFailure(e instanceof OwnCardError?e.status:503);}
 }
}
