import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {requireDummySso} from './DummyEmployeeSso.ts';
import {resolvePowerShell} from '../runtime/PowerShellRuntime.mjs';
import type {SqlParameter} from '../transport/SqlProcedureClient.ts';
const allowed=new Set(['gp.DecideVisit','gp.ReadEmailRequest','gp.RevokeEmailRequest','gp.CancelVisit','gp.GetEmployeeRequestCard','gp.GetEmailRequestCard','gp.ClaimNotifications','gp.GetNotificationEmail','gp.ResolveNotificationPhoto','gp.RenewNotificationLease','gp.CompleteNotification','gp.CreateRegistrationIntake','gp.RecordRegistrationPhoto','gp.SubmitRegistration','gp.ListRegistrationLocations','gp.GetRegistrationOptions','gp.GetVisitDetail','gp.GetOwnDigitalIdCard','gp.GetStaffAccessContext','gp.ManageStaffCredential','gp.ReadAdminVisitRegister','gp.GetAdminConsoleScope','gp.ListAdminGuardAssignments','gp.ListAdminProjectLocations','gp.ListAdminGuards','gp.SearchStaffSubjects','gp.ListStaffRoles','gp.GetOperationalSummary','gp.GetOperationalSummaryRange','gp.ReadGuardQueue','gp.ReadReceptionQueue','gp.ReadActionCentre','gp.RemindPendingApproval','gp.ListScopedAuditEvents','gp.AllocateGuard','gp.DeallocateGuard','gp.CreateScopedProject','gp.GetAdminWorkspaceContext','gp.GetGuardWorkspaceContext','gp.ListGuardDuties','gp.ReadGuardDutyPass','gp.ListGuardDutyVisitors','gp.RecordGuardDutyMovement','gp.GetCommonDutyAdministration','gp.ManageCommonDuty','gp.FindGuardPass','gp.ListGuardVisitors','gp.ListGuardRecentScans','gp.ListGuardWorkContexts','gp.ListVisits','gp.VerifyGuardPass','gp.RecordMovement','gp.ListLeadProjects','gp.SearchProjectLeadCandidates','gp.ListProjectHeads','gp.GrantStaffRole','gp.RevokeStaffRole','gp.BeginGuardLogin','gp.CompleteGuardLogin','gp.TouchGuardSession','gp.RevokeGuardSession','gp.ResolveStaffLoginIdentity','gp.BeginStaffLogin','gp.CompleteStaffLogin','gp.TouchStaffSession','gp.RevokeStaffSession','gp.InspectStaffSetup','gp.CompleteStaffSetup','gp.RemindVisitHost','gp.GetReceptionEmployeeTimeline','gp.AuditReceptionRegistration','gp.LookupReceptionVisits','gp.CorrectReceptionReturn','gp.CreateLocalStaffAccount','gp.ReissueLocalStaffSetup','gp.ReturnReceptionPass','gp.GetReceptionContext','gp.ListReceptionVisits','gp.RequestPassPrint','gp.GetPassPrintJob','gp.GetReceptionCardSource','gp.BeginPassRender','gp.FinishPassRender','gp.DispatchPassPrint','gp.FailPassPrint','gp.ResolveVisitPhoto']);
type RpcWorker={child:ReturnType<typeof spawn>;busy:boolean;dead:boolean;buffer:string;pending?:{resolve:(s:string)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>};idle?:ReturnType<typeof setTimeout>};
export class LocalDevelopmentApiClient {
 #workers:RpcWorker[]=[];
 #closed=false;#spawn:()=>ReturnType<typeof spawn>;
 onSuccess?: (name:string,parameters:Record<string,SqlParameter>,result:Record<string,unknown>)=>void;
 constructor(spawnWorker=()=>spawn(resolvePowerShell(),['-NoProfile','-File',fileURLToPath(new URL('../../tools/GatePass.DevelopmentApiBridge.ps1',import.meta.url)),'-Persistent'],{windowsHide:true,stdio:['pipe','pipe','pipe']})){this.#spawn=spawnWorker;}
 #waiting=new Set<()=>void>();
 #wake(){for(const ready of this.#waiting)ready();this.#waiting.clear();}
 #destroy(worker:RpcWorker){if(worker.dead)return;worker.dead=true;clearTimeout(worker.idle);const p=worker.pending;worker.pending=undefined;if(p){clearTimeout(p.timer);p.reject(new Error('DEVELOPMENT_RPC_UNAVAILABLE'));}worker.buffer='';worker.child.kill();this.#workers=this.#workers.filter(w=>w!==worker);this.#wake();}
 async #acquire():Promise<RpcWorker>{
  const deadline=Date.now()+30000;
  while(true){
   if(this.#closed)throw new Error('DEVELOPMENT_RPC_UNAVAILABLE');
   let worker=this.#workers.find(w=>!w.busy);
   if(!worker&&this.#workers.length<4)worker=this.#start();
   if(worker){clearTimeout(worker.idle);worker.busy=true;return worker;}
   const remaining=deadline-Date.now();if(remaining<=0||this.#waiting.size>=64)throw new Error('DEVELOPMENT_RPC_UNAVAILABLE');
   await new Promise<void>((resolve,reject)=>{const ready=()=>{clearTimeout(timer);resolve();};const timer=setTimeout(()=>{this.#waiting.delete(ready);reject(new Error('DEVELOPMENT_RPC_UNAVAILABLE'));},remaining);this.#waiting.add(ready);});
  }
 }
 #start(){
  const child=this.#spawn();
  const worker:RpcWorker={child,busy:false,dead:false,buffer:''};this.#workers.push(worker);
  child.stdout!.setEncoding('utf8');child.stdout!.on('data',(part:string)=>{
   if(worker.dead)return;
   worker.buffer+=part;if(Buffer.byteLength(worker.buffer)>2097152){this.#destroy(worker);return;}
   const end=worker.buffer.indexOf('\n');if(end<0)return;
   const packet=worker.buffer.slice(0,end);worker.buffer=worker.buffer.slice(end+1);const p=worker.pending;
   if(!p||worker.buffer.trim()){this.#destroy(worker);return;}
   worker.pending=undefined;worker.busy=false;clearTimeout(p.timer);this.#wake();
   try{const envelope=JSON.parse(packet);if(typeof envelope.result!=='string')throw new Error();p.resolve(envelope.result);}catch{p.reject(new Error('DEVELOPMENT_RPC_UNAVAILABLE'));this.#destroy(worker);return;}
   // Keep one helper warm across normal browsing pauses; retire burst capacity quickly.
   worker.idle=setTimeout(()=>this.#destroy(worker),this.#workers[0]===worker?90000:5000);worker.idle.unref();
   // Idle helpers must not keep CLI/test processes alive; EOF closes their pipe.
   child.unref();for(const stream of [child.stdin,child.stdout,child.stderr])(stream as any)?.unref?.();
  });
  child.stderr!.resume();child.on('error',()=>this.#destroy(worker));child.on('close',()=>this.#destroy(worker));child.stdin!.on('error',()=>this.#destroy(worker));return worker;
 }
 async callProcedure(name:string,parameters:Record<string,SqlParameter>):Promise<string>{
  requireDummySso();if(!allowed.has(name))throw new Error('DEVELOPMENT_RPC_UNAVAILABLE');
  const worker=await this.#acquire();worker.child.ref();for(const stream of [worker.child.stdin,worker.child.stdout,worker.child.stderr])(stream as any)?.ref?.();
  if(this.#closed||worker.dead)throw new Error('DEVELOPMENT_RPC_UNAVAILABLE');
  const selected=worker;
  const output=await new Promise<string>((resolve,reject)=>{selected.pending={resolve,reject,timer:setTimeout(()=>this.#destroy(selected),20000)};
   selected.child.stdin!.write(JSON.stringify({procedure:name,parameters:Object.fromEntries(Object.entries(parameters).map(([key,p])=>[key,{type:p.type,value:Buffer.isBuffer(p.value)?p.value.toString('base64'):p.value}]))})+'\n');
  });
  let result;try{result=JSON.parse(output);}catch{throw new Error('DEVELOPMENT_RPC_UNAVAILABLE');}
  if(result.bridgeError){if(process.env.NODE_ENV==='test')process.stderr.write('GP_RPC_FAILURE '+name+' SQL_'+Number(result.number)+' '+String(result.errorKind??'').replace(/[^A-Za-z.]/gu,'')+'\n');throw Object.assign(new Error('SQL_OPERATION_REJECTED'),{number:result.number});}
  // A notification failure cannot turn a committed write into an apparent failed operation.
  try{this.onSuccess?.(name,parameters,result);}catch{/* Reconnect/periodic refresh repairs missed invalidations. */}return output;
 }
 close(){this.#closed=true;for(const worker of [...this.#workers])this.#destroy(worker);this.#wake();}
}
