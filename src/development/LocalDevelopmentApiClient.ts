import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {requireDummySso} from './DummyEmployeeSso.ts';
import {resolvePowerShell} from '../runtime/PowerShellRuntime.mjs';
import type {SqlParameter} from '../transport/SqlProcedureClient.ts';
import type {RpcTiming} from './LoadDiagnostics.ts';
const allowed=new Set(['gp.GetAdminProjectGroups','gp.ManageProjectGroup','gp.ManageProjectGroupGuard','gp.DecideVisit','gp.ReadEmailRequest','gp.RevokeEmailRequest','gp.CancelVisit','gp.GetEmployeeRequestCard','gp.GetEmailRequestCard','gp.GetPublicRegistrationCard','gp.ClaimNotifications','gp.GetNotificationEmail','gp.ResolveNotificationPhoto','gp.RenewNotificationLease','gp.CompleteNotification','gp.CreateRegistrationIntake','gp.RecordRegistrationPhoto','gp.SubmitRegistration','gp.ListRegistrationLocations','gp.GetRegistrationOptions','gp.GetVisitDetail','gp.GetOwnDigitalIdCard','gp.GetStaffAccessContext','gp.ManageStaffCredential','gp.ReadAdminVisitRegister','gp.GetAdminConsoleScope','gp.ListAdminGuardAssignments','gp.ListAdminProjectLocations','gp.ListAdminGuards','gp.SearchStaffSubjects','gp.ListStaffRoles','gp.GetOperationalSummary','gp.GetOperationalSummaryRange','gp.ReadGuardQueue','gp.ReadReceptionQueue','gp.ReadActionCentre','gp.RemindPendingApproval','gp.ListScopedAuditEvents','gp.AllocateGuard','gp.DeallocateGuard','gp.CreateScopedProject','gp.GetAdminWorkspaceContext','gp.GetGuardWorkspaceContext','gp.ListGuardDuties','gp.ReadGuardDutyPass','gp.ListGuardDutyVisitors','gp.RecordGuardDutyMovement','gp.GetCommonDutyAdministration','gp.ManageCommonDuty','gp.FindGuardPass','gp.ListGuardVisitors','gp.ListGuardRecentScans','gp.ListGuardWorkContexts','gp.ListVisits','gp.VerifyGuardPass','gp.RecordMovement','gp.ListLeadProjects','gp.SearchProjectLeadCandidates','gp.ListProjectHeads','gp.GrantStaffRole','gp.RevokeStaffRole','gp.BeginGuardLogin','gp.CompleteGuardLogin','gp.TouchGuardSession','gp.RevokeGuardSession','gp.ResolveStaffLoginIdentity','gp.BeginStaffLogin','gp.CompleteStaffLogin','gp.TouchStaffSession','gp.RevokeStaffSession','gp.InspectStaffSetup','gp.CompleteStaffSetup','gp.RemindVisitHost','gp.GetReceptionEmployeeTimeline','gp.AuditReceptionRegistration','gp.LookupReceptionVisits','gp.CorrectReceptionReturn','gp.CreateLocalStaffAccount','gp.ReissueLocalStaffSetup','gp.ReturnReceptionPass','gp.GetReceptionContext','gp.ListReceptionVisits','gp.RequestPassPrint','gp.GetPassPrintJob','gp.GetReceptionCardSource','gp.BeginPassRender','gp.FinishPassRender','gp.DispatchPassPrint','gp.FailPassPrint','gp.ResolveVisitPhoto','gp.ReadGuardPhotoSource']);
type RpcWorker={child:ReturnType<typeof spawn>;busy:boolean;dead:boolean;buffer:string;pending?:{resolve:(s:string)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>;name?:string;queuedAt:number;startedAt:number};idle?:ReturnType<typeof setTimeout>};
export class LocalDevelopmentApiClient {
 #workers:RpcWorker[]=[];
 #closed=false;#spawn:()=>ReturnType<typeof spawn>;#maximumWorkers:number;
 #warming?:Promise<void>;#retainWarm=false;
 onSuccess?: (name:string,parameters:Record<string,SqlParameter>,result:Record<string,unknown>)=>void;
 onTiming?: (value:RpcTiming)=>void;
 constructor(spawnWorker=()=>spawn(resolvePowerShell(),['-NoProfile','-File',fileURLToPath(new URL('../../tools/GatePass.DevelopmentApiBridge.ps1',import.meta.url)),'-Persistent'],{windowsHide:true,stdio:['pipe','pipe','pipe']}),maximumWorkers=Number(process.env.GATEPASS_DEV_RPC_WORKERS??4)){if(!Number.isInteger(maximumWorkers)||maximumWorkers<1||maximumWorkers>8)throw Error('INVALID_DEVELOPMENT_WORKER_LIMIT');this.#spawn=spawnWorker;this.#maximumWorkers=maximumWorkers;}
 /** Server startup only: acknowledge process readiness without executing SQL or caching authority. */
 warmUp():Promise<void>{
  requireDummySso();if(this.#closed)return Promise.reject(Error('DEVELOPMENT_RPC_UNAVAILABLE'));
  if(this.#warming)return this.#warming;
  if(this.#workers.length)return Promise.reject(Error('DEVELOPMENT_POOL_ALREADY_STARTED'));
  this.#retainWarm=true;
  this.#warming=(async()=>{
   try{
    await Promise.all(Array.from({length:this.#maximumWorkers},async()=>{
     const worker=this.#start();worker.busy=true;const value=JSON.parse(await this.#request(worker,{warmup:true}));
     if(value?.ready!==true||Object.keys(value).length!==1)throw Error('DEVELOPMENT_RPC_UNAVAILABLE');
    }));
   }catch{await this.close();throw Error('DEVELOPMENT_RPC_UNAVAILABLE');}
  })();return this.#warming;
 }
 #waiting=new Set<()=>void>();
 #wake(all=false){
  // Wake only one FIFO waiter per newly available worker. Waking all waiting
  // RPCs creates quadratic acquire/requeue work during large concurrent bursts.
  // Shutdown is exceptional: every queued caller must wake and reject.
  if(all){for(const ready of this.#waiting)ready();this.#waiting.clear();return;}
  const ready=this.#waiting.values().next().value;
  if(ready){this.#waiting.delete(ready);ready();}
 }
 #destroy(worker:RpcWorker){if(worker.dead)return;worker.dead=true;clearTimeout(worker.idle);const p=worker.pending;worker.pending=undefined;if(p){clearTimeout(p.timer);p.reject(new Error('DEVELOPMENT_RPC_UNAVAILABLE'));}worker.buffer='';worker.child.kill();this.#workers=this.#workers.filter(w=>w!==worker);this.#wake();}
 #retire(worker:RpcWorker):Promise<void>{
  if(worker.dead)return Promise.resolve();
  worker.dead=true;clearTimeout(worker.idle);worker.buffer='';this.#workers=this.#workers.filter(w=>w!==worker);this.#wake();
  // EOF lets the helper dispose its role connections and collect their SQL users.
  worker.child.ref();for(const stream of [worker.child.stdin,worker.child.stdout,worker.child.stderr])(stream as any)?.ref?.();
  return new Promise(resolve=>{let finished=false;const done=()=>{if(finished)return;finished=true;clearTimeout(timer);resolve();};const timer=setTimeout(()=>{worker.child.kill();done();},5000);worker.child.once('close',done);worker.child.once('error',done);worker.child.stdin!.end();});
 }
 async #acquire():Promise<RpcWorker>{
  const deadline=Date.now()+30000;
  while(true){
   if(this.#closed)throw new Error('DEVELOPMENT_RPC_UNAVAILABLE');
   let worker=this.#workers.find(w=>!w.busy);
   if(!worker&&this.#workers.length<this.#maximumWorkers)worker=this.#start();
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
   try{const envelope=JSON.parse(packet);if(typeof envelope.result!=='string')throw new Error();
    if(this.onTiming&&p.name)try{const result=JSON.parse(envelope.result);this.onTiming({procedure:p.name,queueMs:p.startedAt-p.queuedAt,rpcMs:performance.now()-p.startedAt,...(result.bridgeError?{sqlError:Number(result.number)}:{}),...(envelope.timing&&typeof envelope.timing==='object'?{bridge:envelope.timing}:{})});}catch{/* Diagnostics never alter a business outcome. */}
    p.resolve(envelope.result);}catch{p.reject(new Error('DEVELOPMENT_RPC_UNAVAILABLE'));this.#destroy(worker);return;}
   // A prewarmed server owns its bounded pool until close. Ad-hoc CLI clients
   // keep the existing idle retirement policy and never prewarm automatically.
   if(!this.#retainWarm){worker.idle=setTimeout(()=>{void this.#retire(worker);},this.#workers[0]===worker?90000:5000);worker.idle.unref();}
   // Idle helpers must not keep CLI/test processes alive; EOF closes their pipe.
   child.unref();for(const stream of [child.stdin,child.stdout,child.stderr])(stream as any)?.unref?.();
  });
  child.stderr!.resume();child.on('error',()=>this.#destroy(worker));child.on('close',()=>this.#destroy(worker));child.stdin!.on('error',()=>this.#destroy(worker));return worker;
 }
 #request(worker:RpcWorker,payload:unknown,name?:string,queuedAt=performance.now(),startedAt=performance.now()):Promise<string>{
  worker.child.ref();for(const stream of [worker.child.stdin,worker.child.stdout,worker.child.stderr])(stream as any)?.ref?.();
  if(this.#closed||worker.dead)return Promise.reject(Error('DEVELOPMENT_RPC_UNAVAILABLE'));
  return new Promise<string>((resolve,reject)=>{
   worker.pending={resolve,reject,name,queuedAt,startedAt,timer:setTimeout(()=>this.#destroy(worker),20000)};
   try{worker.child.stdin!.write(JSON.stringify(payload)+'\n');}catch{this.#destroy(worker);}
  });
 }
 async callProcedure(name:string,parameters:Record<string,SqlParameter>):Promise<string>{
  requireDummySso();if(!allowed.has(name))throw new Error('DEVELOPMENT_RPC_UNAVAILABLE');
  const queuedAt=performance.now();if(this.#warming){await this.#warming;requireDummySso();}
  const worker=await this.#acquire(),startedAt=performance.now();
  const output=await this.#request(worker,{procedure:name,parameters:Object.fromEntries(Object.entries(parameters).map(([key,p])=>[key,{type:p.type,value:Buffer.isBuffer(p.value)?p.value.toString('base64'):p.value}]))},name,queuedAt,startedAt);
  let result;try{result=JSON.parse(output);}catch{throw new Error('DEVELOPMENT_RPC_UNAVAILABLE');}
  if(result.bridgeError){if(process.env.NODE_ENV==='test')process.stderr.write('GP_RPC_FAILURE '+name+' SQL_'+Number(result.number)+' '+String(result.errorKind??'').replace(/[^A-Za-z.]/gu,'')+'\n');throw Object.assign(new Error('SQL_OPERATION_REJECTED'),{number:result.number});}
  // A notification failure cannot turn a committed write into an apparent failed operation.
  try{this.onSuccess?.(name,parameters,result);}catch{/* Reconnect/periodic refresh repairs missed invalidations. */}return output;
 }
 async close(){this.#closed=true;const retired=[...this.#workers].map(worker=>{if(worker.pending){this.#destroy(worker);return Promise.resolve();}return this.#retire(worker);});this.#wake(true);await Promise.all(retired);}
}
