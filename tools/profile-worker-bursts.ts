import assert from 'node:assert/strict';
import {spawn,execFile,type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve} from 'node:path';
import {LocalDevelopmentApiClient} from '../src/development/LocalDevelopmentApiClient.ts';
import {resolvePowerShell} from '../src/runtime/PowerShellRuntime.mjs';
import type {SqlParameter} from '../src/transport/SqlProcedureClient.ts';
import {statistics} from './load-stress/Support.ts';
const exec=promisify(execFile),workers=4,idleMs=6500;
Object.assign(process.env,{NODE_ENV:'test',GATEPASS_SSO_MODE:'dummy',GATEPASS_DIRECTORY_MODE:'mock'});
const run=randomUUID(),folder=resolve('output/worker-bursts',run),secrets:Buffer[]=[],responseHashes=new Map<string,string>();
await mkdir(folder,{recursive:true});console.log('WORKER_BURST_RUN '+run);
const sourceHashes:Record<string,string>={};for(const path of ['tools/profile-worker-bursts.ts','src/development/LocalDevelopmentApiClient.ts','tools/GatePass.DevelopmentApiBridge.ps1','tools/GatePass.DevelopmentLeases.psm1','tests/helpers/DevelopmentLeaseFixture.ps1'])sourceHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
const report:any={status:'RUNNING',runId:run,startedAt:new Date().toISOString(),workers,idleMs,sourceHashes,measurements:[],cleanup:{},limitations:['Matched local SQL-RPC reads; not full HTTP latency or production p99.','Two four-request bursts per API/mode; report all observations rather than estimating a population p99.','Pool startup is measured separately; one serial read warms the SQL plan before bursts.','Helper memory is summed process working set/private bytes; SQL Server is excluded.','Idle legacy mode is the unchanged lazy CLI lifecycle; prewarmed mode is the new server lifecycle.']};
const fixture=async(action:string,actor?:string)=>JSON.parse((await exec(resolvePowerShell(),['-NoProfile','-File','tests/helpers/DevelopmentLeaseFixture.ps1','-RunId',run,'-Action',action,...(actor?['-Actor',actor]:[])],{timeout:120000,windowsHide:true})).stdout);
async function memory(children:ChildProcess[]){
 const ids=children.filter(c=>c.exitCode===null&&!c.killed).map(c=>c.pid!);if(!ids.length)return{count:0,workingSetBytes:0,privateBytes:0};
 const raw=(await exec(resolvePowerShell(),['-NoProfile','-Command',`@(Get-Process -Id ${ids.join(',')} -ErrorAction Stop | Select-Object Id,WorkingSet64,PrivateMemorySize64)|ConvertTo-Json -Compress`],{timeout:15000,windowsHide:true})).stdout;
 const value=JSON.parse(raw),rows=Array.isArray(value)?value:[value];return{count:rows.length,workingSetBytes:rows.reduce((n,r)=>n+r.WorkingSet64,0),privateBytes:rows.reduce((n,r)=>n+r.PrivateMemorySize64,0)};
}
try{
 const owned=await fixture('Create'),state=owned.state,auth:Record<string,Record<string,SqlParameter>>={};
 report.fixture={ownedRows:state.ownedRows,migrations:state.migrations};
 for(const actor of ['ADMIN','GUARD','RECEPTION']){const a=await fixture('Auth',actor),session=Buffer.from(a.sessionHex,'hex'),csrf=Buffer.from(a.csrfHex,'hex');secrets.push(session,csrf);auth[actor]={SessionHash:{type:'binary',value:session},CsrfHash:{type:'binary',value:csrf}};}
 const location={LocationId:{type:'int' as const,value:state.locationId}},duty={...location,DutyKind:{type:'text' as const,value:'PROJECT'},DutyId:{type:'bigint' as const,value:String(state.pair)}};
 const scenarios=[
  {name:'summary',actor:'ADMIN',procedure:'gp.GetOperationalSummaryRange',parameters:{...location,ProjectLocationId:duty.DutyId,FromDate:{type:'date',value:state.today},ToDate:{type:'date',value:state.today}},check:(r:any)=>assert(Number(r.visits.total)>=1000)},
  {name:'queue',actor:'GUARD',procedure:'gp.ReadGuardQueue',parameters:{...duty,Queue:{type:'text',value:'EXPECTED'},Search:{type:'text',value:''}},check:(r:any)=>{assert.equal(r.visitors.length,24);assert(r.total>=1000);}},
  {name:'actions',actor:'GUARD',procedure:'gp.ReadActionCentre',parameters:{...duty,Workspace:{type:'text',value:'GUARD'},Category:{type:'text',value:'PENDING'}},check:(r:any)=>{assert.equal(r.items.length,24);assert(r.counts.pending>=200);}},
  {name:'reception',actor:'RECEPTION',procedure:'gp.ReadReceptionQueue',parameters:{...location,LocalVisitDate:{type:'date',value:state.today},Status:{type:'text',value:'ALL'}},check:(r:any)=>{assert.equal(r.visits.length,50);assert(r.counts.total>=1000);}}
 ];
 for(const [index,scenario]of scenarios.entries())for(const mode of (index%2?['prewarmed','lazy']:['lazy','prewarmed'])){
  const children:ChildProcess[]=[],client=new LocalDevelopmentApiClient(()=>{const c=spawn(resolvePowerShell(),['-NoProfile','-File','tools/GatePass.DevelopmentApiBridge.ps1','-Persistent'],{windowsHide:true,stdio:['pipe','pipe','pipe']});children.push(c);return c;},workers);
  const row:any={name:scenario.name,mode,bursts:[]};console.log('BURST '+scenario.name+' '+mode);
  try{
   const started=performance.now();if(mode==='prewarmed')await client.warmUp();row.startupWarmMs=performance.now()-started;
   const read=async()=>{
    const at=performance.now(),value=JSON.parse(await client.callProcedure(scenario.procedure,{...auth[scenario.actor],...scenario.parameters} as Record<string,SqlParameter>));scenario.check(value);delete value.checkedAtUtc;
    const hash=createHash('sha256').update(JSON.stringify(value)).digest('hex'),previous=responseHashes.get(scenario.name);if(previous)assert.equal(hash,previous,'MATCHED_READ_CONTENT_CHANGED');else responseHashes.set(scenario.name,hash);row.responseHash=hash;
    return performance.now()-at;
   };
   row.serialWarmReadMs=await read();
   for(let round=0;round<2;round++){if(round)await delay(idleMs);const latencies=await Promise.all(Array.from({length:workers},()=>read()));row.bursts.push({round,latenciesMs:latencies,statistics:statistics(latencies)});}
   row.spawnedAfterBursts=children.length;await delay(idleMs);row.idleMemory=await memory(children);
   if(mode==='prewarmed'){assert.equal(row.spawnedAfterBursts,workers,'PREWARMED_POOL_RESTARTED');assert.equal(row.idleMemory.count,workers,'PREWARMED_IDLE_CAPACITY_LOST');}
  }finally{await client.close();assert(children.every(c=>c.exitCode!==null||c.killed),'OWNED_HELPER_NOT_CLOSED');}
  report.measurements.push(row);await writeFile(folder+'/report.json',JSON.stringify(report,null,2));
 }
 report.status='PASS';
}catch(error){report.status='FAIL';report.failure=error instanceof Error?error.message:'WORKER_BURST_FAILED';}
finally{for(const secret of secrets)secret.fill(0);try{report.cleanup.fixture=await fixture('Cleanup');}catch{report.cleanup.error='FIXTURE_CLEANUP_FAILED';report.status='FAIL';}report.finishedAt=new Date().toISOString();await writeFile(folder+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,runId:run,report:folder+'/report.json'}));}
if(report.status!=='PASS')process.exitCode=1;
