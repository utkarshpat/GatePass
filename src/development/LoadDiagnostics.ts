import {monitorEventLoopDelay} from 'node:perf_hooks';

export type RpcTiming={procedure:string;queueMs:number;rpcMs:number;sqlError?:number;bridge?:Record<string,number>};
/** Opt-in test child IPC only. Latencies use the latest 10k samples per metric;
 * counts/errors cover the full reset window. No request/credential values. */
export class LoadDiagnostics{
 #rows=new Map<string,{count:number;errors:Record<string,number>;values:Record<string,number[]>;next:Record<string,number>}>();
 #loop=monitorEventLoopDelay({resolution:20});#cpu=process.cpuUsage();#at=performance.now();
 constructor(){this.#loop.enable();}
 record(row:RpcTiming){
  if(!/^gp\.[A-Za-z0-9]+$/u.test(row.procedure)||this.#rows.size>=100&&!this.#rows.has(row.procedure))return;
  let record=this.#rows.get(row.procedure);if(!record){record={count:0,errors:{},values:{},next:{}};this.#rows.set(row.procedure,record);}record.count++;
  if(row.sqlError)record.errors[row.sqlError]=(record.errors[row.sqlError]??0)+1;
  for(const[key,value]of Object.entries({queueMs:row.queueMs,rpcMs:row.rpcMs,...row.bridge})){
   if(!['queueMs','rpcMs','connectMs','setupMs','executeMs','cleanupMs','totalMs'].includes(key)||!Number.isFinite(value)||value<0||value>120000)continue;
   const values=record.values[key]??=[];const next=record.next[key]??0;
   if(values.length<10000)values.push(value);else values[next%10000]=value;
   record.next[key]=(next+1)%10000;
  }
 }
 snapshot(reset=false){
  const summary=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return{samples:sorted.length,meanMs:values.reduce((a,b)=>a+b,0)/values.length,p50Ms:sorted[Math.max(0,Math.ceil(sorted.length*.5)-1)],p95Ms:sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]};};
  const cpu=process.cpuUsage(this.#cpu),result={pid:process.pid,memory:process.memoryUsage(),cpuMicros:cpu,elapsedMs:performance.now()-this.#at,eventLoopP95Ms:this.#loop.percentile(95)/1e6,latencySamplePolicy:{kind:'rolling',maximumSamplesPerMetric:10000},rpc:[...this.#rows].map(([procedure,row])=>({procedure,count:row.count,errors:row.errors,timings:Object.fromEntries(Object.entries(row.values).map(([k,v])=>[k,summary(v)]))}))};
  if(reset){this.#rows.clear();this.#cpu=process.cpuUsage();this.#at=performance.now();this.#loop.reset();}return result;
 }
 close(){this.#loop.disable();}
}
