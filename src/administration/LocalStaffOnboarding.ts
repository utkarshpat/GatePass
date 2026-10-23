import {createHash} from 'node:crypto';
import {receptionIdentity} from '../reception/ReceptionService.ts';
import {normalizeGuardLogin} from '../security/GuardAuthService.ts';
import {isUuid,isUtc} from '../visits/SqlVisitReadRepository.ts';
import {StaffAdministrationError} from './StaffAdministrationService.ts';
import type {SqlParameter} from '../transport/SqlProcedureClient.ts';
type Client={callProcedure(name:string,p:Record<string,SqlParameter>):Promise<string>};
type Session={sessionToken:string;csrfToken:string};
const roles=['GUARD','RECEPTION','LOCATION_ADMIN','INDIA_ADMIN','PLATFORM_ADMIN'];
const validText=(v:unknown,max:number)=>typeof v==='string'&&v.isWellFormed()&&v.length<=max&&v.trim().length>0&&!/[\u0000-\u001f\u007f-\u009f]/u.test(v);
function check(ok:unknown,output=false):asserts ok {if(!ok)throw new StaffAdministrationError(output?'UNAVAILABLE':'INVALID_INPUT');}
function setupHash(v:unknown){check(typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/u.test(v));const bytes=Buffer.from(v,'base64url');try{check(bytes.length===32&&bytes.toString('base64url')===v);return createHash('sha256').update(bytes).digest();}finally{bytes.fill(0);}}
export async function provisionLocalStaff(client:Client,session:Session,d:Record<string,unknown>,reset=false){
 check(Object.keys(d).every(k=>(reset?['targetUserId','setupToken','clientKey','reason']:['displayName','loginId','roleCode','locationId','projectLocationId','capabilities','setupToken','clientKey','reason']).includes(k))&&isUuid(d.clientKey)&&validText(d.reason,300));
 const p:Record<string,SqlParameter>={...receptionIdentity(session),ClientKey:{type:'guid',value:d.clientKey},SetupTokenHash:{type:'binary',value:setupHash(d.setupToken)},Reason:{type:'text',value:String(d.reason).trim()}};
 if(reset){check(isUuid(d.targetUserId));p.TargetUserId={type:'guid',value:d.targetUserId};}
 else{
  const login=normalizeGuardLogin(d.loginId);check(validText(d.displayName,200)&&login&&roles.includes(String(d.roleCode))&&Number.isInteger(d.locationId)&&Number(d.locationId)>0&&Number(d.locationId)<=2147483647);
  check(d.projectLocationId===undefined||typeof d.projectLocationId==='string'&&/^[1-9][0-9]{0,18}$/u.test(d.projectLocationId)&&BigInt(d.projectLocationId)<=9223372036854775807n);
  check(Array.isArray(d.capabilities)&&d.capabilities.length>=1&&d.capabilities.length<=8&&new Set(d.capabilities).size===d.capabilities.length&&d.capabilities.every(v=>typeof v==='string'&&/^[A-Z_]{1,40}$/u.test(v)));
  Object.assign(p,{DisplayName:{type:'text',value:String(d.displayName).trim()},LoginId:{type:'text',value:login},RoleCode:{type:'text',value:String(d.roleCode)},LocationId:{type:'int',value:Number(d.locationId)},ProjectLocationId:{type:'bigint',value:d.projectLocationId??null},CapabilitiesJson:{type:'text',value:JSON.stringify([...d.capabilities].sort())}});
 }
 let r:any;try{r=JSON.parse(await client.callProcedure(reset?'gp.ReissueLocalStaffSetup':'gp.CreateLocalStaffAccount',p));}catch(e){const n=Number((e as any)?.number);throw new StaffAdministrationError([52001,52601].includes(n)?'NOT_AUTHORIZED':[52002,52602].includes(n)?'INVALID_INPUT':[52003,2601,2627].includes(n)?'CONFLICT':'UNAVAILABLE');}
 check(r&&isUuid(r.userId)&&validText(r.displayName,200)&&normalizeGuardLogin(r.loginId)===r.loginId&&roles.includes(r.roleCode)&&isUtc(r.setupExpiresAtUtc),true);
 check(!reset||r.userId.toLowerCase()===String(d.targetUserId).toLowerCase(),true);
 if(!reset)check(r.roleCode===d.roleCode&&r.loginId===normalizeGuardLogin(d.loginId)&&r.scopeType===(d.roleCode==='INDIA_ADMIN'?'INDIA':d.roleCode==='PLATFORM_ADMIN'?'PLATFORM':'LOCATION'),true);
 return{userId:r.userId.toLowerCase(),displayName:r.displayName,loginId:r.loginId,roleCode:r.roleCode,setupExpiresAtUtc:r.setupExpiresAtUtc};
}
