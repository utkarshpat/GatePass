import type {IncomingMessage,ServerResponse} from 'node:http';
import type {AdditionalHttpRoutes} from '../transport/ApiHandler.ts';
import {HttpFailure,readJsonBody} from '../transport/ApiHandler.ts';
import type {StaffEntryRoutes} from './StaffEntryRoutes.ts';
import type {AdminWorkspaceService} from '../administration/AdminWorkspaceService.ts';
import type {StaffAdministrationService} from '../administration/StaffAdministrationService.ts';
import {requireDummySso} from './DummyEmployeeSso.ts';
export class AdminRoutes implements AdditionalHttpRoutes{
 #staff:StaffEntryRoutes;#reads:AdminWorkspaceService;#writes:StaffAdministrationService;
 constructor(staff:StaffEntryRoutes,reads:AdminWorkspaceService,writes:StaffAdministrationService){this.#staff=staff;this.#reads=reads;this.#writes=writes;}
 handles(path:string){return /^\/api\/admin\/(context|projects|leads|candidates|grant|revoke)$/u.test(path);}
 async handle(req:IncomingMessage,_res:ServerResponse){requireDummySso();if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))throw new HttpFailure(403);if(!this.handles(req.url??''))throw new HttpFailure(404);const session=this.#staff.session(req);if(!await this.#staff.verify(session))throw new HttpFailure(401);const d=await readJsonBody(req),action=req.url!.split('/').at(-1)!;
  if(action==='grant'){if(d.roleCode!=='PROJECT_ADMIN'||!['PROJECT','PROJECT_LOCATION'].includes(String(d.scopeType)))throw new HttpFailure(400);return this.#writes.grant(session,d);}
  if(action==='revoke')return this.#writes.revoke(session,d);
  return this.#reads.read(session,action,d);
 }
}
