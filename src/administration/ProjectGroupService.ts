import {sessionIdentity} from '../security/SessionProof.ts';
import {isUuid,isUtc} from '../visits/SqlVisitReadRepository.ts';
import type {SqlParameter} from '../contracts/Sql.ts';
import {StaffAdministrationError} from './StaffAdministrationService.ts';

type Session={sessionToken:string;csrfToken:string};
type Client={callProcedure(name:string,p:Record<string,SqlParameter>):Promise<string>};
const big=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,18}$/u.test(v)&&BigInt(v)<=9223372036854775807n;
const integer=(v:unknown):v is number=>Number.isInteger(v)&&Number(v)>0&&Number(v)<=2147483647;
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.isWellFormed()&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u001f\u007f-\u009f]/u.test(v);
const check=(ok:unknown,output=false)=>{if(!ok)throw new StaffAdministrationError(output?'UNAVAILABLE':'INVALID_INPUT');};
const unique=(rows:any[],key:string)=>new Set(rows.map(r=>r[key])).size===rows.length;
export class ProjectGroupService{
 #client:Client;
 constructor(client:Client){this.#client=client;}
 async #call(session:Session,name:string,p:Record<string,SqlParameter>){
  try{const value:unknown=JSON.parse(await this.#client.callProcedure(name,{...sessionIdentity(session),...p}));check(value&&typeof value==='object'&&!Array.isArray(value),true);return value as Record<string,any>;}
  catch(e){if(e instanceof StaffAdministrationError)throw e;const n=Number((e as any)?.number);throw new StaffAdministrationError(n===52001?'NOT_AUTHORIZED':n===52002?'INVALID_INPUT':[52003,52004,52005].includes(n)?'CONFLICT':'UNAVAILABLE');}
 }
 async execute(session:Session,action:'project-groups'|'project-group'|'project-group-guard',value:unknown){
  check(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
  const d=value as Record<string,unknown>,read=action==='project-groups';
  const keys=read?['locationId']:action==='project-group'?['locationId','clientKey','reason','action','groupId','revision','name','projectLocationIds']:['locationId','clientKey','reason','action','groupId','revision','guardUserId','groupAssignmentId','validUntilUtc'];
  check(Object.keys(d).every(k=>keys.includes(k))&&integer(d.locationId));
  const p:Record<string,SqlParameter>={LocationId:{type:'int',value:Number(d.locationId)}};
  if(read){
   const r=await this.#call(session,'gp.GetAdminProjectGroups',p);check(Array.isArray(r.groups)&&r.groups.length<=100,true);
   const groups=r.groups.map((g:any)=>{
    check(g&&big(g.groupId)&&text(g.name,100)&&integer(g.revision)&&Array.isArray(g.projects)&&g.projects.length>=1&&g.projects.length<=50&&Array.isArray(g.assignments)&&g.assignments.length<=50,true);
    const projects=g.projects.map((m:any)=>{check(m&&big(m.projectLocationId)&&text(m.projectName,200)&&text(m.projectCode,100),true);return{projectLocationId:m.projectLocationId,projectName:m.projectName,projectCode:m.projectCode};});
    const assignments=g.assignments.map((a:any)=>{check(a&&big(a.groupAssignmentId)&&isUuid(a.userId)&&text(a.guardName,200)&&isUtc(a.validFromUtc)&&(a.validUntilUtc===undefined||a.validUntilUtc===null||isUtc(a.validUntilUtc)),true);return{groupAssignmentId:a.groupAssignmentId,userId:a.userId.toLowerCase(),guardName:a.guardName,validFromUtc:a.validFromUtc,validUntilUtc:a.validUntilUtc??null};});
    check(unique(projects,'projectLocationId')&&unique(assignments,'groupAssignmentId'),true);
    return{groupId:g.groupId,name:g.name,revision:g.revision,projects,assignments};
   });check(unique(groups,'groupId'),true);return{groups};
  }
  check(isUuid(d.clientKey)&&text(d.reason,300));
  Object.assign(p,{ClientKey:{type:'guid',value:d.clientKey},Reason:{type:'text',value:(d.reason as string).trim()},ProjectGroupId:{type:'bigint',value:d.groupId??null},ExpectedRevision:{type:'int',value:d.revision??null},Action:{type:'text',value:d.action}});
  if(action==='project-group'){
   check(d.action==='SAVE'||d.action==='ARCHIVE');
   check(d.groupId===undefined?d.action==='SAVE'&&d.revision===undefined:big(d.groupId)&&integer(d.revision));
   if(d.action==='SAVE')check(text(d.name,100)&&Array.isArray(d.projectLocationIds)&&d.projectLocationIds.length>=1&&d.projectLocationIds.length<=50&&d.projectLocationIds.every(big)&&new Set(d.projectLocationIds).size===d.projectLocationIds.length);
   else check(d.name===undefined&&d.projectLocationIds===undefined);
   Object.assign(p,{GroupName:{type:'text',value:d.name??null},ProjectLocationIdsJson:{type:'text',value:d.projectLocationIds?JSON.stringify([...d.projectLocationIds as string[]].sort()):null}});
  }else{
   check(big(d.groupId)&&integer(d.revision)&&(d.action==='ASSIGN'||d.action==='REMOVE'));
   if(d.action==='ASSIGN')check(isUuid(d.guardUserId)&&d.groupAssignmentId===undefined&&(d.validUntilUtc===undefined||isUtc(d.validUntilUtc)));
   else check(big(d.groupAssignmentId)&&d.guardUserId===undefined&&d.validUntilUtc===undefined);
   Object.assign(p,{GuardUserId:{type:'guid',value:d.guardUserId??null},GroupAssignmentId:{type:'bigint',value:d.groupAssignmentId??null},ValidUntilUtc:{type:'datetime',value:d.validUntilUtc??null}});
  }
  const r=await this.#call(session,action==='project-group'?'gp.ManageProjectGroup':'gp.ManageProjectGroupGuard',p);
  check(isUuid(r.operationId)&&big(r.groupId)&&integer(r.revision)&&r.action===d.action&&(d.groupId===undefined||d.groupId===r.groupId)&&(action!=='project-group-guard'||big(r.groupAssignmentId)),true);
  return{operationId:r.operationId.toLowerCase(),groupId:r.groupId,revision:r.revision,action:r.action,...(action==='project-group-guard'?{groupAssignmentId:r.groupAssignmentId}:{})};
 }
}
