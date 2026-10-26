import assert from'node:assert/strict';
import{http,requireLoad,type Metric}from'./Support.ts';
import{mixedLoad}from'./Mixed.ts';

/** One stateful export lane + ten ordinary readers + one ordered writer.
 * A final 409 is expected only when it rejects the deliberately changing data.
 * Keep its real status; never relabel a rejected export as HTTP 200.
 */
export async function exportPressure(port:number,headers:Record<string,string>,scope:Record<string,unknown>,read:(index:number)=>Promise<Metric>,write:(index:number)=>Promise<Metric>,maximumP95:number){
 let active:{id:string;version:string;page:number;pages:number;total:number}|null=null;
 const responses:{stage:string;status:number;latencyMs:number}[]=[],stats={created:0,changed:0,completed:0,cancelled:0};
 const request=async(stage:string,body:Record<string,unknown>)=>{const r=await http(port,'/api/admin/register',{headers,body:{...scope,export:true,snapshot:true,...body}});responses.push({stage,status:r.status,latencyMs:r.latencyMs});return r;};
 const cancel=async()=>{if(!active)return;const r=await request('cancel',{snapshotId:active.id,cancelExport:true,page:1});assert.equal(r.status,200);assert.equal(JSON.parse(r.body).cancelled,true);stats.cancelled++;active=null;};
 const step=async()=>{
  const at=performance.now();
  if(!active){
   const r=await request('create',{page:1});assert.equal(r.status,200);const p=JSON.parse(r.body);
   assert.equal(p.pageSize,200);assert(p.total>=1000);assert.match(p.exportSnapshotId,/^[a-f0-9-]{36}$/u);assert.match(p.datasetVersion,/^[a-f0-9]{64}$/u);assert.equal(p.rows.length,200);
   active={id:p.exportSnapshotId,version:p.datasetVersion,page:2,pages:Math.ceil(p.total/200),total:p.total};stats.created++;
   return{latencyMs:performance.now()-at,statusCode:r.status,success:true};
  }
  if(active.page<=active.pages){
   const r=await request('page',{page:active.page,snapshotId:active.id});assert.equal(r.status,200);const p=JSON.parse(r.body);assert.equal(p.exportSnapshotId,active.id);assert.equal(p.datasetVersion,active.version);assert.equal(p.total,active.total);assert.equal(p.rows.length,Math.min(200,active.total-(active.page-1)*200));active.page++;
   return{latencyMs:performance.now()-at,statusCode:r.status,success:true};
  }
  const r=await request('finish',{page:1,snapshotId:active.id,finishExport:true});
  if(r.status===409){stats.changed++;await cancel();}else{assert.equal(r.status,200);const p=JSON.parse(r.body);assert.equal(p.exportValidated,true);assert.equal(p.datasetVersion,active.version);stats.completed++;active=null;}
  return{latencyMs:performance.now()-at,statusCode:r.status,success:true};
 };
 let result;
 try{result=await mixedLoad((index,lane)=>lane===0?step():read(index),write);}
 finally{await cancel();}
 requireLoad(result.writes,maximumP95);assert.equal(result.writes.total,100);assert.equal(result.reads.errors,0);assert.equal(result.reads.statusCodes['409']??0,stats.changed);assert.equal((result.reads.statusCodes['200']??0)+stats.changed,result.reads.total);assert(result.reads.latency.p95<=maximumP95);assert(stats.created>0);assert(stats.changed>0,'Concurrent edits must invalidate an export before download');
 return{...result,exports:{...stats,responses,notes:'Read metrics retain final HTTP 409 for expected content invalidations; cancellation replies are recorded separately.'}};
}
