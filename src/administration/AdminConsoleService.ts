import {provisionLocalStaff} from './LocalStaffOnboarding.ts';
import {readAdminRegister} from './AdminRegister.ts';
import {receptionIdentity} from '../reception/ReceptionService.ts';
import {StaffAdministrationError} from './StaffAdministrationService.ts';
import type {SqlParameter} from '../transport/SqlProcedureClient.ts';
import {isUuid,isUtc,isDate} from '../visits/SqlVisitReadRepository.ts';
type Session={sessionToken:string;csrfToken:string};
const big=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,18}$/u.test(v)&&BigInt(v)<=9223372036854775807n;
const check=(v:unknown,output=false)=>{if(!v)throw new StaffAdministrationError(output?'UNAVAILABLE':'INVALID_INPUT');};
export class AdminConsoleService{
 #client:{callProcedure(n:string,p:Record<string,SqlParameter>):Promise<string>};
 constructor(client:{callProcedure(n:string,p:Record<string,SqlParameter>):Promise<string>}){this.#client=client;}
 createStaff(session:Session,d:Record<string,unknown>){return provisionLocalStaff(this.#client,session,d);}
 resetStaffSetup(session:Session,d:Record<string,unknown>){return provisionLocalStaff(this.#client,session,d,true);}
 register(session:Session,d:Record<string,unknown>){return readAdminRegister(this.#client,session,d);}
 async read(session:Session,action:'scope'|'assignments',d:Record<string,unknown>){
  check(Object.keys(d).every(k=>(action==='scope'?['locationId','projectLocationId']:['projectLocationId','afterAssignmentId']).includes(k)));
  check(d.projectLocationId===undefined||big(d.projectLocationId));const p:Record<string,SqlParameter>={...receptionIdentity(session),ProjectLocationId:{type:'bigint',value:d.projectLocationId as string??null}};
  if(action==='scope'){check(Number.isInteger(d.locationId)&&Number(d.locationId)>0&&Number(d.locationId)<=2147483647);p.LocationId={type:'int',value:Number(d.locationId)};}
  else{check(big(d.projectLocationId)&&(d.afterAssignmentId===undefined||big(d.afterAssignmentId)));p.AfterAssignmentId={type:'bigint',value:d.afterAssignmentId as string??null};}
  let r:any;try{
   const procedure=action==='scope'?'gp.GetAdminConsoleScope':'gp.ListAdminGuardAssignments';
   let raw:string;
   try{raw=await this.#client.callProcedure(procedure,p);}catch(e){
    // SQL rolls a deadlock victim back. Retry this authorized read once; do not
    // retry denials, malformed responses or any administration mutation.
    if(Number((e as any)?.number)!==1205)throw e;
    raw=await this.#client.callProcedure(procedure,p);
   }
   r=JSON.parse(raw);
  }catch(e){const n=Number((e as any)?.number);throw new StaffAdministrationError(n===52001?'NOT_AUTHORIZED':n===52002?'INVALID_INPUT':'UNAVAILABLE');}
  check(r&&typeof r==='object'&&!Array.isArray(r),true);
  if(action==='scope'){
   check(isUuid(r.userId)&&isDate(r.currentDate)&&['canReport','canReadVisits','canAudit','canAssignGuards','canManageRoles'].every(k=>typeof r[k]==='boolean')&&Array.isArray(r.roles)&&r.roles.length<=100&&Array.isArray(r.delegations)&&r.delegations.length<=7,true);
   const extras:Record<string,unknown>={};if(r.provisionableRoles!==undefined){check(Array.isArray(r.provisionableRoles)&&r.provisionableRoles.length<=5&&r.provisionableRoles.every((v:any)=>v&&['GUARD','RECEPTION','LOCATION_ADMIN','INDIA_ADMIN','PLATFORM_ADMIN'].includes(v.roleCode))&&new Set(r.provisionableRoles.map((v:any)=>v.roleCode)).size===r.provisionableRoles.length&&typeof r.canResetLocalStaff==='boolean',true);extras.provisionableRoles=r.provisionableRoles.map((v:any)=>({roleCode:v.roleCode}));extras.canResetLocalStaff=r.canResetLocalStaff;}
   const roles=['GUARD','RECEPTION','PROJECT_ADMIN','LOCATION_ADMIN','INDIA_ADMIN','PLATFORM_ADMIN'],scopes=['LOCATION','PROJECT','PROJECT_LOCATION','INDIA','PLATFORM'];
   const convert=(v:any)=>{check(v&&roles.includes(v.roleCode)&&scopes.includes(v.scopeType)&&(['GUARD','RECEPTION','LOCATION_ADMIN'].includes(v.roleCode)?v.scopeType==='LOCATION':v.roleCode==='PROJECT_ADMIN'?['PROJECT','PROJECT_LOCATION'].includes(v.scopeType):v.scopeType===(v.roleCode==='INDIA_ADMIN'?'INDIA':'PLATFORM')),true);return{roleCode:v.roleCode,scopeType:v.scopeType};};
   return{...extras,userId:r.userId.toLowerCase(),currentDate:r.currentDate,canReport:r.canReport,canReadVisits:r.canReadVisits,canAudit:r.canAudit,canAssignGuards:r.canAssignGuards,canManageRoles:r.canManageRoles,roles:r.roles.map(convert),delegations:r.delegations.map(convert)};
  }
  check(Array.isArray(r.assignments)&&r.assignments.length<=50&&typeof r.hasMore==='boolean',true);
  const assignments=r.assignments.map((a:any)=>{check(big(a.assignmentId)&&isUuid(a.userId)&&typeof a.guardName==='string'&&a.guardName.length>0&&a.guardName.length<=200&&isUtc(a.validFromUtc)&&(a.validUntilUtc===undefined||isUtc(a.validUntilUtc)),true);return{assignmentId:a.assignmentId,userId:a.userId.toLowerCase(),guardName:a.guardName,validFromUtc:a.validFromUtc,validUntilUtc:a.validUntilUtc??null};});
  check(new Set(assignments.map((a:any)=>a.assignmentId)).size===assignments.length&&(!r.hasMore||assignments.length===50&&big(r.afterAssignmentId)&&r.afterAssignmentId===assignments.at(-1)?.assignmentId),true);
  return{assignments,cursor:r.hasMore?r.afterAssignmentId:null};
 }
}
