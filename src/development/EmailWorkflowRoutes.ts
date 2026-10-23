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
import {EmailPublicRoutes} from '../transport/EmailPublicRoutes.ts';
export class EmailWorkflowRoutes implements AdditionalHttpRoutes{
 #sso:DummyEmployeeSso;#service:EmailWorkflowService;#photos:VisitPhotoService;#cards:OwnDigitalIdCardService;#external:EmailPublicRoutes;
 constructor(sso:DummyEmployeeSso,service:EmailWorkflowService,photos:VisitPhotoService,cards:OwnDigitalIdCardService,external:OwnDigitalIdCardService){this.#sso=sso;this.#service=service;this.#photos=photos;this.#cards=cards;this.#external=new EmailPublicRoutes(service,external,{localHttp:true});}
 handles(path:string){return this.#external.handles(path)||/^\/api\/email\/(host\/(detail|photo|decide)|request\/(detail|image|revoke))$/u.test(path);}
 async handle(req:IncomingMessage,res:ServerResponse){requireDummySso();const path=req.url??'';if(!this.handles(path))throw new HttpFailure(404);if(this.#external.handles(path))return this.#external.handle(req,res);const body=await readJsonBody(req);
  const jar=cookies(req.headers.cookie),sessionToken=jar['gp-dev-session'],csrfToken=req.headers['x-csrf-token'];if(!token(sessionToken))throw new HttpFailure(401);if(!token(csrfToken)||!token(jar['gp-dev-csrf'])||!timingSafeEqual(Buffer.from(csrfToken),Buffer.from(jar['gp-dev-csrf'])))throw new HttpFailure(403);const session={sessionToken,csrfToken};if(!await this.#sso.verify(session))throw new HttpFailure(401);
  if(path.endsWith('/decide'))return this.#service.decide(session,body);
  if(path.endsWith('/revoke'))return this.#service.revoke(session,body);
  if(path.endsWith('/detail'))return this.#service.detail(session,body,path.includes('/host/')?'HOST':'OWN');
  if(path.endsWith('/image')){await this.#service.detail(session,body,'OWN');try{return await this.#cards.image(session,body.visitRequestId);}catch(e){throw new HttpFailure(e instanceof OwnCardError?e.status:503);}}
  const v=await this.#service.detail(session,body,'HOST');const photo=await this.#photos.read({...session,view:'HOST'},v.visitRequestId);try{await this.#service.detail(session,body,'HOST');return{mimeType:photo.mimeType,imageBase64:photo.bytes.toString('base64')};}finally{photo.bytes.fill(0);}
 }
}
