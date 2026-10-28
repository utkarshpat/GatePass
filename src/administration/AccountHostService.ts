import type {SqlParameter} from '../transport/SqlProcedureClient.ts';
import {receptionIdentity} from '../reception/ReceptionService.ts';
import {isUuid,isUtc} from '../visits/SqlVisitReadRepository.ts';
import {StaffAdministrationError} from './StaffAdministrationService.ts';
type Session={sessionToken:string;csrfToken:string};
type Client={callProcedure(name:string,p:Record<string,SqlParameter>):Promise<string>};
const big=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,18}$/u.test(v)&&BigInt(v)<=9223372036854775807n;
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.isWellFormed()&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u001f\u007f-\u009f]/u.test(v);
const check=(v:unknown,output=false)=>{if(!v)throw new StaffAdministrationError(output?'UNAVAILABLE':'INVALID_INPUT');};
export class AccountHostService{
 #client:Client;constructor(client:Client){this.#client=client;}
 async execute(session:Session,action:'account-hosts'|'account-host',input:unknown){
  check(input&&typeof input==='object'&&!Array.isArray(input)&&[Object.prototype,null].includes(Object.getPrototypeOf(input)));
  const d=input as Record<string,unknown>,read=action==='account-hosts';
  check(Object.keys(d).every(k=>(read?['projectLocationId','search']:['projectLocationId','employeeId','action','revision','reason','clientKey']).includes(k))&&big(d.projectLocationId));
  const p:Record<string,SqlParameter>={...receptionIdentity(session),ProjectLocationId:{type:'bigint',value:d.projectLocationId as string}};
  if(read){check(d.search===undefined||text(d.search,80)&&(d.search as string).trim().length>=2);p.Search={type:'text',value:d.search===undefined?null:(d.search as string).trim()};}
  else{
   check(text(d.employeeId,64)&&['ADD','REMOVE'].includes(d.action as string)&&Number.isInteger(d.revision)&&Number(d.revision)>=0&&Number(d.revision)<2147483647&&text(d.reason,300)&&isUuid(d.clientKey));
   Object.assign(p,{EmployeeId:{type:'text',value:d.employeeId},Action:{type:'text',value:d.action},ExpectedRevision:{type:'int',value:d.revision},Reason:{type:'text',value:(d.reason as string).trim()},ClientKey:{type:'guid',value:d.clientKey}});
  }
  try{
   const r=JSON.parse(await this.#client.callProcedure(read?'gp.ReadAccountHosts':'gp.ManageAccountHost',p));check(r&&typeof r==='object'&&!Array.isArray(r),true);
   if(!read){check(isUuid(r.operationId)&&r.employeeId===d.employeeId&&r.action===d.action&&r.revision===Number(d.revision)+1,true);return{operationId:r.operationId,employeeId:r.employeeId,action:r.action,revision:r.revision};}
   for(const key of ['hosts','candidates'])check(Array.isArray(r[key])&&r[key].length<=(key==='hosts'?500:20),true);
   const rows=(items:any[],hosts:boolean)=>items.map(e=>{check(e&&text(e.employeeId,64)&&text(e.displayName,200)&&text(e.email,320)&&Number.isInteger(e.revision)&&e.revision>=(hosts?1:0),true);if(hosts)check(typeof e.eligible==='boolean'&&isUtc(e.changedAtUtc)&&text(e.changedBy,200),true);return{employeeId:e.employeeId,displayName:e.displayName,email:e.email,revision:e.revision,...(hosts?{eligible:e.eligible,changedAtUtc:e.changedAtUtc,changedBy:e.changedBy}:{})};});
   const hosts=rows(r.hosts,true),candidates=rows(r.candidates,false);check(new Set([...hosts,...candidates].map(e=>e.employeeId)).size===hosts.length+candidates.length,true);return{hosts,candidates};
  }catch(e){if(e instanceof StaffAdministrationError)throw e;const n=Number((e as any)?.number);throw new StaffAdministrationError(n===52001?'NOT_AUTHORIZED':n===52002?'INVALID_INPUT':[52003,52004,52005].includes(n)?'CONFLICT':'UNAVAILABLE');}
 }
}
