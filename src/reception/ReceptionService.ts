import {createHash} from 'node:crypto';
import type {SqlParameter} from '../transport/SqlProcedureClient.ts';
import {isDate,isUtc,isUuid} from '../visits/SqlVisitReadRepository.ts';
export class ReceptionError extends Error{code:'INVALID_INPUT'|'NOT_AUTHORIZED'|'UNAVAILABLE';constructor(code:ReceptionError['code']){super(code);this.code=code;}}
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
 async #call(name:string,p:Record<string,SqlParameter>){try{const row=JSON.parse(await this.#client.callProcedure(name,p));requireOutput(row&&typeof row==='object'&&!Array.isArray(row));return row;}catch(error){if(error instanceof ReceptionError)throw error;const n=Number((error as any)?.number);throw new ReceptionError([52001,52701,52801,53501].includes(n)?'NOT_AUTHORIZED':n===53502?'INVALID_INPUT':'UNAVAILABLE');}}
 async context(session:{sessionToken:string;csrfToken:string}){
  const row=await this.#call('gp.GetReceptionContext',receptionIdentity(session));requireOutput(text(row.displayName,200)&&isDate(row.currentDate)&&Array.isArray(row.locations)&&row.locations.length>0&&row.locations.length<=50);
  const locations=row.locations.map((l:any)=>{requireOutput(int(l.locationId)&&text(l.locationName,150)&&text(l.locationCode,16)&&typeof l.canPrint==='boolean');return {locationId:l.locationId,locationName:l.locationName,locationCode:l.locationCode,canPrint:l.canPrint};});
  requireOutput(new Set(locations.map((l:any)=>l.locationId)).size===locations.length);return {displayName:row.displayName,currentDate:row.currentDate,locations};
 }
 async list(session:{sessionToken:string;csrfToken:string},input:Record<string,unknown>){
  requireInput(Object.keys(input).every(k=>['locationId','visitDate','search','status','cursor'].includes(k))&&int(input.locationId));
  requireInput(input.visitDate===undefined||isDate(input.visitDate));requireInput(input.search===undefined||typeof input.search==='string'&&input.search.length<=100&&!/[\u0000-\u001f\u007f]/u.test(input.search));
  const status=input.status??'ALL';requireInput(['ALL','PENDING','APPROVED','DENIED','CANCELLED'].includes(String(status)));
  const cursor=input.cursor as any;requireInput(cursor===undefined||cursor&&typeof cursor==='object'&&Object.keys(cursor).sort().join('|')==='submittedAtUtc|visitRequestId'&&isUtc(cursor.submittedAtUtc)&&isUuid(cursor.visitRequestId));
  const row=await this.#call('gp.ListReceptionVisits',{...receptionIdentity(session),LocationId:{type:'int',value:Number(input.locationId)},LocalVisitDate:{type:'date',value:input.visitDate as string??null},Search:{type:'text',value:input.search as string??null},Status:{type:'text',value:String(status)},AfterSubmittedAtUtc:{type:'datetime',value:cursor?.submittedAtUtc??null},AfterVisitRequestId:{type:'guid',value:cursor?.visitRequestId??null}});
  requireOutput(Array.isArray(row.visits)&&row.visits.length<=50&&typeof row.hasMore==='boolean'&&isDate(row.visitDate));
  const visits=row.visits.map((v:any)=>{
   requireOutput(isUuid(v.visitRequestId)&&isUuid(v.accessPassId)&&text(v.personName,200)&&text(v.publicReference,40)&&text(v.publicPassNumber,50)&&['DIGITAL_ID','EMPLOYEE_PROJECT','EXTERNAL'].includes(v.requestType)&&['PENDING','APPROVED','DENIED','CANCELLED'].includes(v.status)&&['PENDING','ACTIVE','DENIED','REVOKED'].includes(v.passStatus)&&typeof v.isInside==='boolean'&&isUtc(v.validFromUtc)&&isUtc(v.validUntilUtc)&&isUtc(v.submittedAtUtc)&&Number.isInteger(v.printCount)&&v.printCount>=0);
   requireOutput(v.employeeId===undefined||text(v.employeeId,64));requireOutput(v.projectName===undefined||text(v.projectName,200));
   requireOutput(Date.parse(v.validUntilUtc)>Date.parse(v.validFromUtc));
   return {visitRequestId:v.visitRequestId.toLowerCase(),accessPassId:v.accessPassId.toLowerCase(),personName:v.personName,employeeId:v.employeeId??null,requestType:v.requestType,publicReference:v.publicReference,publicPassNumber:v.publicPassNumber,status:v.status,passStatus:v.passStatus,projectName:v.projectName??null,isInside:v.isInside,validFromUtc:v.validFromUtc,validUntilUtc:v.validUntilUtc,submittedAtUtc:v.submittedAtUtc,printCount:v.printCount};
  });
  requireOutput(new Set(visits.map((v:any)=>v.visitRequestId)).size===visits.length);if(row.hasMore){const last=visits.at(-1);requireOutput(visits.length===50&&isUuid(row.afterVisitRequestId)&&isUtc(row.afterSubmittedAtUtc)&&last?.visitRequestId===row.afterVisitRequestId.toLowerCase()&&last?.submittedAtUtc===row.afterSubmittedAtUtc);}
  if(input.visitDate!==undefined)requireOutput(row.visitDate===input.visitDate);
  return {visits,visitDate:row.visitDate,cursor:row.hasMore?{submittedAtUtc:row.afterSubmittedAtUtc,visitRequestId:row.afterVisitRequestId.toLowerCase()}:null};
 }
}
