import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalDevelopmentApiClient} from '../../src/development/LocalDevelopmentApiClient.ts';
import {resolvePowerShell} from '../../src/runtime/PowerShellRuntime.mjs';
const exec=promisify(execFile);
test('real development role leases reuse identities, isolate roles, survive worker crash and clean on EOF',async()=>{
 const previous={NODE_ENV:process.env.NODE_ENV,GATEPASS_SSO_MODE:process.env.GATEPASS_SSO_MODE,GATEPASS_DIRECTORY_MODE:process.env.GATEPASS_DIRECTORY_MODE};
 Object.assign(process.env,{NODE_ENV:'test',GATEPASS_SSO_MODE:'dummy',GATEPASS_DIRECTORY_MODE:'mock'});
 const run=randomUUID(),children:ChildProcess[]=[];
 const fixture=async(action:string,pid?:number)=>JSON.parse((await exec(resolvePowerShell(),['-NoProfile','-File','tests/helpers/DevelopmentLeaseFixture.ps1','-RunId',run,'-Action',action,...(pid?['-WorkerPid',String(pid)]:[])],{timeout:60000,windowsHide:true})).stdout);
 const client=new LocalDevelopmentApiClient(()=>{const child=spawn(resolvePowerShell(),['-NoProfile','-File','tools/GatePass.DevelopmentApiBridge.ps1','-Persistent'],{windowsHide:true,stdio:['pipe','pipe','pipe']});children.push(child);return child;});
 try{
  const owned=await fixture('Create'),auth=await fixture('Auth');
  const parameters={SessionHash:{type:'binary' as const,value:Buffer.from(auth.sessionHex,'hex')},CsrfHash:{type:'binary' as const,value:Buffer.from(auth.csrfHex,'hex')},LocationId:{type:'int' as const,value:1},ProjectLocationId:{type:'bigint' as const,value:String(owned.state.pair)},FromDate:{type:'date' as const,value:owned.state.today},ToDate:{type:'date' as const,value:owned.state.today}};
  let successes=0;client.onSuccess=()=>{successes++;};
  for(let n=0;n<4;n++){const r=JSON.parse(await client.callProcedure('gp.GetOperationalSummaryRange',parameters));assert(Number(r.visits.total)>=1000);}
  assert.equal(children.length,1);const originalPid=children[0].pid!;
  let state=await fixture('Inspect',originalPid);assert.equal(state.principals,1);assert.deepEqual(state.roles,['gp_api_runtime']);assert(state.singleRole&&state.tableReadDenied);
  await assert.rejects(client.callProcedure('gp.GetOwnDigitalIdCard',{SessionHash:parameters.SessionHash,CsrfHash:parameters.CsrfHash,VisitRequestId:{type:'guid',value:owned.state.movementVisits[0].visitRequestId}}));
  state=await fixture('Inspect',originalPid);assert.equal(state.principals,2);assert.deepEqual([...state.roles].sort(),['gp_api_runtime','gp_render_runtime']);assert(state.singleRole&&state.tableReadDenied);
  const exited=once(children[0],'close');children[0].kill();await exited;
  for(let n=0;n<15;n++){state=await fixture('Inspect',originalPid);if(state.sessions===0)break;await delay(100);}
  assert.equal(state.sessions,0,'crashed SQL sessions must release their leases before collection');
  await client.callProcedure('gp.GetOperationalSummaryRange',parameters);assert.equal(children.length,2);assert.equal(successes,5);
  assert.equal((await fixture('Inspect',originalPid)).principals,0,'next helper collects only lease-free tagged identities');
  const replacementPid=children[1].pid!;await client.close();assert.equal((await fixture('Inspect',replacementPid)).principals,0,'graceful EOF must drop cached SQL users');
 }finally{
  await client.close();for(const child of children)if(child.exitCode===null)child.kill();
  await fixture('Cleanup');for(const[k,v]of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;
 }
});

test('real server prewarm creates no SQL principal or business result and retains fresh actor validation',async()=>{
 const previous={NODE_ENV:process.env.NODE_ENV,GATEPASS_SSO_MODE:process.env.GATEPASS_SSO_MODE,GATEPASS_DIRECTORY_MODE:process.env.GATEPASS_DIRECTORY_MODE};Object.assign(process.env,{NODE_ENV:'test',GATEPASS_SSO_MODE:'dummy',GATEPASS_DIRECTORY_MODE:'mock'});
 const run=randomUUID(),children:ChildProcess[]=[],secrets:Buffer[]=[];
 const fixture=async(action:string,pid?:number)=>JSON.parse((await exec(resolvePowerShell(),['-NoProfile','-File','tests/helpers/DevelopmentLeaseFixture.ps1','-RunId',run,'-Action',action,...(pid?['-WorkerPid',String(pid)]:[])],{timeout:60000,windowsHide:true})).stdout);
 const client=new LocalDevelopmentApiClient(()=>{const child=spawn(resolvePowerShell(),['-NoProfile','-File','tools/GatePass.DevelopmentApiBridge.ps1','-Persistent'],{windowsHide:true,stdio:['pipe','pipe','pipe']});children.push(child);return child;},2);
 try{
  const owned=await fixture('Create'),auth=await fixture('Auth');let observed=0;client.onSuccess=()=>observed++;
  await client.warmUp();assert.equal(children.length,2);assert.equal(observed,0);
  for(const child of children)assert.equal((await fixture('Inspect',child.pid)).principals,0,'readiness must open no SQL role connection');
  const session=Buffer.from(auth.sessionHex,'hex'),csrf=Buffer.from(auth.csrfHex,'hex');secrets.push(session,csrf);
  const p={SessionHash:{type:'binary' as const,value:session},CsrfHash:{type:'binary' as const,value:csrf},LocationId:{type:'int' as const,value:1},ProjectLocationId:{type:'bigint' as const,value:String(owned.state.pair)},FromDate:{type:'date' as const,value:owned.state.today},ToDate:{type:'date' as const,value:owned.state.today}};
  const rows=await Promise.all(Array.from({length:4},()=>client.callProcedure('gp.GetOperationalSummaryRange',p)));assert(rows.every(raw=>Number(JSON.parse(raw).visits.total)>=1000));assert.equal(observed,4);assert.equal(children.length,2);
  await assert.rejects(client.callProcedure('gp.GetOperationalSummaryRange',{...p,SessionHash:{type:'binary',value:Buffer.alloc(32)}}),(e:any)=>e.number===52001);assert.equal(observed,4);
  for(const child of children){const state=await fixture('Inspect',child.pid);assert.equal(state.principals,1);assert(state.singleRole&&state.tableReadDenied);}
  await client.close();for(const child of children)assert.equal((await fixture('Inspect',child.pid)).principals,0,'EOF cleans all prewarmed role connections');
 }finally{await client.close();for(const child of children)if(child.exitCode===null)child.kill();for(const secret of secrets)secret.fill(0);await fixture('Cleanup');for(const[k,v]of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
