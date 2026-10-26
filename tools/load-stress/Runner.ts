import assert from 'node:assert/strict';
import {spawn,execFile,type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {cpus,totalmem,platform,release} from 'node:os';
import {resolvePowerShell} from '../../src/runtime/PowerShellRuntime.mjs';
import {batch,http,openSse,requireFreePort,requireLoad,requireRace,requireSse,type Reply} from './Support.ts';
import {mixedLoad} from './Mixed.ts';
import {exportPressure} from './ExportPressure.ts';
const exec=promisify(execFile),sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function config(){
 const args=process.argv.slice(2),values:Record<string,string>={};
 for(let i=0;i<args.length;i+=2){if(!['--workers','--port','--requests','--concurrency','--soak-seconds','--max-p95-ms','--max-rss-growth-mb'].includes(args[i])||!args[i+1])throw Error('INVALID_LOAD_OPTION');values[args[i]]=args[i+1];}
 const integer=(name:string,fallback:number,min:number,max:number)=>{const n=Number(values[name]??fallback);if(!Number.isInteger(n)||n<min||n>max)throw Error('INVALID_LOAD_OPTION_'+name);return n;};
 const concurrency=(values['--concurrency']??'1,4,8,12').split(',').map(Number),requests=integer('--requests',80,12,5000);
 if(concurrency.some(c=>!Number.isInteger(c)||c<1||c>16||c>requests)||new Set(concurrency).size!==concurrency.length)throw Error('INVALID_CONCURRENCY');
 return{workers:integer('--workers',4,1,8),port:integer('--port',18449,1024,65535),requests,concurrency,soakSeconds:integer('--soak-seconds',60,3,3600),maxP95Ms:integer('--max-p95-ms',5000,100,60000),maxRssGrowthMb:integer('--max-rss-growth-mb',128,1,2048)};
}
async function provenance(){
 const revision=(await exec('git',['rev-parse','HEAD'])).stdout.trim(),diff=(await exec('git',['diff','HEAD','--binary'],{maxBuffer:8*1024*1024})).stdout;
 const paths=['tools/run-load-stress-test.ts','tools/LoadStressFixture.ps1','tests/browser/WorkspaceQueueFixture.ps1','database/tests/003_transaction_cleanup.sql','tools/GatePass.DevelopmentApiBridge.ps1','tools/GatePass.DevelopmentLeases.psm1','tools/GatePass.LocalSql.psm1','database/tests/002_transaction_fixtures.sql','tools/start-dummy-sso.ts','src/development/LocalDevelopmentApiClient.ts','src/development/LoadDiagnostics.ts','database/migrations/100_scoped_read_sets_and_windows.sql','database/migrations/101_presence_projection_and_guard_photos.sql','database/migrations/102_static_register_paging_and_catalogue_search.sql','database/migrations/103_guard_thumbnail_content_versions.sql','database/migrations/104_bounded_consistent_export_snapshots.sql','database/migrations/105_ordered_snapshot_slices_and_completion_bounds.sql','database/migrations/106_owner_bound_export_snapshot_cancellation.sql','database/migrations/107_export_snapshot_storage_budget.sql','database/migrations/108_searchable_catalogue_local_project_freshness.sql','database/migrations/109_empty_workspace_queue_arrays.sql','src/visits/GuardDutyService.ts','src/visits/GuardThumbnailService.ts','src/visits/PhotoThumbnails.ts','src/development/GuardRoutes.ts','src/transport/SqlProcedureClient.ts','src/transport/SqlDateValidation.ts','src/administration/AdminWorkspaceService.ts','src/reception/ReceptionService.ts','src/operations/ActionCentreService.ts','src/administration/AdminRegister.ts','src/app/guard.js','src/app/reception.js','src/app/action-centre.js','src/app/admin.js','src/app/register-export-worker.js','src/app/live-refresh.js',...(await readdir('tools/load-stress')).filter(n=>n.endsWith('.ts')).map(n=>'tools/load-stress/'+n)],hashes:Record<string,string>={};
 for(const p of paths)hashes[p]=createHash('sha256').update(await readFile(p)).digest('hex');
 return{revision,trackedDiffSha256:createHash('sha256').update(diff).digest('hex'),sourceHashes:hashes,status:(await exec('git',['status','--porcelain'])).stdout.split(/\r?\n/u).filter(Boolean),node:process.version,platform:platform(),os:release(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,memoryBytes:totalmem()};
}
function json(reply:Reply){assert.equal(reply.status,200,'HTTP_RESPONSE_NOT_OK');return JSON.parse(reply.body);}
export async function run(){
 const options=config(),runId=randomUUID(),directory=resolve('output/load-stress',runId);
 await mkdir(directory,{recursive:true});
 console.log('LOAD_RUN '+runId+' '+directory);
 const report:any={schemaVersion:2,runId,startedAt:new Date().toISOString(),options,provenance:await provenance(),status:'RUNNING',benchmarks:[],checks:[],budgetViolations:[],cleanup:{attempted:false},limitations:['Local dummy host and PowerShell SQL bridge; not production capacity.','Ordinary HTTP uses an owned socket per request, closed afterwards; idle load-generator sockets cannot consume the SSE test capacity.','Latency budget is an explicit local test guard, not an approved business SLO.','Memory and CPU samples cover the API Node child; PowerShell workers and SQL Server are separate processes.','A short soak cannot establish absence of memory leaks.','RPC stage latency summaries use the latest 10,000 valid samples per metric; counts and errors cover the full reset window. HTTP benchmark percentiles use all responses in each batch.','Percentiles with fewer than 100 samples are descriptive; p99 needs a larger run.']};
 let child:ChildProcess|undefined,fixtureAttempted=false,childExit=false,stopping=false,serverLog='';
 const abort=()=>{stopping=true;};process.once('SIGINT',abort);process.once('SIGTERM',abort);
 const phase=async(name:string,work:()=>Promise<unknown>,collectLatencyFailure=false)=>{console.log('RUN '+name);const at=performance.now();try{const result=await work();report.checks.push({name,status:'PASS',durationMs:performance.now()-at});return result;}catch(error){report.checks.push({name,status:'FAIL',durationMs:performance.now()-at});if(collectLatencyFailure&&error instanceof Error&&error.message==='LOAD_P95_BUDGET_EXCEEDED'){const b=report.benchmarks.at(-1);report.budgetViolations.push({name,p95Ms:b.latency.p95,maximumP95Ms:options.maxP95Ms});console.error('FAIL '+name+' LOAD_P95_BUDGET_EXCEEDED');return;}throw error;}};
 const fixture=async(action:string)=>{try{return JSON.parse((await exec(resolvePowerShell(),['-NoProfile','-File','tools/LoadStressFixture.ps1','-RunId',runId,'-Action',action],{timeout:120000,maxBuffer:2*1024*1024,windowsHide:true})).stdout);}catch(error){serverLog=(serverLog+'\nFixture '+action+'\n'+String((error as any).stderr??'')).slice(-65536);throw error;}};
 const snapshot=(reset=false,gc=false)=>new Promise<any>((resolve,reject)=>{
  if(!child?.connected){reject(Error('DIAGNOSTIC_CHILD_UNAVAILABLE'));return;}const id=randomUUID(),timer=setTimeout(()=>{child?.removeListener('message',receive);reject(Error('DIAGNOSTIC_TIMEOUT'));},5000);
  const receive=(message:any)=>{if(message?.type!=='gatepass-load-snapshot'||message.id!==id||message.runId!==runId)return;clearTimeout(timer);child?.removeListener('message',receive);resolve(message);};
  child.on('message',receive);child.send({type:'gatepass-load-snapshot',id,reset,gc});
 });
 try{
  await requireFreePort(options.port);fixtureAttempted=true;
  const created=await phase('owned mixed-status fixture',()=>fixture('Create')) as any,f=created.fixture,state=created.state;
  assert.equal(state.ownedRows,1000);assert.equal(state.ownedPending,200);assert.equal(state.ownedApproved,800);
  report.fixture={ownedRows:state.ownedRows,pending:state.ownedPending,approved:state.ownedApproved,databaseVisitRows:state.databaseVisitRows,officeVisitRows:state.officeVisitRows,locationId:state.locationId,projectLocationId:String(state.pair),today:state.today,sqlVersion:state.sqlVersion,sqlEdition:state.sqlEdition,migrations:state.migrations,scope:'one invocation-owned project; background records may exist in other scopes and are not modified'};
  child=spawn(process.execPath,['--expose-gc','tools/start-dummy-sso.ts'],{cwd:process.cwd(),windowsHide:true,env:{...process.env,NODE_ENV:'test',GATEPASS_SSO_MODE:'dummy',GATEPASS_DIRECTORY_MODE:'mock',GATEPASS_DUMMY_PORT:String(options.port),GATEPASS_DEV_RPC_WORKERS:String(options.workers),GATEPASS_SHARP_PATH:process.env.GATEPASS_SHARP_PATH??join(process.cwd(),'node_modules/sharp'),GATEPASS_PWSH_PATH:resolvePowerShell(),GATEPASS_LOAD_DIAGNOSTICS:'1',GATEPASS_LOAD_RUN_ID:runId},stdio:['ignore','pipe','pipe','ipc']});
  child.once('exit',()=>{childExit=true;});child.on('error',()=>{childExit=true;serverLog=(serverLog+'\nOWNED_CHILD_PROCESS_ERROR').slice(-65536);});for(const stream of [child.stdout,child.stderr])stream?.on('data',part=>{serverLog=(serverLog+part.toString()).slice(-65536);});
  await phase('owned child readiness',()=>new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>done(Error('OWNED_CHILD_READINESS_TIMEOUT')),30000),receive=(m:any)=>{if(m?.type==='gatepass-load-ready'&&m.runId===runId&&m.pid===child!.pid)done();},failed=()=>done(Error('OWNED_CHILD_STARTUP_FAILED'));
   function done(error?:Error){clearTimeout(timer);child!.removeListener('message',receive);child!.removeListener('exit',failed);child!.removeListener('error',failed);error?reject(error):resolve();}child!.on('message',receive);child!.once('exit',failed);child!.once('error',failed);
  }));
  const login=async(login:string)=>{const reply=await http(options.port,'/api/staff/login',{body:{login,password:'Sopra@123'}});json(reply);const cookie=(reply.headers['set-cookie']??[]).map(c=>c.split(';')[0]).join('; '),csrf=cookie.split('; ').find(c=>c.startsWith('gp-staff-csrf='))?.split('=')[1];assert(csrf);return{Cookie:cookie,'X-CSRF-Token':csrf};};
  const admin=await login(f.adminLogin),guard=await login(f.guardLogin),reception=await login(f.receptionLogin),scope={locationId:state.locationId,dutyKind:'PROJECT',dutyId:String(state.pair)},from=new Date(Date.parse(state.today+'T00:00:00Z')-30*86400000).toISOString().slice(0,10);
  const scenarios=[
   {name:'summary',path:'/api/admin/summary-range',headers:admin,body:{locationId:state.locationId,projectLocationId:String(state.pair),from,to:state.today},check:(r:any)=>{assert.equal(r.days.length,31);assert(Number(r.visits.total)>=1000);}},
   {name:'queue',path:'/api/guard/queue',headers:guard,body:{...scope,queue:'EXPECTED',search:''},check:(r:any)=>{assert(r.visitors.length>0&&r.visitors.length<=24);assert(r.total>=1000);}},
   {name:'actions',path:'/api/operations/actions',headers:guard,body:{workspace:'GUARD',...scope,category:'PENDING'},check:(r:any)=>{assert(r.counts.pending>=200);assert.equal(r.items.length,24);}},
   {name:'reception',path:'/api/reception/queue',headers:reception,body:{locationId:state.locationId,visitDate:state.today,status:'ALL'},check:(r:any)=>{assert.equal(r.visits.length,50);assert(r.counts.total>=1000);assert(r.counts.pending>=200);}},
  ];
  const send=async(sc:typeof scenarios[number])=>{if(stopping)throw Error('LOAD_INTERRUPTED');const r=await http(options.port,sc.path,{headers:sc.headers,body:sc.body});if(r.status===200)sc.check(json(r));return{latencyMs:r.latencyMs,statusCode:r.status,success:r.status===200};};
  await phase('warm-up and payload correctness',async()=>{for(const sc of scenarios)for(let n=0;n<5;n++)assert((await send(sc)).success);});
  report.memoryBaseline=await snapshot(true,true);
  for(const sc of scenarios)for(const concurrency of options.concurrency)await phase(sc.name+' concurrency '+concurrency,async()=>{await fixture('Refresh');await snapshot(true);const result=await batch(()=>send(sc),options.requests,concurrency),diagnostics=await snapshot();report.benchmarks.push({name:sc.name,...result,diagnostics});console.log(JSON.stringify({scenario:sc.name,concurrency,rps:result.rps,p95Ms:result.latency.p95,errors:result.errors}));requireLoad(result,options.maxP95Ms);},true);
  await fixture('Refresh');
  report.directSql=await phase('same RPCs through a reused execute-only SQL connection',()=>fixture('Direct'));
  for(const mixed of [false,true])await phase(mixed?'mixed employee credential race':'same visitor credential race',async()=>{
   await fixture('Refresh');
   await snapshot(true);
   const before=await fixture('Inspect'),visits=mixed?before.movementVisits.filter((v:any)=>['TEMP_ID','EMPLOYEE_PROJECT'].includes(v.requestType)):before.movementVisits.filter((v:any)=>v.requestType==='EXTERNAL');assert.equal(visits.length,mixed?2:1);
   const counters=(rows:any[])=>({entries:rows.reduce((n,v)=>n+v.entries+v.projectEntries,0),inside:rows.reduce((n,v)=>n+Number(v.isInside)+v.projectInside,0)}),initial=counters(visits);assert.equal(initial.inside,0);
   const races=await Promise.all(Array.from({length:12},async(_,i)=>{const v=visits[i%visits.length];return http(options.port,'/api/guard/movement',{headers:guard,body:{...scope,visitRequestId:v.visitRequestId,accessPassId:v.accessPassId,clientKey:randomUUID(),eventType:'ENTRY',entryMethod:'MANUAL'}});}));
   const after=await fixture('Inspect'),current=counters(after.movementVisits.filter((v:any)=>visits.some((x:any)=>x.visitRequestId===v.visitRequestId))),statuses=races.map(r=>r.status);
   report[mixed?'mixedRace':'visitorRace']={statuses,committedEntries:current.entries-initial.entries,insideAfterRace:current.inside,directoryAgeSeconds:before.directoryAgeSeconds,diagnostics:await snapshot(true)};
   requireRace(statuses,current.entries-initial.entries,current.inside);
   const winner=json(races.find(r=>r.status===200)!),entered=visits.find((v:any)=>v.visitRequestId.toLowerCase()===winner.visitRequestId.toLowerCase());assert(entered);
   json(await http(options.port,'/api/guard/movement',{headers:guard,body:{...scope,visitRequestId:entered.visitRequestId,accessPassId:entered.accessPassId,clientKey:randomUUID(),eventType:'EXIT',entryMethod:'MANUAL'}}));
   const final=await fixture('Inspect');assert.equal(counters(final.movementVisits.filter((v:any)=>visits.some((x:any)=>x.visitRequestId===v.visitRequestId))).inside,0);
   report[mixed?'mixedRace':'visitorRace'].remainingInside=0;
  });
  await phase('movement writes under eleven concurrent authenticated readers',async()=>{
   await fixture('Refresh');
   const before=await fixture('Inspect'),visit=before.movementVisits.find((v:any)=>v.requestType==='EXTERNAL');assert(visit);assert.equal(Number(visit.isInside),0);
   const queueTotal=json(await http(options.port,scenarios[1].path,{headers:guard,body:scenarios[1].body})).total;
   await snapshot(true);
   const result=await mixedLoad(async index=>{
    const sc=scenarios[index%scenarios.length],r=await http(options.port,sc.path,{headers:sc.headers,body:sc.body});
    if(r.status===200){const value=json(r);if(sc.name==='queue'){assert.equal(value.visitors.length,24);assert(value.total===queueTotal||value.total===queueTotal-1);}else sc.check(value);}
    return{latencyMs:r.latencyMs,statusCode:r.status,success:r.status===200};
   },async index=>{
    const eventType=index%2===0?'ENTRY':'EXIT',r=await http(options.port,'/api/guard/movement',{headers:guard,body:{...scope,visitRequestId:visit.visitRequestId,accessPassId:visit.accessPassId,clientKey:randomUUID(),eventType,entryMethod:'MANUAL'}});
    if(r.status===200){const value=json(r);assert.equal(value.eventType,eventType);assert.equal(value.isInside,eventType==='ENTRY');}
    return{latencyMs:r.latencyMs,statusCode:r.status,success:r.status===200};
   });
   report.mixedLoad={...result,diagnostics:await snapshot(true)};
   requireLoad(result.reads,options.maxP95Ms);requireLoad(result.writes,options.maxP95Ms);assert.equal(result.writes.total,100);assert(result.reads.total>=11);
   const after=await fixture('Inspect'),current=after.movementVisits.find((v:any)=>v.visitRequestId===visit.visitRequestId);assert(current);assert.equal(current.entries-visit.entries,50);assert.equal(Number(current.isInside),0);
   report.mixedLoad.committedEntries=50;report.mixedLoad.remainingInside=0;
   console.log(JSON.stringify({scenario:'mixed movement writes',readClients:11,readRequests:result.reads.total,writeRequests:result.writes.total,readP95Ms:result.reads.latency.p95,writeP95Ms:result.writes.latency.p95}));
  });
  await phase('snapshot exports under concurrent reads and movement writes',async()=>{
   await fixture('Refresh');await fixture('ExportAccess');const before=await fixture('Inspect'),visit=before.movementVisits.find((v:any)=>v.requestType==='EXTERNAL');assert(visit);assert.equal(Number(visit.isInside),0);await snapshot(true);
   const result=await exportPressure(options.port,admin,{locationId:state.locationId,projectLocationId:String(state.pair),from:state.today,to:state.today},index=>send(scenarios[index%scenarios.length]),async index=>{
    const eventType=index%2===0?'ENTRY':'EXIT',r=await http(options.port,'/api/guard/movement',{headers:guard,body:{...scope,visitRequestId:visit.visitRequestId,accessPassId:visit.accessPassId,clientKey:randomUUID(),eventType,entryMethod:'MANUAL'}});
    if(r.status===200){const value=json(r);assert.equal(value.eventType,eventType);assert.equal(value.isInside,eventType==='ENTRY');}return{latencyMs:r.latencyMs,statusCode:r.status,success:r.status===200};
   },options.maxP95Ms);
   report.exportPressure={...result,diagnostics:await snapshot(true)};const after=await fixture('Inspect'),current=after.movementVisits.find((v:any)=>v.visitRequestId===visit.visitRequestId);assert(current);assert.equal(current.entries-visit.entries,50);assert.equal(Number(current.isInside),0);
   report.exportPressure.committedEntries=50;report.exportPressure.remainingInside=0;
   console.log(JSON.stringify({scenario:'export pressure',writeP95Ms:result.writes.latency.p95,exportsCreated:result.exports.created,expectedInvalidations:result.exports.changed,unexpectedErrors:result.reads.errors+result.writes.errors}));
  });
  await phase('SSE per-session and global limits',async()=>{
   const attempt=async(headers:Record<string,string>[],expected:number[])=>{
    const clients:Awaited<ReturnType<typeof openSse>>[]=[];let failure:unknown;
    try{for(const h of headers)clients.push(await openSse(options.port,h,{workspace:h===guard?'GUARD':h===admin?'ADMIN':'RECEPTION',locationId:state.locationId}));requireSse(clients.map(c=>c.status),expected);}catch(error){failure=error;}finally{for(const c of clients)c.close();}
    const deadline=Date.now()+5000;while((await snapshot()).streams!==0){if(Date.now()>deadline)throw Error('SSE_CLEANUP_FAILED');await sleep(50);}if(failure)throw failure;return clients.map(c=>c.status);
   };
   report.sse={thirdSessionControl:await attempt([reception],[200]),perSession:await attempt([guard,guard,guard],[200,200,429]),global:await attempt([guard,guard,admin,admin,reception,reception,reception,reception],[200,200,200,200,429,429,429,429]),globalProbe:'third independently authorized session has unused per-session capacity'};
  });
  await phase('malformed and actual oversized request rejection',async()=>{
   const tests=[{name:'malformed JSON',body:'{"bad":',status:400},{name:'wrong type',body:JSON.stringify({...scenarios[0].body,locationId:'DROP TABLE'}),status:400},{name:'over 64 KiB',body:JSON.stringify({...scenarios[0].body,huge:'X'.repeat(70000)}),status:413},{name:'own prototype key',body:JSON.stringify(scenarios[0].body).slice(0,-1)+',"__proto__":{"admin":true}}',status:400},{name:'negative office',body:JSON.stringify({...scenarios[0].body,locationId:-1}),status:400},{name:'extra expression',body:JSON.stringify({...scenarios[0].body,sort:'name; EXEC sp_help;'}),status:400}];
   report.rejections=[];for(const test of tests){const reply=await http(options.port,scenarios[0].path,{headers:admin,body:test.body});report.rejections.push({name:test.name,bytes:Buffer.byteLength(test.body),status:reply.status});assert.equal(reply.status,test.status,test.name);}
   assert((await send(scenarios[1])).success);assert.equal(({} as any).admin,undefined);
  });
  await phase('authenticated soak and server memory trend',async()=>{
   await fixture('Refresh');
   report.memorySamples=[await snapshot(true,true)];report.soak=[];
   for(let window=0;window<3;window++){
    const until=performance.now()+options.soakSeconds*1000/3;let batches=0,requests=0;
    while(performance.now()<until){const sc=scenarios[batches++%scenarios.length],result=await batch(()=>send(sc),12,4);requests+=result.total;requireLoad(result,options.maxP95Ms);}
    report.soak.push({window,requests});report.memorySamples.push(await snapshot(true,true));
   }
   const samples=report.memorySamples,rssGrowth=(samples.at(-1).memory.rss-samples[0].memory.rss)/1024**2;
   report.memoryObservation={serverPid:child!.pid,postGcSamples:samples.length,rssGrowthMb:rssGrowth,maximumRssGrowthMb:options.maxRssGrowthMb,leakConclusion:'not established by a short soak'};assert(rssGrowth<=options.maxRssGrowthMb,'SERVER_RSS_GROWTH_BUDGET_EXCEEDED');
  });
  const allDiagnostics=[...report.benchmarks.map((b:any)=>b.diagnostics),report.visitorRace.diagnostics,report.mixedRace.diagnostics,report.mixedLoad.diagnostics,report.exportPressure.diagnostics,...report.memorySamples];
  const deadlocks=allDiagnostics.reduce((n:number,s:any)=>n+s.rpc.reduce((a:number,r:any)=>a+(r.errors['1205']??0),0),0);
  report.deadlocks={observedSql1205:deadlocks,scope:'instrumented business RPCs in this owned server only'};assert.equal(deadlocks,0,'SQL_DEADLOCK_OBSERVED');report.status=report.budgetViolations.length?'FAIL':'PASS';if(report.budgetViolations.length)report.failure='LOAD_P95_BUDGET_EXCEEDED';
 }catch(error){report.status='FAIL';report.failure=error instanceof Error?error.message.slice(0,300):'LOAD_FAILED';console.error('FAIL '+report.failure);}
 finally{
  report.cleanup.attempted=true;const errors:string[]=[];
  if(child&&!childExit)try{child.send({type:'gatepass-load-stop'});const deadline=Date.now()+10000;while(!childExit&&Date.now()<deadline)await sleep(50);if(!childExit){child.kill();errors.push('SERVER_REQUIRED_FORCED_TERMINATION');}}catch{child.kill();errors.push('SERVER_STOP_FAILED');}
  if(fixtureAttempted)try{report.cleanup.fixture=await fixture('Cleanup');}catch{errors.push('FIXTURE_CLEANUP_FAILED');}
  report.cleanup.errors=errors;if(errors.length)report.status='FAIL';report.finishedAt=new Date().toISOString();process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);
  await writeFile(join(directory,'server.log'),serverLog);await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));
  const rows=report.benchmarks.map((b:any)=>`| ${b.name} | ${b.concurrency} | ${b.total} | ${b.rps.toFixed(2)} | ${b.latency.p50.toFixed(1)} | ${b.latency.p95.toFixed(1)} | ${b.errors} |`).join('\n');
  await writeFile(join(directory,'report.md'),`# Local load run ${runId}\n\nStatus: ${report.status}\n\nCommit: ${report.provenance.revision}; exact source hashes and dirty diff fingerprint are in report.json.\n\n| Scenario | Concurrency | Requests | RPS | p50 ms | p95 ms | Errors |\n|---|---:|---:|---:|---:|---:|---:|\n${rows}\n\n${report.limitations.join('\n\n')}\n\nFailure: ${report.failure??'none'}. Cleanup errors: ${errors.join(', ')||'none'}.\n`);
  console.log(JSON.stringify({status:report.status,runId,report:join(directory,'report.json'),cleanupErrors:errors}));
 }
 if(report.status!=='PASS')throw Error('LOAD_RUN_FAILED');return report;
}
