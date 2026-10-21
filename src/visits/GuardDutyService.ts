import { createHash } from 'node:crypto';
import { receptionIdentity } from '../reception/ReceptionService.ts';
import { guardVisitors } from './GuardWorkspaceService.ts';
import { normalizeVisitRow } from './VisitReadService.ts';
import { isUuid } from './SqlVisitReadRepository.ts';
import type { SqlParameter } from '../transport/SqlProcedureClient.ts';

type Session = {sessionToken:string;csrfToken:string};
type Client = {callProcedure(name:string,parameters:Record<string,SqlParameter>):Promise<string>};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,18}$/u.test(v)&&BigInt(v)<=9223372036854775807n;
const office=(v:unknown)=>Number.isInteger(v)&&Number(v)>0&&Number(v)<=2147483647;
const text=(v:unknown,n:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=n&&!/[\u0000-\u001f\u007f]/u.test(v);
export class GuardDutyError extends Error {
  code:'INVALID_INPUT'|'NOT_AUTHORIZED'|'CONFLICT'|'UNAVAILABLE';
  constructor(code:GuardDutyError['code']){super(code);this.code=code;}
}
const input=(ok:unknown)=>{if(!ok)throw new GuardDutyError('INVALID_INPUT');};
const output=(ok:unknown)=>{if(!ok)throw new GuardDutyError('UNAVAILABLE');};
function body(value:unknown,keys:string[]){
  input(!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
  const d=value as Record<string,unknown>;input(Object.keys(d).every(k=>keys.includes(k)));return d;
}
function duty(d:Record<string,unknown>){input(office(d.locationId)&&['COMMON','PROJECT'].includes(String(d.dutyKind))&&id(d.dutyId));
  return {LocationId:{type:'int' as const,value:Number(d.locationId)},DutyKind:{type:'text' as const,value:d.dutyKind as string},DutyId:{type:'bigint' as const,value:d.dutyId as string}};}
function credential(value:unknown){input(typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/u.test(value as string));const raw=Buffer.from(value as string,'base64url');
  try{input(raw.length===32&&raw.toString('base64url')===value);return createHash('sha256').update(raw).digest();}finally{raw.fill(0);}}
export class GuardDutyService {
  #client:Client;
  constructor(client:Client){this.#client=client;}
  async #call(session:Session,name:string,parameters:Record<string,SqlParameter>){
    try{const r:unknown=JSON.parse(await this.#client.callProcedure(name,{...receptionIdentity(session),...parameters}));output(r&&typeof r==='object'&&!Array.isArray(r));return r as Record<string,unknown>;}
    catch(e){if(e instanceof GuardDutyError)throw e;const n=Number((e as {number?:number})?.number);throw new GuardDutyError(n===52001||n===52801?'NOT_AUTHORIZED':n===52002?'INVALID_INPUT':[52003,52004,52005].includes(n)?'CONFLICT':'UNAVAILABLE');}
  }
  async duties(session:Session,value:unknown){const d=body(value,['locationId']);input(office(d.locationId));
    const r=await this.#call(session,'gp.ListGuardDuties',{LocationId:{type:'int',value:Number(d.locationId)}});
    output(r.locationId===d.locationId&&Array.isArray(r.duties)&&r.duties.length<=500);
    const duties=(r.duties as Record<string,unknown>[]).map(v=>{output(v&&['PROJECT','COMMON'].includes(String(v.kind))&&id(v.dutyId)&&text(v.name,200));return{kind:v.kind as 'PROJECT'|'COMMON',dutyId:v.dutyId as string,name:v.name as string};});
    output(new Set(duties.map(v=>v.kind+':'+v.dutyId)).size===duties.length);return{locationId:Number(d.locationId),duties};
  }
  async visitors(session:Session,value:unknown){const d=body(value,['locationId','dutyKind','dutyId','queue','search','offset']),scope=duty(d);
    input(['EXPECTED','INSIDE'].includes(String(d.queue))&&(d.dutyKind!=='COMMON'||d.queue==='EXPECTED')&&typeof d.search==='string'&&d.search.length<=100&&!/[\u0000-\u001f\u007f]/u.test(d.search)&&Number.isInteger(d.offset)&&Number(d.offset)>=0&&Number(d.offset)<=100000);
    const r=await this.#call(session,'gp.ListGuardDutyVisitors',{...scope,Queue:{type:'text',value:d.queue as string},Search:{type:'text',value:(d.search as string).trim()},Offset:{type:'int',value:Number(d.offset)}});
    return guardVisitors(r,d.queue as string);
  }
  async detail(session:Session,value:unknown){const d=body(value,['locationId','dutyKind','dutyId','visitRequestId','credential','correlationId']),scope=duty(d);
    input(isUuid(d.visitRequestId)?d.credential===undefined&&d.correlationId===undefined:d.visitRequestId===undefined&&isUuid(d.correlationId)&&d.credential!==undefined);
    const r=await this.#call(session,'gp.ReadGuardDutyPass',{...scope,VisitRequestId:{type:'guid',value:d.visitRequestId as string??null},CredentialHash:{type:'binary',value:d.credential===undefined?null:credential(d.credential)},CorrelationId:{type:'guid',value:d.correlationId as string??null}});
    output(['NOT_AVAILABLE','VALID','REVOKED','CANCELLED','DENIED','PENDING','EXPIRED','NOT_YET_VALID','NOT_AUTHORIZED'].includes(String(r.outcome)));
    if(r.visit===undefined){output(r.outcome==='NOT_AVAILABLE');return{outcome:r.outcome as string,visit:null};}
    const v=r.visit as Record<string,unknown>;output(v&&v.dutyKind===d.dutyKind&&v.dutyId===d.dutyId&&v.verificationOnly===(d.dutyKind==='COMMON')&&typeof v.commonAccessAllowed==='boolean');
    const visit=normalizeVisitRow(v,{...session,view:'GUARD'},true);
    output(visit.locationId===d.locationId&&(d.visitRequestId===undefined||visit.visitRequestId===(d.visitRequestId as string).toLowerCase()));
    output(d.dutyKind==='COMMON'?visit.canEnter===false&&visit.canExit===false&&visit.isInside===false:visit.projectLocationId===d.dutyId);
    return{outcome:r.outcome as string,visit:{...visit,visitRequestId:visit.visitRequestId as string,accessPassId:visit.accessPassId as string,dutyKind:d.dutyKind as string,dutyId:d.dutyId as string,verificationOnly:v.verificationOnly as boolean,commonAccessAllowed:v.commonAccessAllowed as boolean}};
  }
  async movement(session:Session,value:unknown){const d=body(value,['locationId','dutyKind','dutyId','clientKey','visitRequestId','accessPassId','eventType','entryMethod','credential','reason']),scope=duty(d);
    input(d.dutyKind==='PROJECT'&&isUuid(d.clientKey)&&isUuid(d.visitRequestId)&&isUuid(d.accessPassId)&&['ENTRY','EXIT'].includes(String(d.eventType))&&['SCAN','MANUAL','RECONCILE'].includes(String(d.entryMethod)));
    input(d.entryMethod==='SCAN'?d.credential!==undefined:d.credential===undefined);input(d.entryMethod==='RECONCILE'?d.eventType==='EXIT'&&text(d.reason,300):d.reason===undefined);
    const r=await this.#call(session,'gp.RecordGuardDutyMovement',{...scope,ClientKey:{type:'guid',value:d.clientKey as string},VisitRequestId:{type:'guid',value:d.visitRequestId as string},AccessPassId:{type:'guid',value:d.accessPassId as string},EventType:{type:'text',value:d.eventType as string},EntryMethod:{type:'text',value:d.entryMethod as string},CredentialHash:{type:'binary',value:d.credential===undefined?null:credential(d.credential)},Reason:{type:'text',value:d.reason as string??null}});
    output(isUuid(r.operationId)&&isUuid(r.visitRequestId)&&r.visitRequestId.toLowerCase()===(d.visitRequestId as string).toLowerCase()&&r.projectLocationId===d.dutyId&&r.eventType===d.eventType&&r.isInside===(d.eventType==='ENTRY')&&Number.isSafeInteger(r.accessEventId)&&Number(r.accessEventId)>0);
    return{operationId:(r.operationId as string).toLowerCase(),visitRequestId:(r.visitRequestId as string).toLowerCase(),accessEventId:r.accessEventId as number,projectLocationId:r.projectLocationId as string,eventType:r.eventType as string,isInside:r.isInside as boolean};
  }
  async administration(session:Session,value:unknown){const d=body(value,['locationId','search','offset']);input(office(d.locationId)&&typeof d.search==='string'&&(d.search===''||text(d.search,80)&&d.search.trim().length>=2)&&Number.isInteger(d.offset)&&Number(d.offset)>=0&&Number(d.offset)<=100000);
    const r=await this.#call(session,'gp.GetCommonDutyAdministration',{LocationId:{type:'int',value:Number(d.locationId)},Search:{type:'text',value:d.search as string},Offset:{type:'int',value:Number(d.offset)}});
    output(Array.isArray(r.areas)&&r.areas.length<=500&&Array.isArray(r.guards)&&r.guards.length<=20&&Array.isArray(r.assignments)&&r.assignments.length<=50&&typeof r.hasMore==='boolean');
    const areas=(r.areas as Record<string,unknown>[]).map(v=>{output(id(v.areaId)&&text(v.name,100));return{areaId:v.areaId as string,name:v.name as string};});
    const guards=(r.guards as Record<string,unknown>[]).map(v=>{output(isUuid(v.userId)&&text(v.displayName,200));return{userId:v.userId as string,displayName:v.displayName as string};});
    const assignments=(r.assignments as Record<string,unknown>[]).map(v=>{output(id(v.assignmentId)&&id(v.areaId)&&text(v.areaName,100)&&text(v.guardName,200)&&isUuid(v.guardUserId));return{assignmentId:v.assignmentId as string,areaId:v.areaId as string,areaName:v.areaName as string,guardName:v.guardName as string,guardUserId:v.guardUserId as string};});
    output(!r.hasMore||assignments.length===50);return{areas,guards,assignments,hasMore:r.hasMore as boolean};
  }
  async manage(session:Session,value:unknown){const d=body(value,['clientKey','locationId','action','areaId','guardUserId','areaName','assignmentId','reason']);input(isUuid(d.clientKey)&&office(d.locationId)&&text(d.reason,300));
    input(d.action==='CREATE_AREA'?text(d.areaName,100)&&d.areaId===undefined&&d.guardUserId===undefined&&d.assignmentId===undefined:d.action==='ASSIGN'?id(d.areaId)&&isUuid(d.guardUserId)&&d.areaName===undefined&&d.assignmentId===undefined:d.action==='REMOVE'&&id(d.assignmentId)&&d.areaId===undefined&&d.guardUserId===undefined&&d.areaName===undefined);
    const r=await this.#call(session,'gp.ManageCommonDuty',{ClientKey:{type:'guid',value:d.clientKey as string},LocationId:{type:'int',value:Number(d.locationId)},Action:{type:'text',value:d.action as string},AreaId:{type:'bigint',value:d.areaId as string??null},GuardUserId:{type:'guid',value:d.guardUserId as string??null},AreaName:{type:'text',value:d.areaName as string??null},AssignmentId:{type:'bigint',value:d.assignmentId as string??null},Reason:{type:'text',value:d.reason as string}});
    output(isUuid(r.operationId)&&r.action===d.action&&id(r.areaId)&&(d.action==='CREATE_AREA'?r.assignmentId===undefined:id(r.assignmentId)));
    return{operationId:r.operationId,action:r.action as string,areaId:r.areaId as string,assignmentId:r.assignmentId as string|undefined};
  }
}
