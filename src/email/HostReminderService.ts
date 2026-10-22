import {HttpFailure} from '../transport/ApiHandler.ts';
import type {Session} from '../transport/ApiHandler.ts';
import {emailIdentity} from './EmailWorkflowService.ts';
import type {EmailSql} from './EmailWorkflowService.ts';
import {isUuid,isUtc} from '../visits/SqlVisitReadRepository.ts';
export class HostReminderService {
 private client:EmailSql;
 constructor(client:EmailSql){this.client=client;}
 async run(session:Session,input:Record<string,unknown>,view:'RECEPTION'|'GUARD'){
  const keys=view==='GUARD'?['visitRequestId','clientKey','locationId','dutyKind','dutyId']:['visitRequestId','clientKey'];
  if(Object.keys(input).some(k=>!keys.includes(k))||!isUuid(input.visitRequestId)||(input.clientKey!==undefined&&!isUuid(input.clientKey)))throw new HttpFailure(400);
  if(view==='GUARD'&&(input.dutyKind!=='PROJECT'||!Number.isSafeInteger(input.locationId)||Number(input.locationId)<=0||typeof input.dutyId!=='string'||! /^[1-9][0-9]{0,18}$/u.test(input.dutyId)||BigInt(input.dutyId)>9223372036854775807n))throw new HttpFailure(403);
  try{
   const r=JSON.parse(await this.client.callProcedure('gp.RemindVisitHost',{...emailIdentity(session),VisitRequestId:{type:'guid',value:String(input.visitRequestId)},View:{type:'text',value:view},ClientKey:{type:'guid',value:input.clientKey as string??null},LocationId:{type:'int',value:input.locationId as number??null},DutyId:{type:'bigint',value:input.dutyId as string??null}}));
   if(!['STATUS','QUEUED','ALREADY_QUEUED','COOLDOWN'].includes(r.outcome)||!['QUEUED','SENT','FAILED','CANCELLED'].includes(r.mailStatus)||typeof r.eligible!=='boolean'||!isUtc(r.lastQueuedAtUtc)||!isUtc(r.nextReminderAtUtc))throw new Error();
   return {outcome:r.outcome,mailStatus:r.mailStatus,eligible:r.eligible,lastQueuedAtUtc:r.lastQueuedAtUtc,nextReminderAtUtc:r.nextReminderAtUtc};
  }catch(error){if(error instanceof HttpFailure)throw error;const n=Number((error as any)?.number);throw new HttpFailure(n===52001||n===53501?403:n===52002?400:[52003,52004].includes(n)?409:503);}
 }
}
