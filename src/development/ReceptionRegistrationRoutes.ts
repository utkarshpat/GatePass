import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { HttpFailure } from '../transport/ApiHandler.ts';
import { RegistrationHttpRoutes } from '../transport/RegistrationHttpRoutes.ts';
import type { RegistrationService } from '../registration/RegistrationService.ts';
import type { StaffEntryRoutes } from './StaffEntryRoutes.ts';
import type { ReceptionService } from '../reception/ReceptionService.ts';
import { receptionIdentity } from '../reception/ReceptionService.ts';
import type { SqlParameter } from '../transport/SqlProcedureClient.ts';
import { requireDummySso } from './DummyEmployeeSso.ts';

/** Separate reception intake capability; every operation rechecks the operator's office grant. */
export class ReceptionRegistrationRoutes {
 #staff:StaffEntryRoutes;#reception:ReceptionService;#registration:RegistrationHttpRoutes;
 #context=new WeakMap<IncomingMessage,{office:string;session:{sessionToken:string;csrfToken:string}}>();
 constructor(staff:StaffEntryRoutes,reception:ReceptionService,service:RegistrationService,key:Buffer,client:{callProcedure(name:string,p:Record<string,SqlParameter>):Promise<string>}) {
  this.#staff=staff;this.#reception=reception;
  this.#registration=new RegistrationHttpRoutes(service,key,undefined,{localHttp:true,surface:'RECEPTION',allowedTypes:['EXTERNAL'],office:req=>this.#context.get(req)!.office,
   submitted:async(req,intake)=>{const ctx=this.#context.get(req)!;const hash=(v:string)=>createHash('sha256').update(Buffer.from(v,'base64url')).digest();await client.callProcedure('gp.AuditReceptionRegistration',{...receptionIdentity(ctx.session),IntakeId:{type:'guid',value:intake.intakeId},TokenHash:{type:'binary',value:hash(intake.intakeToken)},IntakeCsrfHash:{type:'binary',value:hash(intake.intakeCsrfToken)}});}});
 }
 handles(path:string){return /^\/api\/reception\/manual\/(start|reset|options|photo|submit)$/u.test(path);}
 async handle(req:IncomingMessage,res:ServerResponse){
  requireDummySso();if(!this.handles(req.url??''))throw new HttpFailure(404);
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))throw new HttpFailure(403);
  const session=this.#staff.session(req);if(!await this.#staff.verify(session))throw new HttpFailure(401);
  const office=req.headers['x-reception-office'];if(typeof office!=='string'||!['NOIDA','BENGALURU','CHENNAI','PUNE'].includes(office))throw new HttpFailure(400);
  const context=await this.#reception.context(session);if(!context.locations.some((l:{locationCode:string})=>l.locationCode===office))throw new HttpFailure(403);
  this.#context.set(req,{office,session});const original=req.url;req.url=req.url!.replace('/api/reception/manual/','/api/registration/');
  try{return await this.#registration.handle(req,res);}finally{req.url=original;this.#context.delete(req);}
 }
}
