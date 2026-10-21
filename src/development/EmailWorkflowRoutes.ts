import {OwnCardError} from '../printing/OwnDigitalIdCardService.ts';
import {timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {cookies,HttpFailure,readJsonBody,token} from '../transport/ApiHandler.ts';
import type {AdditionalHttpRoutes} from '../transport/ApiHandler.ts';
import type {DummyEmployeeSso} from './DummyEmployeeSso.ts';
import {requireDummySso} from './DummyEmployeeSso.ts';
import type {EmailWorkflowService} from '../email/EmailWorkflowService.ts';
import type {VisitPhotoService} from '../visits/VisitReadService.ts';
import type {OwnDigitalIdCardService} from '../printing/OwnDigitalIdCardService.ts';
export class EmailWorkflowRoutes implements AdditionalHttpRoutes{
 #sso:DummyEmployeeSso;#service:EmailWorkflowService;#photos:VisitPhotoService;#cards:OwnDigitalIdCardService;#external:OwnDigitalIdCardService;
 constructor(sso:DummyEmployeeSso,service:EmailWorkflowService,photos:VisitPhotoService,cards:OwnDigitalIdCardService,external:OwnDigitalIdCardService){this.#sso=sso;this.#service=service;this.#photos=photos;this.#cards=cards;this.#external=external;}
 handles(path:string){return /^\/api\/email\/(host\/(detail|photo|decide)|request\/(detail|image)|external\/(detail|image))$/u.test(path);}
 async handle(req:IncomingMessage,_res:ServerResponse){requireDummySso();const path=req.url??'';if(!this.handles(path))throw new HttpFailure(404);const body=await readJsonBody(req);
  if(path.includes('/external/')){if(path.endsWith('/detail'))return this.#service.external(body);if(Object.keys(body).join('|')!=='link')throw new HttpFailure(400);const p=await this.#service.linkParameters(body.link);try{return await this.#external.image({sessionToken:'',csrfToken:''},p.VisitRequestId.value,{RecipientEmailHash:p.RecipientEmailHash.value,SnapshotHash:p.SnapshotHash.value});}catch(e){throw new HttpFailure(e instanceof OwnCardError?e.status:503);}}
  const jar=cookies(req.headers.cookie),sessionToken=jar['gp-dev-session'],csrfToken=req.headers['x-csrf-token'];if(!token(sessionToken))throw new HttpFailure(401);if(!token(csrfToken)||!token(jar['gp-dev-csrf'])||!timingSafeEqual(Buffer.from(csrfToken),Buffer.from(jar['gp-dev-csrf'])))throw new HttpFailure(403);const session={sessionToken,csrfToken};if(!await this.#sso.verify(session))throw new HttpFailure(401);
  if(path.endsWith('/decide'))return this.#service.decide(session,body);
  if(path.endsWith('/detail'))return this.#service.detail(session,body,path.includes('/host/')?'HOST':'OWN');
  if(path.endsWith('/image')){await this.#service.detail(session,body,'OWN');try{return await this.#cards.image(session,body.visitRequestId);}catch(e){throw new HttpFailure(e instanceof OwnCardError?e.status:503);}}
  const v=await this.#service.detail(session,body,'HOST');const photo=await this.#photos.read({...session,view:'HOST'},v.visitRequestId);try{await this.#service.detail(session,body,'HOST');return{mimeType:photo.mimeType,imageBase64:photo.bytes.toString('base64')};}finally{photo.bytes.fill(0);}
 }
}
