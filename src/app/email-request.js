'use strict';
const $=id=>document.getElementById(id),host=location.pathname.startsWith('/approval/'),visit=location.pathname.split('/').filter(Boolean).at(-1)?.toLowerCase()??'';
const fragment=new URLSearchParams(location.hash.slice(1));
let bearer=host?null:fragment.get('link'),external=!host&&(history.state?.gatepassExternal===visit||(()=>{try{return sessionStorage.getItem('gp-ext-'+visit)==='1';}catch{return false;}})());
let current=null,busy=false,image=null,version=0,poll=null;
const keys=new Map();
// Raw proof is exchanged for a path-scoped HttpOnly cookie; history stores only a non-secret view hint.
if(!bearer&&location.hash)history.replaceState(history.state,'',location.pathname);
$('title').textContent=host?'Visit approval':'Request status';
function csrf(){const c=document.cookie.split('; ').find(x=>x.startsWith('gp-dev-csrf='));return c?c.slice('gp-dev-csrf='.length):'';}
async function api(path,body){const r=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf()},body:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw Object.assign(new Error(),{status:r.status});return value;}
function state(message){$('message').textContent=message;}
function error(e){state(e.status===401?'Sign in to continue.':e.status===403?'This request is unavailable or its link has expired.':e.status===409?'This request changed or was already decided. Refresh to check its status.':'Request unavailable. Please try again.');}
function clearMedia(){if(image)URL.revokeObjectURL(image);image=null;for(const id of ['card','photo']){$(id).hidden=true;$(id).removeAttribute('src');}}
function invalidate(){current=null;clearMedia();$('actions').hidden=$('download').hidden=true;}
function path(action){return '/api/email/'+(external?'external/'+visit:host?'host':'request')+'/'+action;}
function payload(){return external?{}:{visitRequestId:visit};}
function downloadable(v){return !host&&Date.parse(v.validUntilUtc)>Date.now()&&['PENDING','APPROVED'].includes(v.status)&&['PENDING','ACTIVE'].includes(v.passStatus);}
function render(v){
 current=v;$('login').hidden=true;$('request').hidden=false;$('fields').replaceChildren();
 for(const [label,value] of [['Name',v.personName],['Company',v.companyName],['Devices',v.deviceTypes?.length?v.deviceTypes.map(code=>({LAPTOP:'Laptop',TABLET:'Tablet / iPad',PEN_DRIVE:'Pen Drive',CAMERA:'Camera',OTHER:'Other'})[code]).join(', '):null],['Request',v.publicReference],['Office',v.locationName],['Project',v.projectName],['Host',v.hostName],['Purpose',v.reason],['Valid from',v.validFromUtc],['Valid until',v.validUntilUtc]]){
  if(!value)continue;const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=label.startsWith('Valid ')?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+' IST':value;$('fields').append(dt,dd);
 }
 const expired=Date.parse(v.validUntilUtc)<=Date.now();state(expired?'Expired':v.passStatus==='REVOKED'?'Revoked':({PENDING:'Approval pending',APPROVED:'Approved',DENIED:'Declined',CANCELLED:'Cancelled'}[v.status]??'Request unavailable'));$('actions').hidden=!host||!v.canDecide||expired;$('approve').disabled=$('reject').disabled=busy;$('download').hidden=!downloadable(v);
}
async function showPass(download,expected=version){
 if(!current||!downloadable(current))return;$('download').disabled=true;
 try{const r=await api(path('image'),payload());if(expected!==version||!current||!downloadable(current))return;
  if(r.mimeType!=='image/png'||typeof r.imageBase64!=='string'||r.imageBase64.length>7340032)throw new Error();
  const bytes=Uint8Array.from(atob(r.imageBase64),x=>x.charCodeAt(0));if(image)URL.revokeObjectURL(image);image=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));$('card').src=image;$('card').hidden=false;
  if(download){const a=document.createElement('a');a.href=image;a.download='GatePass-'+visit+'.png';a.click();}
 }catch(e){if(expected===version){clearMedia();if(download)error(e);}}finally{if(expected===version)$('download').disabled=false;}
}
async function load(){
 const expected=++version;clearTimeout(poll);invalidate();$('refresh').disabled=true;$('request').hidden=true;
 try{const v=await api(path('detail'),payload());if(expected!==version)return;if(typeof v.visitRequestId!=='string'||v.visitRequestId.toLowerCase()!==visit.toLowerCase())throw new Error();render(v);
  if(downloadable(v))void showPass(false,expected);
  if(host&&v.photoAvailable){try{const p=await api('/api/email/host/photo',{visitRequestId:visit});if(expected!==version)return;if(['image/png','image/jpeg','image/webp'].includes(p.mimeType)&&typeof p.imageBase64==='string'&&p.imageBase64.length<=7340032){$('photo').src='data:'+p.mimeType+';base64,'+p.imageBase64;$('photo').hidden=false;}}catch{/* Scoped details remain available without a photo. */}}
 }catch(e){if(expected!==version)return;invalidate();$('request').hidden=true;if([401,403].includes(e.status)&&!external){$('login').hidden=false;state(e.status===403?(host?'Sign in with the assigned host’s email.':'Sign in with the request owner’s email.'):'Sign in to continue.');}else{$('login').hidden=true;error(e);}}
 finally{if(expected===version){$('refresh').disabled=false;if(current&&['PENDING','ACTIVE'].includes(current.passStatus)&&Date.parse(current.validUntilUtc)>Date.now()){const remaining=Date.parse(current.validUntilUtc)-Date.now(),delay=current.status==='PENDING'?Math.min(30000,remaining):remaining;poll=setTimeout(()=>{if(!busy&&!document.hidden)void load();},Math.min(Math.max(1,delay),2147483000));}}}
}
async function refresh(){
 if(busy)return;
 if(bearer){$('refresh').disabled=true;try{const r=await api('/api/email/external/session',{link:bearer});if(r.visitRequestId?.toLowerCase()!==visit.toLowerCase())throw new Error();external=true;bearer=null;try{sessionStorage.setItem('gp-ext-'+visit,'1');}catch{}history.replaceState({gatepassExternal:visit},'',location.pathname);}catch(e){invalidate();$('request').hidden=$('login').hidden=true;error(e);$('refresh').disabled=false;return;}}
 await load();
}
$('refresh').addEventListener('click',()=>void refresh());
$('login').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;$('sign-in').disabled=true;try{await api('/api/dev/sso/login',{email:$('email').value.trim(),password:$('password').value});$('password').value='';await load();}catch(e){state(e.status===401?'Email or password is incorrect.':'Sign-in unavailable. Please try again.');}finally{busy=false;$('sign-in').disabled=$('approve').disabled=$('reject').disabled=false;}});
async function decide(decision){if(busy||!current?.canDecide)return;busy=true;$('approve').disabled=$('reject').disabled=$('refresh').disabled=true;const binding=current.snapshotHash+'|'+decision;if(!keys.has(binding))keys.set(binding,crypto.randomUUID());state('Saving…');try{await api('/api/email/host/decide',{visitRequestId:visit,clientKey:keys.get(binding),snapshotVersion:current.snapshotVersion,snapshotHash:current.snapshotHash,decision});await load();}catch(e){error(e);}finally{busy=false;$('approve').disabled=$('reject').disabled=$('refresh').disabled=false;}}
$('approve').addEventListener('click',()=>void decide('APPROVED'));$('reject').addEventListener('click',()=>void decide('DENIED'));
$('download').addEventListener('click',()=>void showPass(true));
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!busy)void refresh();});
window.addEventListener('pagehide',()=>{version++;clearTimeout(poll);invalidate();});
window.addEventListener('pageshow',e=>{if(e.persisted)void refresh();});
void refresh();
