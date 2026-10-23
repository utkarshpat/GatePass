import {createHash} from 'node:crypto';
import type {ServerResponse} from 'node:http';
import type {SqlParameter} from '../transport/SqlProcedureClient.ts';
import {HttpFailure} from '../transport/ApiHandler.ts';

type Scope={location:number;project?:string;digital?:boolean};
type Listener={key:string;topics:Set<string>;response:ServerResponse;dirty:boolean;timer?:ReturnType<typeof setTimeout>;lease:ReturnType<typeof setTimeout>};
const office=(v:unknown):v is number=>Number.isInteger(v)&&Number(v)>0&&Number(v)<=2147483647;
const big=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,18}$/u.test(v)&&BigInt(v)<=9223372036854775807n;
const visit=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(v);
const mutations=new Set(['gp.SubmitRegistration','gp.DecideVisit','gp.CancelVisit','gp.RevokeEmailRequest','gp.RecordGuardDutyMovement','gp.RecordMovement','gp.ReturnReceptionPass','gp.CorrectReceptionReturn','gp.DispatchPassPrint','gp.CreateScopedProject','gp.ManageCommonDuty','gp.AllocateGuard','gp.DeallocateGuard','gp.GrantStaffRole','gp.RevokeStaffRole']);
const catalogue=new Set(['gp.CreateScopedProject','gp.ManageCommonDuty','gp.AllocateGuard','gp.DeallocateGuard','gp.GrantStaffRole','gp.RevokeStaffRole']);

/** Single-process, bounded invalidations, never an authorization or identity cache. */
export class WorkspaceChanges {
 #listeners=new Set<Listener>();#visits=new Map<string,Scope&{until:number}>();#pairs=new Map<string,number>();#closed=false;
 #heartbeat:ReturnType<typeof setInterval>;
 constructor(){this.#heartbeat=setInterval(()=>{for(const l of this.#listeners)this.#write(l,': keepalive\n\n');},15000);this.#heartbeat.unref();}
 get connections(){return this.#listeners.size;}
 capacity(sessionToken:string){const key=createHash('sha256').update(sessionToken).digest('hex');return Math.min(4-this.#listeners.size,2-[...this.#listeners].filter(l=>l.key===key).length);}
 #write(l:Listener,text:string){try{if(l.response.destroyed||!l.response.write(text))this.#remove(l);}catch{this.#remove(l);}}
 #remove(l:Listener){if(!this.#listeners.delete(l))return;clearTimeout(l.timer);clearTimeout(l.lease);try{l.response.end();}catch{l.response.destroy();}}
 open(sessionToken:string,topics:Set<string>,response:ServerResponse){
  if(this.#closed)throw new HttpFailure(503);
  const key=createHash('sha256').update(sessionToken).digest('hex');
  // Four streams leave twelve of the existing sixteen local sockets for ordinary HTTP work.
  if(this.capacity(sessionToken)<=0)throw new HttpFailure(429);
  if(!topics.size||topics.size>505)throw new HttpFailure(403);
  const l:Listener={key,topics:new Set(topics),response,dirty:false,lease:setTimeout(()=>this.#remove(l),120000)};
  l.lease.unref();this.#listeners.add(l);response.once('close',()=>this.#remove(l));response.once('error',()=>this.#remove(l));
  response.setHeader('Content-Type','text/event-stream; charset=utf-8');response.setHeader('X-Accel-Buffering','no');response.setHeader('Cache-Control','no-store');response.flushHeaders();
  this.#write(l,'event: ready\ndata: {}\n\n');
 }
 publish(topics:Set<string>){
  for(const l of this.#listeners){
   if(l.dirty||![...topics].some(topic=>l.topics.has(topic)))continue;
   l.dirty=true;l.timer=setTimeout(()=>{l.dirty=false;this.#write(l,'event: invalidate\ndata: {}\n\n');},250);l.timer.unref();
  }
 }
 #remember(id:string,scope:Scope){
  const previous=this.#visits.get(id);
  // Partial rosters omit project IDs; retain a known immutable visit route until its expiry.
  if(!scope.project&&!scope.digital&&previous&&previous.location===scope.location&&previous.until>Date.now())scope={...scope,...(previous.digital?{digital:true}:previous.project?{project:previous.project}:{})};
  this.#visits.delete(id);this.#visits.set(id,{...scope,until:Date.now()+3600000});
  while(this.#visits.size>4096)this.#visits.delete(this.#visits.keys().next().value!);
 }
 #scope(row:Record<string,unknown>,fallback?:Scope):Scope|undefined{
  const location=office(row.locationId)?row.locationId:fallback?.location;
  if(!location)return;
  const digital=['DIGITAL_ID','TEMP_ID'].includes(String(row.requestType))||fallback?.digital===true;
  return{location,...(digital?{digital:true}:big(row.projectLocationId)?{project:row.projectLocationId}:fallback?.project?{project:fallback.project}:{})};
 }
 /** Called only after a successful SQL RPC. Mapping holds numeric routing IDs, not names/credentials. */
 observe(name:string,parameters:Record<string,SqlParameter>,result:Record<string,unknown>){
  if(this.#closed)return;
  const value=(key:string)=>parameters[key]?.value;
  const location=value('LocationId'),project=value('ProjectLocationId')??(value('DutyKind')==='PROJECT'?value('DutyId'):undefined);
  const knownLocation=office(location)?location:big(project)?this.#pairs.get(project):undefined;
  let scope:Scope|undefined=knownLocation?{location:knownLocation,...(big(project)?{project}:{}),...(['DIGITAL_ID','TEMP_ID'].includes(String(value('RequestType')))?{digital:true}:{})}:undefined;
  const id=value('VisitRequestId');if(!scope&&visit(id)){const cached=this.#visits.get(id.toLowerCase());if(cached&&cached.until>Date.now())scope=cached;else this.#visits.delete(id.toLowerCase());}
  scope=this.#scope(result,scope);
  if(office(result.locationId)&&big(result.projectLocationId))this.#pairs.set(result.projectLocationId,result.locationId);
  const learn=(row:unknown,depth=0)=>{
   if(!row||typeof row!=='object'||depth>2)return;
   if(Array.isArray(row)){for(const child of row.slice(0,100))learn(child,depth+1);return;}
   const r=row as Record<string,unknown>,s=this.#scope(r,scope);
   if(s&&visit(r.visitRequestId))this.#remember(r.visitRequestId.toLowerCase(),s);
   if(s&&big(r.projectLocationId))this.#pairs.set(r.projectLocationId,s.location);
   for(const key of ['requests','visits','visitors','rows','projects','visit'])if(r[key])learn(r[key],depth+1);
  };
  learn(result);while(this.#pairs.size>4096)this.#pairs.delete(this.#pairs.keys().next().value!);
  if(!mutations.has(name)||!scope||name==='gp.SubmitRegistration'&&result.status!=='SUBMITTED')return;
  const topics=new Set(['o:'+scope.location]);
  if(catalogue.has(name)){topics.add('s:'+scope.location);if(scope.project)topics.add('s:'+scope.location+':'+scope.project);}
  else{topics.add('c:'+scope.location);if(scope.digital)topics.add('d:'+scope.location);else if(scope.project)topics.add('p:'+scope.location+':'+scope.project);}
  this.publish(topics);
 }
 close(){this.#closed=true;clearInterval(this.#heartbeat);for(const l of this.#listeners)this.#remove(l);this.#visits.clear();this.#pairs.clear();}
}
