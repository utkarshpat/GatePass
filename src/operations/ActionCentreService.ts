import type {SqlParameter} from '../transport/SqlProcedureClient.ts';
import {receptionIdentity} from '../reception/ReceptionService.ts';
import {isDate,isUtc,isUuid} from '../visits/SqlVisitReadRepository.ts';
type Session={sessionToken:string;csrfToken:string};
export class ActionCentreError extends Error{code:'INVALID_INPUT'|'NOT_AUTHORIZED'|'CONFLICT'|'UNAVAILABLE';constructor(code:ActionCentreError['code']){super(code);this.code=code;}}
const input=(ok:unknown)=>{if(!ok)throw new ActionCentreError('INVALID_INPUT');};
const output=(ok:unknown)=>{if(!ok)throw new ActionCentreError('UNAVAILABLE');};
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/u.test(v);
export class ActionCentreService{
 private client:{callProcedure(name:string,p:Record<string,SqlParameter>):Promise<string>};
 constructor(client:{callProcedure(name:string,p:Record<string,SqlParameter>):Promise<string>}){this.client=client;}
 async remind(session:Session,d:Record<string,unknown>){
  input(Object.keys(d).every(k=>['workspace','locationId','dutyKind','dutyId','visitRequestId','clientKey'].includes(k))&&['GUARD','RECEPTION','ADMIN'].includes(String(d.workspace))&&Number.isInteger(d.locationId)&&Number(d.locationId)>0&&Number(d.locationId)<=2147483647&&isUuid(d.visitRequestId)&&(d.clientKey===undefined||isUuid(d.clientKey)));
  input(d.workspace==='GUARD'?['COMMON','PROJECT'].includes(String(d.dutyKind))&&typeof d.dutyId==='string'&&/^[1-9][0-9]{0,18}$/u.test(d.dutyId)&&BigInt(d.dutyId)<=9223372036854775807n:d.dutyKind==='OFFICE'&&d.dutyId==='0');
  let r:any;try{r=JSON.parse(await this.client.callProcedure('gp.RemindPendingApproval',{...receptionIdentity(session),Workspace:{type:'text',value:String(d.workspace)},LocationId:{type:'int',value:Number(d.locationId)},DutyKind:{type:'text',value:String(d.dutyKind)},DutyId:{type:'bigint',value:String(d.dutyId)},VisitRequestId:{type:'guid',value:String(d.visitRequestId)},ClientKey:{type:'guid',value:d.clientKey as string??null}}));}
  catch(error){throw new ActionCentreError([52001,53501].includes(Number((error as any)?.number))?'NOT_AUTHORIZED':Number((error as any)?.number)===52002?'INVALID_INPUT':[52003,52004].includes(Number((error as any)?.number))?'CONFLICT':'UNAVAILABLE');}
  output(r&&['STATUS','QUEUED','ALREADY_QUEUED','COOLDOWN'].includes(r.outcome)&&['QUEUED','SENT','FAILED','CANCELLED'].includes(r.mailStatus)&&typeof r.eligible==='boolean'&&isUtc(r.lastQueuedAtUtc)&&isUtc(r.nextReminderAtUtc));
  return{outcome:r.outcome,mailStatus:r.mailStatus,eligible:r.eligible,lastQueuedAtUtc:r.lastQueuedAtUtc,nextReminderAtUtc:r.nextReminderAtUtc};
 }
 async read(session:Session,d:Record<string,unknown>){
  input(Object.keys(d).every(k=>['workspace','locationId','dutyKind','dutyId','category','cursor'].includes(k))&&['GUARD','RECEPTION','ADMIN'].includes(String(d.workspace))&&Number.isInteger(d.locationId)&&Number(d.locationId)>0&&Number(d.locationId)<=2147483647);
  input(d.workspace==='GUARD'?['COMMON','PROJECT'].includes(String(d.dutyKind))&&typeof d.dutyId==='string'&&/^[1-9][0-9]{0,18}$/u.test(d.dutyId)&&BigInt(d.dutyId)<=9223372036854775807n:d.dutyKind==='OFFICE'&&d.dutyId==='0');
  const category=d.category??'PENDING';input(['PENDING','EXPIRED_INSIDE','UNRETURNED'].includes(String(category)));
  if(d.workspace==='GUARD'&&category==='UNRETURNED')throw new ActionCentreError('NOT_AUTHORIZED');
  const cursor=d.cursor as any;input(cursor===undefined||cursor&&typeof cursor==='object'&&Object.keys(cursor).sort().join('|')==='submittedAtUtc|visitRequestId'&&isUtc(cursor.submittedAtUtc)&&isUuid(cursor.visitRequestId));
  let r:any;try{r=JSON.parse(await this.client.callProcedure('gp.ReadActionCentre',{...receptionIdentity(session),Workspace:{type:'text',value:String(d.workspace)},LocationId:{type:'int',value:Number(d.locationId)},DutyKind:{type:'text',value:String(d.dutyKind)},DutyId:{type:'bigint',value:String(d.dutyId)},Category:{type:'text',value:String(category)},AfterSubmittedAtUtc:{type:'datetime',value:cursor?.submittedAtUtc??null},AfterVisitRequestId:{type:'guid',value:cursor?.visitRequestId??null}}));}
  catch(error){if(error instanceof ActionCentreError)throw error;throw new ActionCentreError([52001,53501].includes(Number((error as any)?.number))?'NOT_AUTHORIZED':Number((error as any)?.number)===52002?'INVALID_INPUT':'UNAVAILABLE');}
  output(r&&r.category===category&&isUtc(r.checkedAtUtc)&&r.counts&&['pending','expiredInside','unreturned'].every(k=>Number.isSafeInteger(r.counts[k])&&r.counts[k]>=0)&&Array.isArray(r.items)&&r.items.length<=24&&typeof r.hasMore==='boolean');
  output(d.workspace!=='GUARD'||r.counts.unreturned===0);
  const items=r.items.map((v:any)=>{output(v&&isUuid(v.visitRequestId)&&text(v.personName,200)&&isDate(v.visitDate)&&text(v.publicReference,40)&&text(v.publicPassNumber,50)&&isUtc(v.submittedAtUtc));return{visitRequestId:v.visitRequestId.toLowerCase(),personName:v.personName,visitDate:v.visitDate,publicReference:v.publicReference,publicPassNumber:v.publicPassNumber,submittedAtUtc:v.submittedAtUtc};});
  output(new Set(items.map((v:any)=>v.visitRequestId)).size===items.length&&items.length<=r.counts[category==='PENDING'?'pending':category==='EXPIRED_INSIDE'?'expiredInside':'unreturned']);
  if(r.hasMore){const last=items.at(-1);output(items.length===24&&isUuid(r.afterVisitRequestId)&&isUtc(r.afterSubmittedAtUtc)&&last?.visitRequestId===r.afterVisitRequestId.toLowerCase()&&last?.submittedAtUtc===r.afterSubmittedAtUtc);}
  return{category,checkedAtUtc:r.checkedAtUtc,counts:{pending:r.counts.pending,expiredInside:r.counts.expiredInside,unreturned:r.counts.unreturned},items,cursor:r.hasMore?{submittedAtUtc:r.afterSubmittedAtUtc,visitRequestId:r.afterVisitRequestId.toLowerCase()}:null};
 }
}
