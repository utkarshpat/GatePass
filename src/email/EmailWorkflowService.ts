import {createHash} from 'node:crypto';
import type {SqlParameter} from '../transport/SqlProcedureClient.ts';
import type {Session} from '../transport/ApiHandler.ts';
import {normalizeVisitRow} from '../visits/VisitReadService.ts';
import {visitorDetails} from '../registration/VisitorDetails.ts';
import {isUuid,isUtc} from '../visits/SqlVisitReadRepository.ts';
import {token} from '../transport/ApiHandler.ts';
import type {EmailLinkCodec} from './EmailLinkCodec.ts';
export type EmailSql={callProcedure(name:string,p:Record<string,SqlParameter>):Promise<string>};
export class EmailWorkflowError extends Error{code:string;constructor(code:string){super(code);this.code=code;}}
const input=(ok:unknown)=>{if(!ok)throw new EmailWorkflowError('INVALID_INPUT');};
export function emailIdentity(s:Session){if(!token(s.sessionToken)||!token(s.csrfToken))throw new EmailWorkflowError('NOT_AUTHORIZED');return{SessionHash:{type:'binary' as const,value:createHash('sha256').update(Buffer.from(s.sessionToken,'base64url')).digest()},CsrfHash:{type:'binary' as const,value:createHash('sha256').update(Buffer.from(s.csrfToken,'base64url')).digest()}};}
function body(v:unknown,keys:string[]){input(v&&typeof v==='object'&&!Array.isArray(v));const r=v as Record<string,unknown>;input(Object.keys(r).every(k=>keys.includes(k)));return r;}
export class EmailWorkflowService{
 #client:EmailSql;#links:EmailLinkCodec|undefined;
 constructor(client:EmailSql,links?:EmailLinkCodec){this.#client=client;this.#links=links;}
 async #call(name:string,p:Record<string,SqlParameter>){try{return JSON.parse(await this.#client.callProcedure(name,p));}catch(e){const n=Number((e as any)?.number);throw new EmailWorkflowError([52001,52801,53401,54101].includes(n)?'NOT_AUTHORIZED':[52002,52802,54102].includes(n)?'INVALID_INPUT':[52003,52004,52005].includes(n)?'CONFLICT':'UNAVAILABLE');}}
 async detail(session:Session,value:unknown,view:'HOST'|'OWN'){
  const d=body(value,['visitRequestId']);input(isUuid(d.visitRequestId));const row=await this.#call('gp.GetVisitDetail',{...emailIdentity(session),View:{type:'text',value:view},VisitRequestId:{type:'guid',value:d.visitRequestId as string}});
  const r=normalizeVisitRow(row,{...session,view},true);if(r.visitRequestId!==(d.visitRequestId as string).toLowerCase())throw new EmailWorkflowError('UNAVAILABLE');return r;
 }
 async decide(session:Session,value:unknown){const d=body(value,['visitRequestId','clientKey','snapshotVersion','snapshotHash','decision']);input(isUuid(d.visitRequestId)&&isUuid(d.clientKey)&&d.snapshotVersion===1&&typeof d.snapshotHash==='string'&&/^[a-f0-9]{64}$/iu.test(d.snapshotHash)&&['APPROVED','DENIED'].includes(String(d.decision)));
  const r=await this.#call('gp.DecideVisit',{...emailIdentity(session),VisitRequestId:{type:'guid',value:d.visitRequestId as string},ClientKey:{type:'guid',value:d.clientKey as string},SnapshotVersion:{type:'int',value:1},SnapshotHash:{type:'binary',value:Buffer.from(d.snapshotHash as string,'hex')},Decision:{type:'text',value:d.decision as string}});
  if(!isUuid(r.operationId)||!isUuid(r.visitRequestId)||r.visitRequestId.toLowerCase()!==(d.visitRequestId as string).toLowerCase()||r.decision!==d.decision)throw new EmailWorkflowError('UNAVAILABLE');return{operationId:r.operationId.toLowerCase(),visitRequestId:r.visitRequestId.toLowerCase(),decision:r.decision};
 }
 async linkParameters(value:unknown){let link;try{if(!this.#links)throw new Error();link=await this.#links.verify(value);}catch{throw new EmailWorkflowError('NOT_AUTHORIZED');}return{VisitRequestId:{type:'guid' as const,value:link.visit},RecipientEmailHash:{type:'binary' as const,value:Buffer.from(link.emailHash,'hex')},SnapshotHash:{type:'binary' as const,value:Buffer.from(link.snapshot,'hex')}};}
 async external(value:unknown){const d=body(value,['link']),parameters=await this.linkParameters(d.link);const r=await this.#call('gp.ReadEmailRequest',parameters);
  if(!isUtc(r.validFromUtc)||!isUtc(r.validUntilUtc)||!isUuid(r.visitRequestId)||r.visitRequestId.toLowerCase()!==parameters.VisitRequestId.value.toLowerCase()||!['PENDING','APPROVED','DENIED','CANCELLED'].includes(r.status)||!['PENDING','ACTIVE','DENIED','REVOKED'].includes(r.passStatus))throw new EmailWorkflowError('UNAVAILABLE');
  let extras:ReturnType<typeof visitorDetails>={};if(r.companyName!==undefined||r.deviceTypes!==undefined){try{extras=visitorDetails(r.companyName,r.deviceTypes);}catch{throw new EmailWorkflowError('UNAVAILABLE');}}
  const result:Record<string,unknown>={...extras,visitRequestId:r.visitRequestId.toLowerCase(),status:r.status,passStatus:r.passStatus};for(const [k,max] of Object.entries({personName:200,publicReference:40,locationName:150,projectName:200,hostName:200,reason:1000,validFromUtc:24,validUntilUtc:24})){if(typeof r[k]!=='string'||!r[k].length||r[k].length>max)throw new EmailWorkflowError('UNAVAILABLE');result[k]=r[k];}return result;
 }
}
