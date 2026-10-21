import type {IncomingMessage,ServerResponse} from 'node:http';
import type {AdditionalHttpRoutes} from '../transport/ApiHandler.ts';
import {HttpFailure,readJsonBody} from '../transport/ApiHandler.ts';
import type {StaffEntryRoutes} from './StaffEntryRoutes.ts';
import type {VisitReadService,VisitPhotoService} from '../visits/VisitReadService.ts';
import type {GuardWorkspaceService} from '../visits/GuardWorkspaceService.ts';
import type {GuardMovementService} from '../visits/GuardMovementService.ts';
import {requireDummySso} from './DummyEmployeeSso.ts';
export class GuardRoutes implements AdditionalHttpRoutes{
 #staff:StaffEntryRoutes;#workspace:GuardWorkspaceService;#reads:VisitReadService;#photos:VisitPhotoService;#moves:GuardMovementService;
 constructor(staff:StaffEntryRoutes,workspace:GuardWorkspaceService,reads:VisitReadService,photos:VisitPhotoService,moves:GuardMovementService){this.#staff=staff;this.#workspace=workspace;this.#reads=reads;this.#photos=photos;this.#moves=moves;}
 handles(path:string){return /^\/api\/guard\/(context|projects|verify|lookup|detail|photo|recent|visitors|movement)$/u.test(path);}
 async handle(req:IncomingMessage,_res:ServerResponse){requireDummySso();if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))throw new HttpFailure(403);if(!this.handles(req.url??''))throw new HttpFailure(404);const session=this.#staff.session(req);if(!await this.#staff.verify(session))throw new HttpFailure(401);const d=await readJsonBody(req),action=req.url!.split('/').at(-1)!,context={...session,view:'GUARD' as const};
  if(action==='context'){if(Object.keys(d).length)throw new HttpFailure(400);return this.#workspace.read(session);}
  if(action==='visitors')return this.#workspace.visitors(session,d);
  if(['projects','recent'].includes(action)){if(Object.keys(d).join('|')!=='locationId')throw new HttpFailure(400);return action==='projects'?this.#reads.workContexts(context,d.locationId):this.#workspace.read(session,d.locationId);}
  if(action==='verify')return this.#reads.verify(context,d);
  if(action==='lookup'){if(Object.keys(d).sort().join('|')!=='locationId|publicReference')throw new HttpFailure(400);const id=await this.#workspace.lookup(session,d.locationId,d.publicReference);return{visits:id?[await this.#reads.detail(context,id)]:[]};}
  if(action==='movement')return this.#moves.record(session,d);
  if(Object.keys(d).join('|')!=='visitRequestId')throw new HttpFailure(400);
  if(action==='detail')return this.#reads.detail(context,d.visitRequestId);
  const photo=await this.#photos.read(context,d.visitRequestId);try{return{mimeType:photo.mimeType,imageBase64:photo.bytes.toString('base64')};}finally{photo.bytes.fill(0);}
 }
}
