import type {NotificationBatch} from './MailContracts.ts';

/** Configuration/startup failures belong to the caller. A running daemon recovers
 * from batch failures; claimed jobs remain fenced and SQL owns their recovery. */
export async function runNotificationWorker(worker:NotificationBatch,options:{
 once?:boolean;stopping:()=>boolean;onBatch:(results:unknown[])=>void;onRetry:()=>void;sleep?:(milliseconds:number)=>Promise<void>;
}){
 const sleep=options.sleep??(milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds)));
 let failures=0;
 while(!options.stopping()){
  let delay=10000;
  try{const results=await worker.runOnce();failures=0;options.onBatch(results);}
  catch(error){if(options.once)throw error;delay=Math.min(30000,1000*2**Math.min(failures++,5));options.onRetry();}
  if(options.once)return;
  for(let remaining=delay;remaining>0&&!options.stopping();remaining-=1000)await sleep(Math.min(remaining,1000));
 }
}
