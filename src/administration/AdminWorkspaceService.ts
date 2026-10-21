import type {SqlParameter} from '../transport/SqlProcedureClient.ts';
import {receptionIdentity} from '../reception/ReceptionService.ts';
import {isUuid} from '../visits/SqlVisitReadRepository.ts';
import {StaffAdministrationError} from './StaffAdministrationService.ts';
type Session={sessionToken:string;csrfToken:string};
type Client={callProcedure(name:string,p:Record<string,SqlParameter>):Promise<string>};
const big=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,18}$/u.test(v)&&BigInt(v)<=9223372036854775807n;
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/u.test(v);
const valid=(v:unknown,output=false)=>{if(!v)throw new StaffAdministrationError(output?'UNAVAILABLE':'INVALID_INPUT');};
export class AdminWorkspaceService{
 #client:Client;constructor(client:Client){this.#client=client;}
 async #call(session:Session,name:string,p:Record<string,SqlParameter>={}){try{const r=JSON.parse(await this.#client.callProcedure(name,{...receptionIdentity(session),...p}));valid(r&&typeof r==='object'&&!Array.isArray(r),true);return r;}catch(e){if(e instanceof StaffAdministrationError)throw e;const n=Number((e as any)?.number);throw new StaffAdministrationError(n===52001?'NOT_AUTHORIZED':n===52002?'INVALID_INPUT':'UNAVAILABLE');}}
 async read(session:Session,action:string,d:Record<string,unknown>){
  if(action==='context'){valid(Object.keys(d).length===0);const r=await this.#call(session,'gp.GetAdminWorkspaceContext');valid(text(r.displayName,200)&&Array.isArray(r.locations)&&r.locations.length>0&&r.locations.length<=50,true);const locations=r.locations.map((l:any)=>{valid(Number.isInteger(l.locationId)&&l.locationId>0&&text(l.locationName,150)&&text(l.locationCode,16),true);return{locationId:l.locationId,locationName:l.locationName,locationCode:l.locationCode};});return{displayName:r.displayName,locations};}
  valid(['projects','leads','candidates'].includes(action));valid(Object.keys(d).every(k=>(action==='projects'?['locationId','cursor']:action==='leads'?['projectLocationId','cursor']:['projectLocationId','search']).includes(k)));
  let p:Record<string,SqlParameter>;
  if(action==='projects'){valid(Number.isInteger(d.locationId)&&Number(d.locationId)>0&&Number(d.locationId)<=2147483647);valid(d.cursor===undefined||big(d.cursor));p={LocationId:{type:'int',value:Number(d.locationId)},AfterProjectLocationId:{type:'bigint',value:d.cursor as string??null}};}
  else{valid(big(d.projectLocationId));p={ProjectLocationId:{type:'bigint',value:d.projectLocationId as string}};if(action==='leads'){valid(d.cursor===undefined||big(d.cursor));p.AfterRoleGrantId={type:'bigint',value:d.cursor as string??null};}else{valid(typeof d.search==='string'&&d.search.trim().length>=2&&text(d.search,80));p.Search={type:'text',value:(d.search as string).trim()};}}
  const r=await this.#call(session,'gp.'+({projects:'ListLeadProjects',leads:'ListProjectHeads',candidates:'SearchProjectLeadCandidates'}[action]),p);
  if(action==='candidates'){valid(Array.isArray(r.employees)&&r.employees.length<=20,true);return{employees:r.employees.map((e:any)=>{valid(isUuid(e.userId)&&text(e.employeeId,64)&&text(e.displayName,200)&&text(e.email,320),true);return{userId:e.userId,employeeId:e.employeeId,displayName:e.displayName,email:e.email};})};}
  valid(typeof r.hasMore==='boolean',true);const rawCursor=action==='projects'?r.afterProjectLocationId:r.afterRoleGrantId;valid(!r.hasMore||big(rawCursor),true);
  const raw=action==='projects'?r.projects:r.leads;valid(Array.isArray(raw)&&raw.length<=25,true);
  const rows=raw.map((v:any)=>{if(action==='projects'){valid(big(v.projectLocationId)&&big(v.projectId)&&text(v.projectName,200)&&text(v.projectCode,64)&&['directoryCurrent','canAssignProject','canAssignLocation'].every(k=>typeof v[k]==='boolean'),true);return{projectLocationId:v.projectLocationId,projectId:v.projectId,projectName:v.projectName,projectCode:v.projectCode,directoryCurrent:v.directoryCurrent,canAssignProject:v.canAssignProject,canAssignLocation:v.canAssignLocation};}valid(big(v.roleGrantId)&&text(v.displayName,200)&&(v.employeeId===null||text(v.employeeId,64))&&(v.email===null||text(v.email,320))&&['PROJECT','PROJECT_LOCATION'].includes(v.scopeType)&&typeof v.canRemove==='boolean',true);return{roleGrantId:v.roleGrantId,displayName:v.displayName,employeeId:v.employeeId,email:v.email,scopeType:v.scopeType,canRemove:v.canRemove};});
  return{[action]:rows,cursor:r.hasMore?rawCursor:null};
 }
}
