import type {EmailSql} from './EmailWorkflowService.ts';
import type {OutlookActionCodec} from './OutlookActionCodec.ts';
import type {OutlookActionTokenVerifier} from './OutlookActionToken.ts';
import {isUuid} from '../visits/SqlVisitReadRepository.ts';
export class OutlookDecisionError extends Error{status:number;constructor(status:number){super('OUTLOOK_ACTION_REJECTED');this.status=status;}}
export class OutlookDecisionService{
 #sql:EmailSql;#tokens:Pick<OutlookActionTokenVerifier,'verify'>;#codec:OutlookActionCodec;
 constructor(sql:EmailSql,tokens:Pick<OutlookActionTokenVerifier,'verify'>,codec:OutlookActionCodec){this.#sql=sql;this.#tokens=tokens;this.#codec=codec;}
 async decide(authorization:unknown,body:Record<string,unknown>){
  let actor;try{actor=await this.#tokens.verify(authorization);}catch{throw new OutlookDecisionError(401);}
  if(Object.keys(body).join('|')!=='capability')throw new OutlookDecisionError(400);
  let action;try{action=await this.#codec.verify(body.capability);}catch{throw new OutlookDecisionError(403);}
  try{const result=JSON.parse(await this.#sql.callProcedure('gp.DecideOutlookVisit',{
   TenantId:{type:'guid',value:actor.tenantId},ObjectId:{type:'guid',value:actor.objectId},ExpectedHostEmployeeId:{type:'text',value:action.host},
   ClientKey:{type:'guid',value:action.clientKey},VisitRequestId:{type:'guid',value:action.visit},SnapshotVersion:{type:'int',value:1},SnapshotHash:{type:'binary',value:Buffer.from(action.snapshot,'hex')},Decision:{type:'text',value:action.decision}
  }));if(!isUuid(result.operationId)||!isUuid(result.visitRequestId)||result.visitRequestId.toLowerCase()!==action.visit||result.decision!==action.decision)throw new Error();return{visitRequestId:action.visit,decision:action.decision};
  }catch(e){const n=Number((e as any)?.number);throw new OutlookDecisionError(n===52001?403:n===52002?400:[52003,52004,52005].includes(n)?409:503);}
 }
}
