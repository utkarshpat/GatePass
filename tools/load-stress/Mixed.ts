import {statistics,type Metric} from './Support.ts';

// One writer preserves ENTRY/EXIT order; independent readers keep real pressure
// on the same bounded RPC pool. Drain every request before inspecting the DB.
export async function mixedLoad(read:(index:number,reader:number)=>Promise<Metric>,write:(index:number)=>Promise<Metric>,writes=100,readers=11){
 if(!Number.isInteger(writes)||writes<1||writes>1000||!Number.isInteger(readers)||readers<1||readers>15)throw Error('INVALID_MIXED_LOAD');
 const started=performance.now(),deadline=started+120000,readMetrics:Metric[]=[],writeMetrics:Metric[]=[];
 let finished=false,next=0;
 const sample=async(task:()=>Promise<Metric>)=>{const at=performance.now();try{return await task();}catch{return{latencyMs:performance.now()-at,statusCode:599,success:false};}};
 const reading=Array.from({length:readers},async(_,reader)=>{while(!finished&&performance.now()<deadline&&next<100000){const index=next++;readMetrics.push(await sample(()=>read(index,reader)));}});
 try{for(let index=0;index<writes;index++){if(performance.now()>=deadline)break;const result=await sample(()=>write(index));writeMetrics.push(result);if(!result.success||result.statusCode!==200)break;}}
 finally{finished=true;await Promise.all(reading);}
 const durationMs=performance.now()-started;
 const summarize=(metrics:Metric[],concurrency:number)=>{const statusCodes:Record<string,number>={};for(const m of metrics)statusCodes[m.statusCode]=(statusCodes[m.statusCode]??0)+1;return{total:metrics.length,concurrency,durationMs,rps:metrics.length*1000/durationMs,latency:statistics(metrics.map(m=>m.latencyMs)),errors:metrics.filter(m=>!m.success).length,statusCodes};};
 return{durationMs,requestedWrites:writes,reads:summarize(readMetrics,readers),writes:summarize(writeMetrics,1)};
}
