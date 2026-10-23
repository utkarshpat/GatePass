"use strict";
// Small SSE invalidations; every protected payload still uses the normal authorized API.
class LiveRefresh {
 constructor(refresh,ready,intervalMs=20000,scope=()=>null){
  this.refresh=refresh;this.ready=ready;this.scope=scope;this.intervalMs=intervalMs;
  this.running=false;this.closed=false;this.suspended=false;this.last=Date.now();this.dirty=false;
  this.stream=null;this.online=false;this.key=null;this.blocked=null;this.failures=0;this.nextConnect=0;
  this.wake=()=>{if(document.hidden)this.disconnect();clearTimeout(this.focusTimer);this.focusTimer=setTimeout(()=>{if(!document.hidden&&Date.now()-this.last>=2000){this.dirty=true;this.tick();}},300);};
  this.timer=setInterval(()=>this.tick(),1000);
  document.addEventListener('visibilitychange',this.wake);window.addEventListener('focus',this.wake);
  this.hide=()=>{this.suspended=true;clearInterval(this.timer);clearTimeout(this.focusTimer);this.disconnect();};
  this.show=event=>{if(event.persisted&&!this.closed){this.suspended=false;clearInterval(this.timer);this.timer=setInterval(()=>this.tick(),1000);this.wake();}};
  window.addEventListener('pagehide',this.hide);window.addEventListener('pageshow',this.show);
 }
 disconnect(){const stream=this.stream;this.stream=null;this.online=false;stream?.controller.abort();}
 tick(){
  if(this.closed||this.suspended||document.hidden){this.disconnect();return;}
  const scope=this.scope(),key=scope?JSON.stringify(scope):null;
  if(key!==this.key){this.disconnect();this.key=key;this.blocked=null;this.failures=0;this.nextConnect=0;}
  if(key&&!this.stream&&this.blocked!==key&&Date.now()>=this.nextConnect&&this.ready())void this.connect(key,scope);
  if(this.dirty&&Date.now()-this.last>=1000||Date.now()-this.last>=(this.online?60000:this.intervalMs))void this.run();
 }
 async connect(key,scope){
  const ticket={controller:new AbortController()};this.stream=ticket;
  let watchdog=setTimeout(()=>ticket.controller.abort(),10000),reader;
  try{
   const csrf=document.cookie.split('; ').find(c=>c.startsWith('gp-staff-csrf='))?.split('=')[1];
   const response=await fetch('/api/workspace/events',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf??''},body:JSON.stringify(scope),signal:ticket.controller.signal});
   if(this.stream!==ticket)return;
   if([401,403,404,405].includes(response.status)){this.blocked=key;throw Error('Stream unavailable for this scope');}
   if(response.status===429)this.failures=Math.max(this.failures,4);
   if(!response.ok||!response.headers.get('content-type')?.startsWith('text/event-stream')||!response.body)throw Error('Stream unavailable');
   reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
   while(this.stream===ticket){
    clearTimeout(watchdog);watchdog=setTimeout(()=>ticket.controller.abort(),45000);
    const part=await reader.read();if(part.done)break;
    if(this.stream!==ticket)return;
    buffer+=decoder.decode(part.value,{stream:true});if(buffer.length>4096)throw Error('Stream frame too large');
    let end;while((end=buffer.indexOf('\n\n'))>=0){
     const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);
     if(frame.startsWith('event: ready\n')){this.online=true;this.failures=0;this.dirty=true;}
     else if(frame.startsWith('event: invalidate\n'))this.dirty=true;
    }
   }
  }catch{/* Polling remains available; no write or paid-provider retry. */}
  finally{
   clearTimeout(watchdog);void reader?.cancel().catch(()=>{});ticket.controller.abort();
   if(this.stream===ticket){this.stream=null;this.online=false;this.failures++;this.nextConnect=Date.now()+Math.min(60000,5000*2**Math.min(this.failures-1,4))*(0.8+Math.random()*0.4);}
  }
 }
 async run(){
  if(this.closed||this.suspended||this.running||document.hidden||!this.ready())return;
  this.running=true;this.last=Date.now();this.dirty=false;
  try{await this.refresh();}catch{/* Existing views own their read/error state. */}finally{this.running=false;}
 }
 close(){if(this.closed)return;this.closed=true;this.hide();document.removeEventListener('visibilitychange',this.wake);window.removeEventListener('focus',this.wake);window.removeEventListener('pagehide',this.hide);window.removeEventListener('pageshow',this.show);}
}
function workspaceIdle(){return !document.querySelector('dialog[open]')&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);}
