"use strict";
// Near-real-time reads only: no background writes, hidden-tab work or overlapping runs.
class LiveRefresh {
 constructor(refresh,ready,intervalMs=20000){
  this.refresh=refresh;this.ready=ready;this.running=false;this.closed=false;this.suspended=false;this.last=0;
  this.wake=()=>{clearTimeout(this.focusTimer);this.focusTimer=setTimeout(()=>{if(!document.hidden&&Date.now()-this.last>=2000)void this.run();},300);};
  this.timer=setInterval(()=>void this.run(),intervalMs);
  document.addEventListener('visibilitychange',this.wake);window.addEventListener('focus',this.wake);
  this.hide=()=>{this.suspended=true;clearInterval(this.timer);clearTimeout(this.focusTimer);};
  this.show=event=>{if(event.persisted&&!this.closed){this.suspended=false;clearInterval(this.timer);this.timer=setInterval(()=>void this.run(),intervalMs);this.wake();}};
  window.addEventListener('pagehide',this.hide);window.addEventListener('pageshow',this.show);
 }
 async run(){
  if(this.closed||this.suspended||this.running||document.hidden||!this.ready())return;
  this.running=true;this.last=Date.now();
  try{await this.refresh();}catch{/* Existing views own their read/error state. */}finally{this.running=false;}
 }
 close(){if(this.closed)return;this.closed=true;this.hide();document.removeEventListener('visibilitychange',this.wake);window.removeEventListener('focus',this.wake);window.removeEventListener('pagehide',this.hide);window.removeEventListener('pageshow',this.show);}
}
function workspaceIdle(){return !document.querySelector('dialog[open]')&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);}
