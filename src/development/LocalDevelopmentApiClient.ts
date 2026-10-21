import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {requireDummySso} from './DummyEmployeeSso.ts';
import {resolvePowerShell} from '../runtime/PowerShellRuntime.mjs';
import type {SqlParameter} from '../transport/SqlProcedureClient.ts';
const allowed=new Set(['gp.CreateRegistrationIntake','gp.RecordRegistrationPhoto','gp.SubmitRegistration','gp.ListRegistrationLocations','gp.GetRegistrationOptions','gp.GetVisitDetail','gp.GetOwnDigitalIdCard','gp.GetStaffAccessContext','gp.ManageStaffCredential','gp.GetAdminWorkspaceContext','gp.GetGuardWorkspaceContext','gp.FindGuardPass','gp.ListGuardVisitors','gp.ListGuardRecentScans','gp.ListGuardWorkContexts','gp.ListVisits','gp.VerifyGuardPass','gp.RecordMovement','gp.ListLeadProjects','gp.SearchProjectLeadCandidates','gp.ListProjectHeads','gp.GrantStaffRole','gp.RevokeStaffRole','gp.BeginGuardLogin','gp.CompleteGuardLogin','gp.TouchGuardSession','gp.RevokeGuardSession','gp.ResolveStaffLoginIdentity','gp.BeginStaffLogin','gp.CompleteStaffLogin','gp.TouchStaffSession','gp.RevokeStaffSession','gp.InspectStaffSetup','gp.CompleteStaffSetup','gp.GetReceptionContext','gp.ListReceptionVisits','gp.RequestPassPrint','gp.GetPassPrintJob','gp.GetReceptionCardSource','gp.BeginPassRender','gp.FinishPassRender','gp.DispatchPassPrint','gp.FailPassPrint','gp.ResolveVisitPhoto']);
export class LocalDevelopmentApiClient {
 #active=0;
 async callProcedure(name:string,parameters:Record<string,SqlParameter>):Promise<string>{
  requireDummySso();if(!allowed.has(name)||this.#active>=4)throw new Error('DEVELOPMENT_RPC_UNAVAILABLE');this.#active++;
  try{return await new Promise<string>((resolve,reject)=>{
   const child=spawn(resolvePowerShell(),['-NoProfile','-File',fileURLToPath(new URL('../../tools/GatePass.DevelopmentApiBridge.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';let length=0;
   const timer=setTimeout(()=>{child.kill();reject(new Error('DEVELOPMENT_RPC_UNAVAILABLE'));},20000);
   child.stdout.on('data',bytes=>{length+=bytes.length;if(length>1048576){child.kill();reject(new Error('DEVELOPMENT_RPC_UNAVAILABLE'));}else output+=bytes;});child.stderr.resume();
   child.on('error',()=>{clearTimeout(timer);reject(new Error('DEVELOPMENT_RPC_UNAVAILABLE'));});
   child.on('close',code=>{clearTimeout(timer);try{if(code!==0)throw new Error();const result=JSON.parse(output);if(result.bridgeError){if(process.env.NODE_ENV==='test')process.stderr.write('GP_RPC_FAILURE '+name+' SQL_'+Number(result.number)+' '+String(result.errorKind??'').replace(/[^A-Za-z.]/gu,'')+'\n');reject(Object.assign(new Error('SQL_OPERATION_REJECTED'),{number:result.number}));return;}resolve(output);}catch{reject(new Error('DEVELOPMENT_RPC_UNAVAILABLE'));}});
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({procedure:name,parameters:Object.fromEntries(Object.entries(parameters).map(([key,p])=>[key,{type:p.type,value:Buffer.isBuffer(p.value)?p.value.toString('base64'):p.value}]))}));
  });}finally{this.#active--;}
 }
}


