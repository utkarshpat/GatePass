import {visitorDetails} from '../registration/VisitorDetails.ts';
import {createHash} from 'node:crypto';
import type {SqlParameter} from '../transport/SqlProcedureClient.ts';
import {isDate,isUtc,isUuid} from '../visits/SqlVisitReadRepository.ts';
import {employeeProjectSummary} from '../visits/EmployeeProjectSummary.ts';
export class ReceptionError extends Error{code:'INVALID_INPUT'|'NOT_AUTHORIZED'|'CONFLICT'|'INSIDE_PROJECT'|'UNAVAILABLE';constructor(code:ReceptionError['code']){super(code);this.code=code;}}
const requireInput=(v:unknown)=>{if(!v)throw new ReceptionError('INVALID_INPUT');};
const requireOutput=(v:unknown)=>{if(!v)throw new ReceptionError('UNAVAILABLE');};
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/u.test(v);
const int=(v:unknown)=>Number.isInteger(v)&&Number(v)>0&&Number(v)<=2147483647;
export function receptionIdentity(session:{sessionToken:string;csrfToken:string}){
 const hash=(v:string)=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{43}$/u.test(v))throw new ReceptionError('NOT_AUTHORIZED');const bytes=Buffer.from(v,'base64url');try{if(bytes.length!==32||bytes.toString('base64url')!==v)throw new ReceptionError('NOT_AUTHORIZED');return createHash('sha256').update(bytes).digest();}finally{bytes.fill(0);}};
 return {SessionHash:{type:'binary',value:hash(session.sessionToken)},CsrfHash:{type:'binary',value:hash(session.csrfToken)}} as Record<string,SqlParameter>;
}
export class ReceptionService{
 #client:{callProcedure(name:string,p:Record<string,SqlParameter>):Promise<string>};
 constructor(client:{callProcedure(name:string,p:Record<string,SqlParameter>):Promise<string>}){this.#client=client;}
 async lookup(session:{sessionToken:string;csrfToken:string},input:Record<string,unknown>){
  requireInput(Object.keys(input).every(k=>['locationId','search','credential','cursor'].includes(k))&&int(input.locationId)&&((input.search===undefined)!==(input.credential===undefined)));
  let credentialHash:Buffer|null=null;
  if(input.credential!==undefined){requireInput(typeof input.credential==='string'&&/^[A-Za-z0-9_-]{43}$/u.test(input.credential));const bytes=Buffer.from(String(input.credential),'base64url');try{requireInput(bytes.length===32&&bytes.toString('base64url')===input.credential);credentialHash=createHash('sha256').update(bytes).digest();}finally{bytes.fill(0);}}
  else requireInput(text(input.search,100)&&String(input.search).trim().length>=2);
  const cursor=input.cursor as any;requireInput(cursor===undefined||cursor&&typeof cursor==='object'&&Object.keys(cursor).sort().join('|')==='submittedAtUtc|visitRequestId'&&isUtc(cursor.submittedAtUtc)&&isUuid(cursor.visitRequestId));
  const result=await this.#call('gp.LookupReceptionVisits',{...receptionIdentity(session),LocationId:{type:'int',value:Number(input.locationId)},Search:{type:'text',value:input.search===undefined?null:String(input.search).trim()},CredentialHash:{type:'binary',value:credentialHash},AfterSubmittedAtUtc:{type:'datetime',value:cursor?.submittedAtUtc??null},AfterVisitRequestId:{type:'guid',value:cursor?.visitRequestId??null}});
  requireOutput(Array.isArray(result.matches)&&result.matches.length<=20&&typeof result.hasMore==='boolean');
  const matches=result.matches.map((r:any)=>{requireOutput(isUuid(r.visitRequestId)&&text(r.personName,200)&&text(r.publicReference,40)&&text(r.publicPassNumber,50)&&['DIGITAL_ID','EXTERNAL','EMPLOYEE_PROJECT'].includes(r.requestType)&&['PENDING','APPROVED','DENIED','CANCELLED'].includes(r.status)&&isUtc(r.submittedAtUtc));return{visitRequestId:r.visitRequestId.toLowerCase(),personName:r.personName,publicReference:r.publicReference,publicPassNumber:r.publicPassNumber,requestType:r.requestType,status:r.status,submittedAtUtc:r.submittedAtUtc};});
  requireOutput(new Set(matches.map((r:any)=>r.visitRequestId)).size===matches.length);
  if(result.hasMore)requireOutput(matches.length===20&&isUtc(result.afterSubmittedAtUtc)&&isUuid(result.afterVisitRequestId)&&result.afterVisitRequestId.toLowerCase()===matches.at(-1)?.visitRequestId&&result.afterSubmittedAtUtc===matches.at(-1)?.submittedAtUtc);
  return{matches,cursor:result.hasMore?{submittedAtUtc:result.afterSubmittedAtUtc,visitRequestId:result.afterVisitRequestId.toLowerCase()}:null};
 }
 async correctReturn(session:{sessionToken:string;csrfToken:string},input:Record<string,unknown>){
  requireInput(Object.keys(input).sort().join('|')==='clientKey|expectedPassId|expectedReturnedAtUtc|reason|visitRequestId'&&isUuid(input.clientKey)&&isUuid(input.visitRequestId)&&isUuid(input.expectedPassId)&&isUtc(input.expectedReturnedAtUtc)&&text(input.reason,300)&&String(input.reason).trim().length>=5);
  const r=await this.#call('gp.CorrectReceptionReturn',{...receptionIdentity(session),ClientKey:{type:'guid',value:String(input.clientKey)},VisitRequestId:{type:'guid',value:String(input.visitRequestId)},ExpectedPassId:{type:'guid',value:String(input.expectedPassId)},ExpectedReturnedAtUtc:{type:'datetime',value:String(input.expectedReturnedAtUtc)},Reason:{type:'text',value:String(input.reason).trim()}});
  requireOutput(isUuid(r.visitRequestId)&&r.visitRequestId.toLowerCase()===String(input.visitRequestId).toLowerCase()&&isUuid(r.accessPassId)&&r.accessPassId.toLowerCase()===String(input.expectedPassId).toLowerCase()&&isUtc(r.correctedAtUtc));
  return{visitRequestId:r.visitRequestId.toLowerCase(),accessPassId:r.accessPassId.toLowerCase(),correctedAtUtc:r.correctedAtUtc};
 }
 async #call(name:string,p:Record<string,SqlParameter>){try{const row=JSON.parse(await this.#client.callProcedure(name,p));requireOutput(row&&typeof row==='object'&&!Array.isArray(row));return row;}catch(error){if(error instanceof ReceptionError)throw error;const n=Number((error as any)?.number);throw new ReceptionError([52001,52701,52801,53501].includes(n)?'NOT_AUTHORIZED':[53502,54502].includes(n)?'INVALID_INPUT':n===54504?'INSIDE_PROJECT':n===54503||n===52003?'CONFLICT':'UNAVAILABLE');}}
 async returnPass(session:{sessionToken:string;csrfToken:string},input:Record<string,unknown>){
  requireInput(Object.keys(input).every(k=>['clientKey','expectedPassId','visitRequestId','devicesVerified'].includes(k))&&(input.devicesVerified===undefined||typeof input.devicesVerified==='boolean')&&isUuid(input.clientKey)&&isUuid(input.visitRequestId)&&isUuid(input.expectedPassId));
  const row=await this.#call('gp.ReturnReceptionPass',{...receptionIdentity(session),DevicesVerified:{type:'bit',value:input.devicesVerified===true},ClientKey:{type:'guid',value:String(input.clientKey)},VisitRequestId:{type:'guid',value:String(input.visitRequestId)},ExpectedPassId:{type:'guid',value:String(input.expectedPassId)}});
  requireOutput(isUuid(row.visitRequestId)&&row.visitRequestId.toLowerCase()===String(input.visitRequestId).toLowerCase()&&isUuid(row.accessPassId)&&row.accessPassId.toLowerCase()===String(input.expectedPassId).toLowerCase()&&isUtc(row.returnedAtUtc));
  return {visitRequestId:row.visitRequestId.toLowerCase(),accessPassId:row.accessPassId.toLowerCase(),returnedAtUtc:row.returnedAtUtc};
 }
 async context(session:{sessionToken:string;csrfToken:string}){
  const row=await this.#call('gp.GetReceptionContext',receptionIdentity(session));requireOutput(text(row.displayName,200)&&isDate(row.currentDate)&&Array.isArray(row.locations)&&row.locations.length>0&&row.locations.length<=50);
  const locations=row.locations.map((l:any)=>{requireOutput(int(l.locationId)&&text(l.locationName,150)&&text(l.locationCode,16)&&typeof l.canPrint==='boolean');return {locationId:l.locationId,locationName:l.locationName,locationCode:l.locationCode,canPrint:l.canPrint};});
  requireOutput(new Set(locations.map((l:any)=>l.locationId)).size===locations.length);return {queuePaging:true,displayName:row.displayName,currentDate:row.currentDate,locations};
 }
 async timeline(session:{sessionToken:string;csrfToken:string},visitRequestId:unknown){
  requireInput(isUuid(visitRequestId));const row=await this.#call('gp.GetReceptionEmployeeTimeline',{...receptionIdentity(session),VisitRequestId:{type:'guid',value:String(visitRequestId).toLowerCase()}});
  requireOutput(typeof row.isInside==='boolean'&&typeof row.movementsHasMore==='boolean'&&Array.isArray(row.movements)&&row.movements.length<=100);
  const movements=row.movements.map((m:any)=>{requireOutput(typeof m.accessEventId==='string'&&/^[1-9][0-9]{0,18}$/u.test(m.accessEventId)&&BigInt(m.accessEventId)<=9223372036854775807n&&['ENTRY','EXIT'].includes(m.eventType)&&['SCAN','MANUAL','RECONCILE'].includes(m.entryMethod)&&text(m.guardName,200)&&text(m.projectName,200)&&isUtc(m.occurredAtUtc));return{accessEventId:m.accessEventId,eventType:m.eventType,entryMethod:m.entryMethod,guardName:m.guardName,projectName:m.projectName,occurredAtUtc:m.occurredAtUtc};});
  requireOutput(!row.movementsHasMore||movements.length===100);return{isInside:row.isInside,movements,movementsHasMore:row.movementsHasMore};
 }
 async list(session:{sessionToken:string;csrfToken:string},input:Record<string,unknown>){
  requireInput(Object.keys(input).every(k=>['locationId','visitDate','search','status','cursor','pendingReturns'].includes(k))&&int(input.locationId));
  requireInput(input.visitDate===undefined||isDate(input.visitDate));requireInput(input.search===undefined||typeof input.search==='string'&&input.search.length<=100&&!/[\u0000-\u001f\u007f]/u.test(input.search));
  requireInput(input.pendingReturns===undefined||typeof input.pendingReturns==='boolean');
  const status=input.status??'ALL';requireInput(['ALL','PENDING','APPROVED','DENIED','CANCELLED'].includes(String(status)));
  const cursor=input.cursor as any;requireInput(cursor===undefined||cursor&&typeof cursor==='object'&&Object.keys(cursor).sort().join('|')==='submittedAtUtc|visitRequestId'&&isUtc(cursor.submittedAtUtc)&&isUuid(cursor.visitRequestId));
  const row=await this.#call('gp.ListReceptionVisits',{...receptionIdentity(session),PendingReturns:{type:'bit',value:input.pendingReturns===true},LocationId:{type:'int',value:Number(input.locationId)},LocalVisitDate:{type:'date',value:input.visitDate as string??null},Search:{type:'text',value:input.search as string??null},Status:{type:'text',value:String(status)},AfterSubmittedAtUtc:{type:'datetime',value:cursor?.submittedAtUtc??null},AfterVisitRequestId:{type:'guid',value:cursor?.visitRequestId??null}});
  return this.#listRows(row,input);
 }
 #listRows(row:any,input:Record<string,unknown>){
  requireOutput(Array.isArray(row.visits)&&row.visits.length<=50&&typeof row.hasMore==='boolean'&&isDate(row.visitDate));
  const visits=row.visits.map((v:any)=>{
   requireOutput(isUuid(v.visitRequestId)&&isUuid(v.accessPassId)&&text(v.personName,200)&&text(v.publicReference,40)&&text(v.publicPassNumber,50)&&['DIGITAL_ID','EMPLOYEE_PROJECT','EXTERNAL'].includes(v.requestType)&&['PENDING','APPROVED','DENIED','CANCELLED'].includes(v.status)&&['PENDING','ACTIVE','DENIED','REVOKED'].includes(v.passStatus)&&typeof v.isInside==='boolean'&&isUtc(v.validFromUtc)&&isUtc(v.validUntilUtc)&&isUtc(v.submittedAtUtc)&&Number.isInteger(v.printCount)&&v.printCount>=0);
   requireOutput(v.returnedAtUtc===undefined||v.returnedAtUtc===null||isUtc(v.returnedAtUtc));
   requireOutput(v.employeeId===undefined||text(v.employeeId,64));requireOutput(v.projectName===undefined||text(v.projectName,200));
   requireOutput(v.hostName===undefined||text(v.hostName,200));requireOutput(v.hostEmail===undefined||text(v.hostEmail,320));
   let extras:ReturnType<typeof visitorDetails>;try{extras=visitorDetails(v.companyName,v.deviceTypes);}catch{throw new ReceptionError('UNAVAILABLE');}
   const projects=v.requestType==='DIGITAL_ID'?employeeProjectSummary(v.employeeProjects??{available:false,total:null,items:[]}):null;
   requireOutput(v.requestType!=='DIGITAL_ID'||projects!==null);
   requireOutput(Date.parse(v.validUntilUtc)>Date.parse(v.validFromUtc));
   return {...extras,visitRequestId:v.visitRequestId.toLowerCase(),accessPassId:v.accessPassId.toLowerCase(),personName:v.personName,employeeId:v.employeeId??null,requestType:v.requestType,publicReference:v.publicReference,publicPassNumber:v.publicPassNumber,status:v.status,passStatus:v.passStatus,projectName:v.projectName??null,hostName:v.hostName??null,hostEmail:v.hostEmail??null,...(projects?{employeeProjects:projects}:{}),isInside:v.isInside,validFromUtc:v.validFromUtc,validUntilUtc:v.validUntilUtc,submittedAtUtc:v.submittedAtUtc,printCount:v.printCount,returnedAtUtc:v.returnedAtUtc??null};
  });
  requireOutput(new Set(visits.map((v:any)=>v.visitRequestId)).size===visits.length);if(row.hasMore){const last=visits.at(-1);requireOutput(visits.length===50&&isUuid(row.afterVisitRequestId)&&isUtc(row.afterSubmittedAtUtc)&&last?.visitRequestId===row.afterVisitRequestId.toLowerCase()&&last?.submittedAtUtc===row.afterSubmittedAtUtc);}
  if(input.visitDate!==undefined)requireOutput(row.visitDate===input.visitDate);
  requireOutput(row.pendingReturnCount===undefined||Number.isSafeInteger(row.pendingReturnCount)&&row.pendingReturnCount>=0);
  return {visits,visitDate:row.visitDate,pendingReturnCount:row.pendingReturnCount??null,cursor:row.hasMore?{submittedAtUtc:row.afterSubmittedAtUtc,visitRequestId:row.afterVisitRequestId.toLowerCase()}:null};
 }
 async queue(session:{sessionToken:string;csrfToken:string},input:Record<string,unknown>){
  requireInput(Object.keys(input).every(k=>['locationId','visitDate','search','status','cursor','pendingReturns','typeFilter','printFilter','insideOnly'].includes(k))&&int(input.locationId));
  requireInput(input.visitDate===undefined||isDate(input.visitDate));requireInput(input.search===undefined||typeof input.search==='string'&&input.search.length<=100&&!/[\u0000-\u001f\u007f]/u.test(input.search));
  requireInput((input.pendingReturns===undefined||typeof input.pendingReturns==='boolean')&&(input.insideOnly===undefined||typeof input.insideOnly==='boolean'));
  const status=input.status??'ALL',type=input.typeFilter??'ALL',print=input.printFilter??'ALL';requireInput(['ALL','PENDING','APPROVED','DENIED','CANCELLED','REVOKED','EXPIRED'].includes(String(status))&&['ALL','EMPLOYEE','VISITOR'].includes(String(type))&&['ALL','PRINTED','UNPRINTED','PENDING_RETURN','RETURNED'].includes(String(print)));
  const cursor=input.cursor as any;requireInput(cursor===undefined||cursor&&typeof cursor==='object'&&Object.keys(cursor).sort().join('|')==='submittedAtUtc|visitRequestId'&&isUtc(cursor.submittedAtUtc)&&isUuid(cursor.visitRequestId));
  const row=await this.#call('gp.ReadReceptionQueue',{...receptionIdentity(session),PendingReturns:{type:'bit',value:input.pendingReturns===true},LocationId:{type:'int',value:Number(input.locationId)},LocalVisitDate:{type:'date',value:input.visitDate as string??null},Search:{type:'text',value:input.search as string??null},Status:{type:'text',value:String(status)},TypeFilter:{type:'text',value:String(type)},PrintFilter:{type:'text',value:String(print)},InsideOnly:{type:'bit',value:input.insideOnly===true},AfterSubmittedAtUtc:{type:'datetime',value:cursor?.submittedAtUtc??null},AfterVisitRequestId:{type:'guid',value:cursor?.visitRequestId??null}});
  const page=this.#listRows(row,input),c=row.counts;requireOutput(c&&['total','pending','inside'].every(k=>Number.isSafeInteger(c[k])&&c[k]>=0)&&c.pending<=c.total&&c.inside<=c.total&&c.total>=page.visits.length);
  return{...page,counts:{total:c.total,pending:c.pending,inside:c.inside}};
 }

}
