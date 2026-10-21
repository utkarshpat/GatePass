'use strict';
const $=id=>document.getElementById(id),toasts=new ToastNotifications();
const state={context:null,location:null,rows:[],cursor:null,status:'ALL',listVersion:0,detailVersion:0,selected:null,detail:null,listBusy:false,listComplete:false,listFailed:false,printBusy:false,photoUrl:null,cardUrl:null,pendingPrint:new Map()};
let searchTimer;
const cookie=name=>document.cookie.split('; ').find(value=>value.startsWith(name+'='))?.split('=')[1];
async function api(action,body={}){
 const headers={'Content-Type':'application/json'},csrf=cookie('gp-staff-csrf')??cookie('gp-reception-csrf');if(csrf)headers['X-CSRF-Token']=csrf;
 let response;try{response=await fetch('/api/reception/'+action,{method:'POST',credentials:'same-origin',headers,body:JSON.stringify(body)});}catch{throw new Error('Connection lost. Please retry.');}
 if(!response.ok){const messages={400:'Check the details.',401:'Sign in again to continue.',403:'Access unavailable for this office or pass.',409:'Pass or print state changed. Refresh and try again.',429:'Too many requests. Please wait.'};const error=Object.assign(new Error(messages[response.status]??'Unable to complete the request. Please retry.'),{status:response.status});if(response.status===401)showLogin();throw error;}return response.json();
}
function badge(status){const item=document.createElement('span');item.className='status-pill';item.dataset.status=status;item.textContent=status.charAt(0)+status.slice(1).toLowerCase();return item;}
function effective(row){return row.status==='CANCELLED'?'CANCELLED':row.passStatus==='REVOKED'?'REVOKED':Date.parse(row.validUntilUtc)<=Date.now()?'EXPIRED':row.status;}
const kind=row=>row.requestType==='DIGITAL_ID'?'Digital ID':row.requestType==='EMPLOYEE_PROJECT'?'Project access':'Visitor';
const time=value=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const dateTime=value=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
function releaseImages(){for(const key of ['photoUrl','cardUrl']){if(state[key])URL.revokeObjectURL(state[key]);state[key]=null;}}
function imageUrl(result){if(!['image/png','image/jpeg','image/webp'].includes(result.mimeType)||typeof result.imageBase64!=='string'||result.imageBase64.length>7340032)throw new Error('Image unavailable.');const bytes=Uint8Array.from(atob(result.imageBase64),c=>c.charCodeAt(0));return URL.createObjectURL(new Blob([bytes],{type:result.mimeType}));}
function showLogin(){state.context=null;state.listVersion++;state.detailVersion++;state.rows=[];state.cursor=null;state.pendingPrint.clear();closeVisit();location.replace('/');}
function setContext(context){
 state.context=context;state.location=context.locations[0];$('staff-name').textContent=context.displayName;$('staff-session').hidden=$('reception-dashboard').hidden=false;
 $('reception-date').value=context.currentDate;const base=Date.parse(context.currentDate+'T12:00:00.000Z');$('reception-date').min=new Date(base-30*86400000).toISOString().slice(0,10);$('reception-date').max=new Date(base+90*86400000).toISOString().slice(0,10);
 $('reception-location').replaceChildren(...context.locations.map(row=>new Option(row.locationName,String(row.locationId))));$('office-selector').hidden=context.locations.length===1;$('office-name').textContent=state.location.locationName;
 $('visit-search').value='';state.status='ALL';document.querySelectorAll('[data-status]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.status==='ALL')));loadVisits();
}
function renderRows(){
 $('visit-rows').replaceChildren();
 let pendingCount=0,insideCount=0,printedCount=0;
 for(const row of state.rows){
  if(row.status==='PENDING')pendingCount++;
  if(row.isInside)insideCount++;
  printedCount+=row.printCount;
  const tr=document.createElement('tr'),person=document.createElement('td'),project=document.createElement('td'),status=document.createElement('td'),valid=document.createElement('td'),actions=document.createElement('td');
  const personWrap=document.createElement('div');personWrap.className='person-cell-content';
  const avatar=document.createElement('span');avatar.className='avatar visit-avatar';
  const initials=(row.personName||'').split(' ').filter(Boolean).map(s=>s[0]).slice(0,2).join('').toUpperCase()||'V';
  avatar.textContent=initials;
  const personInfo=document.createElement('div');
  const name=document.createElement('button');name.className='visit-person';name.type='button';name.textContent=row.personName;name.addEventListener('click',()=>openVisit(row));
  const id=document.createElement('span');id.className='visit-secondary';id.textContent=row.employeeId??row.publicReference;
  personInfo.append(name,id);personWrap.append(avatar,personInfo);person.append(personWrap);
  const type=document.createElement('span');type.className='visit-type';type.textContent=kind(row);
  const projName=document.createElement('div');projName.textContent=row.projectName??'—';
  project.append(projName,type);
  status.append(badge(effective(row)));if(row.isInside){const inside=document.createElement('span');inside.className='visit-secondary';inside.textContent='Inside';status.append(inside);}
  valid.className='time-cell';valid.textContent=time(row.validUntilUtc)+' IST';const button=document.createElement('button');button.className='secondary';button.type='button';button.textContent='View pass';button.addEventListener('click',()=>openVisit(row));actions.append(button);tr.append(person,project,status,valid,actions);$('visit-rows').append(tr);
 }
 const elTotal=$('stat-total');if(elTotal)elTotal.textContent=!state.listComplete?(state.listFailed?'—':'…'):String(state.rows.length);
 const elPending=$('stat-pending');if(elPending)elPending.textContent=state.listBusy?'…':String(pendingCount);
 const elInside=$('stat-inside');if(elInside)elInside.textContent=state.listBusy?'…':String(insideCount);
 const elPrinted=$('stat-printed');if(elPrinted)elPrinted.textContent=state.listBusy?'…':String(printedCount);
 $('empty-visits').hidden=state.rows.length>0;$('load-more').hidden=!state.cursor;$('list-status').textContent=state.rows.length+' visits'+(state.cursor?' · More available':'');
}
async function loadVisits(more=false){
 if(!state.context)return;const version=++state.listVersion;state.listBusy=true;state.listComplete=false;state.listFailed=false;$('refresh').disabled=$('load-more').disabled=true;$('load-more').hidden=true;$('empty-visits').hidden=true;
 if(!more){state.rows=[];state.cursor=null;$('visit-rows').replaceChildren();}$('list-status').textContent='Loading visits…';
 for(const id of ['stat-total','stat-pending','stat-inside','stat-printed'])if($(id))$(id).textContent='…';
 const filter={locationId:state.location.locationId,visitDate:$('reception-date').value,search:$('visit-search').value.trim(),status:state.status};
 try{const cursors=new Set();do{
  const result=await api('list',{...filter,...(state.cursor?{cursor:state.cursor}:{})});if(version!==state.listVersion)return;
  const known=new Set(state.rows.map(row=>row.visitRequestId));state.rows.push(...result.visits.filter(row=>!known.has(row.visitRequestId)));state.cursor=result.cursor;
  if(state.cursor){const key=JSON.stringify(state.cursor);if(cursors.has(key))throw new Error('List changed. Refresh to retry.');cursors.add(key);}
  if(!state.cursor){state.listBusy=false;state.listComplete=true;}renderRows();$('load-more').hidden=true;if(state.cursor)$('list-status').textContent='Loading visits…';
 }while(state.cursor);
 }catch(error){if(version!==state.listVersion)return;state.listFailed=true;renderRows();$('load-more').hidden=true;$('list-status').textContent='Visits could not be fully loaded. Use Refresh to retry.';toasts.show(error.message,'error');}
 finally{if(version===state.listVersion){state.listBusy=false;$('refresh').disabled=$('load-more').disabled=false;}}
}

function fitDialog(){const dialog=$('visit-dialog');if(!dialog.open)return;const v=window.visualViewport,w=v?.width??innerWidth,h=v?.height??innerHeight,mobile=w<=760,width=Math.max(0,Math.min(mobile?w:672,w-(mobile?0:32))),height=Math.max(0,Math.min(736,h-(mobile?16:32)));dialog.style.inset='auto';dialog.style.margin='0';dialog.style.width=width+'px';dialog.style.height=height+'px';dialog.style.left=((v?.offsetLeft??0)+(w-width)/2)+'px';dialog.style.top=((v?.offsetTop??0)+(mobile?h-height:(h-height)/2))+'px';}
function closeVisit(){state.detailVersion++;state.selected=null;state.detail=null;releaseImages();toasts.clear();document.body.append(toasts.region);if($('visit-dialog').open)$('visit-dialog').close();}
function field(label,value){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$('detail-fields').append(dt,dd);}
async function openVisit(row){
 closeVisit();state.selected=row;const version=++state.detailVersion;const dialog=$('visit-dialog');dialog.append(toasts.region);$('detail-name').textContent=row.personName;$('detail-kind').textContent=kind(row);$('detail-badge').replaceChildren(badge(effective(row)));$('detail-fields').replaceChildren();$('detail-photo').hidden=$('reception-card').hidden=true;$('reception-card').replaceChildren();$('detail-status').textContent='Loading details…';$('card-status').textContent='';$('retry-detail').hidden=true;$('detail-print').disabled=true;$('detail-print').textContent=row.printCount?'Reprint pass':'Print pass';dialog.showModal();fitDialog();
 try {
  const detail=await api('detail',{visitRequestId:row.visitRequestId});if(version!==state.detailVersion)return;state.detail=detail;$('detail-status').textContent='';$('detail-name').textContent=detail.personName;$('detail-badge').replaceChildren(badge(effective(detail)));
  field('Pass ID',detail.publicPassNumber);field('Office',detail.locationName);if(detail.projectName)field('Project',detail.projectName);field('Purpose',detail.reason);field('Valid from',dateTime(detail.validFromUtc));field('Valid until',dateTime(detail.validUntilUtc));field('Print requests',String(row.printCount));
  if(detail.photoAvailable)api('photo',{visitRequestId:row.visitRequestId}).then(photo=>{if(version!==state.detailVersion)return;state.photoUrl=imageUrl(photo);$('detail-photo').src=state.photoUrl;$('detail-photo').hidden=false;}).catch(()=>{});
  const allowed=['PENDING','APPROVED'].includes(detail.status)&&['PENDING','ACTIVE'].includes(detail.passStatus)&&Date.parse(detail.validUntilUtc)>Date.now();
  if(!allowed){$('card-status').textContent='This pass is unavailable for printing.';return;}
  $('card-status').textContent='Preparing card preview…';
  try{const image=await api('preview',{visitRequestId:row.visitRequestId});if(version!==state.detailVersion)return;state.cardUrl=imageUrl(image);const img=document.createElement('img');img.src=state.cardUrl;img.alt='Pass for '+detail.personName;img.width=1712;img.height=1080;$('reception-card').append(img);$('reception-card').hidden=false;$('card-status').textContent='';$('detail-print').disabled=!state.location.canPrint||state.printBusy;}
  catch(error){if(version!==state.detailVersion)return;$('card-status').textContent='Preview unavailable. Retry to check the current pass.';$('retry-detail').hidden=false;toasts.show(error.message,'error');}
 }catch(error){if(version!==state.detailVersion)return;$('detail-status').textContent='Visit details could not be loaded.';$('retry-detail').hidden=false;toasts.show(error.message,'error');}
}
async function browserPrint(){
 if(state.printBusy||!state.detail||!state.selected)return;
 const row=state.selected,detail=state.detail,popup=window.open('/reception/print','_blank','popup,width=1000,height=700');
 if(!popup){toasts.show('Allow pop-ups to open the print window.','error');return;}
 state.printBusy=true;$('detail-print').disabled=true;$('detail-print').textContent='Preparing print…';
 const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{window.removeEventListener('message',receive);reject(new Error('Print window did not open. Please retry.'));},15000);function receive(event){if(event.origin===location.origin&&event.source===popup&&event.data?.type==='gatepass-print-ready'){clearTimeout(timer);window.removeEventListener('message',receive);resolve();}}window.addEventListener('message',receive);});
 const key=row.visitRequestId+':'+detail.accessPassId;
 try{
  await ready;if(popup.closed)throw new Error('Print window was closed.');
  let operation=state.pendingPrint.get(key);if(!operation){operation={clientKey:crypto.randomUUID(),visitRequestId:row.visitRequestId,expectedPassId:detail.accessPassId,printerLabel:'Reception browser'};state.pendingPrint.set(key,operation);}
  const job=await api('print/request',operation);
  if(job.status==='DISPATCHED'){state.pendingPrint.delete(key);row.printCount=Math.max(row.printCount,1);throw new Error('Previous print request was already handed off. Use Reprint if needed.');}
  if(job.status==='FAILED'){state.pendingPrint.delete(key);throw new Error('Previous print failed. Try a new print request.');}
  const image=await api('print/render',{printJobId:job.printJobId});state.pendingPrint.delete(key);row.printCount++;renderRows();
  if(popup.closed)throw new Error('Print window was closed after handoff. Use Reprint if needed.');
  popup.postMessage({type:'gatepass-print-image',mimeType:image.mimeType,imageBase64:image.imageBase64},location.origin);toasts.show('Pass sent to the browser print window.','success');
 }catch(error){if(!popup.closed)popup.postMessage({type:'gatepass-print-error',message:error.message},location.origin);toasts.show(error.message,'error');}
 finally{state.printBusy=false;if(state.selected===row){$('detail-print').disabled=!state.cardUrl||!state.location?.canPrint;$('detail-print').textContent=row.printCount?'Reprint pass':'Print pass';}}
}
$('staff-logout').addEventListener('click',async()=>{if(state.printBusy)return;try{if(cookie('gp-staff-csrf')){const response=await fetch('/api/staff/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':cookie('gp-staff-csrf')},body:'{}'});if(!response.ok)throw new Error('Unable to sign out. Please retry.');}else await api('logout');showLogin();}catch(error){toasts.show(error.message,'error');}});
$('refresh').addEventListener('click',()=>loadVisits());$('load-more').addEventListener('click',()=>loadVisits(true));
$('reception-date').addEventListener('change',()=>{if($('reception-date').reportValidity())loadVisits();});$('today').addEventListener('click',()=>{$('reception-date').value=state.context.currentDate;loadVisits();});
$('reception-location').addEventListener('change',()=>{closeVisit();state.location=state.context.locations.find(row=>String(row.locationId)===$('reception-location').value);$('office-name').textContent=state.location.locationName;loadVisits();});
$('visit-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadVisits(),350);});
for(const button of document.querySelectorAll('[data-status]'))button.addEventListener('click',()=>{state.status=button.dataset.status;document.querySelectorAll('[data-status]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));loadVisits();});
$('close-visit').addEventListener('click',closeVisit);$('visit-dialog').addEventListener('cancel',event=>{event.preventDefault();closeVisit();});$('retry-detail').addEventListener('click',()=>{if(state.selected)openVisit(state.selected);});$('detail-print').addEventListener('click',browserPrint);
window.addEventListener('resize',fitDialog);window.visualViewport?.addEventListener('resize',fitDialog);window.visualViewport?.addEventListener('scroll',fitDialog);
enhanceSelect($('reception-location'));
if(cookie('gp-staff-csrf')||cookie('gp-reception-csrf')){$('staff-loading').hidden=false;api('me').then(setContext).catch(()=>showLogin()).finally(()=>{$('staff-loading').hidden=true;});}else showLogin();
