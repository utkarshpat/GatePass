import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';

type Job={id:string;line:string;resolve:(value:Record<string,unknown>)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
type Worker={child:ChildProcessWithoutNullStreams;buffer:string;dead:boolean;job?:Job;idle?:ReturnType<typeof setTimeout>};
type Options={maximumWorkers?:number;maximumQueued?:number;idleMs?:number;requestMs?:number;queueMs?:number};
const unavailable=()=>new Error('DEVELOPMENT_SQL_UNAVAILABLE');
/** Local helper transport only. A failed/disconnected job is never replayed. */
export class JsonLineWorkerPool {
 #spawn:()=>ChildProcessWithoutNullStreams;#workers=new Set<Worker>();#queue:Job[]=[];#closed=false;
 #maximum:number;#queued:number;#idleMs:number;#requestMs:number;#queueMs:number;
 constructor(spawnWorker:()=>ChildProcessWithoutNullStreams,options:Options={}){
  this.#spawn=spawnWorker;this.#maximum=options.maximumWorkers??2;this.#queued=options.maximumQueued??32;
  this.#idleMs=options.idleMs??90000;this.#requestMs=options.requestMs??20000;this.#queueMs=options.queueMs??10000;
  if(!Number.isInteger(this.#maximum)||this.#maximum<1||this.#maximum>4||!Number.isInteger(this.#queued)||this.#queued<1||this.#queued>64||[this.#idleMs,this.#requestMs,this.#queueMs].some(n=>!Number.isInteger(n)||n<1||n>120000))throw new Error('INVALID_DEVELOPMENT_POOL_OPTIONS');
 }
 call(request:Record<string,unknown>):Promise<Record<string,unknown>>{
  if(this.#closed)return Promise.reject(unavailable());
  const id=randomUUID().replaceAll('-','');let line:string;
  try{line=JSON.stringify({id,request})+'\n';if(Buffer.byteLength(line)>8192)throw unavailable();}catch{return Promise.reject(unavailable());}
  if(this.#queue.length>=this.#queued)return Promise.reject(new Error('DEVELOPMENT_SQL_BUSY'));
  return new Promise((resolve,reject)=>{
   const job:Job={id,line,resolve,reject,timer:setTimeout(()=>{
    const index=this.#queue.indexOf(job);if(index>=0){this.#queue.splice(index,1);reject(new Error('DEVELOPMENT_SQL_BUSY'));}
   },this.#queueMs)};
   this.#queue.push(job);this.#pump();
  });
 }
 #refs(worker:Worker,active:boolean){
  if(active)worker.child.ref();else worker.child.unref();
  for(const stream of [worker.child.stdin,worker.child.stdout,worker.child.stderr]){
   const socket=stream as typeof stream&{ref?:()=>void;unref?:()=>void};if(active)socket.ref?.();else socket.unref?.();
  }
 }
 #start(){
  const child=this.#spawn(),worker:Worker={child,buffer:'',dead:false};this.#workers.add(worker);
  child.stdout.setEncoding('utf8');child.stdout.on('data',(part:string)=>{
   if(worker.dead)return;worker.buffer+=part;
   if(Buffer.byteLength(worker.buffer)>1048576){this.#drop(worker);return;}
   const end=worker.buffer.indexOf('\n');if(end<0)return;
   const line=worker.buffer.slice(0,end),remaining=worker.buffer.slice(end+1),job=worker.job;
   if(!job||remaining.trim()){this.#drop(worker);return;}
   let result:Record<string,unknown>;
   try{const packet=JSON.parse(line);
    if(!packet||Object.keys(packet).sort().join('|')!=='id|result'||packet.id!==job.id||!packet.result||typeof packet.result!=='object'||Array.isArray(packet.result))throw unavailable();
    result=packet.result;
   }catch{this.#drop(worker);return;}
   worker.buffer='';worker.job=undefined;clearTimeout(job.timer);
   worker.idle=setTimeout(()=>this.#drop(worker),this.#idleMs);worker.idle.unref();
   this.#refs(worker,false);job.resolve(result);this.#pump();
  });
  child.stderr.resume();child.stdin.on('error',()=>this.#drop(worker));child.on('error',()=>this.#drop(worker));child.on('close',()=>this.#drop(worker));
  return worker;
 }
 #pump(){
  if(this.#closed)return;
  while(this.#queue.length){
   let worker=[...this.#workers].find(w=>!w.job&&!w.dead);
   if(!worker&&this.#workers.size<this.#maximum){try{worker=this.#start();}catch{const job=this.#queue.shift()!;clearTimeout(job.timer);job.reject(unavailable());continue;}}
   if(!worker)return;
   clearTimeout(worker.idle);worker.idle=undefined;const job=this.#queue.shift()!;clearTimeout(job.timer);
   worker.job=job;this.#refs(worker,true);const selected=worker;
   job.timer=setTimeout(()=>this.#drop(selected),this.#requestMs);
   try{worker.child.stdin.write(job.line,error=>{if(error)this.#drop(selected);});}catch{this.#drop(worker);}
  }
 }
 #drop(worker:Worker){
  if(worker.dead)return;worker.dead=true;clearTimeout(worker.idle);
  const job=worker.job;worker.job=undefined;if(job){clearTimeout(job.timer);job.reject(unavailable());}
  worker.buffer='';this.#workers.delete(worker);worker.child.kill();this.#refs(worker,false);this.#pump();
 }
 close(){
  this.#closed=true;for(const job of this.#queue.splice(0)){clearTimeout(job.timer);job.reject(unavailable());}
  for(const worker of this.#workers)this.#drop(worker);
 }
}
