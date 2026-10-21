import type {IncomingMessage,ServerResponse} from 'node:http';
import type {AdditionalHttpRoutes} from '../transport/ApiHandler.ts';
import {HttpFailure,readJsonBody} from '../transport/ApiHandler.ts';
import type {StaffEntryRoutes} from './StaffEntryRoutes.ts';
import type {VisitReadService,VisitPhotoService} from '../visits/VisitReadService.ts';
import type {GuardWorkspaceService} from '../visits/GuardWorkspaceService.ts';
import type {GuardDutyService} from '../visits/GuardDutyService.ts';
import {requireDummySso} from './DummyEmployeeSso.ts';
export class GuardRoutes implements AdditionalHttpRoutes{
 #staff:StaffEntryRoutes;#workspace:GuardWorkspaceService;#reads:VisitReadService;#photos:VisitPhotoService;#duties:GuardDutyService;
 constructor(staff:StaffEntryRoutes,workspace:GuardWorkspaceService,reads:VisitReadService,photos:VisitPhotoService,duties:GuardDutyService){this.#staff=staff;this.#workspace=workspace;this.#reads=reads;this.#photos=photos;this.#duties=duties;}
 handles(path:string){return /^\/api\/guard\/(context|duties|projects|verify|lookup|detail|photo|recent|visitors|movement)$/u.test(path);}
 async handle(req:IncomingMessage,_res:ServerResponse){requireDummySso();if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))throw new HttpFailure(403);if(!this.handles(req.url??''))throw new HttpFailure(404);const session=this.#staff.session(req);if(!await this.#staff.verify(session))throw new HttpFailure(401);const d=await readJsonBody(req),action=req.url!.split('/').at(-1)!,context={...session,view:'GUARD' as const};
  if(action==='context'){if(Object.keys(d).length)throw new HttpFailure(400);return this.#workspace.read(session);}
  if(action==='duties')return this.#duties.duties(session,d);
  if(action==='visitors')return this.#duties.visitors(session,d);
  if(['projects','recent'].includes(action)){if(Object.keys(d).join('|')!=='locationId')throw new HttpFailure(400);return action==='projects'?this.#reads.workContexts(context,d.locationId):this.#workspace.read(session,d.locationId);}
  if(action==='verify')return this.#duties.detail(session,d);
  if(action==='lookup'){if(Object.keys(d).sort().join('|')!=='locationId|publicReference')throw new HttpFailure(400);const id=await this.#workspace.lookup(session,d.locationId,d.publicReference);return{visits:id?[await this.#reads.detail(context,id)]:[]};}
  if(action==='movement')return this.#duties.movement(session,d);
  if(action==='detail'){const result=await this.#duties.detail(session,d);if(!result.visit)throw new HttpFailure(403);return result.visit;}
  const before=await this.#duties.detail(session,d);if(!before.visit)throw new HttpFailure(403);
  const photo=await this.#photos.read(context,before.visit.visitRequestId);
  try{const after=await this.#duties.detail(session,d);if(!after.visit||after.visit.accessPassId!==before.visit.accessPassId)throw new HttpFailure(403);return{mimeType:photo.mimeType,imageBase64:photo.bytes.toString('base64')};}finally{photo.bytes.fill(0);}
 }
}
