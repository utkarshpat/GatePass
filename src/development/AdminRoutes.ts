import type {AdministrationReadService} from '../administration/AdministrationReadService.ts';
import type {AdminConsoleService} from '../administration/AdminConsoleService.ts';
import type {VisitReadService} from '../visits/VisitReadService.ts';
import QRCode from 'qrcode';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {AdditionalHttpRoutes} from '../transport/ApiHandler.ts';
import {HttpFailure,readJsonBody} from '../transport/ApiHandler.ts';
import type {StaffEntryRoutes} from './StaffEntryRoutes.ts';
import type {AdminWorkspaceService} from '../administration/AdminWorkspaceService.ts';
import type {StaffAdministrationService} from '../administration/StaffAdministrationService.ts';
import type {GuardDutyService} from '../visits/GuardDutyService.ts';
import {requireDummySso} from './DummyEmployeeSso.ts';

export class AdminRoutes implements AdditionalHttpRoutes{
 #admin?:AdministrationReadService;#console?:AdminConsoleService;#visits?:VisitReadService;
 #staff:StaffEntryRoutes;#reads:AdminWorkspaceService;#writes:StaffAdministrationService;#duties:GuardDutyService;
 #brandIcon?:Buffer;#sharp?:any;#centerBadge?:Buffer;
 constructor(staff:StaffEntryRoutes,reads:AdminWorkspaceService,writes:StaffAdministrationService,duties:GuardDutyService,admin?:AdministrationReadService,console?:AdminConsoleService,visits?:VisitReadService,brandIcon?:Buffer,sharp?:any){
  this.#admin=admin;this.#console=console;this.#visits=visits;this.#staff=staff;this.#reads=reads;this.#writes=writes;this.#duties=duties;
  this.#brandIcon=brandIcon;this.#sharp=sharp;
 }
 async #generateOfficeQr(url:string):Promise<string>{
  const qrBuf=await QRCode.toBuffer(url,{width:600,margin:4,errorCorrectionLevel:'H',type:'png'});
  let sharp=this.#sharp,icon=this.#brandIcon;
  if(!sharp){
   try{
    const {createRequire}=await import('node:module');
    const {homedir}=await import('node:os');
    const {join}=await import('node:path');
    sharp=createRequire(import.meta.url)(process.env.GATEPASS_SHARP_PATH??join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','sharp'));
    this.#sharp=sharp;
   }catch{}
  }
  if(!icon){
   try{
    const {readFile}=await import('node:fs/promises');
    icon=await readFile(new URL('../../assets/brand/sopra-steria-icon.png',import.meta.url));
    this.#brandIcon=icon;
   }catch{}
  }
  if(!sharp||!icon)return 'data:image/png;base64,'+qrBuf.toString('base64');
  try{
   if(!this.#centerBadge){
    const size=110,inner=Math.round(size*0.72);
    const resized=await sharp(icon).resize({width:inner,height:inner,fit:'inside'}).png().toBuffer();
    const badgeSvg=Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="14" fill="white" stroke="#e2e8f0" stroke-width="2"/></svg>`);
    this.#centerBadge=await sharp(badgeSvg).composite([{input:resized,gravity:'center'}]).png().toBuffer();
   }
   const finalBuf=await sharp(qrBuf).composite([{input:this.#centerBadge,gravity:'center'}]).png().toBuffer();
   return 'data:image/png;base64,'+finalBuf.toString('base64');
  }catch{return 'data:image/png;base64,'+qrBuf.toString('base64');}
 }
 handles(path:string){return /^\/api\/admin\/(context|create-project|projects|leads|candidates|grant|revoke|common-duties|common-duty|scope|assignments|guards|subjects|roles|summary|audit|allocate|deallocate|visits|register|create-staff|reset-staff-setup|visit-detail|office-qr)$/u.test(path);}
 async handle(req:IncomingMessage,_res:ServerResponse){requireDummySso();if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))throw new HttpFailure(403);if(!this.handles(req.url??''))throw new HttpFailure(404);const session=this.#staff.session(req);if(!await this.#staff.verify(session))throw new HttpFailure(401);const d=await readJsonBody(req),action=req.url!.split('/').at(-1)!;
  if(['scope','assignments'].includes(action)){if(!this.#console)throw new HttpFailure(503);return this.#console.read(session,action as 'scope'|'assignments',d);}
  if(['guards','subjects','roles','summary','audit'].includes(action)){if(!this.#admin)throw new HttpFailure(503);return this.#admin[action as 'guards'|'subjects'|'roles'|'summary'|'audit'](session,d);}
  if(action==='create-project')return this.#reads.createProject(session,d);
  if(action==='allocate'||action==='deallocate')return this.#writes[action](session,d);
  if(action==='create-staff'||action==='reset-staff-setup'){if(!this.#console)throw new HttpFailure(503);return action==='create-staff'?this.#console.createStaff(session,d):this.#console.resetStaffSetup(session,d);}
  if(action==='register'){if(!this.#console)throw new HttpFailure(503);return this.#console.register(session,d);}
  if(action==='visits'){if(!this.#visits)throw new HttpFailure(503);return this.#visits.list({...session,view:'ADMIN'},d);}
  if(action==='visit-detail'){if(!this.#visits)throw new HttpFailure(503);if(Object.keys(d).join('|')!=='visitRequestId')throw new HttpFailure(400);return this.#visits.detail({...session,view:'ADMIN'},d.visitRequestId);}
  if(action==='office-qr'){
   if(Object.keys(d).join('|')!=='locationId')throw new HttpFailure(400);const ctx=await this.#reads.read(session,'context',{}),office=ctx.locations?.find((o:any)=>o.locationId===d.locationId);if(!office)throw new HttpFailure(403);
   const code=String(office.locationCode).toLowerCase();if(!['noida','bengaluru','chennai','pune'].includes(code))throw new HttpFailure(409);
   const origin=String(req.headers.origin??'');if(!/^http:\/\/localhost:[0-9]{1,5}$/u.test(origin))throw new HttpFailure(403);
   const url=origin+'/office/'+code;return{url,locationName:office.locationName,imageDataUrl:await this.#generateOfficeQr(url)};
  }
  if(action==='common-duties')return this.#duties.administration(session,d);
  if(action==='common-duty')return this.#duties.manage(session,d);
  if(action==='grant'){const pairs:Record<string,string[]>= {GUARD:['LOCATION'],RECEPTION:['LOCATION'],PROJECT_ADMIN:['PROJECT','PROJECT_LOCATION'],LOCATION_ADMIN:['LOCATION'],INDIA_ADMIN:['INDIA'],PLATFORM_ADMIN:['PLATFORM']};if(!Object.hasOwn(pairs,String(d.roleCode))||!pairs[String(d.roleCode)].includes(String(d.scopeType)))throw new HttpFailure(400);return this.#writes.grant(session,d);}
  if(action==='revoke')return this.#writes.revoke(session,d);
  return this.#reads.read(session,action,d);
 }
}
