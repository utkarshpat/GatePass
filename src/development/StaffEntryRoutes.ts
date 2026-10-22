import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {cookies,HttpFailure,readJsonBody,token} from '../transport/ApiHandler.ts';
import type {AdditionalHttpRoutes} from '../transport/ApiHandler.ts';
import type {SqlParameter} from '../transport/SqlProcedureClient.ts';
import {requireDummySso} from './DummyEmployeeSso.ts';import type {DummyEmployeeSso} from './DummyEmployeeSso.ts';
import {dummyPasswordValid} from './DummySsoRoutes.ts';import type {GuardAuthService} from '../security/GuardAuthService.ts';
import {receptionIdentity} from '../reception/ReceptionService.ts';
type Session={sessionToken:string;csrfToken:string};
const routes=['/api/staff/login','/api/staff/me','/api/staff/logout'];
export class StaffEntryRoutes implements AdditionalHttpRoutes{
 #sso:DummyEmployeeSso;#guard:GuardAuthService;#client:{callProcedure(name:string,p:Record<string,SqlParameter>):Promise<string>};#source=randomBytes(32);#issued=new Map<string,{kind:'SSO'|'LOCAL';csrfToken:string;expires:number;lastTouched:number;touching?:Promise<boolean>}>();
 constructor(sso:DummyEmployeeSso,guard:GuardAuthService,client:{callProcedure(name:string,p:Record<string,SqlParameter>):Promise<string>}){this.#sso=sso;this.#guard=guard;this.#client=client;}
 handles(path:string){return routes.includes(path);}
 #key(session:Session){return createHash('sha256').update(session.sessionToken).digest('hex');}
 async verify(session:Session){
  const key=this.#key(session),issued=this.#issued.get(key);if(!issued||issued.expires<=Date.now()||!token(session.csrfToken)||!timingSafeEqual(Buffer.from(session.csrfToken),Buffer.from(issued.csrfToken)))return false;
  if(Date.now()-issued.lastTouched>=60000){if(!issued.touching)issued.touching=(async()=>{try{const result=issued.kind==='LOCAL'?await this.#guard.sessionAction('touch',session.sessionToken,issued.csrfToken):await this.#sso.sessionAction('touch',session);if(result.ok)issued.lastTouched=Date.now();else this.#issued.delete(key);return result.ok===true;}catch{return false;}finally{issued.touching=undefined;}})();return issued.touching;}
  return issued.kind==='LOCAL'||await this.#sso.verify(session);
 }
 #cookies(session:string,csrf:string,clear=false){const attributes='; Path=/; SameSite=Strict'+(clear?'; Max-Age=0':'');return ['gp-staff-session='+session+attributes+'; HttpOnly','gp-staff-csrf='+csrf+attributes,'gp-reception-session=; Path=/; SameSite=Strict; Max-Age=0; HttpOnly','gp-reception-csrf=; Path=/; SameSite=Strict; Max-Age=0'];}
 session(req:IncomingMessage){const jar=cookies(req.headers.cookie),sessionToken=jar['gp-staff-session'],csrfToken=req.headers['x-csrf-token'];if(!token(sessionToken))throw new HttpFailure(401);if(!token(csrfToken)||!token(jar['gp-staff-csrf'])||!timingSafeEqual(Buffer.from(csrfToken),Buffer.from(jar['gp-staff-csrf'])))throw new HttpFailure(403);return{sessionToken,csrfToken};}
 async #revoke(session:Session,kind:'SSO'|'LOCAL'){if(kind==='SSO')return this.#sso.sessionAction('logout',session);return this.#guard.sessionAction('logout',session.sessionToken,session.csrfToken);}
 async #context(session:Session){
  let data:any;try{data=JSON.parse(await this.#client.callProcedure('gp.GetStaffAccessContext',receptionIdentity(session)));}catch(error){throw new HttpFailure([52001,53601].includes(Number((error as any)?.number))?403:503);}
  if(!data||typeof data.displayName!=='string'||data.displayName.length>200||!Array.isArray(data.grants)||data.grants.length>100||typeof data.receptionAvailable!=='boolean')throw new HttpFailure(503);
  const grants=data.grants.map((g:any)=>{if(!g||!['GUARD','RECEPTION','INDIA_ADMIN','LOCATION_ADMIN','PROJECT_ADMIN','PLATFORM_ADMIN'].includes(g.roleCode)||!['INDIA','LOCATION','PROJECT','PROJECT_LOCATION','PLATFORM'].includes(g.scopeType)||typeof g.scopeName!=='string'||g.scopeName.length>403||!Array.isArray(g.capabilities)||g.capabilities.length>100||g.capabilities.some((c:any)=>typeof c.code!=='string'||!/^[A-Z_]{1,40}$/u.test(c.code)))throw new HttpFailure(503);return{roleCode:g.roleCode,scopeType:g.scopeType,scopeName:g.scopeName,capabilities:g.capabilities.map((c:any)=>c.code)};});
  if(typeof data.adminAvailable!=='boolean')throw new HttpFailure(503);
  return{displayName:data.displayName,grants,workspaces:[...(grants.some((g:any)=>g.roleCode==='GUARD'&&g.capabilities.includes('VISITS_READ'))?[{code:'GUARD',name:'Guard',path:'/guard'}]:[]),...(data.adminAvailable?[{code:'ADMIN',name:'Administration',path:'/admin'}]:[]),...(data.receptionAvailable?[{code:'RECEPTION',name:'Reception',path:'/reception'}]:[])]};
 }
 async handle(req:IncomingMessage,res:ServerResponse){
  requireDummySso();if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))throw new HttpFailure(403);
  if(!this.handles(req.url??''))throw new HttpFailure(404);const input=await readJsonBody(req);
  if(req.url===routes[0]){
   if(Object.keys(input).sort().join('|')!=='login|password'||typeof input.login!=='string'||!input.login.trim()||input.login.length>320||typeof input.password!=='string'||input.password.length>512)throw new HttpFailure(400);
   for(const[key,value]of this.#issued)if(value.expires<=Date.now())this.#issued.delete(key);if(this.#issued.size>=256)throw new HttpFailure(429);
   const login=input.login.trim();let signed:any,kind:'SSO'|'LOCAL';
   let identity:any;try{identity=JSON.parse(await this.#client.callProcedure('gp.ResolveStaffLoginIdentity',{LoginId:{type:'text',value:login.toLowerCase()}}));}catch{throw new HttpFailure(503);}
   if(!identity||!['SSO','LOCAL'].includes(identity.provider)||identity.provider==='SSO'&&(typeof identity.employeeId!=='string'||!/^EMP[0-9]{3}$/u.test(identity.employeeId)))throw new HttpFailure(503);
   if(identity.provider==='SSO'){kind='SSO';if(!dummyPasswordValid(input.password))throw new HttpFailure(401);signed=await this.#sso.signIn(identity.employeeId);}
   else{kind='LOCAL';signed=await this.#guard.signIn(login,input.password,{sourceHash:createHmac('sha256',this.#source).update(req.socket.remoteAddress??'unknown').digest()});if(!signed.ok)throw new HttpFailure(401);}
   try{
    const context=await this.#context(signed);
    // Retire only a session this adapter issued, using its original binding even if browser CSRF is stale.
    const previousToken=cookies(req.headers.cookie)['gp-staff-session'];if(token(previousToken)){const previousKey=createHash('sha256').update(previousToken).digest('hex'),previous=this.#issued.get(previousKey);if(previous){await this.#revoke({sessionToken:previousToken,csrfToken:previous.csrfToken},previous.kind);this.#issued.delete(previousKey);}}
    this.#issued.set(this.#key(signed),{kind,csrfToken:signed.csrfToken,lastTouched:Date.now(),expires:Date.parse(signed.absoluteExpiresAtUtc.endsWith('Z')?signed.absoluteExpiresAtUtc:signed.absoluteExpiresAtUtc+'Z')});
    res.setHeader('Set-Cookie',this.#cookies(signed.sessionToken,signed.csrfToken));return context;
   }catch(error){await this.#revoke(signed,kind).catch(()=>{});throw error;}
  }
  if(Object.keys(input).length)throw new HttpFailure(400);const session=this.session(req);if(!await this.verify(session))throw new HttpFailure(401);
  if(req.url===routes[2]){const issued=this.#issued.get(this.#key(session))!;const result=await this.#revoke(session,issued.kind);if(!result.ok)throw new HttpFailure(401);this.#issued.delete(this.#key(session));res.setHeader('Set-Cookie',this.#cookies('','',true));return{ok:true};}
  return this.#context(session);
 }
}
