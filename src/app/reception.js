'use strict';
const deviceLabels={LAPTOP:"Laptop",TABLET:"Tablet / iPad",PEN_DRIVE:"Pen Drive",CAMERA:"Camera",OTHER:"Other"};
let deviceReturn=null;
const $=id=>document.getElementById(id),toasts=new ToastNotifications();
const state={context:null,location:null,rows:[],cursor:null,status:'ALL',listVersion:0,calendarVersion:0,calendarBusy:false,detailVersion:0,selected:null,detail:null,listBusy:false,listComplete:false,listFailed:false,accessDenied:false,printBusy:false,photoUrl:null,cardUrl:null,pendingPrint:null,insideOnly:false,pendingReturns:false,pendingReturnCount:null,returnBusy:false,returnKeys:new Map()};
let searchTimer;
const cookie=name=>document.cookie.split('; ').find(value=>value.startsWith(name+'='))?.split('=')[1];
async function api(action,body={}){
 const headers={'Content-Type':'application/json'},csrf=cookie('gp-staff-csrf')??cookie('gp-reception-csrf');if(csrf)headers['X-CSRF-Token']=csrf;
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
 try{
  const response=await fetch('/api/reception/'+action,{method:'POST',credentials:'same-origin',headers,body:JSON.stringify(body),signal:controller.signal});
  if(!response.ok){const messages={400:'Check the details.',401:'Sign in again to continue.',403:'Access unavailable for this office or pass.',409:'Pass or print state changed. Refresh and try again.',429:'Too many requests. Please wait.'};const error=Object.assign(new Error(messages[response.status]??'Unable to complete the request. Please retry.'),{status:response.status});if(response.status===401)showLogin();throw error;}
  return await response.json();
 }catch(error){if(Number.isInteger(error?.status))throw error;throw new Error(error?.name==='AbortError'?'Request timed out. Please retry.':'Connection lost. Please retry.');}
 finally{clearTimeout(timeout);}
}

state.pendingPrint=new ReceptionPrintCoordinator(api);
function badge(status){const item=document.createElement('span');item.className='status '+status.toLowerCase();item.textContent=status.charAt(0)+status.slice(1).toLowerCase();return item;}
function effective(row){return row.status==='CANCELLED'?'CANCELLED':!row.returnedAtUtc&&row.passStatus==='REVOKED'?'REVOKED':Date.parse(row.validUntilUtc)<=Date.now()?'EXPIRED':row.status;}
const kind=row=>row.requestType==='DIGITAL_ID'?'Digital ID':row.requestType==='EMPLOYEE_PROJECT'?'Project access':'Visitor';
const time=value=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const dateTime=value=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const eyeIcon='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
function canPrint(row){return !row.returnedAtUtc&&!!state.location?.canPrint&&['PENDING','APPROVED'].includes(row.status)&&['PENDING','ACTIVE'].includes(row.passStatus)&&Date.parse(row.validUntilUtc)>Date.now();}
function projectText(row){if(row.requestType!=='DIGITAL_ID')return row.projectName??'Project unavailable';const p=row.employeeProjects;return p?.available?(p.items.map(i=>i.name).join(' · ')+(p.total>p.items.length?' · '+(p.total-p.items.length)+' more':''))||'No assigned projects':'Assignments unavailable';}
function renderTimeline(movements=[],hasMore=false){const root=$('detail-timeline');root.replaceChildren();if(!movements.length){root.textContent='No movements recorded.';return;}const ol=document.createElement('ol');ol.className='reception-timeline';for(const m of [...movements].sort((a,b)=>Date.parse(a.occurredAtUtc)-Date.parse(b.occurredAtUtc)||(BigInt(a.accessEventId)<BigInt(b.accessEventId)?-1:1))){const li=document.createElement('li'),title=document.createElement('strong'),time=document.createElement('time'),meta=document.createElement('p');title.textContent=m.eventType==='ENTRY'?'Entry':'Exit';time.dateTime=m.occurredAtUtc;time.textContent=dateTime(m.occurredAtUtc)+' IST';meta.textContent=(m.projectName?m.projectName+' / ':'')+m.guardName+' · '+({SCAN:'QR scan',MANUAL:'Manual',RECONCILE:'Reconciled exit'}[m.entryMethod]??m.entryMethod);li.append(title,time,meta);ol.append(li);}root.append(ol);if(hasMore){const p=document.createElement('p');p.textContent='Showing the latest '+movements.length+' movements.';root.append(p);}}
function releaseImages(){for(const key of ['photoUrl','cardUrl']){if(state[key])URL.revokeObjectURL(state[key]);state[key]=null;}}
function imageUrl(result){if(!['image/png','image/jpeg','image/webp'].includes(result.mimeType)||typeof result.imageBase64!=='string'||result.imageBase64.length>7340032)throw new Error('Image unavailable.');const bytes=Uint8Array.from(atob(result.imageBase64),c=>c.charCodeAt(0));return URL.createObjectURL(new Blob([bytes],{type:result.mimeType}));}
function showLogin(){clearLookup();deviceReturn=null;$('devices-return-dialog').close();state.calendarVersion++;state.context=null;state.listVersion++;state.detailVersion++;state.rows=[];state.cursor=null;state.pendingPrint.clear();state.returnKeys.clear();state.pendingReturnCount=null;closeVisit();closeManual();$('history-dialog').close();$('profile-dialog').close();$('visit-rows').replaceChildren();$('reception-dashboard').hidden=true;location.replace('/');}
function setContext(context){clearLookup();
 state.rows=[];state.cursor=null;state.pendingReturnCount=null;state.listComplete=false;state.listFailed=false;state.accessDenied=false;state.context=context;state.location=context.locations[0];$('staff-name').textContent=context.displayName;$('staff-session').hidden=$('reception-dashboard').hidden=false;
 setCalendar(context.currentDate);$('reception-date').value=context.currentDate;
 $('reception-location').replaceChildren(...context.locations.map(row=>new Option(row.locationName,String(row.locationId))));$('office-selector').hidden=context.locations.length===1;$('office-name').textContent=state.location.locationName;
 $('visit-search').value='';state.status='ALL';state.insideOnly=false;state.pendingReturns=false;if($('printFilter'))$('printFilter').value='ALL';if($('typeFilter'))$('typeFilter').value='ALL';if($('approvalFilter'))$('approvalFilter').value='ALL';document.querySelectorAll('[data-status]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.status==='ALL')));
 updateTodayLabel();renderRows();loadVisits();
}
function updateTodayLabel(){if(state.context)$('todayLabel').textContent=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'long',year:'numeric'}).format(new Date(state.context.currentDate+'T12:00:00Z'));}
function updateActiveKpi(){
 document.querySelectorAll('.kpi').forEach(el=>el.classList.remove('active-kpi'));
 if(state.insideOnly){$('kpi-inside')?.classList.add('active-kpi');return;}
 if(state.pendingReturns){$('kpi-returns')?.classList.add('active-kpi');return;}
 if(state.status==='PENDING'){$('kpi-pending')?.classList.add('active-kpi');return;}
 const pr=$('printFilter')?.value;

 if(state.status==='ALL'&&(!pr||pr==='ALL')){$('kpi-total')?.classList.add('active-kpi');}
}
function setCalendar(currentDate){
 if(typeof currentDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(currentDate)||new Date(currentDate+'T12:00:00.000Z').toISOString().slice(0,10)!==currentDate)throw new Error('Office date unavailable.');
 const base=Date.parse(currentDate+'T12:00:00.000Z');state.context.currentDate=currentDate;
 $('reception-date').min=new Date(base-30*86400000).toISOString().slice(0,10);$('reception-date').max=new Date(base+90*86400000).toISOString().slice(0,10);
}
async function refreshCalendar(forceToday=false){
 if(!state.context||(!forceToday&&state.calendarBusy))return;state.calendarBusy=true;const version=++state.calendarVersion,previousDate=state.context.currentDate,selected=$('reception-date').value;$('today').disabled=true;
 try{const context=await api('me');if(!state.context||version!==state.calendarVersion)return;const updatedOffice=context.locations.find(l=>l.locationId===state.location.locationId);if(!updatedOffice){closeVisit();closeManual();$('history-dialog').close();setContext(context);return;}state.location=updatedOffice;state.context.locations=context.locations;$('reception-location').replaceChildren(...context.locations.map(l=>new Option(l.locationName,String(l.locationId))));$('reception-location').value=String(updatedOffice.locationId);$('office-selector').hidden=context.locations.length===1;setCalendar(context.currentDate);updateTodayLabel();
  if((forceToday||selected===previousDate)&&$('reception-date').value===selected){$('reception-date').value=context.currentDate;await loadVisits();}
 }catch(error){if(version===state.calendarVersion&&state.context){if(error.status===403)clearProtectedVisits();toasts.show(error.message,'error');}}
 finally{if(version===state.calendarVersion){state.calendarBusy=false;$('today').disabled=false;}}
}
function currentIndiaDay(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
let calendarTimer;
function watchCalendar(){clearInterval(calendarTimer);calendarTimer=setInterval(()=>{if(!document.hidden&&state.context){if(currentIndiaDay()!==state.context.currentDate)void refreshCalendar();renderRows();if(state.detail){$('detail-print').hidden=!canPrint(state.detail);void reminderState(state.detail,state.detailVersion);}}},60000);}
watchCalendar();
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.context)void refreshCalendar();});
window.addEventListener('pagehide',()=>{clearLookup();deviceReturn=null;$('devices-return-dialog').close();state.calendarVersion++;state.calendarBusy=false;state.listVersion++;clearInterval(calendarTimer);closeVisit();closeManual();$('history-dialog').close();$('profile-dialog').close();state.rows=[];$('visit-rows').replaceChildren();$('reception-dashboard').hidden=true;});
window.addEventListener('pageshow',event=>{if(event.persisted){watchCalendar();api('me').then(setContext).catch(()=>showLogin());}});
function renderRows(){
 $('visit-rows').replaceChildren();
 let pendingCount=0,matched=0;const insideKeys=new Set();
 const typeFilter=$('typeFilter')?.value||'ALL';
 const printFilter=$('printFilter')?.value||'ALL';const key=JSON.stringify([state.status,state.insideOnly,typeFilter,printFilter]);if(state.renderFilter!==key){state.renderFilter=key;state.renderLimit=50;}
 const formatRef=ref=>typeof ref==='string'&&ref.startsWith('V-')&&ref.length>14?'V-'+ref.slice(2,10).toUpperCase():(ref??'—');
 for(const row of state.rows){
  const pending=row.status==='PENDING'&&!row.returnedAtUtc&&row.passStatus==='PENDING'&&effective(row)==='PENDING';
  if(state.status==='PENDING'?!pending:state.status!=='ALL'&&effective(row)!==state.status)continue;


  if(state.insideOnly&&!row.isInside)continue;
  const isPr=row.printCount>0;
  if(printFilter==='PRINTED'&&!isPr)continue;
  if(printFilter==='UNPRINTED'&&isPr)continue;
  if(printFilter==='PENDING_RETURN'&&(!isPr||row.returnedAtUtc))continue;
  if(printFilter==='RETURNED'&&!row.returnedAtUtc)continue;
  if(typeFilter==='EMPLOYEE'&&row.requestType==='EXTERNAL')continue;
  if(typeFilter==='VISITOR'&&row.requestType!=='EXTERNAL')continue;

  if(pending)pendingCount++;if(row.isInside)insideKeys.add(row.employeeId?'employee:'+row.employeeId:'visit:'+row.visitRequestId);
  matched++;if(matched>(state.renderLimit??50))continue;
  const tr=document.createElement('tr');tr.className='registration-row';
  const person=document.createElement('td');person.className='cell-identity';
  const personWrap=document.createElement('div');personWrap.className='identity-cell';
  const avatar=document.createElement('div');avatar.className='avatar';
  const initials=(row.personName||'').split(' ').filter(Boolean).map(s=>s[0]).slice(0,2).join('').toUpperCase()||'V';
  avatar.textContent=initials;
  const personInfo=document.createElement('div');personInfo.className='person-copy';
  const name=document.createElement('button');name.className='visit-person name';name.type='button';name.textContent=row.personName;name.addEventListener('click',()=>openVisit(row));
  const rawRef=row.employeeId??row.publicReference;
  const id=document.createElement('div');id.className='sub';id.title=rawRef;id.textContent=formatRef(rawRef)+' \u00b7 '+kind(row)+' \u00b7 '+time(row.submittedAtUtc||row.validFromUtc);
  personInfo.append(name,id);personWrap.append(avatar,personInfo);person.append(personWrap);

  const project=document.createElement('td');project.className='cell-project';
  const projName=document.createElement('div');projName.className='cell-primary';projName.textContent=projectText(row);
  const projType=document.createElement('div');projType.className='cell-secondary';projType.textContent=kind(row);
  project.append(projName,projType);

  const host=document.createElement('td');host.className='cell-host host-col';
  const hostName=document.createElement('div');hostName.className='cell-primary';hostName.textContent=row.requestType==='DIGITAL_ID'?'Not applicable':row.hostName??'Host unavailable';
  const hostSub=document.createElement('div');hostSub.className='cell-secondary';hostSub.textContent=row.requestType==='DIGITAL_ID'?'':(row.hostEmail??'');
  host.append(hostName,hostSub);

  const status=document.createElement('td');status.className='cell-status';
  status.append(badge(effective(row)));if(row.isInside){const inside=document.createElement('span');inside.className='status inside';inside.textContent='Inside';status.append(inside);}

  const cardStatus=document.createElement('td');cardStatus.className='cell-card';
  cardStatus.append(cardStatusControl(row));

  const actions=document.createElement('td');actions.className='cell-actions actions';
  const viewBtn=document.createElement('button');viewBtn.className='btn outline';viewBtn.type='button';viewBtn.innerHTML=eyeIcon;viewBtn.classList.add('icon-action');viewBtn.setAttribute('aria-label','View pass for '+row.personName);viewBtn.title='View pass';viewBtn.addEventListener('click',()=>openVisit(row));
  const printBtn=document.createElement('button');printBtn.className='btn primary';printBtn.type='button';printBtn.textContent=row.printCount?'Reprint':'Print';printBtn.hidden=!canPrint(row);printBtn.disabled=state.printBusy||state.returnBusy;printBtn.addEventListener('click',()=>browserPrint(row));
  actions.append(viewBtn,printBtn);

  tr.tabIndex=0;tr.setAttribute('aria-label','View pass for '+row.personName);tr.addEventListener('click',event=>{if(!event.target.closest('button,a,input,select'))openVisit(row);});tr.addEventListener('keydown',event=>{if(event.target===tr&&['Enter',' '].includes(event.key)){event.preventDefault();openVisit(row);}});
  tr.append(person,project,host,status,cardStatus,actions);
  $('visit-rows').append(tr);
 }
 const complete=state.listComplete&&!state.listFailed;const hasRows=state.rows.length>0;
 for(const [id,count] of [['stat-total',matched],['stat-pending',pendingCount],['stat-inside',insideKeys.size],['stat-returns',state.pendingReturnCount??state.rows.filter(r=>r.printCount>0&&!r.returnedAtUtc).length]])if($(id))$(id).textContent=complete||hasRows?String(count):state.listFailed?'\u2014':'\u2026';
 $('empty-visits').hidden=!complete||$('visit-rows').children.length>0;$('load-more').hidden=$('visit-rows').children.length>=matched;$('list-status').textContent=state.accessDenied?'Access to this office is unavailable. Refresh your session.':state.listFailed?'Could not update visits. Showing the previous list. Use Refresh to retry.':state.listBusy?'Updating visits…':($('visit-rows').children.length<matched?$('visit-rows').children.length+' / '+matched:matched)+' matching visits'+(state.cursor?' \u00b7 Loading more\u2026':'');
 if(typeof updateActiveKpi==='function')updateActiveKpi();
}
async function loadVisits(more=false,quiet=false){
 if(!state.context)return;if(!more&&!quiet)state.renderLimit=50;const version=++state.listVersion,hadComplete=state.listComplete;state.listBusy=true;state.listFailed=false;state.accessDenied=false;$('refresh').disabled=$('load-more').disabled=true;$('load-more').hidden=true;$('empty-visits').hidden=true;
 $('list-status').textContent=state.rows.length?'Updating visits…':'Loading visits…';$('visit-rows').setAttribute('aria-busy','true');
 if(!state.rows.length&&!hadComplete)for(const id of ['stat-total','stat-pending','stat-inside','stat-returns'])if($(id))$(id).textContent='…';
 const filter={locationId:state.location.locationId,visitDate:$('reception-date').value,search:$('visit-search').value.trim(),status:'ALL',pendingReturns:state.pendingReturns},rows=more?[...state.rows]:[];let cursor=more?state.cursor:null,pendingReturnCount=state.pendingReturnCount;
 try{const cursors=new Set();do{
  const result=await api('list',{...filter,...(cursor?{cursor}:{})});if(version!==state.listVersion)return;
  if(Number.isSafeInteger(result.pendingReturnCount))pendingReturnCount=result.pendingReturnCount;
  const known=new Set(rows.map(row=>row.visitRequestId));rows.push(...result.visits.filter(row=>!known.has(row.visitRequestId)));cursor=result.cursor;
  if(cursor){const key=JSON.stringify(cursor);if(cursors.has(key))throw new Error('List changed. Refresh to retry.');cursors.add(key);}
 }while(cursor);
 state.rows=rows;state.pendingReturnCount=pendingReturnCount;state.cursor=null;state.listComplete=true;state.listBusy=false;renderRows();
 }catch(error){if(version!==state.listVersion)return;if(error.status===403){clearProtectedVisits();toasts.show(error.message,'error');return;}state.listFailed=true;$('list-status').textContent='Could not update visits. Showing the previous list. Use Refresh to retry.';toasts.show(error.message,'error');}
 finally{if(version===state.listVersion){state.listBusy=false;$('visit-rows').setAttribute('aria-busy','false');$('refresh').disabled=$('load-more').disabled=false;}}
}

function clearProtectedVisits(){clearLookup();deviceReturn=null;$('devices-return-dialog').close();
 state.listVersion++;state.rows=[];state.cursor=null;state.pendingReturnCount=null;state.listComplete=false;state.listFailed=true;state.accessDenied=true;state.listBusy=false;
 closeVisit();closeManual();$('history-dialog').close();$('profile-dialog').close();renderRows();$('visit-rows').setAttribute('aria-busy','false');$('refresh').disabled=$('load-more').disabled=false;
}

function fitDialog(){const dialog=$('visit-dialog');if(!dialog.open)return;const v=window.visualViewport,w=v?.width??innerWidth,h=v?.height??innerHeight,mobile=w<=760,width=Math.max(0,Math.min(mobile?w:672,w-(mobile?0:32))),height=Math.max(0,Math.min(736,h-(mobile?16:32)));dialog.style.inset='auto';dialog.style.margin='0';dialog.style.width=width+'px';dialog.style.height=height+'px';dialog.style.left=((v?.offsetLeft??0)+(w-width)/2)+'px';dialog.style.top=((v?.offsetTop??0)+(mobile?h-height:(h-height)/2))+'px';}
function closeVisit(){state.detailVersion++;state.selected=null;state.detail=null;releaseImages();toasts.clear();document.body.append(toasts.region);if($('visit-dialog').open)$('visit-dialog').close();}
function field(label,value){const box=document.createElement('div');box.className='info';const dt=document.createElement('dt');dt.className='label';dt.textContent=label;const dd=document.createElement('dd');dd.className='value';dd.textContent=value;box.append(dt,dd);$('detail-fields').append(box);return dd;}
function readOnlyCard(detail){const card=document.createElement('article');card.className='readonly-pass';card.setAttribute('aria-label','Read-only pass summary');for(const value of [detail.personName,kind(detail)+' · '+effective(detail),detail.publicPassNumber,detail.locationName,projectText(detail)]){const line=document.createElement('p');line.textContent=value;card.append(line);}const note=document.createElement('small');note.textContent='Details only · no entry credential';card.append(note);$('reception-card').replaceChildren(card);$('reception-card').hidden=false;}
async function openVisit(row){
 closeVisit();$('lookup-panel').hidden=true;state.selected=row;$('detail-card-control').replaceChildren();const version=++state.detailVersion;const dialog=$('visit-dialog');dialog.append(toasts.region);$('detail-name').textContent=row.personName;$('detail-kind').textContent=kind(row);$('detail-badge').replaceChildren(badge(effective(row)));$('detail-fields').replaceChildren();$('detail-timeline').replaceChildren();$('reception-person-wrap').hidden=true;$('detail-photo').hidden=$('reception-card').hidden=true;$('reception-card').replaceChildren();$('remind-host').hidden=true;$('reminder-status').textContent='';$('detail-status').textContent='Loading details\u2026';$('card-status').textContent='';$('retry-detail').hidden=true;$('detail-print').hidden=true;$('detail-print').disabled=true;$('detail-print').textContent=row.printCount?'Reprint pass':'Print pass';dialog.showModal();fitDialog();
 try {
  const detail=await api('detail',{visitRequestId:row.visitRequestId});if(version!==state.detailVersion)return;if(Object.hasOwn(detail,'returnedAtUtc'))row.returnedAtUtc=detail.returnedAtUtc;if(Number.isSafeInteger(detail.printCount))row.printCount=detail.printCount;Object.assign(row,{status:detail.status,isInside:detail.isInside,accessPassId:detail.accessPassId,passStatus:detail.passStatus,publicPassNumber:detail.publicPassNumber,companyName:detail.companyName,deviceTypes:detail.deviceTypes});Object.assign(row,detail);const listed=state.rows.find(r=>r.visitRequestId===row.visitRequestId);if(listed&&listed!==row)Object.assign(listed,{returnedAtUtc:row.returnedAtUtc,printCount:row.printCount,status:detail.status,isInside:detail.isInside,accessPassId:detail.accessPassId,passStatus:detail.passStatus,publicPassNumber:detail.publicPassNumber,companyName:detail.companyName,deviceTypes:detail.deviceTypes});renderRows();state.detail={...detail,returnedAtUtc:row.returnedAtUtc};void reminderState(detail,version);$('detail-status').textContent='';$('detail-name').textContent=detail.personName;$('detail-badge').replaceChildren(badge(effective({...detail,returnedAtUtc:row.returnedAtUtc})));
  field('Pass ID',detail.publicPassNumber);field('Office',detail.locationName);field(detail.requestType==='DIGITAL_ID'?'Assigned projects':'Project',projectText(detail));if(detail.requestType!=='DIGITAL_ID'){const host=field('Host',detail.hostName??'Unavailable');const email=document.createElement('span');email.className='host-email';email.textContent=detail.hostEmail??'Email unavailable';host.append(email);}if(detail.companyName)field('Company',detail.companyName);if(detail.deviceTypes?.length)field('Declared devices',detail.deviceTypes.map(code=>deviceLabels[code]).join(', '));field('Purpose',detail.reason);field('Valid from',dateTime(detail.validFromUtc));field('Valid until',dateTime(detail.validUntilUtc));field('Print count',String(row.printCount)).id='detail-print-count';$('detail-card-control').replaceChildren(cardStatusControl(row));field('Card status',row.returnedAtUtc?'Returned '+dateTime(row.returnedAtUtc):row.printCount?'Printed — awaiting return':'Not printed').id='detail-card-status';renderTimeline(detail.movements,detail.movementsHasMore);
  const allowed=canPrint({...detail,returnedAtUtc:row.returnedAtUtc});
  if(detail.photoAvailable&&!allowed)api('photo',{visitRequestId:row.visitRequestId}).then(photo=>{if(version!==state.detailVersion)return;state.photoUrl=imageUrl(photo);$('detail-photo').src=state.photoUrl;$('detail-photo').hidden=$('reception-person-wrap').hidden=false;}).catch(()=>{});
  if(!allowed){readOnlyCard(state.detail);$('card-status').textContent=state.location.canPrint?'This pass is unavailable for printing.':'View-only access. Printing is not permitted.';return;}
  $('card-status').textContent='Preparing card preview\u2026';
  try{const image=await api('preview',{visitRequestId:row.visitRequestId});if(version!==state.detailVersion)return;state.cardUrl=imageUrl(image);const img=document.createElement('img');img.src=state.cardUrl;img.alt='Pass for '+detail.personName;img.width=1712;img.height=1080;$('reception-card').append(img);$('reception-card').hidden=false;$('card-status').textContent='';$('detail-print').hidden=false;$('detail-print').disabled=state.printBusy||state.returnBusy;}
  catch(error){if(version!==state.detailVersion)return;readOnlyCard(detail);$('card-status').textContent='Preview unavailable. Retry to check the current pass.';$('retry-detail').hidden=false;toasts.show(error.message,'error');}
 }catch(error){if(version!==state.detailVersion)return;$('detail-status').textContent='Visit details could not be loaded.';$('retry-detail').hidden=false;toasts.show(error.message,'error');}
}
async function browserPrint(row=state.selected){
 if(state.printBusy||state.returnBusy||!row||!canPrint(row))return;
 state.printBusy=true;$('reception-location').disabled=true;renderRows();$('detail-print').disabled=true;let frame;
 try{
  const detail=row;if(!detail.accessPassId)throw new Error('Refresh the pass before printing.');
  frame=document.createElement('iframe');frame.className='print-frame';frame.title='Pass print document';frame.setAttribute('aria-hidden','true');
  const waitMessage=(type,jobId)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{window.removeEventListener('message',receive);reject(new Error('Printer document unavailable. Retry to check this job.'));},15000);function receive(event){if(event.origin!==location.origin||event.source!==frame.contentWindow||jobId&&event.data?.printJobId!==jobId)return;if(event.data?.type===type||event.data?.type==='gatepass-print-display-error'){clearTimeout(timer);window.removeEventListener('message',receive);event.data.type===type?resolve():reject(new Error('Print image unavailable.'));}}window.addEventListener('message',receive);});
  const ready=waitMessage('gatepass-print-ready');frame.src='/reception/print';document.body.append(frame);await ready;
  const image=await state.pendingPrint.handoff(row.visitRequestId,detail.accessPassId,()=>crypto.randomUUID());row.printCount++;
  const loaded=waitMessage('gatepass-print-loaded',image.printJobId);frame.contentWindow.postMessage({type:'gatepass-print-image',...image},location.origin);await loaded;
  const printedFrame=frame;printedFrame.contentWindow.addEventListener('afterprint',()=>printedFrame.remove(),{once:true});setTimeout(()=>printedFrame.remove(),60000);
  printedFrame.contentWindow.focus();printedFrame.contentWindow.print();frame=null;
  toasts.show('Print dialog opened. A handoff does not confirm a physical print.','success');
 }catch(error){if(error.dispatched){const visitDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.validFromUtc));try{const current=await api('list',{locationId:state.location.locationId,visitDate,search:row.publicReference,status:'ALL'});const refreshed=current.visits.find(v=>v.visitRequestId===row.visitRequestId);if(refreshed)Object.assign(row,refreshed);}catch{/* Keep the operation consumed; refreshing the page can recover its receipt. */}}toasts.show(error.message,'error');}
 finally{frame?.remove();state.printBusy=false;$('reception-location').disabled=false;await loadVisits();if(state.selected){const current=state.rows.find(r=>r.visitRequestId===state.selected.visitRequestId);if(current)state.selected=current;$('detail-print').hidden=!canPrint(state.selected);$('detail-print').disabled=false;$('detail-print').textContent=state.selected.printCount?'Reprint pass':'Print pass';if($('detail-print-count'))$('detail-print-count').textContent=String(state.selected.printCount);if($('detail-card-status'))$('detail-card-status').textContent=state.selected.returnedAtUtc?'Returned '+dateTime(state.selected.returnedAtUtc):state.selected.printCount?'Printed — awaiting return':'Not printed';if($('detail-card-control'))$('detail-card-control').replaceChildren(cardStatusControl(state.selected));}}
}
$('staff-logout').addEventListener('click',async()=>{if(state.printBusy||state.returnBusy)return;try{if(cookie('gp-staff-csrf')){const response=await fetch('/api/staff/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':cookie('gp-staff-csrf')},body:'{}'});if(!response.ok)throw new Error('Unable to sign out. Please retry.');}else await api('logout');showLogin();}catch(error){toasts.show(error.message,'error');}});
$('refresh').addEventListener('click',()=>loadVisits());$('load-more').addEventListener('click',()=>{state.renderLimit=(state.renderLimit??50)+50;renderRows();});
$('reception-date').addEventListener('change',()=>{if($('reception-date').reportValidity())loadVisits();});$('today').addEventListener('click',()=>void refreshCalendar(true));
$('reception-location').addEventListener('change',()=>{clearLookup();deviceReturn=null;$('devices-return-dialog').close();closeVisit();closeManual();$('history-dialog').close();state.location=state.context.locations.find(row=>String(row.locationId)===$('reception-location').value);$('office-name').textContent=state.location.locationName;state.pendingReturnCount=null;state.rows=[];renderRows();loadVisits();});
$('visit-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadVisits(),350);});
if($('approvalFilter'))$('approvalFilter').addEventListener('change',()=>{state.status=$('approvalFilter').value;document.querySelectorAll('[data-status]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.status===state.status)));state.insideOnly=false;renderRows();});
if($('printFilter'))$('printFilter').addEventListener('change',()=>{const pending=$('printFilter').value==='PENDING_RETURN';const changed=pending!==state.pendingReturns;state.pendingReturns=pending;if(changed)loadVisits();else renderRows();});
if($('typeFilter'))$('typeFilter').addEventListener('change',()=>renderRows());
if($('clearFilters'))$('clearFilters').addEventListener('click',()=>{
 $('visit-search').value='';if($('approvalFilter'))$('approvalFilter').value='ALL';if($('printFilter'))$('printFilter').value='ALL';if($('typeFilter'))$('typeFilter').value='ALL';
 state.status='ALL';state.insideOnly=false;state.pendingReturns=false;document.querySelectorAll('[data-status]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.status==='ALL')));loadVisits();
});

// Interactive KPI Card Filters
if($('kpi-total'))$('kpi-total').addEventListener('click',()=>{
 $('visit-search').value='';if($('approvalFilter'))$('approvalFilter').value='ALL';if($('printFilter'))$('printFilter').value='ALL';if($('typeFilter'))$('typeFilter').value='ALL';
 state.status='ALL';state.insideOnly=false;state.pendingReturns=false;document.querySelectorAll('[data-status]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.status==='ALL')));loadVisits();
});
if($('kpi-pending'))$('kpi-pending').addEventListener('click',()=>{
 state.pendingReturns=false;$('printFilter').value='ALL';state.insideOnly=false;state.status='PENDING';if($('approvalFilter'))$('approvalFilter').value='PENDING';document.querySelectorAll('[data-status]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.status==='PENDING')));loadVisits();
});
if($('kpi-inside'))$('kpi-inside').addEventListener('click',()=>{
 state.pendingReturns=false;$('printFilter').value='ALL';state.status='ALL';if($('approvalFilter'))$('approvalFilter').value='ALL';document.querySelectorAll('[data-status]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.status==='ALL')));state.insideOnly=!state.insideOnly;loadVisits();
});
if($('kpi-returns'))$('kpi-returns').addEventListener('click',()=>{state.insideOnly=false;state.status='ALL';state.pendingReturns=true;$('visit-search').value='';$('approvalFilter').value='ALL';$('printFilter').value='PENDING_RETURN';$('typeFilter').value='ALL';document.querySelectorAll('[data-status]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.status==='ALL')));loadVisits();});

for(const button of document.querySelectorAll('[data-status]'))button.addEventListener('click',()=>{state.status=button.dataset.status;if($('approvalFilter'))$('approvalFilter').value=state.status;document.querySelectorAll('[data-status]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));loadVisits();});
$('close-visit').addEventListener('click',closeVisit);$('visit-dialog').addEventListener('cancel',event=>{event.preventDefault();closeVisit();});$('retry-detail').addEventListener('click',()=>{if(state.selected)openVisit(state.selected);});$('detail-print').addEventListener('click',()=>browserPrint());
window.addEventListener('resize',fitDialog);window.visualViewport?.addEventListener('resize',fitDialog);window.visualViewport?.addEventListener('scroll',fitDialog);
enhanceSelect($('reception-location'));

// Manual intake uses isolated cookies and the same photo, validation and idempotency workflow.
function closeManual(){if($('assisted-dialog').open)$('assisted-dialog').close();$('manual-content').replaceChildren();}
$('assistedFab').addEventListener('click',()=>{if(!state.location)return;const frame=document.createElement('iframe');frame.title='Manual visitor registration';frame.allow='camera';frame.src='/reception/register/'+state.location.locationCode.toLowerCase();$('manual-content').replaceChildren(frame);$('assisted-dialog').showModal();});
$('close-assisted').addEventListener('click',closeManual);$('assisted-dialog').addEventListener('cancel',event=>{event.preventDefault();closeManual();});
window.addEventListener('message',event=>{const frame=$('manual-content').querySelector('iframe');if(event.origin!==location.origin||event.source!==frame?.contentWindow)return;if(event.data?.type==='gatepass-manual-close')closeManual();if(event.data?.type==='gatepass-manual-submitted')void loadVisits();});
$('account-toggle').addEventListener('click',()=>{const opened=$('account-menu').hidden;$('account-menu').hidden=!opened;$('account-toggle').setAttribute('aria-expanded',String(opened));if(opened)$('open-profile').focus();});
function closeAccount(){ $('account-menu').hidden=true;$('account-toggle').setAttribute('aria-expanded','false'); }
document.addEventListener('click',event=>{if(!$('staff-session').contains(event.target))closeAccount();});
$('account-menu').addEventListener('keydown',event=>{const buttons=[...$('account-menu').querySelectorAll('button')];if(event.key==='Escape'){closeAccount();$('account-toggle').focus();}if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();buttons[(buttons.indexOf(document.activeElement)+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();}});
$('open-profile').addEventListener('click',async()=>{closeAccount();try{const context=await api('me');$('profile-fields').replaceChildren();for(const [label,value] of [['Name',context.displayName],['Role','Reception']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$('profile-fields').append(dt,dd);}$('profile-offices').replaceChildren(...context.locations.map(l=>{const p=document.createElement('p');p.textContent=l.locationName+' · '+(l.canPrint?'View and print':'View only');return p;}));$('profile-dialog').showModal();}catch(error){toasts.show(error.message,'error');}});
$('close-profile').addEventListener('click',()=>$('profile-dialog').close());
let historyVersion=0;
async function loadHistory(){const version=++historyVersion;$('history-rows').replaceChildren();$('history-status').textContent='Loading history…';const date=$('history-date').value,end=$('history-end').value;if(!$('history-date').reportValidity()||!$('history-end').reportValidity())return;if(date>end){$('history-status').textContent='From date must be on or before To date.';return;}const office=state.location.locationId;let cursor,count=0;const cursors=new Set();try{for(let day=date;day<=end;day=new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10)){cursor=null;cursors.clear();do{const result=await api('list',{locationId:office,visitDate:day,status:'ALL',...(cursor?{cursor}:{})});if(version!==historyVersion)return;for(const row of result.visits){const item=document.createElement('button'),avatar=document.createElement('span'),copy=document.createElement('span'),name=document.createElement('strong'),meta=document.createElement('span'),ref=document.createElement('span'),arrow=document.createElement('span');item.type='button';item.className='history-row';item.setAttribute('aria-label','View pass for '+row.personName);avatar.className='history-avatar';avatar.textContent=(row.personName??'V').split(' ').filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();copy.className='history-copy';name.textContent=row.personName;meta.textContent=projectText(row)+' · '+dateTime(row.submittedAtUtc??row.validFromUtc);ref.className='history-reference';ref.textContent=row.employeeId??row.publicReference;ref.title=row.publicPassNumber;copy.append(name,meta,ref);arrow.className='history-eye';arrow.innerHTML=eyeIcon;item.append(avatar,copy,badge(effective(row)),arrow);item.addEventListener('click',()=>openVisit(row));$('history-rows').append(item);count++;}cursor=result.cursor;if(cursor){const key=JSON.stringify(cursor);if(cursors.has(key))throw new Error('History changed. Retry.');cursors.add(key);}}while(cursor);}if(version===historyVersion)$('history-status').textContent=count?count+' registrations':'No registrations in this range.';}catch(error){if(version===historyVersion)$('history-status').textContent='History could not be fully loaded. '+error.message;}}
$('open-history').addEventListener('click',()=>{$('history-date').min=$('reception-date').min;$('history-date').max=$('reception-date').max;$('history-date').value=state.context.currentDate;for(const key of ['min','max','value'])$('history-end')[key]=$('history-date')[key];$('history-dialog').showModal();void loadHistory();});
$('history-date').addEventListener('change',loadHistory);$('history-end').addEventListener('change',loadHistory);$('refresh-history').addEventListener('click',loadHistory);$('close-history').addEventListener('click',()=>$('history-dialog').close());$('history-dialog').addEventListener('close',()=>{historyVersion++;$('history-rows').replaceChildren();});
for(const kpi of document.querySelectorAll('.kpi[role="button"]'))kpi.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();kpi.click();}});
if(cookie('gp-staff-csrf')||cookie('gp-reception-csrf')){$('staff-loading').hidden=false;api('me').then(setContext).catch(error=>{if(error.status!==401){$('staff-loading').textContent='Reception could not load. Reload to retry.';$('staff-loading').hidden=false;toasts.show(error.message,'error');}}).finally(()=>{$('staff-loading').hidden=!!state.context;});}else showLogin();

const reminderKeys=new Map();
async function reminderState(detail,version){
 $('remind-host').hidden=true;
 if(detail.requestType==='DIGITAL_ID'||effective(detail)!=='PENDING')return;
 $('remind-host').hidden=false;$('remind-host').disabled=true;
 try{const r=await api('remind-host',{visitRequestId:detail.visitRequestId});if(version!==state.detailVersion)return;$('remind-host').hidden=!r.eligible;$('remind-host').disabled=!r.eligible||r.mailStatus==='QUEUED'||Date.parse(r.nextReminderAtUtc)>Date.now();$('reminder-status').textContent='Host email: '+r.mailStatus.toLowerCase()+' · Last queued '+dateTime(r.lastQueuedAtUtc)+(r.mailStatus==='SENT'?' (delivery not confirmed)':'')+(r.mailStatus!=='QUEUED'&&Date.parse(r.nextReminderAtUtc)>Date.now()?' · Next reminder '+dateTime(r.nextReminderAtUtc):'');$('remind-host').textContent=r.mailStatus==='FAILED'?'Retry host email':'Remind host';}catch{if(version===state.detailVersion){$('remind-host').disabled=false;$('reminder-status').textContent='Email status unavailable. Retry to check.';}}
}
$('remind-host').addEventListener('click',async()=>{const detail=state.detail,version=state.detailVersion;if(!detail)return;const id=detail.visitRequestId;if(!reminderKeys.has(id))reminderKeys.set(id,crypto.randomUUID());$('remind-host').disabled=true;try{const r=await api('remind-host',{visitRequestId:id,clientKey:reminderKeys.get(id)});reminderKeys.delete(id);if(version!==state.detailVersion)return;$('reminder-status').textContent=r.outcome==='COOLDOWN'?'Please wait five minutes between reminders.':r.outcome==='ALREADY_QUEUED'?'Host email is already queued.':'Host reminder queued.';await reminderState(detail,version);}catch(error){if(version===state.detailVersion){$('reminder-status').textContent=error.message;$('remind-host').disabled=false;}}});

async function returnPass(row,devicesVerified=false){
 if(state.returnBusy||state.printBusy||!row||row.returnedAtUtc||row.printCount<1)return;
 if(row.isInside){toasts.show('Record all project exits before returning this pass.','error');return;}
 if(!devicesVerified){deviceReturn={row,office:state.location.locationId};$('devices-return-person').textContent=row.personName;$('return-explanation').textContent=row.deviceTypes?.length?'Confirm every declared device is leaving with the visitor. The printed pass will be marked returned and its QR will be revoked.':'Confirm you have collected the printed pass at final building exit. Its QR will be revoked. A mistaken return can be corrected with a reason.';$('confirm-devices-return').textContent=row.deviceTypes?.length?'Verify devices & mark returned':'Confirm returned';$('devices-return-list').replaceChildren(...(row.deviceTypes??[]).map(code=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.required=true;label.append(input,document.createTextNode(' '+deviceLabels[code]));label.style.display='block';return label;}));$('devices-return-status').textContent='';$('devices-return-dialog').showModal();return;}
 const id=row.visitRequestId,key=id+':'+row.accessPassId+':'+devicesVerified;
 if(!state.returnKeys.has(key))state.returnKeys.set(key,crypto.randomUUID());
 const wasSelected=state.selected?.visitRequestId===id,office=state.location.locationId;state.returnBusy=true;$('reception-location').disabled=true;renderRows();
 try{
  const result=await api('return',{visitRequestId:id,expectedPassId:row.accessPassId,clientKey:state.returnKeys.get(key),...(row.deviceTypes?.length&&devicesVerified?{devicesVerified:true}:{})});
  state.returnKeys.delete(key);if($('devices-return-dialog').open)$('devices-return-dialog').close();deviceReturn=null;Object.assign(row,{returnedAtUtc:result.returnedAtUtc,passStatus:'REVOKED',isInside:false});
  if(state.selected?.visitRequestId===id)closeVisit();
  toasts.show('Pass returned. Final building exit recorded.','success');
 }catch(error){if($('devices-return-dialog').open)$('devices-return-status').textContent='Return failed. Check all project exits and device verification, then retry.';toasts.show(error.status===409?'Pass could not be returned. Record all project exits and refresh to check whether the pass changed or was already returned.':error.message,'error');}
 finally{state.returnBusy=false;$('reception-location').disabled=false;if(state.context&&state.location.locationId===office){await loadVisits();if(wasSelected&&row.returnedAtUtc)await openVisit(row);}}
}

$('devices-return-form').addEventListener('submit',async event=>{event.preventDefault();if(!deviceReturn||state.returnBusy||!event.currentTarget.reportValidity())return;$('confirm-devices-return').disabled=true;try{if(deviceReturn.office!==state.location.locationId){deviceReturn=null;$('devices-return-dialog').close();return;}await returnPass(deviceReturn.row,true);}finally{$('confirm-devices-return').disabled=false;}});
$('cancel-devices-return').addEventListener('click',()=>{if(state.returnBusy)return;deviceReturn=null;$('devices-return-dialog').close();});
$('devices-return-dialog').addEventListener('cancel',event=>{if(state.returnBusy)event.preventDefault();else deviceReturn=null;});

// One office-scoped lookup opens the same detail/actions view for today and historical records.
const lookupState={version:0,cursor:null,rows:[],query:'',cameraVersion:0,decoder:null,correction:null};
const receptionCamera=new CameraSession(()=>navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false}));
let lookupTimer;
function closeLookupScanner(){lookupState.cameraVersion++;lookupState.decoder?.reset();lookupState.decoder=null;receptionCamera.close();$('lookup-video').srcObject=null;if($('lookup-scanner').open)$('lookup-scanner').close();}
function clearLookup(){lookupState.version++;lookupState.rows=[];lookupState.cursor=null;lookupState.correction=null;clearTimeout(lookupTimer);closeLookupScanner();$('lookup-results').replaceChildren();$('lookup-panel').hidden=true;$('correct-return-dialog').close();}
function cardStatusControl(row){
 if(!state.location?.canPrint||!row.returnedAtUtc&&!row.printCount){const tag=document.createElement('span');tag.className='status '+(row.returnedAtUtc?'returned':row.printCount?'printed':'unprinted');tag.textContent=row.returnedAtUtc?'Returned':row.printCount?'Printed':'Not printed';return tag;}
 const select=document.createElement('select');select.className='card-status-select';select.setAttribute('aria-label','Card status for '+row.personName);select.add(new Option(row.returnedAtUtc?'Returned':'Printed','CURRENT'));
 select.add(new Option(row.returnedAtUtc?'Correct mistaken return…':'Mark returned…',row.returnedAtUtc?'CORRECT':'RETURN'));
 select.disabled=state.returnBusy||state.printBusy||!!row.isInside;select.title=row.isInside?'Record every project exit before returning the pass':'Change printed pass return status';
 select.addEventListener('change',()=>{const value=select.value;select.value='CURRENT';if(value==='RETURN')void returnPass(row);if(value==='CORRECT'){lookupState.correction={row,office:state.location.locationId};$('correct-return-person').textContent=row.personName+' · '+row.publicPassNumber;$('correct-return-reason').value='';$('correct-return-status').textContent='';$('correct-return-dialog').showModal();}});return select;
}
async function lookupVisits(openSingle=false,more=false,credential=null){
 if(!state.context)return;const query=$('lookup-search').value.trim();if(!credential&&query.length<2){clearLookup();return;}const version=++lookupState.version,office=state.location.locationId;
 if(!more){lookupState.rows=[];lookupState.cursor=null;}lookupState.query=query;$('lookup-panel').hidden=false;$('lookup-status').textContent='Searching all registrations for this office…';$('lookup-more').disabled=true;
 try{const r=await api('lookup',{locationId:office,...(credential?{credential}:{search:query}),...(more&&lookupState.cursor?{cursor:lookupState.cursor}:{})});if(version!==lookupState.version||office!==state.location?.locationId)return;
 lookupState.rows.push(...r.matches);lookupState.cursor=r.cursor;$('lookup-results').replaceChildren(...lookupState.rows.map(row=>{const b=document.createElement('button');b.type='button';b.className='lookup-match';const name=document.createElement('strong'),meta=document.createElement('span');name.textContent=row.personName;meta.textContent=row.publicPassNumber+' · '+dateTime(row.submittedAtUtc)+' · '+kind(row);b.append(name,meta);b.addEventListener('click',()=>openVisit({...row,printCount:0}));return b;}));$('lookup-status').textContent=r.matches.length?'Matching registrations (all dates)':'No matching pass in this office.';$('lookup-more').hidden=!r.cursor;
 if(openSingle&&r.matches.length===1&&!r.cursor){$('lookup-panel').hidden=true;await openVisit({...r.matches[0],printCount:0});}
 }catch(e){if(version!==lookupState.version)return;$('lookup-results').replaceChildren();lookupState.rows=[];$('lookup-more').hidden=true;$('lookup-status').textContent=e.message;if(e.status===403)clearProtectedVisits();}finally{if(version===lookupState.version)$('lookup-more').disabled=false;}
}
async function startReceptionScanner(){
 if(!state.context||state.returnBusy||state.printBusy)return;closeLookupScanner();$('lookup-panel').hidden=true;$('lookup-scanner').showModal();const version=lookupState.cameraVersion;
 if(!navigator.mediaDevices?.getUserMedia){$('lookup-camera-status').textContent='Camera unavailable. Search by pass ID, name or mobile instead.';return;}
 const reader=new ZXing.BrowserQRCodeReader();lookupState.decoder=reader;$('lookup-camera-status').textContent='Opening camera…';
 try{const stream=await receptionCamera.open();if(!stream||version!==lookupState.cameraVersion)return;$('lookup-camera-status').textContent='Keep the pass QR inside the camera view.';await reader.decodeFromStream(stream,$('lookup-video'),result=>{if(!result||version!==lookupState.cameraVersion)return;const credential=result.getText();if(!/^[A-Za-z0-9_-]{43}$/u.test(credential)){$('lookup-camera-status').textContent='This is not a GatePass pass QR. Scan the printed pass QR.';return;}closeLookupScanner();void lookupVisits(true,false,credential);});if(version!==lookupState.cameraVersion)reader.reset();}
 catch{if(version===lookupState.cameraVersion){lookupState.decoder?.reset();lookupState.decoder=null;receptionCamera.close();$('lookup-camera-status').textContent='Camera could not start. Allow camera access or search by pass ID.';}}
}
$('lookup-form').addEventListener('submit',event=>{event.preventDefault();clearTimeout(lookupTimer);void lookupVisits(true);});
$('lookup-search').addEventListener('input',()=>{clearTimeout(lookupTimer);lookupState.version++;lookupTimer=setTimeout(()=>lookupVisits(),350);});
$('lookup-more').addEventListener('click',()=>lookupVisits(false,true));$('lookup-clear').addEventListener('click',clearLookup);
$('lookup-scan').addEventListener('click',startReceptionScanner);$('lookup-scan-close').addEventListener('click',closeLookupScanner);$('lookup-scanner').addEventListener('cancel',event=>{event.preventDefault();closeLookupScanner();});
$('correct-return-close').addEventListener('click',()=>{if(state.returnBusy)return;lookupState.correction=null;$('correct-return-dialog').close();});$('correct-return-dialog').addEventListener('cancel',event=>{if(state.returnBusy)event.preventDefault();else lookupState.correction=null;});
$('correct-return-form').addEventListener('submit',async event=>{
 event.preventDefault();const correction=lookupState.correction;if(!correction||state.returnBusy||!event.currentTarget.reportValidity()||correction.office!==state.location.locationId)return;
 const row=correction.row,reason=$('correct-return-reason').value.trim(),key='CORRECT:'+row.visitRequestId+':'+row.accessPassId+':'+row.returnedAtUtc+':'+reason;if(!state.returnKeys.has(key))state.returnKeys.set(key,crypto.randomUUID());state.returnBusy=true;$('reception-location').disabled=true;$('correct-return-submit').disabled=true;
 try{await api('correct-return',{visitRequestId:row.visitRequestId,expectedPassId:row.accessPassId,expectedReturnedAtUtc:row.returnedAtUtc,reason,clientKey:state.returnKeys.get(key)});state.returnKeys.delete(key);row.returnedAtUtc=null;row.passStatus=row.status==='APPROVED'?'ACTIVE':'PENDING';$('correct-return-dialog').close();lookupState.correction=null;await loadVisits();await openVisit(row);toasts.show('Mistaken return corrected. Original return and reason are retained in the audit trail.','success');}
 catch(e){$('correct-return-status').textContent=e.status===409?'Correction blocked: this pass changed, has project presence or a replacement request. Refresh the entry before retrying.':e.message;}
 finally{state.returnBusy=false;$('reception-location').disabled=false;$('correct-return-submit').disabled=false;renderRows();if(state.selected){$('detail-card-control').replaceChildren(cardStatusControl(state.selected));$('detail-print').disabled=state.printBusy||!canPrint(state.selected);}}
});

document.addEventListener('visibilitychange',()=>{if(document.hidden)closeLookupScanner();});

const liveRefresh=new LiveRefresh(()=>loadVisits(false,true),()=>!!state.context&&!state.listBusy&&!state.calendarBusy&&!state.printBusy&&!state.returnBusy&&!state.accessDenied&&workspaceIdle(),20000,()=>state.context&&state.location&&!state.accessDenied&&cookie('gp-staff-csrf')?{workspace:'RECEPTION',locationId:state.location.locationId}:null);
