import {request, type IncomingHttpHeaders, type ClientRequest, type IncomingMessage} from 'node:http';
import {createServer} from 'node:net';

export type Metric={latencyMs:number;statusCode:number;success:boolean};
export type Reply={status:number;headers:IncomingHttpHeaders;body:string;latencyMs:number};
export function statistics(values:number[]){
 if(!values.length)return{count:0,min:0,mean:0,p50:0,p95:0,p99:0,max:0};
 if(values.some(v=>!Number.isFinite(v)||v<0))throw Error('INVALID_METRIC');
 const sorted=[...values].sort((a,b)=>a-b),p=(q:number)=>sorted[Math.max(0,Math.ceil(q*sorted.length)-1)];
 return{count:values.length,min:sorted[0],mean:values.reduce((a,b)=>a+b,0)/values.length,p50:p(.5),p95:p(.95),p99:p(.99),max:sorted.at(-1)!};
}
export async function batch(task:(index:number)=>Promise<Metric>,total:number,concurrency:number){
 if(!Number.isInteger(total)||total<1||!Number.isInteger(concurrency)||concurrency<1||concurrency>total)throw Error('INVALID_BATCH');
 const metrics:Metric[]=[];let next=0;const started=performance.now();
 await Promise.all(Array.from({length:concurrency},async()=>{while(next<total){const index=next++,at=performance.now();try{metrics.push(await task(index));}catch{metrics.push({statusCode:599,success:false,latencyMs:performance.now()-at});}}}));
 const durationMs=performance.now()-started,statusCodes:Record<string,number>={};
 for(const m of metrics)statusCodes[m.statusCode]=(statusCodes[m.statusCode]??0)+1;
 return{total,concurrency,durationMs,rps:total*1000/durationMs,latency:statistics(metrics.map(m=>m.latencyMs)),errors:metrics.filter(m=>!m.success).length,statusCodes};
}
export function requireLoad(result:Awaited<ReturnType<typeof batch>>,maximumP95:number){
 if(result.errors!==0||result.statusCodes['200']!==result.total)throw Error('LOAD_UNEXPECTED_RESPONSE');
 if(result.latency.p95>maximumP95)throw Error('LOAD_P95_BUDGET_EXCEEDED');
}
export function requireRace(statuses:number[],entries:number,inside:number){
 if(statuses.length!==12||statuses.filter(s=>s===200).length!==1||statuses.filter(s=>s===409).length!==11||entries!==1||inside!==1)throw Error('RACE_INVARIANT_FAILED');
}
export function requireSse(statuses:number[],expected:number[]){if(JSON.stringify(statuses)!==JSON.stringify(expected))throw Error('SSE_CAPACITY_MISMATCH');}
export async function requireFreePort(port:number){
 await new Promise<void>((resolve,reject)=>{const server=createServer();server.once('error',()=>reject(Error('LOAD_PORT_IN_USE')));server.listen(port,'127.0.0.1',()=>server.close(error=>error?reject(error):resolve()));});
}
export function http(port:number,path:string,options:{headers?:Record<string,string>;body?:unknown;timeoutMs?:number;maximumBytes?:number}={}):Promise<Reply>{
 const started=performance.now();return new Promise((resolve,reject)=>{
  let ended=false;const body=options.body===undefined?null:typeof options.body==='string'?options.body:JSON.stringify(options.body);
  const finish=(error?:Error,value?:Reply)=>{if(ended)return;ended=true;clearTimeout(timer);if(error)reject(Object.assign(Error(error.message),{latencyMs:performance.now()-started}));else resolve(value!);};
  const req=request({hostname:'127.0.0.1',port,path,agent:false,method:body===null?'GET':'POST',headers:{Host:`localhost:${port}`,Origin:`http://localhost:${port}`,...(body===null?{}:{'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(body))}),...options.headers}},res=>{
   let size=0;const chunks:Buffer[]=[];
   res.on('data',chunk=>{size+=chunk.length;if(size>(options.maximumBytes??4*1024*1024)){finish(Error('LOAD_RESPONSE_TOO_LARGE'));res.destroy();req.destroy();}else chunks.push(chunk);});
   res.once('error',()=>finish(Error('LOAD_RESPONSE_ERROR')));res.once('aborted',()=>finish(Error('LOAD_RESPONSE_ABORTED')));
   res.once('end',()=>finish(undefined,{status:res.statusCode??0,headers:res.headers,body:Buffer.concat(chunks).toString('utf8'),latencyMs:performance.now()-started}));
  });
  const timer=setTimeout(()=>{finish(Error('LOAD_REQUEST_TIMEOUT'));req.destroy();},options.timeoutMs??15000);
  req.once('error',()=>finish(Error('LOAD_CONNECTION_ERROR')));if(body!==null)req.write(body);req.end();
 });
}
export async function openSse(port:number,headers:Record<string,string>,body:unknown,timeoutMs=10000):Promise<{status:number;close:()=>void}>{
 return new Promise((resolve,reject)=>{
  let response:IncomingMessage|undefined,settled=false;let req:ClientRequest;
  const close=()=>{clearTimeout(timer);response?.destroy();req?.destroy();};
  const finish=(error?:Error,status?:number)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){close();reject(error);}else resolve({status:status!,close});};
  req=request({hostname:'127.0.0.1',port,path:'/api/workspace/events',method:'POST',agent:false,headers:{Host:`localhost:${port}`,Origin:`http://localhost:${port}`,'Content-Type':'application/json',...headers}},res=>{
   response=res;const status=res.statusCode??0;if(status!==200){res.resume();res.once('end',()=>finish(undefined,status));return;}
   if(!String(res.headers['content-type']).startsWith('text/event-stream')){finish(Error('SSE_BAD_CONTENT_TYPE'));return;}
   let frame='';const read=(chunk:Buffer)=>{frame+=chunk.toString();if(frame.length>4096){finish(Error('SSE_OVERSIZED_FRAME'));return;}if(frame.includes('event: ready\ndata: {}\n\n')){res.removeListener('data',read);res.resume();finish(undefined,status);}};res.on('data',read);
   res.once('aborted',()=>finish(Error('SSE_ABORTED')));res.once('error',()=>finish(Error('SSE_READ_ERROR')));res.once('end',()=>finish(Error('SSE_ENDED_BEFORE_READY')));
  });
  const timer=setTimeout(()=>finish(Error('SSE_READY_TIMEOUT')),timeoutMs);req.once('error',()=>finish(Error('SSE_CONNECTION_ERROR')));req.end(JSON.stringify(body));
 });
}
