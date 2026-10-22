import {timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {cookies,HttpFailure,readJsonBody,token} from '../transport/ApiHandler.ts';
import type {AdditionalHttpRoutes} from '../transport/ApiHandler.ts';
import {requireDummySso} from './DummyEmployeeSso.ts';
import type {DummyEmployeeSso} from './DummyEmployeeSso.ts';
import {dummyPasswordValid} from './DummySsoRoutes.ts';
import type {ReceptionService} from '../reception/ReceptionService.ts';
import type {VisitReadService,VisitPhotoService} from '../visits/VisitReadService.ts';
import type {OwnDigitalIdCardService} from '../printing/OwnDigitalIdCardService.ts';
import {OwnCardError} from '../printing/OwnDigitalIdCardService.ts';
import type {PassPrintService,PassRenderService} from '../printing/PassPrintService.ts';
const paths=['login','me','logout','list','detail','photo','preview','print/request','print/status','print/render'].map(p=>'/api/reception/'+p);
export class ReceptionRoutes implements AdditionalHttpRoutes{
 #sso:DummyEmployeeSso;#workspace:ReceptionService;#reads:VisitReadService;#photos:VisitPhotoService;#cards:OwnDigitalIdCardService;#printing:PassPrintService;#render:PassRenderService;#rendering=0;#staff?:{verify(session:{sessionToken:string;csrfToken:string}):Promise<boolean>};
 constructor(sso:DummyEmployeeSso,workspace:ReceptionService,reads:VisitReadService,photos:VisitPhotoService,cards:OwnDigitalIdCardService,printing:PassPrintService,render:PassRenderService,staff?:{verify(session:{sessionToken:string;csrfToken:string}):Promise<boolean>}){this.#sso=sso;this.#workspace=workspace;this.#reads=reads;this.#photos=photos;this.#cards=cards;this.#printing=printing;this.#render=render;this.#staff=staff;}
 handles(path:string){return paths.includes(path);}
 #session(req:IncomingMessage){const jar=cookies(req.headers.cookie),sessionToken=jar[jar['gp-staff-session']?'gp-staff-session':'gp-reception-session'],csrfToken=req.headers['x-csrf-token'];if(!token(sessionToken))throw new HttpFailure(401);if(!token(csrfToken)||!token(jar[jar['gp-staff-session']?'gp-staff-csrf':'gp-reception-csrf'])||!timingSafeEqual(Buffer.from(csrfToken),Buffer.from(jar[jar['gp-staff-session']?'gp-staff-csrf':'gp-reception-csrf'])))throw new HttpFailure(403);return {sessionToken,csrfToken};}
 #cookie(session:string,csrf:string,clear=false){const attrs='; Path=/; SameSite=Strict'+(clear?'; Max-Age=0':'');return ['gp-reception-session='+session+attrs+'; HttpOnly','gp-reception-csrf='+csrf+attrs];}
 async handle(req:IncomingMessage,res:ServerResponse){
  requireDummySso();if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))throw new HttpFailure(403);
  if(!this.handles(req.url??''))throw new HttpFailure(404);const path=req.url!,input=await readJsonBody(req);
  if(path===paths[0]){
   if(Object.keys(input).sort().join('|')!=='email|password'||typeof input.email!=='string'||input.email.length>320||!dummyPasswordValid(input.password))throw new HttpFailure(401);
   const employee=(await this.#sso.list()).find(p=>p.officialEmail.toLowerCase()===String(input.email).trim().toLowerCase());if(!employee)throw new HttpFailure(401);
   const login=await this.#sso.signIn(employee.employeeId);
   try{
    const context=await this.#workspace.context(login);
    try{if(cookies(req.headers.cookie)['gp-reception-session']){const previous=this.#session(req);await this.#sso.sessionAction('logout',previous).catch(()=>{});}}catch{/* Stale cleanup */}
    res.setHeader('Set-Cookie',this.#cookie(login.sessionToken,login.csrfToken));return context;
   }catch(error){await this.#sso.sessionAction('logout',login).catch(()=>{});throw error;}
  }
  const session=this.#session(req);const central=!!cookies(req.headers.cookie)['gp-staff-session'];if(!(central?await this.#staff?.verify(session):await this.#sso.verify(session)))throw new HttpFailure(401);
  if(path===paths[2]){if(Object.keys(input).length)throw new HttpFailure(400);await this.#sso.sessionAction('logout',session);res.setHeader('Set-Cookie',this.#cookie('','',true));return{ok:true};}
  if(path===paths[1]){if(Object.keys(input).length)throw new HttpFailure(400);return this.#workspace.context(session);}
  if(path===paths[3])return this.#workspace.list(session,input);
  if(path===paths[7])return this.#printing.request(session,input);
  const key=path===paths[8]||path===paths[9]?'printJobId':'visitRequestId';if(Object.keys(input).length!==1||!Object.hasOwn(input,key))throw new HttpFailure(400);
  if(path===paths[8])return this.#printing.status(session,input.printJobId);
  if(path===paths[4])return this.#reads.detail({...session,view:'RECEPTION'},input.visitRequestId);
  if(path===paths[5]){const photo=await this.#photos.read({...session,view:'RECEPTION'},input.visitRequestId);try{return{mimeType:photo.mimeType,imageBase64:photo.bytes.toString('base64')};}finally{photo.bytes.fill(0);}}
  if(path===paths[6]){try{return await this.#cards.image(session,input.visitRequestId);}catch(error){throw new HttpFailure(error instanceof OwnCardError?error.status:503);}}
  if(path===paths[9]){
   if(this.#rendering>=2)throw new HttpFailure(429);this.#rendering++;
   try{const image=await this.#render.renderAndDispatch(session,input.printJobId);try{return{printJobId:image.printJobId,mimeType:image.mimeType,imageBase64:image.bytes.toString('base64'),status:'DISPATCHED'};}finally{image.bytes.fill(0);}}finally{this.#rendering--;}
  }
  throw new HttpFailure(404);
 }
}
