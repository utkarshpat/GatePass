import type {IncomingMessage,ServerResponse} from 'node:http';
import {HttpFailure,readJsonBody} from './ApiHandler.ts';
import type {AdditionalHttpRoutes} from './ApiHandler.ts';
import type {EmailWorkflowService} from '../email/EmailWorkflowService.ts';
import {OwnCardError} from '../printing/OwnDigitalIdCardService.ts';
import type {OwnDigitalIdCardService} from '../printing/OwnDigitalIdCardService.ts';
/** Read-only bearer endpoints. Outer HTTP adapter enforces exact origin and JSON POST. */
export class EmailPublicRoutes implements AdditionalHttpRoutes{
 #service:EmailWorkflowService;#cards:Pick<OwnDigitalIdCardService,'image'>|undefined;
 constructor(service:EmailWorkflowService,cards?:Pick<OwnDigitalIdCardService,'image'>){this.#service=service;this.#cards=cards;}
 handles(path:string){return ['/api/email/external/detail','/api/email/external/image'].includes(path);}
 async handle(req:IncomingMessage,_res:ServerResponse){if(!this.handles(req.url??''))throw new HttpFailure(404);const body=await readJsonBody(req);if(req.url!.endsWith('/detail'))return this.#service.external(body);
  if(Object.keys(body).join('|')!=='link')throw new HttpFailure(400);const p=await this.#service.linkParameters(body.link);if(!this.#cards)throw new HttpFailure(503);
  try{return await this.#cards.image({sessionToken:'',csrfToken:''},p.VisitRequestId.value,{RecipientEmailHash:p.RecipientEmailHash.value,SnapshotHash:p.SnapshotHash.value});}catch(e){throw new HttpFailure(e instanceof OwnCardError?e.status:503);}
 }
}
