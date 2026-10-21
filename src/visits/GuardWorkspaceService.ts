import type {SqlParameter} from '../transport/SqlProcedureClient.ts';
import {receptionIdentity} from '../reception/ReceptionService.ts';
import {VisitReadError} from './VisitReadService.ts';
import {isUuid,isUtc} from './SqlVisitReadRepository.ts';
const out=(v:unknown)=>{if(!v)throw new VisitReadError('UNAVAILABLE');};
const text=(v:unknown,n:number)=>typeof v==='string'&&v.length>0&&v.length<=n;
export class GuardWorkspaceService{
 #client:{callProcedure(name:string,p:Record<string,SqlParameter>):Promise<string>};
 constructor(client:{callProcedure(name:string,p:Record<string,SqlParameter>):Promise<string>}){this.#client=client;}
 async visitors(session:{sessionToken:string;csrfToken:string},input:any){
  const projectFilter=input?.projectFilter===undefined?'ALL':input.projectFilter;
  if(typeof projectFilter!=='string'||!(['ALL','DIGITAL_ID'].includes(projectFilter)||/^[1-9][0-9]{0,18}$/u.test(projectFilter)&&BigInt(projectFilter)<=9223372036854775807n))throw new VisitReadError('INVALID_INPUT');
  if(!input||Object.keys(input).some(k=>!['locationId','offset','queue','search','projectFilter'].includes(k))||!Number.isInteger(input.locationId)||input.locationId<1||input.locationId>2147483647||!['EXPECTED','INSIDE'].includes(input.queue)||typeof input.search!=='string'||input.search.length>100||/[\u0000-\u001f\u007f]/u.test(input.search)||!Number.isInteger(input.offset)||input.offset<0||input.offset>100000)throw new VisitReadError('INVALID_INPUT');
  let r:any;try{r=JSON.parse(await this.#client.callProcedure('gp.ListGuardVisitors',{...receptionIdentity(session),LocationId:{type:'int',value:input.locationId},Queue:{type:'text',value:input.queue},Search:{type:'text',value:input.search.trim()},Offset:{type:'int',value:input.offset},ProjectFilter:{type:'text',value:projectFilter}}));}catch(e){throw new VisitReadError(Number((e as any)?.number)===52001?'NOT_AUTHORIZED':'UNAVAILABLE');}
  out(r&&Array.isArray(r.visitors)&&r.visitors.length<=50&&typeof r.hasMore==='boolean'&&(!r.hasMore||r.visitors.length===50));
  return{visitors:r.visitors.map((v:any)=>{
   out(isUuid(v.visitRequestId)&&text(v.personName,200)&&text(v.publicReference,40)&&text(v.publicPassNumber,50)&&['DIGITAL_ID','EMPLOYEE_PROJECT','EXTERNAL'].includes(v.requestType)&&['PENDING','APPROVED','DENIED','CANCELLED'].includes(v.status)&&['PENDING','ACTIVE','REVOKED','DENIED'].includes(v.passStatus)&&typeof v.isInside==='boolean'&&v.isInside===(input.queue==='INSIDE')&&isUtc(v.validUntilUtc)&&typeof v.photoAvailable==='boolean'&&(v.projectName===undefined||text(v.projectName,200)));
   return{visitRequestId:v.visitRequestId.toLowerCase(),personName:v.personName,publicReference:v.publicReference,publicPassNumber:v.publicPassNumber,requestType:v.requestType,projectName:v.projectName??null,status:v.status,passStatus:v.passStatus,isInside:v.isInside,validUntilUtc:v.validUntilUtc,photoAvailable:v.photoAvailable};
  }),hasMore:r.hasMore};
 }
 async lookup(session:{sessionToken:string;csrfToken:string},locationId:unknown,reference:unknown){
  if(!Number.isInteger(locationId)||Number(locationId)<1||Number(locationId)>2147483647||!text(reference,50)||!(reference as string).trim()||/[\u0000-\u001f\u007f]/u.test(reference as string))throw new VisitReadError('INVALID_INPUT');
  let r:any;try{r=JSON.parse(await this.#client.callProcedure('gp.FindGuardPass',{...receptionIdentity(session),LocationId:{type:'int',value:Number(locationId)},Reference:{type:'text',value:(reference as string).trim()}}));}catch(e){throw new VisitReadError(Number((e as any)?.number)===52001?'NOT_AUTHORIZED':'UNAVAILABLE');}
  out(r&&typeof r==='object'&&(r.visitRequestId===null||isUuid(r.visitRequestId)));return r.visitRequestId as string|null;
 }
 async read(session:{sessionToken:string;csrfToken:string},locationId?:unknown){
  if(locationId!==undefined&&(!Number.isInteger(locationId)||Number(locationId)<1||Number(locationId)>2147483647))throw new VisitReadError('INVALID_INPUT');
  let r:any;try{r=JSON.parse(await this.#client.callProcedure(locationId===undefined?'gp.GetGuardWorkspaceContext':'gp.ListGuardRecentScans',{...receptionIdentity(session),...(locationId===undefined?{}:{LocationId:{type:'int' as const,value:Number(locationId)}})}));}catch(e){throw new VisitReadError(Number((e as any)?.number)===52001?'NOT_AUTHORIZED':'UNAVAILABLE');}
  out(r&&typeof r==='object');if(locationId===undefined){out(text(r.displayName,200)&&Array.isArray(r.locations)&&r.locations.length>0&&r.locations.length<=50);return{displayName:r.displayName,locations:r.locations.map((l:any)=>{out(Number.isInteger(l.locationId)&&l.locationId>0&&text(l.locationName,150));return{locationId:l.locationId,locationName:l.locationName};})};}
  out(Array.isArray(r.scans)&&r.scans.length<=20);return{scans:r.scans.map((s:any)=>{out(typeof s.scanId==='string'&&/^[1-9][0-9]{0,18}$/u.test(s.scanId)&&['VALID','PENDING','DENIED','EXPIRED','REVOKED','NOT_FOUND','WRONG_PROJECT','WRONG_LOCATION','NOT_YET_VALID','NOT_AUTHORIZED','CANCELLED','ERROR'].includes(s.outcome)&&isUtc(s.occurredAtUtc)&&(s.personName===undefined||text(s.personName,200))&&(s.publicReference===undefined||text(s.publicReference,40)));const card:any={};if(s.visitRequestId!==undefined){out(isUuid(s.visitRequestId)&&text(s.personName,200)&&text(s.publicReference,40)&&text(s.publicPassNumber,50)&&['DIGITAL_ID','EMPLOYEE_PROJECT','EXTERNAL'].includes(s.requestType)&&isUtc(s.validUntilUtc)&&typeof s.photoAvailable==='boolean'&&(s.projectName===undefined||text(s.projectName,200)));Object.assign(card,{visitRequestId:s.visitRequestId.toLowerCase(),publicPassNumber:s.publicPassNumber,requestType:s.requestType,validUntilUtc:s.validUntilUtc,photoAvailable:s.photoAvailable,projectName:s.projectName??null});}else out(['personName','publicReference','publicPassNumber','requestType','validUntilUtc','photoAvailable','projectName'].every(k=>s[k]===undefined));return{scanId:s.scanId,outcome:s.outcome,occurredAtUtc:s.occurredAtUtc,personName:s.personName??null,publicReference:s.publicReference??null,...card};})};
 }
}
