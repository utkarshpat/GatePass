import {receptionIdentity} from '../reception/ReceptionService.ts';
import {StaffAdministrationError} from './StaffAdministrationService.ts';
import {isUuid,isDate,isUtc} from '../visits/SqlVisitReadRepository.ts';
import type {SqlParameter} from '../transport/SqlProcedureClient.ts';

// The SQL projection and UI use the same public business fields. Never accept a SQL expression.
export const registerFields=['localVisitDate','submittedAtUtc','personName','employeeId','personEmail','personPhone','companyName','deviceTypes','locationName','projectName','hostName','hostEmail','requestType','reason','publicReference','publicPassNumber','status','passStatus','presence','printStatus','returnedAtUtc','validFromUtc','validUntilUtc','firstEntryAtUtc','lastEntryAtUtc','lastExitAtUtc'] as const;
const choices:Record<string,string[]>={requestType:['EXTERNAL','EMPLOYEE_PROJECT','DIGITAL_ID'],status:['PENDING','APPROVED','DENIED','CANCELLED'],passStatus:['PENDING','ACTIVE','DENIED','REVOKED'],presence:['INSIDE','OUTSIDE'],printStatus:['NOT_PRINTED','PRINTED','RETURNED'],deviceTypes:['LAPTOP','TABLET','PEN_DRIVE','CAMERA','OTHER']};
const invalid=():never=>{throw new StaffAdministrationError('INVALID_INPUT');};
export async function readAdminRegister(client:{callProcedure(n:string,p:Record<string,SqlParameter>):Promise<string>},session:{sessionToken:string;csrfToken:string},d:Record<string,unknown>){
 if(Object.keys(d).some(k=>!['locationId','projectLocationId','from','to','filters','sort','direction','page'].includes(k)))invalid();
 if(!Number.isInteger(d.locationId)||Number(d.locationId)<1||Number(d.locationId)>2147483647)invalid();
 if(d.projectLocationId!==undefined&&(typeof d.projectLocationId!=='string'||!/^\d{1,19}$/u.test(d.projectLocationId)||BigInt(d.projectLocationId)<1n||BigInt(d.projectLocationId)>9223372036854775807n))invalid();
 if(!isDate(d.from)||!isDate(d.to)||String(d.from)>String(d.to)||Date.parse(String(d.to))-Date.parse(String(d.from))>30*86400000)invalid();
 const sort=d.sort??'submittedAtUtc',direction=d.direction??'DESC',page=d.page??1;
 if(!registerFields.includes(sort as any)||!['ASC','DESC'].includes(String(direction))||!Number.isInteger(page)||Number(page)<1||Number(page)>100000)invalid();
 const filters=d.filters===undefined?{}:d.filters;
 if(!filters||typeof filters!=='object'||Array.isArray(filters)||Object.keys(filters).length>registerFields.length)invalid();
 for(const [key,v] of Object.entries(filters as Record<string,unknown>)){
  if(!registerFields.includes(key as any)||typeof v!=='string'||!v.length||v!==v.trim()||v.length>200||!v.isWellFormed()||/[\u0000-\u001f\u007f]/u.test(v)||choices[key]&&!choices[key].includes(v))invalid();
 }
 let r:any;
 try{r=JSON.parse(await client.callProcedure('gp.ReadAdminVisitRegister',{...receptionIdentity(session),LocationId:{type:'int',value:Number(d.locationId)},ProjectLocationId:{type:'bigint',value:d.projectLocationId as string??null},FromDate:{type:'date',value:String(d.from)},ToDate:{type:'date',value:String(d.to)},FiltersJson:{type:'text',value:JSON.stringify(filters)},Sort:{type:'text',value:String(sort)},Direction:{type:'text',value:String(direction)},Page:{type:'int',value:Number(page)}}));}
 catch(e){const n=Number((e as any)?.number);throw new StaffAdministrationError(n===52001?'NOT_AUTHORIZED':n===52002?'INVALID_INPUT':'UNAVAILABLE');}
 const bad=()=>{throw new StaffAdministrationError('UNAVAILABLE');};
 if(!r||!Array.isArray(r.rows)||r.rows.length>50||!Number.isSafeInteger(r.total)||r.total<0||r.page!==page||r.pageSize!==50||!isUtc(r.checkedAtUtc)||r.rows.length!==Math.min(50,Math.max(0,r.total-(Number(page)-1)*50)))bad();
 const ids=new Set<string>();
 const rows=r.rows.map((v:any)=>{
  if(!v||!isUuid(v.visitRequestId)||ids.has(v.visitRequestId.toLowerCase()))bad();ids.add(v.visitRequestId.toLowerCase());
  const row:Record<string,string|null>={visitRequestId:v.visitRequestId.toLowerCase()};
  for(const key of registerFields){const value=v[key]??null;if(value!==null&&(typeof value!=='string'||value.length>2000||!value.isWellFormed()))bad();if(choices[key]&&key!=='deviceTypes'&&!choices[key].includes(value))bad();row[key]=value;}
  if(!row.personName||!isDate(row.localVisitDate)||!isUtc(row.submittedAtUtc)||!isUtc(row.validFromUtc)||!isUtc(row.validUntilUtc)||['returnedAtUtc','firstEntryAtUtc','lastEntryAtUtc','lastExitAtUtc'].some(k=>row[k]!==null&&!isUtc(row[k])))bad();
  return row;
 });
 return{rows,total:r.total,page:r.page,pageSize:50,checkedAtUtc:r.checkedAtUtc};
}
