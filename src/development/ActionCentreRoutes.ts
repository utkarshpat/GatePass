import {timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {cookies,HttpFailure,readJsonBody,token} from '../transport/ApiHandler.ts';
import type {AdditionalHttpRoutes} from '../transport/ApiHandler.ts';
import type {StaffEntryRoutes} from './StaffEntryRoutes.ts';
import type {DummyEmployeeSso} from './DummyEmployeeSso.ts';
import {requireDummySso} from './DummyEmployeeSso.ts';
import type {ActionCentreService} from '../operations/ActionCentreService.ts';
export class ActionCentreRoutes implements AdditionalHttpRoutes{
 private staff:StaffEntryRoutes;private sso:DummyEmployeeSso;private service:ActionCentreService;
 constructor(staff:StaffEntryRoutes,sso:DummyEmployeeSso,service:ActionCentreService){this.staff=staff;this.sso=sso;this.service=service;}
 handles(path:string){return ['/api/operations/actions','/api/operations/remind'].includes(path);}
 async handle(req:IncomingMessage,_res:ServerResponse){
  requireDummySso();if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))throw new HttpFailure(403);
  if(!this.handles(req.url??''))throw new HttpFailure(404);
  const jar=cookies(req.headers.cookie);let session;
  if(jar['gp-staff-session']){session=this.staff.session(req);if(!await this.staff.verify(session))throw new HttpFailure(401);}
  else{const sessionToken=jar['gp-reception-session'],csrfToken=req.headers['x-csrf-token'];if(!token(sessionToken))throw new HttpFailure(401);if(!token(csrfToken)||!token(jar['gp-reception-csrf'])||!timingSafeEqual(Buffer.from(csrfToken),Buffer.from(jar['gp-reception-csrf'])))throw new HttpFailure(403);session={sessionToken,csrfToken};if(!await this.sso.verify(session))throw new HttpFailure(401);}
  const body=await readJsonBody(req);return req.url==='/api/operations/remind'?this.service.remind(session,body):this.service.read(session,body);
 }
}
