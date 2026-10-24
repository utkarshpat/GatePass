import type {HostReminderService} from '../email/HostReminderService.ts';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {AdditionalHttpRoutes} from '../transport/ApiHandler.ts';
import {HttpFailure,readJsonBody} from '../transport/ApiHandler.ts';
import type {StaffEntryRoutes} from './StaffEntryRoutes.ts';
import type {VisitReadService,VisitPhotoService} from '../visits/VisitReadService.ts';
import type {GuardWorkspaceService} from '../visits/GuardWorkspaceService.ts';
import type {GuardDutyService} from '../visits/GuardDutyService.ts';
import {requireDummySso} from './DummyEmployeeSso.ts';
import {createHash} from 'node:crypto';
import {NameReadings,NameReadingError} from '../visits/NameReadings.ts';
import type{PhotoThumbnails}from'../visits/PhotoThumbnails.ts';
export class GuardRoutes implements AdditionalHttpRoutes{
 private reminders?:HostReminderService;
 #staff:StaffEntryRoutes;#workspace:GuardWorkspaceService;#reads:VisitReadService;#photos:VisitPhotoService;#duties:GuardDutyService;
 #names:NameReadings;#nameRates=new Map<string,{count:number;until:number}>();#thumbnails?:PhotoThumbnails;
 constructor(staff:StaffEntryRoutes,workspace:GuardWorkspaceService,reads:VisitReadService,photos:VisitPhotoService,duties:GuardDutyService,reminders?:HostReminderService,names=new NameReadings(null),thumbnails?:PhotoThumbnails){this.reminders=reminders;this.#staff=staff;this.#workspace=workspace;this.#reads=reads;this.#photos=photos;this.#duties=duties;this.#names=names;this.#thumbnails=thumbnails;}
 handles(path:string){return /^\/api\/guard\/(context|queue|duties|projects|verify|lookup|detail|photo|recent|visitors|movement|remind-host|name-readings)$/u.test(path);}
 async handle(req:IncomingMessage,_res:ServerResponse){requireDummySso();if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))throw new HttpFailure(403);if(!this.handles(req.url??''))throw new HttpFailure(404);const session=this.#staff.session(req);if(!await this.#staff.verify(session))throw new HttpFailure(401);const d=await readJsonBody(req),action=req.url!.split('/').at(-1)!,context={...session,view:'GUARD' as const};
  if(action==='remind-host'){if(!this.reminders)throw new HttpFailure(503);return this.reminders.run(session,d,'GUARD');}
  if(action==='name-readings'){
   // Recheck current guard access before even a cached display transformation.
   // This endpoint transforms submitted text; it never searches the directory.
   await this.#workspace.read(session);
   const now=Date.now(),key=createHash('sha256').update(session.sessionToken).digest('hex');
   for(const [k,v]of this.#nameRates)if(v.until<=now)this.#nameRates.delete(k);
   const rate=this.#nameRates.get(key)??{count:0,until:now+60000};
   if(rate.count>=30||!this.#nameRates.has(key)&&this.#nameRates.size>=256)throw new HttpFailure(429);
   rate.count++;this.#nameRates.set(key,rate);
   try{return await this.#names.read(d);}catch(e){if(e instanceof NameReadingError)throw new HttpFailure(e.code==='INVALID_INPUT'?400:429);throw e;}
  }
  if(action==='context'){if(Object.keys(d).length)throw new HttpFailure(400);return this.#workspace.read(session);}
  if(action==='duties')return this.#duties.duties(session,d);
  if(action==='queue')return this.#duties.queue(session,d);
  if(action==='visitors')return this.#duties.visitors(session,d);
  if(['projects','recent'].includes(action)){if(Object.keys(d).join('|')!=='locationId')throw new HttpFailure(400);return action==='projects'?this.#reads.workContexts(context,d.locationId):this.#workspace.read(session,d.locationId);}
  if(action==='verify')return this.#duties.detail(session,d);
  if(action==='lookup'){if(Object.keys(d).sort().join('|')!=='locationId|publicReference')throw new HttpFailure(400);const id=await this.#workspace.lookup(session,d.locationId,d.publicReference);return{visits:id?[await this.#reads.detail(context,id)]:[]};}
  if(action==='movement')return this.#duties.movement(session,d);
  if(action==='detail'){const result=await this.#duties.detail(session,d);if(!result.visit)throw new HttpFailure(403);return result.visit;}
  const thumbnail=d.thumbnail===true;if(Object.hasOwn(d,'thumbnail')){if(typeof d.thumbnail!=='boolean')throw new HttpFailure(400);delete d.thumbnail;}
  const before=await this.#duties.detail(session,d);if(!before.visit)throw new HttpFailure(403);
  const photo=await this.#photos.read(context,before.visit.visitRequestId);
  let small:Buffer|undefined;try{if(thumbnail){if(!this.#thumbnails)throw new HttpFailure(503);try{small=await this.#thumbnails.read(photo.bytes);}catch(error){throw new HttpFailure((error as Error).message==='THUMBNAILS_BUSY'?429:503);}}const after=await this.#duties.detail(session,d);if(!after.visit||after.visit.accessPassId!==before.visit.accessPassId)throw new HttpFailure(403);return{mimeType:thumbnail?'image/jpeg':photo.mimeType,imageBase64:(small??photo.bytes).toString('base64')};}finally{small?.fill(0);photo.bytes.fill(0);}
 }
}
