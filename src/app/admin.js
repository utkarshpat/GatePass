"use strict";
const $=id=>document.getElementById(id),toasts=new ToastNotifications();
const state={office:null,areas:[],areasLoaded:false,areaAssignments:[],areaRequest:0,projects:[],cursor:null,listVersion:0,dialogVersion:0,searchVersion:0,project:null,leadCursor:null,selected:null,busy:false,removing:null,grantAttempt:null,revokeAttempt:null};let searchTimer;
const csrf=()=>document.cookie.split('; ').find(v=>v.startsWith('gp-staff-csrf='))?.split('=')[1];
async function api(action,body={},staff=false){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
 try{const response=await fetch('/api/'+(staff?'staff/':'admin/')+action,{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf()??''},body:JSON.stringify(body)});
 if(!response.ok){if(response.status===401)location.replace('/');throw Object.assign(new Error(({400:'Check the details.',401:'Sign in again to continue.',403:'Your access to this scope is unavailable.',409:'This assignment changed. Refresh and try again.',429:'Please wait before trying again.'})[response.status]??'Unable to complete the request. Please retry.'),{status:response.status});}return await response.json();
 }catch(error){if(error.status)throw error;throw new Error(controller.signal.aborted?'Request timed out. Refresh to check the result before retrying.':'Connection lost. Please retry.');}finally{clearTimeout(timer);}
}
function node(tag,text,className){const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;}
function button(text,fn,className='secondary'){const n=node('button',text,className);n.type='button';n.addEventListener('click',fn);return n;}
function fail(error){if(error.status===403){clearConsole();$('page-status').textContent='Your permissions changed or this scope is unavailable. Refresh to reload authorized access.';}toasts.show(error.message,'error');}
const initials=name=>String(name).split(/\s+/u).filter(Boolean).slice(0,2).map(w=>[...w][0]).join('').toUpperCase()||'?';
const leadPreview={queue:[],active:0,observer:null,pending:new Map()};
function pauseLeadPreviews(){
 leadPreview.observer?.disconnect();leadPreview.observer=null;
 for(const [p] of leadPreview.queue.splice(0))if(p.leadPreview===null)delete p.leadPreview;
}
function readLeadPage(p,cursor){
 const projectLocationId=p.projectLocationId,key=JSON.stringify([consoleState.version,state.office.locationId,csrf(),projectLocationId,p.leadRevision??0,cursor??null]);
 let pending=leadPreview.pending.get(key);
 if(!pending){pending=api('leads',{projectLocationId,...(cursor?{cursor}:{})}).finally(()=>{if(leadPreview.pending.get(key)===pending)leadPreview.pending.delete(key);});leadPreview.pending.set(key,pending);}
 return pending.then(result=>structuredClone(result));
}
function invalidateProjectLeads(){const p=state.project;if(p){p.leadRevision=(p.leadRevision??0)+1;delete p.leadPreview;}}
function fillLeadStrip(p){
 const strip=p.leadSlot,pv=p.leadPreview;if(!strip)return;strip.replaceChildren();
 if(!pv){strip.append(node('span','Loading leads…'));return;}
 if(pv.failed){strip.append(node('span','Leads unavailable'));return;}
 if(!pv.names.length){strip.append(node('span','No project lead assigned','status-chip warn'));return;}
 const stack=node('span','','avatar-stack');
 for(const [i,name] of pv.names.slice(0,3).entries()){const a=node('span',initials(name),'mini-avatar avatar-tone-'+(i%5));a.title=name;a.setAttribute('aria-hidden','true');stack.append(a);}
 const extra=pv.names.length-2;
 strip.append(stack,node('span',pv.names.slice(0,2).join(', ')+(extra>0?' +'+extra+(pv.more?'+':'')+' more':pv.more?' and more':''),'lead-names'));
}
function updateProjectSummary(){
 const total=state.projects.length,areas=state.areas.length;
 $('projects-summary').textContent=total+' '+(total===1?'project':'projects')+' · '+areas+' '+(areas===1?'common area':'common areas');const shown=$('projects').querySelectorAll('.project-card').length;if(shown<(state.projectMatchCount??0))$('projects-summary').textContent+=' · Showing '+shown+' / '+state.projectMatchCount;
}
function projectCard(p,index){
 const card=node('article','','project-row project-card'),top=node('div','','project-card-top'),avatar=node('span',initials(p.projectName),'project-avatar avatar-tone-'+(index%5)),copy=node('div','','project-card-copy');
 avatar.setAttribute('aria-hidden','true');copy.append(node('span','Project','workspace-kind'),node('h3',p.projectName),node('p',p.projectCode,'project-code'));top.append(avatar,copy);
 if(!p.directoryCurrent)top.append(node('span','Directory refresh required','status-chip warn'));
 const strip=node('div','','project-leads-strip'),actions=node('div','','project-card-actions');p.leadSlot=strip;fillLeadStrip(p);
 actions.append(button('Project leads',()=>openLeads(p),'secondary'));
 if(p.directoryCurrent&&(p.canAssignProject||p.canAssignLocation)){const add=button('Add lead',()=>openLeads(p,true),'primary');add.setAttribute('aria-label','Add lead to '+p.projectName);actions.append(add);}
 card.append(top,strip,actions);return card;
}
function areaCard(area,index){
 const card=node('article','','project-row project-card area-card'),top=node('div','','project-card-top'),avatar=node('span',initials(area.name),'project-avatar avatar-tone-'+(index%5)),copy=node('div','','project-card-copy');
 card.dataset.areaId=area.areaId;avatar.setAttribute('aria-hidden','true');copy.append(node('span','Common area','workspace-kind'),node('h3',area.name));top.append(avatar,copy);
 const duties=state.areaAssignments.filter(a=>a.areaId===area.areaId),strip=node('div','','project-leads-strip'),actions=node('div','','project-card-actions');
 const names=[...new Set(duties.map(a=>a.guardName))];strip.append(node('span',names.length?names.slice(0,2).join(', ')+(names.length>2?' +'+(names.length-2)+' more':''):'No guard assigned',names.length?'lead-names':'status-chip warn'));
 actions.append(button('Assigned guards',()=>openCommon('duties',area),'secondary'));
 const assign=button('Assign guard',()=>openCommon('assign',area),'primary');assign.setAttribute('aria-label','Assign guard to '+area.name);actions.append(assign);card.append(top,strip,actions);return card;
}
function renderProjects(){
 const q=$('project-search').value.trim().toLowerCase(),projects=state.projects.filter(p=>!q||(p.projectName+' '+p.projectCode).toLowerCase().includes(q)),areas=state.areas.filter(a=>!q||a.name.toLowerCase().includes(q));
 const entries=[...projects.map(item=>({kind:'project',item})),...areas.map(item=>({kind:'area',item}))].sort((a,b)=>(a.item.projectName??a.item.name).localeCompare(b.item.projectName??b.item.name));
 if(state.projectSearch!==q){state.projectSearch=q;state.projectRenderLimit=24;}state.projectMatchCount=entries.length;const shown=entries.slice(0,state.projectRenderLimit??24);$('more-projects').hidden=shown.length>=entries.length;
 $('projects').replaceChildren(...shown.map(({kind,item})=>kind==='project'?projectCard(item,state.projects.indexOf(item)):areaCard(item,state.areas.indexOf(item))));
 if(!projects.length&&!areas.length)$('projects').append(node('p',q?'No projects or common areas match your search.':'No projects or common areas in this office.','empty-note'));
 updateProjectSummary();previewLeads();
}
async function readCommonCatalogue(locationId,current){
 const areas=new Map(),assignments=[];
 for(let offset=0;offset<10000;){
  const r=await api('common-duties',{locationId,search:'',offset});if(!current())return null;
  for(const area of r.areas)areas.set(area.areaId,area);assignments.push(...r.assignments);
  if(!r.hasMore)return{areas:[...areas.values()],assignments};
  if(!r.assignments.length)break;offset+=r.assignments.length;
 }
 throw Error('Too many common duties. Contact your office administrator.');
}
async function loadWorkspaceAreas(){
 if(!state.office?.canManageCommonAreas||!consoleState.scope)return;
 const version=consoleState.version,request=++state.areaRequest,current=()=>version===consoleState.version&&request===state.areaRequest;
 $('common-catalog-status').textContent='Loading common areas…';
 try{const r=await readCommonCatalogue(state.office.locationId,current);if(!r||!current())return;state.areas=r.areas;state.areasLoaded=true;state.areaAssignments=r.assignments;$('common-catalog-status').textContent='';renderProjects();}
 catch(error){if(current()){$('common-catalog-status').textContent='Common areas could not be loaded. Use Refresh to retry.';fail(error);}}
}
function pumpLeadPreviews(){
 while(leadPreview.active<3&&leadPreview.queue.length&&consoleState.scope&&consoleState.view==='projects'){
  const [p,version]=leadPreview.queue.shift();if(version!==consoleState.version||!p.leadSlot?.isConnected){if(p.leadPreview===null)delete p.leadPreview;continue;}leadPreview.active++;
  const revision=p.leadRevision;readLeadPage(p).then(r=>{if(version===consoleState.version&&revision===p.leadRevision)p.leadPreview={names:r.leads.map(l=>l.displayName),more:!!r.cursor};},()=>{if(version===consoleState.version&&revision===p.leadRevision)p.leadPreview={failed:true};}).finally(()=>{leadPreview.active--;if(version===consoleState.version){fillLeadStrip(p);updateProjectSummary();}pumpLeadPreviews();});
 }
}
function previewLeads(){
 pauseLeadPreviews();if(!consoleState.scope||consoleState.view!=='projects'||$('admin-projects').hidden)return;const version=consoleState.version;
 const enqueue=p=>{if(version!==consoleState.version||consoleState.view!=='projects'||!p.leadSlot?.isConnected||p.leadPreview!==undefined)return;p.leadPreview=null;leadPreview.queue.push([p,version]);pumpLeadPreviews();};
 if(typeof IntersectionObserver!=='function'){for(const p of state.projects)enqueue(p);return;}
 const projects=new Map(state.projects.filter(p=>p.leadSlot?.isConnected&&p.leadPreview===undefined).map(p=>[p.leadSlot,p]));
 const observer=new IntersectionObserver(entries=>{if(leadPreview.observer!==observer)return;for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);const p=projects.get(entry.target);if(p)enqueue(p);}},{root:null,rootMargin:'150px'});
 leadPreview.observer=observer;for(const target of projects.keys())observer.observe(target);
}
function resetSearch(){clearTimeout(searchTimer);state.searchVersion++;state.selected=null;$('employee-search').value='';$('employee-results').replaceChildren();$('selected-employee').hidden=true;$('search-status').textContent='';$('add-lead').disabled=true;}
function closeLeads(){if(state.busy)return;state.dialogVersion++;state.searchVersion++;state.project=null;resetSearch();$('lead-dialog').close();}
function openLeads(p,focusAdd=false){state.dialogVersion++;state.project=p;state.leadCursor=null;state.grantAttempt=state.revokeAttempt=null;state.removing=null;resetSearch();$('remove-form').hidden=true;$('grant-reason').value='';$('lead-project').textContent=p.projectName+' · '+state.office.locationName;$('lead-list').replaceChildren();$('lead-form').hidden=!(p.directoryCurrent&&(p.canAssignProject||p.canAssignLocation));$('lead-scope').replaceChildren(...[...(p.canAssignLocation?[new Option(state.office.locationName+' only','PROJECT_LOCATION')]:[]),...(p.canAssignProject?[new Option('All offices in this project','PROJECT')]:[])]);if(!$('lead-dialog').open)$('lead-dialog').showModal();if(focusAdd&&!$('lead-form').hidden)$('employee-search').focus();loadLeads();}
async function loadLeads(more=false){const version=state.dialogVersion,p=state.project,revision=p.leadRevision;$('more-leads').disabled=true;$('lead-status').textContent='Loading leads…';if(!more)$('lead-list').replaceChildren();try{const r=await readLeadPage(p,more?state.leadCursor:null);if(version!==state.dialogVersion||revision!==p.leadRevision)return;state.leadCursor=r.cursor;if(!more){p.leadPreview={names:r.leads.map(l=>l.displayName),more:!!r.cursor};fillLeadStrip(p);updateProjectSummary();}for(const lead of r.leads){const row=node('div','','lead-row'),info=node('div',''),avatar=node('span',initials(lead.displayName),'lead-avatar avatar-tone-'+(r.leads.indexOf(lead)%5));avatar.setAttribute('aria-hidden','true');row.append(avatar);info.append(node('strong',lead.displayName),node('p',[lead.employeeId,lead.email].filter(Boolean).join(' · '),'hint'),node('p',lead.scopeType==='PROJECT'?'All offices in this project':state.office.locationName+' only','lead-scope'));row.append(info);if(lead.canRemove){const b=button('Remove',()=>beginRemove(lead),'quiet');b.dataset.remove='true';row.append(b);} $('lead-list').append(row);}$('lead-status').textContent=$('lead-list').children.length?'':'No project leads assigned.';$('more-leads').hidden=!state.leadCursor;}catch(e){if(version===state.dialogVersion){$('lead-status').textContent='Leads could not be loaded.';fail(e);}}finally{if(version===state.dialogVersion)$('more-leads').disabled=state.busy;}}
function beginRemove(lead){if(state.busy)return;state.removing=lead;state.revokeAttempt=null;$('remove-title').textContent='Remove '+lead.displayName+'?';$('remove-reason').value='';$('lead-form').hidden=true;$('remove-form').hidden=false;$('remove-reason').focus();}
function cancelRemove(){if(state.busy)return;state.removing=null;$('remove-form').hidden=true;const p=state.project;$('lead-form').hidden=!(p.directoryCurrent&&(p.canAssignProject||p.canAssignLocation));}
function busy(value){state.busy=value;$('close-leads').disabled=$('cancel-remove').disabled=$('more-leads').disabled=value;for(const f of [$('lead-form'),$('remove-form')])for(const c of f.elements)c.disabled=value;for(const c of document.querySelectorAll('[data-remove]'))c.disabled=value;if(!value)$('add-lead').disabled=!state.selected;}
function retainedKey(key,payload){const fingerprint=JSON.stringify(payload);if(state[key]?.fingerprint!==fingerprint)state[key]={fingerprint,key:crypto.randomUUID()};return state[key].key;}
$('employee-search').addEventListener('input',()=>{clearTimeout(searchTimer);const version=++state.searchVersion,q=$('employee-search').value.trim(),dialog=state.dialogVersion;state.selected=null;$('selected-employee').hidden=true;$('add-lead').disabled=true;$('employee-results').replaceChildren();$('search-status').textContent=q.length>=2?'Searching…':'';if(q.length<2)return;searchTimer=setTimeout(async()=>{try{const r=await api('candidates',{projectLocationId:state.project.projectLocationId,search:q});if(version!==state.searchVersion||dialog!==state.dialogVersion||state.busy)return;$('employee-results').replaceChildren(...r.employees.map(e=>{const b=button('',()=>{if(state.busy)return;state.selected=e;$('selected-employee').replaceChildren(node('strong',e.displayName),node('p',e.employeeId+' · '+e.email,'hint'));$('selected-employee').hidden=false;$('employee-results').replaceChildren();$('search-status').textContent='';$('add-lead').disabled=false;},'employee-result');b.append(node('span',e.displayName),node('span',e.employeeId+' · '+e.email,'hint'));return b;}));$('search-status').textContent=r.employees.length?'':'No employees found.';}catch(e){if(version===state.searchVersion&&dialog===state.dialogVersion){$('search-status').textContent='Search unavailable. Try again.';fail(e);}}},300);});
$('lead-form').addEventListener('submit',async event=>{event.preventDefault();if(state.busy||!state.selected||!$('lead-form').reportValidity())return;const p=state.project,scope=$('lead-scope').value,payload={targetUserId:state.selected.userId,roleCode:'PROJECT_ADMIN',scopeType:scope,...(scope==='PROJECT'?{projectId:p.projectId}:{projectLocationId:p.projectLocationId}),capabilities:['VISITS_READ','GUARDS_MANAGE','REPORTS_READ','REPORTS_EXPORT','AUDIT_READ','ROLE_GRANTS_MANAGE'],reason:$('grant-reason').value.trim()};const clientKey=retainedKey('grantAttempt',payload);busy(true);try{await api('grant',{...payload,clientKey});state.grantAttempt=null;resetSearch();$('grant-reason').value='';toasts.show('Project lead added.','success');invalidateProjectLeads();await loadLeads();}catch(e){fail(e);}finally{busy(false);}});
$('remove-form').addEventListener('submit',async event=>{event.preventDefault();if(state.busy||!state.removing||!$('remove-form').reportValidity())return;const payload={roleGrantId:state.removing.roleGrantId,reason:$('remove-reason').value.trim()},clientKey=retainedKey('revokeAttempt',payload);busy(true);try{await api('revoke',{...payload,clientKey});state.revokeAttempt=null;busy(false);cancelRemove();toasts.show('Project lead removed.','success');invalidateProjectLeads();await loadLeads();}catch(e){fail(e);}finally{busy(false);}});
$('close-leads').addEventListener('click',closeLeads);$('lead-dialog').addEventListener('cancel',e=>{e.preventDefault();closeLeads();});$('cancel-remove').addEventListener('click',cancelRemove);$('more-leads').addEventListener('click',()=>loadLeads(true));$('refresh').addEventListener('click',()=>state.office?refreshConsole():initialize());$('more-projects').addEventListener('click',()=>{state.projectRenderLimit=(state.projectRenderLimit??24)+24;renderProjects();});$('admin-office').addEventListener('change',()=>{if(consoleState.writing||state.busy||commonState.busy)return;state.office=state.offices.find(o=>String(o.locationId)===$('admin-office').value);$('office-name').textContent=state.office.locationName;void prepareConsole();});$('staff-logout').addEventListener('click',async()=>{if(state.busy||consoleState.writing||commonState.busy)return;try{await api('logout',{},true);location.replace('/');}catch(e){fail(e);}});
async function initialize(){consoleState.datesInitialized=false;clearConsole();try{const r=await api('context');state.offices=r.locations;state.office=r.locations[0];$('staff-name').textContent=r.displayName;$('staff-session').hidden=false;$('office-name').textContent=state.office.locationName;$('admin-office').replaceChildren(...r.locations.map(o=>new Option(o.locationName,String(o.locationId))));syncOfficeChip();await prepareConsole();}catch(e){$('page-status').textContent='Projects unavailable. Use Refresh to retry.';fail(e);}}
function syncOfficeChip(){const many=state.offices.length>1;$('office-selector').hidden=!many;$('office-static').hidden=many||!state.office;$('office-name').textContent=state.office?.locationName??'';}
enhanceSelect($('admin-office'));enhanceSelect($('lead-scope'));
// Initialize after console helpers are declared.

const commonState={office:null,version:0,searchVersion:0,busy:false,guard:null,remove:null,offset:0,area:null,attempt:null};
let commonSearchTimer;
function switchCommonTab(tab){
  for(const b of document.querySelectorAll('.dialog-tab-btn')){
    const active=b.dataset.commonTab===tab;
    b.classList.toggle('active',active);
    b.setAttribute('aria-selected',String(active));
  }
  if($('common-view-duties'))$('common-view-duties').hidden=tab!=='duties';
  if($('common-assign'))$('common-assign').hidden=tab!=='assign';
  if($('common-remove'))$('common-remove').hidden=true;
}
for(const b of document.querySelectorAll('.dialog-tab-btn'))b.addEventListener('click',()=>switchCommonTab(b.dataset.commonTab));
function commonQuery(search='',offset=0){return api('common-duties',{locationId:commonState.office.locationId,search,offset});}
function commonBusy(value){commonState.busy=value;for(const c of $('common-dialog').querySelectorAll('button,input,select'))c.disabled=value;if(!value)$('common-assign-button').disabled=!commonState.guard;}
async function commonLoad(){
 const version=++commonState.version,office=commonState.office,area=commonState.area,current=()=>version===commonState.version;
 $('common-status').textContent='Loading guards…';$('common-assign-button').disabled=true;
 try{
  const r=await readCommonCatalogue(office.locationId,current);if(!r||!current())return;
  if(!r.areas.some(a=>a.areaId===area.areaId))throw Object.assign(Error('This common area is no longer available. Refresh your office.'),{status:403});
  $('common-area').replaceChildren(new Option(area.name,area.areaId));
  $('common-assignments').replaceChildren();
  for(const a of r.assignments.filter(a=>a.areaId===area.areaId)){
   const row=node('div','','lead-row'),copy=node('div','');copy.append(node('strong',a.guardName),node('p',a.areaName,'hint'));
   row.append(copy,button('Remove',()=>{commonState.remove=a;$('common-remove-title').textContent='Remove '+a.guardName+' from '+a.areaName+'?';$('common-remove-reason').value='';$('common-remove').hidden=false;$('common-view-duties').hidden=$('common-assign').hidden=true;$('common-remove-reason').focus();},'quiet'));$('common-assignments').append(row);
  }
  $('common-more').hidden=true;$('common-status').textContent=$('common-assignments').children.length?'':'No guards assigned to this area.';$('common-assign-button').disabled=commonState.busy||!commonState.guard;
 }catch(error){if(current()){$('common-status').textContent='Guards unavailable. Close and reopen to retry.';fail(error);}}
}
async function commonWrite(command){
 if(commonState.busy)return;commonState.searchVersion++;clearTimeout(commonSearchTimer);
 const payload={locationId:commonState.office.locationId,...command},fingerprint=JSON.stringify(payload);
 if(commonState.attempt?.fingerprint!==fingerprint)commonState.attempt={fingerprint,clientKey:crypto.randomUUID()};commonBusy(true);
 try{await api('common-duty',{...payload,clientKey:commonState.attempt.clientKey});commonState.attempt=null;commonState.guard=null;commonState.remove=null;$('common-selected').textContent='';$('common-guard-results').replaceChildren();switchCommonTab('duties');$('common-assign').reset();await commonLoad();await loadWorkspaceAreas();toasts.show('Guard duty saved.','success');}catch(error){fail(error);}finally{commonBusy(false);}
}
function openCommon(tab,area){
 if(!consoleState.scope||!state.office?.canManageCommonAreas||!area||commonState.busy||consoleState.writing)return;
 commonState.office={...state.office};commonState.area=area;commonState.guard=commonState.remove=null;commonState.attempt=null;
 $('common-title').textContent=area.name+' · '+commonState.office.locationName;$('common-selected').textContent='';$('common-guard-results').replaceChildren();$('common-guard-search').value='';$('common-area').replaceChildren(new Option(area.name,area.areaId));$('common-assign-reason').value='';switchCommonTab(tab);$('common-dialog').showModal();commonLoad();
}
$('project-search').addEventListener('input',renderProjects);
function closeCommon(){if(commonState.busy)return;commonState.version++;commonState.searchVersion++;clearTimeout(commonSearchTimer);$('common-dialog').close();}
$('common-close').addEventListener('click',closeCommon);$('common-dialog').addEventListener('cancel',e=>{e.preventDefault();closeCommon();});
$('common-guard-search').addEventListener('input',()=>{clearTimeout(commonSearchTimer);const version=++commonState.searchVersion,query=$('common-guard-search').value.trim();commonState.guard=null;$('common-assign-button').disabled=true;$('common-selected').textContent='';$('common-guard-results').replaceChildren();if(query.length<2)return;commonSearchTimer=setTimeout(async()=>{try{const r=await commonQuery(query);if(version!==commonState.searchVersion)return;$('common-guard-results').replaceChildren(...r.guards.map(g=>{const item=button(g.displayName,()=>{commonState.guard=g;$('common-selected').textContent=g.displayName;$('common-guard-results').replaceChildren();$('common-assign-button').disabled=false;},'quiet');item.dataset.guardUserId=g.userId.toLowerCase();return item;}));if(!r.guards.length)$('common-selected').textContent='No matching guards in this office.';}catch(e){if(version===commonState.searchVersion)fail(e);}},250);});
$('common-assign').addEventListener('submit',e=>{e.preventDefault();if(!commonState.guard||!$('common-assign').reportValidity())return;commonWrite({action:'ASSIGN',areaId:commonState.area.areaId,guardUserId:commonState.guard.userId,reason:$('common-assign-reason').value.trim()});});
$('common-remove').addEventListener('submit',e=>{e.preventDefault();if(!commonState.remove||!$('common-remove').reportValidity())return;commonWrite({action:'REMOVE',assignmentId:commonState.remove.assignmentId,reason:$('common-remove-reason').value.trim()});});
$('common-cancel-remove').addEventListener('click',()=>{commonState.remove=null;switchCommonTab('duties');});$('common-more').addEventListener('click',()=>commonLoad(true));

const consoleState={view:'overview',version:0,scope:null,pair:null,subjects:[],subject:null,subjectCursor:null,roleCursor:null,assignmentCursor:null,guardCursor:null,reportCursor:null,reportDay:null,auditCursor:null,confirm:null,writing:false,searchVersion:0,detailVersion:0,requests:{},allowedViews:{},officeWide:false};
function requestToken(kind){const value=(consoleState.requests[kind]??0)+1;consoleState.requests[kind]=value;return value;}
const titles={overview:'Overview',projects:'Projects & areas',staff:'Users & permissions',assignments:'Guard assignments',offices:'Offices & QR',reports:'Visit register',audit:'Audit log'};
const roleCaps={GUARD:['VISITS_READ','PROJECT_MOVEMENT','TEMP_ID_MOVEMENT','RECONCILE_EXIT'],RECEPTION:['VISITS_READ','PASS_PRINT','PASS_REISSUE'],PROJECT_ADMIN:['VISITS_READ','GUARDS_MANAGE','REPORTS_READ','REPORTS_EXPORT','AUDIT_READ','ROLE_GRANTS_MANAGE'],LOCATION_ADMIN:['VISITS_READ','GUARDS_MANAGE','REPORTS_READ','REPORTS_EXPORT','AUDIT_READ','GUARD_CREDENTIALS_MANAGE','STAFF_CREDENTIALS_MANAGE','ROLE_GRANTS_MANAGE'],INDIA_ADMIN:['VISITS_READ','GUARDS_MANAGE','REPORTS_READ','REPORTS_EXPORT','AUDIT_READ','GUARD_CREDENTIALS_MANAGE','STAFF_CREDENTIALS_MANAGE','ROLE_GRANTS_MANAGE'],PLATFORM_ADMIN:['VISITS_READ','GUARDS_MANAGE','REPORTS_READ','REPORTS_EXPORT','AUDIT_READ','GUARD_CREDENTIALS_MANAGE','STAFF_CREDENTIALS_MANAGE','ROLE_GRANTS_MANAGE']};
const human=s=>String(s).toLowerCase().replaceAll('_',' ').replace(/^./u,x=>x.toUpperCase());
const dateTime=v=>v?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(new Date(v))+' IST':'No end date';
const dayAfter=day=>new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10);
const indiaStart=day=>new Date(day+'T00:00:00+05:30').toISOString();
const scopeBody=()=>({locationId:state.office.locationId,...(consoleState.pair?{projectLocationId:consoleState.pair.projectLocationId}:{})});
function clearConsole(){pauseLeadPreviews();leadPreview.pending.clear();clearOnboarding();state.areas=[];state.areasLoaded=false;state.areaAssignments=[];state.areaRequest++;$('common-catalog-status').textContent='';$('add-project-open').hidden=true;$('add-project-form').reset();$('new-project-status').textContent='';state.projectCreateAttempt=null;state.newProjectOfficeId=null;$('add-staff-open').hidden=$('add-guard-open').hidden=$('reset-staff-setup').hidden=true;registerState.total=0;registerState.page=1;registerState.rows=[];registerState.filter=null;registerState.loading=false;registerState.exporting=false;$('register-page').textContent='';$('report-status').textContent='';$('register-apply').disabled=false;$('register-previous').disabled=true;consoleState.version++;consoleState.searchVersion++;consoleState.detailVersion++;state.dialogVersion++;state.searchVersion++;commonState.version++;commonState.searchVersion++;clearTimeout(searchTimer);clearTimeout(commonSearchTimer);state.selected=null;state.project=null;commonState.guard=null;commonState.remove=null;commonState.area=null;commonState.office=null;$('common-area').replaceChildren();$('common-title').textContent='Common area';for(const id of ['add-project-dialog','lead-dialog','common-dialog','assign-dialog','admin-visit-dialog','admin-profile-dialog','admin-confirm-dialog','qr-dialog'])if($(id)?.open)$(id).close();consoleState.subject=null;consoleState.scope=null;consoleState.allowedViews={};for(const b of document.querySelectorAll('[data-admin-view]'))b.hidden=true;for(const key of Object.keys(titles))$('admin-'+key).hidden=true;$('audit-all').checked=false;$('audit-all-label').hidden=true;$('office-selector').hidden=$('office-static').hidden=true;syncScopeBar();$('staff-grant-form').hidden=true;$('allocation-guard').replaceChildren();leadPreview.queue.length=0;for(const p of state.projects)if(p.leadPreview===null)delete p.leadPreview;roster.guards=[];roster.duties=[];roster.common=[];auditState.events=[];$('register-export').disabled=true;for(const id of ['projects','lead-list','employee-results','selected-employee','common-assignments','common-guard-results','common-selected','summary-cards','presence-cards','chart-status','chart-trend','subject-results','staff-roles','assignment-list','project-duty-list','guard-stats','report-list','audit-list','office-list','profile-content'])$(id).replaceChildren();$('staff-detail').hidden=true;$('office-qr').hidden=true;$('qr-image').removeAttribute('src');$('qr-download').removeAttribute('href');for(const id of ['subjects-more','roles-more','reports-more','audit-more'])$(id).hidden=true;}
async function prepareConsole(){
 const previousPair=consoleState.pair?.projectLocationId;clearConsole();const version=consoleState.version;$('console-project').disabled=true;$('page-status').textContent='Loading authorized scope…';
 state.projects=[];state.cursor=null;const seen=new Set();let cursor=null;
 try{do{const r=await api('projects',{locationId:state.office.locationId,...(cursor?{cursor}:{})});if(version!==consoleState.version)return;for(const p of r.projects)if(!seen.has(p.projectLocationId)){seen.add(p.projectLocationId);state.projects.push(p);}cursor=r.cursor;if(cursor&&seen.size>10000)throw Error('Too many projects. Narrow the office scope.');}while(cursor);
 renderProjects();
 $('console-project').replaceChildren(new Option('All authorized projects in office',''),...state.projects.map(p=>new Option(p.projectName+' · '+p.projectCode,p.projectLocationId)));
 // Office-wide scope may be unavailable to a project admin. Select the first authorized project in that case.
 try{const scope=await api('scope',{locationId:state.office.locationId});if(version!==consoleState.version)return;consoleState.scope=scope;consoleState.pair=null;consoleState.officeWide=true;}catch(error){if(error.status!==403||!state.projects.length)throw error;const p=state.projects[0];const scope=await api('scope',{locationId:state.office.locationId,projectLocationId:p.projectLocationId});if(version!==consoleState.version)return;consoleState.scope=scope;consoleState.pair=p;consoleState.officeWide=false;$('console-project').value=p.projectLocationId;$('console-project').querySelector('option[value=""]').remove();}
 if(previousPair&&consoleState.pair?.projectLocationId!==previousPair){const p=state.projects.find(x=>x.projectLocationId===previousPair);if(p){const sc=await api('scope',{locationId:state.office.locationId,projectLocationId:p.projectLocationId});if(version!==consoleState.version)return;consoleState.pair=p;consoleState.scope=sc;$('console-project').value=p.projectLocationId;}}
 if(version!==consoleState.version)return;for(const id of ['overview-from','overview-to','report-from','report-to','audit-from','audit-to'])if(!consoleState.datesInitialized||!$(id).value)$(id).value=consoleState.scope.currentDate;consoleState.datesInitialized=true;setScope();await showAdminView(consoleState.view);
 }catch(error){if(version===consoleState.version){clearConsole();$('page-status').textContent='Administration could not load. Use Refresh to retry.';fail(error);}}finally{if(version===consoleState.version)$('console-project').disabled=false;}
}
function setScope(){const sc=consoleState.scope;if(!sc)return;if($('open-action-centre'))$('open-action-centre').hidden=!sc.canReport;$('add-project-open').hidden=!(state.office.canCreateProject||state.office.canManageCommonAreas);renderProjects();$('scope-hint').textContent=consoleState.pair?consoleState.pair.projectName+' · '+state.office.locationName:'Authorized office scope';syncOfficeChip();$('audit-all-label').hidden=!(sc.canAudit&&sc.roles.some(r=>['INDIA','PLATFORM'].includes(r.scopeType)));const permissions={overview:sc.canReport,projects:true,staff:sc.canManageRoles,assignments:sc.canAssignGuards,offices:true,reports:sc.canReadVisits,audit:sc.canAudit};consoleState.allowedViews=permissions;for(const b of document.querySelectorAll('[data-admin-view]'))b.hidden=!permissions[b.dataset.adminView];for(const group of document.querySelectorAll('.admin-nav-group'))group.hidden=![...group.querySelectorAll('[data-admin-view]')].some(b=>!b.hidden);if(!permissions[consoleState.view])consoleState.view='projects';$('staff-role').replaceChildren(...sc.delegations.map((d,i)=>new Option(human(d.roleCode)+' · '+human(d.scopeType),String(i))));renderCapabilities();$('add-staff-open').hidden=!sc.provisionableRoles?.some(r=>r.roleCode!=='GUARD');$('add-guard-open').hidden=!sc.provisionableRoles?.some(r=>r.roleCode==='GUARD');$('assign-guard-open').hidden=!sc.canAssignGuards;syncScopeBar();}

// A single creation flow; each type retains its existing server-enforced office permission.
function creationAllowed(type){return type==='project'?state.office?.canCreateProject:type==='area'&&state.office?.canManageCommonAreas;}
function syncCreationType(){
 const project=$('new-workspace-type').value==='project';
 $('new-project-name').labels[0].textContent=project?'Project name':'Area name';$('new-project-name').maxLength=project?200:100;
 $('new-project-name').placeholder=project?'Digital Workplace Transformation':'Main reception lobby';
 $('new-project-code-field').hidden=!project;$('new-project-code').required=project;$('new-project-code').disabled=!project;
 $('new-project-reason').labels[0].textContent=project?'Reason for adding this project':'Reason for adding this area';
 $('new-project-submit').textContent=project?'Create project':'Create area';
 $('new-project-help').textContent=project?'Assign project leads after creation. Employees need verified project and office assignments to host visits.':'Assign guards to this common area after creation.';
}
$('new-workspace-type').addEventListener('change',syncCreationType);
$('add-project-open').addEventListener('click',()=>{
 if(!consoleState.scope||!(state.office?.canCreateProject||state.office?.canManageCommonAreas)||consoleState.writing)return;
 if(state.newProjectOfficeId!==state.office.locationId){$('add-project-form').reset();state.projectCreateAttempt=null;}
 const prior=$('new-workspace-type').value;
 $('new-workspace-type').replaceChildren(...[...(state.office.canCreateProject?[new Option('Project','project')]:[]),...(state.office.canManageCommonAreas?[new Option('Common area','area')]:[])]);
 if(creationAllowed(prior))$('new-workspace-type').value=prior;syncCreationType();
 state.newProjectOfficeId=state.office.locationId;$('new-project-office').textContent='Location: '+state.office.locationName+' · Your authorized office scope';$('new-project-status').textContent='';$('add-project-dialog').showModal();$('new-project-name').focus();
});
function closeProjectCreation(){if(!consoleState.writing)$('add-project-dialog').close();}
$('close-add-project').addEventListener('click',closeProjectCreation);
$('add-project-dialog').addEventListener('cancel',event=>{event.preventDefault();closeProjectCreation();});
$('new-project-code').addEventListener('input',()=>{$('new-project-code').value=$('new-project-code').value.toUpperCase();});
$('add-project-form').addEventListener('submit',async event=>{
 event.preventDefault();const type=$('new-workspace-type').value;
 if(consoleState.writing||!consoleState.scope||!creationAllowed(type)||state.newProjectOfficeId!==state.office.locationId||!$('add-project-form').reportValidity())return;
 const project=type==='project',name=$('new-project-name').value.trim(),reason=$('new-project-reason').value.trim();if(!name||!reason)return;
 const payload={locationId:state.newProjectOfficeId,...(project?{projectName:name,projectCode:$('new-project-code').value.trim()}:{action:'CREATE_AREA',areaName:name}),reason};
 const clientKey=retainedKey('projectCreateAttempt',{type,...payload});consoleState.writing=true;
 const locked=[...document.querySelectorAll('button,input,select')].map(el=>[el,el.disabled]);for(const [el] of locked)el.disabled=true;
 $('new-project-status').textContent=project?'Creating project…':'Creating common area…';
 try{await api(project?'create-project':'common-duty',{...payload,clientKey});state.projectCreateAttempt=null;$('project-search').value='';$('add-project-dialog').close();toasts.show((project?'Project':'Common area')+' created in '+state.office.locationName+'.','success');await prepareConsole();}
 catch(error){if(error.status===409)error.message=project?'This project code is unavailable. Use a different code, or refresh to check an earlier request.':'This common area already exists or changed. Refresh to check it.';$('new-project-status').textContent=error.message;fail(error);}
 finally{consoleState.writing=false;for(const [el,disabled] of locked)if(el.isConnected)el.disabled=disabled;}
});
const scopedViews=new Set(['overview','staff','reports','audit']);
function syncScopeBar(){
 const sc=consoleState.scope,view=consoleState.view,scoped=!!sc&&scopedViews.has(view),single=$('console-project').options.length<=1;
 $('scope-project-wrap').hidden=!scoped||single;$('scope-hint').hidden=!scoped||!single;$('overview-range').hidden=!scoped||view!=='overview';
 const slot=sc&&!scoped?document.querySelector('#admin-'+view+' [data-refresh-slot]'):null,host=slot??$('console-scope');
 if($('refresh').parentElement!==host)host.append($('refresh'));
 $('console-scope').hidden=!!slot;$('console-scope').classList.toggle('is-bare',!scoped);
}
function renderCapabilities(){const d=consoleState.scope?.delegations[Number($('staff-role').value)];$('staff-capabilities').replaceChildren();if(!d){$('staff-grant-form').hidden=true;return;}$('staff-grant-form').hidden=!consoleState.subject?.active||consoleState.subject.userId===consoleState.scope.userId;for(const cap of roleCaps[d.roleCode]??[]){const label=node('label',''),input=document.createElement('input');input.type='checkbox';input.value=cap;input.checked=['VISITS_READ','PROJECT_MOVEMENT','REPORTS_READ'].includes(cap);label.append(input,document.createTextNode(human(cap)));$('staff-capabilities').append(label);}}
async function showAdminView(view){if(!consoleState.scope||!consoleState.allowedViews[view])return;consoleState.view=view;if(view!=='projects')pauseLeadPreviews();syncScopeBar();for(const b of document.querySelectorAll('[data-admin-view]'))b.setAttribute('aria-current',b.dataset.adminView===view?'page':'false');for(const key of Object.keys(titles))$('admin-'+key).hidden=key!==view;$('admin-title').textContent=titles[view];$('page-status').textContent='';if(view==='projects'){previewLeads();if(!state.areasLoaded)await loadWorkspaceAreas();}if(view==='overview')await loadSummary();if(view==='assignments')await loadAssignments();if(view==='offices')renderOffices();if(view==='reports')syncReportChips();if(view==='reports'&&!$('report-list').children.length)await loadReports();if(view==='audit'&&!$('audit-list').children.length)await loadAudit();}
async function refreshConsole(){if(!consoleState.scope)return initialize();const v=consoleState.view;await prepareConsole();if(v==='staff'&&consoleState.subject)await loadRoles();}
function stat(root,label,value,tone=''){const card=node('article','','admin-stat');card.dataset.tone=tone;card.append(node('strong',value),node('span',label));$(root).append(card);}
const SVG_NS='http://www.w3.org/2000/svg';
const statusMeta=[['approved','Approved'],['pending','Pending'],['denied','Denied'],['cancelled','Cancelled']];
const dayLabel=d=>new Intl.DateTimeFormat('en-IN',{timeZone:'UTC',day:'numeric',month:'short'}).format(new Date(d+'T12:00:00Z'));
const rangeLabel=(from,to)=>from===to?dayLabel(from)+' '+from.slice(0,4):dayLabel(from)+' – '+dayLabel(to)+' '+to.slice(0,4);
const spanDays=(from,to)=>Math.round((Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))/86400000);
const shiftDay=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
function svgNode(tag,attrs={},...kids){const n=document.createElementNS(SVG_NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));n.append(...kids);return n;}
function svgText(content,attrs){const t=svgNode('text',attrs);t.textContent=content;return t;}
function shares(totals){const sum=statusMeta.reduce((a,[k])=>a+totals[k],0),out={};if(!sum)return out;let left=100;const rows=statusMeta.map(([k])=>{const exact=totals[k]*100/sum,whole=Math.floor(exact);left-=whole;out[k]=whole;return [k,exact-whole];}).sort((a,b)=>b[1]-a[1]);for(const [k] of rows){if(left<=0)break;if(totals[k]>0){out[k]++;left--;}}return out;}
function legend(items,totals){const list=node('ul','','chart-legend'),pct=totals?shares(totals):{};for(const [k,label] of items){const li=node('li',''),dot=node('span','','legend-dot tone-'+k);dot.setAttribute('aria-hidden','true');li.append(dot,node('span',label,'legend-label'));if(totals)li.append(node('strong',String(totals[k])),node('span',k in pct?pct[k]+'%':'—','legend-share'));list.append(li);}return list;}
function renderDonut(root,t){
 const total=statusMeta.reduce((sum,[key])=>sum+t[key],0),R=46,C=2*Math.PI*R;
 const chart=svgNode('svg',{viewBox:'0 0 140 140',class:'chart-donut',role:'img','aria-label':'Approval status: '+statusMeta.map(([k,l])=>t[k]+' '+l.toLowerCase()).join(', ')});
 chart.append(svgNode('circle',{cx:70,cy:70,r:R,fill:'none','stroke-width':18,class:'donut-track'}));
 let used=0;if(total)for(const [k] of statusMeta){if(!t[k])continue;const len=C*t[k]/total;chart.append(svgNode('circle',{cx:70,cy:70,r:R,fill:'none','stroke-width':18,class:'donut-segment tone-'+k,'stroke-dasharray':len.toFixed(2)+' '+(C-len).toFixed(2),'stroke-dashoffset':(-used).toFixed(2),transform:'rotate(-90 70 70)'}));used+=len;}
 chart.append(svgText(String(total),{x:70,y:74,class:'donut-total','text-anchor':'middle'}),svgText('registered',{x:70,y:91,class:'donut-caption','text-anchor':'middle'}));
 root.replaceChildren(chart,legend(statusMeta,t));
}
function renderColumns(root,days){
 const W=640,H=220,L=34,B=26,T=10,n=days.length,band=(W-L)/n,bw=Math.min(36,band*0.64),max=Math.max(1,...days.map(d=>d.total)),plot=H-B-T,y=v=>T+plot-plot*v/max;
 const chart=svgNode('svg',{viewBox:'0 0 '+W+' '+H,class:'chart-columns',role:'img','aria-label':'Daily registrations from '+dayLabel(days[0].day)+' to '+dayLabel(days[n-1].day)+', highest day '+max});
 for(const tick of new Set([0,Math.ceil(max/2),max]))chart.append(svgNode('line',{x1:L,x2:W,y1:y(tick).toFixed(2),y2:y(tick).toFixed(2),class:'chart-grid'}),svgText(String(tick),{x:L-6,y:(y(tick)+3).toFixed(2),class:'chart-axis','text-anchor':'end'}));
 const step=Math.ceil(n/8);
 days.forEach((d,i)=>{const cx=L+band*i+band/2,tip=svgNode('title'),group=svgNode('g',{},tip);let base=T+plot;tip.textContent=dayLabel(d.day)+': '+statusMeta.map(([k,label])=>d[k]+' '+label.toLowerCase()).join(', ');
  for(const [k] of statusMeta){if(!d[k])continue;const h=plot*d[k]/max;base-=h;group.append(svgNode('rect',{x:(cx-bw/2).toFixed(2),y:base.toFixed(2),width:bw.toFixed(2),height:h.toFixed(2),class:'column tone-'+k}));}
  chart.append(group);if(i%step===0)chart.append(svgText(dayLabel(d.day),{x:cx.toFixed(2),y:H-8,class:'chart-axis','text-anchor':'middle'}));});
 root.replaceChildren(chart,legend(statusMeta));
}
function renderBars(root,t){
 const row=46,W=420,max=Math.max(1,...statusMeta.map(([k])=>t[k]));
 const chart=svgNode('svg',{viewBox:'0 0 '+W+' '+row*statusMeta.length,class:'chart-bars',role:'img','aria-label':'Status comparison: '+statusMeta.map(([k,l])=>t[k]+' '+l.toLowerCase()).join(', ')});
 statusMeta.forEach(([k,label],i)=>{const y=i*row;chart.append(svgText(label,{x:0,y:y+14,class:'bar-label'}),svgText(String(t[k]),{x:W,y:y+14,class:'bar-value','text-anchor':'end'}),svgNode('rect',{x:0,y:y+22,width:W,height:12,rx:6,class:'bar-track'}));if(t[k])chart.append(svgNode('rect',{x:0,y:y+22,width:Math.max(12,W*t[k]/max).toFixed(2),height:12,rx:6,class:'bar-fill tone-'+k}));});
 root.replaceChildren(chart);
}
function syncRangeChips(){const from=$('overview-from').value,to=$('overview-to').value,today=consoleState.scope?.currentDate;for(const b of document.querySelectorAll('[data-range-days]'))b.setAttribute('aria-pressed',String(!!today&&to===today&&from===shiftDay(today,1-Number(b.dataset.rangeDays))));}
async function loadSummary(){
 const version=consoleState.version,request=requestToken('summary'),from=$('overview-from').value,to=$('overview-to').value;
 if(!from||!to||from>to||spanDays(from,to)>30)return;
 syncRangeChips();$('summary-range-label').textContent=rangeLabel(from,to);$('overview-range').setAttribute('aria-busy','true');$('page-status').textContent='Updating overview…';
 const current=()=>version===consoleState.version&&request===consoleState.requests.summary;
 try{
  const result=await api('summary-range',{...scopeBody(),from,to});if(!current())return;
  const series=result.days.map(r=>({day:r.localVisitDate,...Object.fromEntries(Object.entries(r.visits).map(([key,value])=>[key,Number(value)]))}));
  const totals=Object.fromEntries(Object.entries(result.visits).map(([key,value])=>[key,Number(value)]));
  $('summary-cards').replaceChildren();stat('summary-cards','Registered',String(totals.total),'total');for(const [k,label] of [['pending','Pending'],['approved','Approved'],['denied','Denied']])stat('summary-cards',label,String(totals[k]),k);
  renderDonut($('chart-status'),totals);
  if(series.length>1){$('chart-trend-title').textContent='Daily registrations';renderColumns($('chart-trend'),series);}else{$('chart-trend-title').textContent='Status comparison';renderBars($('chart-trend'),totals);}
  const presence=result.recordedPresence;$('presence-cards').replaceChildren();stat('presence-cards','Project visits inside',presence.projectVisitsInside);stat('presence-cards','Employee project presence',presence.digitalIdsInside);$('page-status').textContent='';
 }catch(e){if(current()){for(const id of ['summary-cards','presence-cards','chart-status','chart-trend'])$(id).replaceChildren();$('page-status').textContent='Summary unavailable for this scope.';fail(e);}}
 finally{if(current())$('overview-range').removeAttribute('aria-busy');}
}
function initOverviewControls(){
 const adjust=changed=>{const from=$('overview-from').value,to=$('overview-to').value;if(!from||!to)return false;if(from>to){if(changed==='from')$('overview-to').value=from;else $('overview-from').value=to;}else if(spanDays(from,to)>30){if(changed==='from')$('overview-to').value=shiftDay(from,30);else $('overview-from').value=shiftDay(to,-30);}return true;};
 for(const [id,which] of [['overview-from','from'],['overview-to','to']])$(id).addEventListener('change',()=>{if(!consoleState.writing&&adjust(which))void loadSummary();});
 for(const b of document.querySelectorAll('[data-range-days]'))b.addEventListener('click',()=>{const today=consoleState.scope?.currentDate;if(!today||consoleState.writing)return;$('overview-to').value=today;$('overview-from').value=shiftDay(today,1-Number(b.dataset.rangeDays));void loadSummary();});
}
function row(copy,action){const item=node('article','','admin-row'),text=node('div','');for(const [i,v] of copy.entries())text.append(node(i===0?'strong':'p',v,i===0?'':'hint'));item.append(text);if(action)item.append(action);return item;}
async function searchSubjects(more=false){const q=$('subject-search').value.trim();if(q.length<2)return;const version=++consoleState.searchVersion,scope=consoleState.version;if(!more){$('subject-results').replaceChildren();consoleState.subjectCursor=null;}$('page-status').textContent='Searching staff…';try{const r=await api('subjects',{namePrefix:q,...(more&&consoleState.subjectCursor?{afterUserId:consoleState.subjectCursor}:{})});if(version!==consoleState.searchVersion||scope!==consoleState.version)return;consoleState.subjectCursor=r.afterUserId;for(const u of r.users){const item=row([u.displayName,u.active?'Active identity':'Inactive identity'],button('Manage access',()=>selectSubject(u)));item.dataset.userId=u.userId;$('subject-results').append(item);}$('subjects-more').hidden=!r.hasMore;$('page-status').textContent=$('subject-results').children.length?'':'No matching staff.';}catch(e){if(version===consoleState.searchVersion&&scope===consoleState.version)fail(e);}}
function selectSubject(u){consoleState.subject=u;$('reset-staff-setup').hidden=!(u.localAccount&&u.active&&u.userId!==consoleState.scope.userId&&consoleState.scope.canResetLocalStaff);consoleState.roleCursor=null;$('subject-name').textContent=u.displayName;$('staff-detail').hidden=false;renderCapabilities();void loadRoles();}
function grantScope(g){if(g.scopeType==='LOCATION')return state.offices.find(o=>o.locationId===g.locationId)?.locationName??'Office '+g.locationId;if(g.scopeType==='PROJECT_LOCATION')return state.projects.find(p=>p.projectLocationId===g.projectLocationId)?.projectName??'Project office';if(g.scopeType==='PROJECT')return state.projects.find(p=>p.projectId===g.projectId)?.projectName??'Project';return human(g.scopeType);}
function mayRevoke(g){if(consoleState.subject?.userId===consoleState.scope?.userId)return false;if(g.roleCode==='PROJECT_ADMIN'&&g.scopeType==='PROJECT'&&state.projects.some(p=>p.projectId===g.projectId&&p.canAssignProject))return true;if(g.roleCode==='PROJECT_ADMIN'&&g.scopeType==='PROJECT_LOCATION'&&state.projects.some(p=>p.projectLocationId===g.projectLocationId&&p.canAssignLocation))return true;return !!consoleState.scope?.delegations.some(d=>d.roleCode===g.roleCode&&d.scopeType===g.scopeType)&&(g.scopeType==='LOCATION'?g.locationId===state.office.locationId:g.scopeType==='PROJECT'?g.projectId===consoleState.pair?.projectId:g.scopeType==='PROJECT_LOCATION'?g.projectLocationId===consoleState.pair?.projectLocationId:true);}
async function loadRoles(more=false){const u=consoleState.subject;if(!u)return;const version=consoleState.version,request=requestToken('roles');if(!more){$('staff-roles').replaceChildren();consoleState.roleCursor=null;}try{const r=await api('roles',{targetUserId:u.userId,state:$('role-state').value,...(more&&consoleState.roleCursor?{afterRoleGrantId:consoleState.roleCursor}:{})});if(version!==consoleState.version||u!==consoleState.subject||request!==consoleState.requests.roles)return;consoleState.roleCursor=r.afterRoleGrantId;for(const g of r.grants){const ended=g.revoked||g.validUntilUtc&&Date.parse(g.validUntilUtc)<=Date.now();$('staff-roles').append(row([human(g.roleCode)+' · '+grantScope(g),g.capabilities.map(human).join(' · '),dateTime(g.validFromUtc)+' → '+dateTime(g.validUntilUtc)+(g.revoked?' · Revoked':'')],!ended&&mayRevoke(g)?button('Revoke',()=>confirmChange('Revoke '+human(g.roleCode)+' for '+u.displayName,'revoke',{roleGrantId:g.roleGrantId},()=>loadRoles()),'quiet'):null));}$('roles-more').hidden=!r.hasMore;if(!r.grants.length&&!more)$('staff-roles').append(node('p','No roles in your permitted scope.','hint'));}catch(e){if(version===consoleState.version&&u===consoleState.subject&&request===consoleState.requests.roles)fail(e);}}
function formUntil(id){const value=$(id).value;if(!value)return undefined;const date=new Date(value);if(!Number.isFinite(date.getTime())||date.getTime()<=Date.now())throw Error('End time must be in the future.');return date.toISOString();}
async function writeConsole(action,payload,keyName,after){if(consoleState.writing)return;const clientKey=retainedKey(keyName,payload);consoleState.writing=true;const locked=[...document.querySelectorAll('.admin-content button,.admin-content input,.admin-content select,.admin-header button,.admin-nav button,#console-project,#admin-office')].map(el=>[el,el.disabled]);for(const [el] of locked)el.disabled=true;try{await api(action,{...payload,clientKey});state[keyName]=null;toasts.show('Change saved.','success');await after();}catch(e){fail(e);}finally{consoleState.writing=false;for(const [el,disabled] of locked)if(el.isConnected)el.disabled=disabled;}}
$('staff-grant-form').addEventListener('submit',e=>{e.preventDefault();if(!$('staff-grant-form').reportValidity()||!consoleState.subject)return;try{const d=consoleState.scope.delegations[Number($('staff-role').value)],capabilities=[...$('staff-capabilities').querySelectorAll('input:checked')].map(x=>x.value);if(!d||(['PROJECT','PROJECT_LOCATION'].includes(d.scopeType)&&!consoleState.pair)||!capabilities.length||capabilities.length>8)throw Error('Choose between one and eight permissions.');if(['GUARD','RECEPTION'].includes(d.roleCode)&&!capabilities.includes('VISITS_READ'))throw Error('Visit reading is required for this workspace.');if(!['GUARD','RECEPTION'].includes(d.roleCode)&&!capabilities.some(c=>['VISITS_READ','REPORTS_READ','GUARDS_MANAGE','ROLE_GRANTS_MANAGE'].includes(c)))throw Error('Choose a workspace permission: visit reading, reports, guard management or role management.');const payload={targetUserId:consoleState.subject.userId,roleCode:d.roleCode,scopeType:d.scopeType,capabilities,reason:$('staff-reason').value.trim(),...(d.scopeType==='LOCATION'?{locationId:state.office.locationId}:d.scopeType==='PROJECT'?{projectId:consoleState.pair.projectId}:d.scopeType==='PROJECT_LOCATION'?{projectLocationId:consoleState.pair.projectLocationId}:{}),...(formUntil('staff-until')?{validUntilUtc:formUntil('staff-until')}:{})};void writeConsole('grant',payload,'consoleGrant',()=>loadRoles());}catch(error){fail(error);}});
function confirmChange(copy,action,payload,after){consoleState.confirm={action,payload,after};state.consoleConfirm=null;$('admin-confirm-title').textContent=copy;$('admin-confirm-copy').textContent='This change takes effect immediately and is recorded in the audit log.';$('admin-confirm-reason').value='';$('admin-confirm-status').textContent='';$('admin-confirm-dialog').showModal();}
$('admin-confirm-form').addEventListener('submit',async e=>{e.preventDefault();const c=consoleState.confirm;if(!c||!$('admin-confirm-form').reportValidity())return;if(consoleState.writing)return;consoleState.writing=true;$('admin-office').disabled=$('console-project').disabled=true;$('admin-confirm-submit').disabled=true;const clientKey=retainedKey('consoleConfirm',{...c.payload,reason:$('admin-confirm-reason').value.trim()});try{await api(c.action,{...c.payload,reason:$('admin-confirm-reason').value.trim(),clientKey});state.consoleConfirm=null;$('admin-confirm-dialog').close();await c.after();toasts.show('Change saved.','success');}catch(error){$('admin-confirm-status').textContent=error.message;if(error.status===403)fail(error);}finally{consoleState.writing=false;$('admin-office').disabled=$('console-project').disabled=false;$('admin-confirm-submit').disabled=false;}});
const roster={guards:[],duties:[],common:[],filter:'all',view:'guard',search:''};
const auditState={events:[]};
async function pagedAll(fetchPage,max=40){const out=[];let cursor=null;for(let i=0;i<max;i++){const r=await fetchPage(cursor);out.push(...r.items);if(!r.cursor)break;cursor=r.cursor;}return out;}
async function mapLimit(items,limit,fn){const out=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const k=next++;out[k]=await fn(items[k]);}}));return out;}
async function loadCommonDuties(){const out=[];for(let offset=0,i=0;i<20;i++){const r=await api('common-duties',{locationId:state.office.locationId,search:'',offset});out.push(...r.assignments);offset+=r.assignments.length;if(!r.hasMore||!r.assignments.length)break;}return out;}
async function loadAssignments(){
 const version=consoleState.version,request=requestToken('assignments'),current=()=>version===consoleState.version&&request===consoleState.requests.assignments;
 $('roster-status').textContent='Loading guard roster…';
 try{
  const projects=state.projects.slice(0,60);let guards=[];
  for(const p of projects.slice(0,3)){try{guards=await pagedAll(c=>api('guards',{projectLocationId:p.projectLocationId,pageSize:50,...(c?{afterUserId:c}:{})}).then(r=>({items:r.guards,cursor:r.hasMore?r.afterUserId:null})));break;}catch(e){if(e.status!==403)throw e;}}
  if(!current())return;
  const perProject=await mapLimit(projects,4,async p=>{try{return(await pagedAll(c=>api('assignments',{projectLocationId:p.projectLocationId,...(c?{afterAssignmentId:c}:{})}).then(r=>({items:r.assignments,cursor:r.cursor})))).map(a=>({...a,projectLocationId:p.projectLocationId,projectName:p.projectName,projectCode:p.projectCode}));}catch(e){if(e.status===403)return[];throw e;}});
  if(!current())return;
  let common=[];if(state.office.canManageCommonAreas){try{common=await loadCommonDuties();}catch{common=[];}}
  if(!current())return;
  roster.guards=guards;roster.duties=perProject.flat();roster.common=common;renderRoster();if($('assign-dialog').open)fillAllocationGuards();
 }catch(e){if(current()){$('roster-status').textContent='Guard roster could not be loaded. Use Refresh to retry.';fail(e);}}
}
function rosterPeople(){
 const people=new Map(),person=(id,name)=>{const key=String(id).toLowerCase();if(!people.has(key))people.set(key,{userId:key,name,duties:[]});return people.get(key);};
 for(const g of roster.guards)person(g.userId,g.displayName);
 for(const d of roster.duties)person(d.userId,d.guardName).duties.push({kind:'project',...d});
 for(const c of roster.common)person(c.guardUserId,c.guardName).duties.push({kind:'common',areaName:c.areaName,assignmentId:c.assignmentId});
 return[...people.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
const shortDay=v=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short'}).format(new Date(v));
const dutyPeriod=d=>(Date.parse(d.validFromUtc)>Date.now()?'from '+shortDay(d.validFromUtc)+' ':'')+(d.validUntilUtc?'until '+shortDay(d.validUntilUtc):'no end date');
function dutyChip(d,name,withProject=true){
 const common=d.kind==='common',chip=node('span','','duty-chip'+(common?' common':''));
 if(common){chip.append(node('span',d.areaName),node('small','Common area'));return chip;}
 chip.append(node('span',withProject?d.projectName:name),node('small',dutyPeriod(d)));
 if(consoleState.scope?.canAssignGuards){const b=button('×',()=>confirmChange('Remove '+name+' from '+d.projectName,'deallocate',{assignmentId:d.assignmentId},()=>loadAssignments()),'chip-remove');b.setAttribute('aria-label','Remove '+name+' from '+d.projectName);b.title='Remove from '+d.projectName;chip.append(b);}
 return chip;
}
function guardRow(p,i){
 const row=node('article','','roster-row'),avatar=node('span',initials(p.name),'roster-avatar avatar-tone-'+(i%5)),person=node('div','','roster-person'),chips=node('div','','duty-chips');row.dataset.userId=p.userId;avatar.setAttribute('aria-hidden','true');
 person.append(node('strong',p.name),p.duties.length?node('span',p.duties.length+(p.duties.length===1?' duty':' duties'),'status-chip info'):node('span','Free','status-chip ok'));
 if(!p.duties.length)chips.append(node('span','Not assigned to any project','roster-free'));
 for(const d of p.duties)chips.append(dutyChip(d,p.name));
 row.append(avatar,person,chips);
 if(consoleState.scope?.canAssignGuards){const act=button('Assign',()=>openAssign({guardId:p.userId}),'secondary');act.setAttribute('aria-label','Assign '+p.name+' to a project');row.append(act);}
 return row;
}
function projectRosterCard(p,i,duties,people){
 const card=node('article','','roster-project'),head=node('div','','roster-project-head'),avatar=node('span',initials(p.projectName),'project-avatar avatar-tone-'+(i%5)),copy=node('div',''),chips=node('div','','duty-chips');
 avatar.setAttribute('aria-hidden','true');copy.append(node('span','Project','workspace-kind'),node('h3',p.projectName),node('p',p.projectCode,'project-code'));
 head.append(avatar,copy,duties.length?node('span',duties.length+(duties.length===1?' guard':' guards'),'status-chip info'):node('span','No guard','status-chip warn'));
 if(!duties.length)chips.append(node('span','Nobody is posted here yet','roster-free'));
 for(const d of duties)chips.append(dutyChip(d,d.guardName,false));
 card.append(head,chips);
 if(consoleState.scope?.canAssignGuards){const actions=node('div','','project-card-actions'),add=button('Assign guard',()=>openAssign({projectLocationId:p.projectLocationId}),'secondary');add.setAttribute('aria-label','Assign a guard to '+p.projectName);actions.append(add);card.append(actions);}
 return card;
}
function renderRoster(){
 const people=rosterPeople(),q=roster.search.trim().toLowerCase(),assigned=people.filter(p=>p.duties.length).length,projects=state.projects.slice(0,60);
 const covered=new Set(roster.duties.map(d=>d.projectLocationId)).size,uncovered=projects.length-covered;
 $('guard-stats').replaceChildren();stat('guard-stats','Total guards',String(people.length),'total');stat('guard-stats','Assigned',String(assigned),'approved');stat('guard-stats','Free',String(people.length-assigned),'pending');stat('guard-stats','Projects without a guard',String(uncovered),uncovered?'denied':'approved');
 for(const b of document.querySelectorAll('[data-guard-filter]'))b.setAttribute('aria-pressed',String(b.dataset.guardFilter===roster.filter));
 for(const b of document.querySelectorAll('[data-roster-view]'))b.setAttribute('aria-pressed',String(b.dataset.rosterView===roster.view));
 $('assignment-list').hidden=roster.view!=='guard';$('project-duty-list').hidden=roster.view!=='project';
 const keep=hasDuty=>roster.filter==='all'||(roster.filter==='free')===!hasDuty;
 if(roster.view==='guard'){
  const shown=people.filter(p=>keep(p.duties.length>0)&&(!q||p.name.toLowerCase().includes(q)||p.duties.some(d=>(d.projectName??d.areaName).toLowerCase().includes(q))));
  $('assignment-list').replaceChildren(...shown.map((p,i)=>guardRow(p,i)));if(!shown.length)$('assignment-list').append(node('p',people.length?'No guards match these filters.':'No guards found for this office.','empty-note'));
  $('roster-status').textContent='Showing '+shown.length+' of '+people.length+' guards';
 }else{
  const cards=projects.map((p,i)=>({p,i,duties:roster.duties.filter(d=>d.projectLocationId===p.projectLocationId)})).filter(({p,duties})=>keep(duties.length>0)&&(!q||(p.projectName+' '+p.projectCode).toLowerCase().includes(q)||duties.some(d=>d.guardName.toLowerCase().includes(q))));
  const nodes=cards.map(({p,i,duties})=>projectRosterCard(p,i,duties,people));
  if(roster.common.length&&roster.filter!=='free'){const card=node('article','','roster-project'),head=node('div','','roster-project-head'),copy=node('div',''),chips=node('div','','duty-chips');copy.append(node('h3','Common areas'),node('p','Managed from Projects & leads','hint'));head.append(copy,node('span',roster.common.length+(roster.common.length===1?' guard':' guards'),'status-chip info'));for(const c of roster.common){const chip=node('span','','duty-chip common');chip.append(node('span',c.guardName),node('small',c.areaName));chips.append(chip);}card.append(head,chips);nodes.push(card);}
  $('project-duty-list').replaceChildren(...nodes);if(!nodes.length)$('project-duty-list').append(node('p','No projects match these filters.','empty-note'));
  $('roster-status').textContent='Showing '+cards.length+' of '+projects.length+' projects · "Assigned" has guards, "Free" still needs one';
 }
}
const localInput=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
function setUntil(mode){
 for(const b of document.querySelectorAll('[data-until]'))b.setAttribute('aria-pressed',String(b.dataset.until===mode));
 const input=$('allocation-until'),now=new Date();input.hidden=mode!=='custom';
 if(mode==='none')input.value='';
 else if(mode==='today'){const end=new Date(now);end.setHours(23,59,0,0);input.value=localInput(end);}
 else if(mode==='custom'){if(!input.value){const t=new Date(now.getTime()+864e5);t.setHours(18,0,0,0);input.value=localInput(t);}}
 else input.value=localInput(new Date(now.getTime()+Number(mode)*864e5));
}
function fillAllocationGuards(selected){
 const pl=$('allocation-project').value,keep=selected??$('allocation-guard').value,people=rosterPeople().sort((a,b)=>a.duties.length-b.duties.length||a.name.localeCompare(b.name));
 $('allocation-guard').replaceChildren(new Option('Select guard',''),...people.map(p=>{const here=!!pl&&p.duties.some(d=>d.kind==='project'&&d.projectLocationId===pl),n=p.duties.length,o=new Option(p.name+(here?' · already on this project':n?' · on '+n+(n===1?' duty':' duties'):' · free'),p.userId);o.disabled=here;return o;}));
 $('allocation-guard').value=people.some(p=>p.userId===keep)?keep:'';
 const free=people.filter(p=>!p.duties.length).length;
 $('allocation-hint').textContent=people.length?free+' free · '+(people.length-free)+' already on duty (they can still take another project)':'No guards found for this office.';
}
function openAssign({guardId=null,projectLocationId=null}={}){
 if(!consoleState.scope?.canAssignGuards||consoleState.writing)return;
 if(!state.projects.length){toasts.show('No projects available in this office.','error');return;}
 $('allocation-project').replaceChildren(new Option('Select project',''),...state.projects.map(p=>new Option(p.projectName+' · '+p.projectCode,p.projectLocationId)));
 $('allocation-project').value=projectLocationId??(state.projects.length===1?state.projects[0].projectLocationId:consoleState.pair?.projectLocationId??'');
 fillAllocationGuards(guardId);setUntil('none');$('allocation-reason').value='';
 if(!$('assign-dialog').open)$('assign-dialog').showModal();
}
$('assign-guard-open').addEventListener('click',()=>openAssign());
$('allocation-project').addEventListener('change',()=>fillAllocationGuards());
for(const b of document.querySelectorAll('[data-until]'))b.addEventListener('click',()=>setUntil(b.dataset.until));
for(const b of document.querySelectorAll('[data-reason]'))b.addEventListener('click',()=>{$('allocation-reason').value=b.dataset.reason;});
for(const b of document.querySelectorAll('[data-guard-filter]'))b.addEventListener('click',()=>{roster.filter=b.dataset.guardFilter;renderRoster();});
for(const b of document.querySelectorAll('[data-roster-view]'))b.addEventListener('click',()=>{roster.view=b.dataset.rosterView;renderRoster();});
$('guard-search').addEventListener('input',()=>{roster.search=$('guard-search').value;renderRoster();});
$('allocation-form').addEventListener('submit',e=>{e.preventDefault();const pl=$('allocation-project').value;if(!pl||!$('allocation-form').reportValidity())return;try{const end=formUntil('allocation-until');void writeConsole('allocate',{guardUserId:$('allocation-guard').value,projectLocationId:pl,reason:$('allocation-reason').value.trim(),...(end?{validUntilUtc:end}:{})},'consoleAllocate',async()=>{$('assign-dialog').close();await loadAssignments();});}catch(error){fail(error);}});
function renderOffices(){$('office-list').replaceChildren(...state.offices.map(o=>row([o.locationName,o.locationCode],button('Registration QR',()=>loadOfficeQr(o)))));}
let currentOfficeQr=null;
async function downloadPosterPng(office,qrDataUrl,locationName,officeUrl){
  if(!qrDataUrl)return;
  const canvas=document.createElement('canvas'),width=1200,height=1600;
  canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');
  if(!ctx)return;
  function roundRect(x,y,w,h,r){
    if(typeof ctx.roundRect==='function'){ctx.beginPath();ctx.roundRect(x,y,w,h,r);return;}
    const radius=typeof r==='number'?r:(Array.isArray(r)?r[0]:0);
    ctx.beginPath();ctx.moveTo(x+radius,y);ctx.arcTo(x+w,y,x+w,y+h,radius);ctx.arcTo(x+w,y+h,x,y+h,radius);ctx.arcTo(x,y+h,x,y,radius);ctx.arcTo(x,y,x+w,y,radius);ctx.closePath();
  }
  ctx.fillStyle='#f8fafc';ctx.fillRect(0,0,width,height);
  const mx=60,my=60,cw=width-120,ch=height-120,cr=28;
  ctx.save();ctx.shadowColor='rgba(15, 23, 42, 0.08)';ctx.shadowBlur=36;ctx.shadowOffsetY=16;
  ctx.fillStyle='#ffffff';roundRect(mx,my,cw,ch,cr);ctx.fill();ctx.restore();
  ctx.strokeStyle='#e2e8f0';ctx.lineWidth=2;roundRect(mx,my,cw,ch,cr);ctx.stroke();
  const grad=ctx.createLinearGradient(mx,my,mx+cw,my);
  grad.addColorStop(0,'#c9002b');grad.addColorStop(1,'#ff7800');
  ctx.fillStyle=grad;roundRect(mx,my,cw,16,[cr,cr,0,0]);ctx.fill();

  const logoImg=document.querySelector('.poster-company-logo')||document.querySelector('.admin-brand img');
  let topY=my+60;
  if(logoImg&&logoImg.complete&&logoImg.naturalWidth){
    const lw=400,lh=Math.round(lw*(logoImg.naturalHeight/logoImg.naturalWidth));
    ctx.drawImage(logoImg,(width-lw)/2,topY,lw,lh);
    topY+=lh+24;
  }else{
    ctx.font='bold 44px Arial, sans-serif';ctx.fillStyle='#182230';ctx.textAlign='center';
    ctx.fillText('sopra steria',width/2,topY+44);
    topY+=68;
  }

  ctx.textAlign='center';
  const welcomeStyle=getComputedStyle(document.querySelector('.poster-welcomes-script'));
  ctx.font='600 54px '+welcomeStyle.fontFamily;
  ctx.fillStyle='#334155';
  ctx.fillText('welcomes you',width/2,topY+32);

  if(locationName){
    ctx.font='bold 22px Arial, sans-serif';
    ctx.fillStyle='#64748b';
    ctx.fillText(locationName.toUpperCase(),width/2,topY+70);
  }

  const qBoxW=960,qBoxH=960,qBoxX=(width-qBoxW)/2,qBoxY=topY+105;
  ctx.fillStyle='#ffffff';ctx.strokeStyle='#e2e8f0';ctx.lineWidth=3;
  roundRect(qBoxX,qBoxY,qBoxW,qBoxH,24);ctx.fill();ctx.stroke();

  const qrImg=$('qr-image');
  if(qrImg&&qrImg.complete&&qrImg.naturalWidth){
    const qPad=28;ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(qrImg,qBoxX+qPad,qBoxY+qPad,qBoxW-qPad*2,qBoxH-qPad*2);ctx.restore();
  }

  const pillW=960,pillH=80,pillX=(width-pillW)/2,pillY=qBoxY+qBoxH+32;
  ctx.fillStyle='#0f172a';roundRect(pillX,pillY,pillW,pillH,32);ctx.fill();
  ctx.fillStyle='#ffffff';ctx.font='bold 26px Arial, sans-serif';ctx.textAlign='center';
  ctx.fillText('📷  Scan the above QR to get your Digital Pass',width/2,pillY+49);

  const footerY=pillY+pillH+48;
  ctx.fillStyle='#64748b';ctx.font='bold 22px Arial, sans-serif';
  ctx.fillText('Unable to scan? Visit: '+(officeUrl||''),width/2,footerY);

  ctx.fillStyle='#94a3b8';ctx.font='20px Arial, sans-serif';
  ctx.fillText('You can ask reception for help',width/2,footerY+36);

  canvas.toBlob(blob=>{
    if(!blob)return;
    const blobUrl=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=blobUrl;link.download='GatePass-'+(office?.locationCode||'Office')+'-Welcome-Poster.png';
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(blobUrl),2000);
  },'image/png');
}
async function loadOfficeQr(office){
  const version=consoleState.version,request=requestToken('qr');
  if($('office-qr'))$('office-qr').hidden=true;
  try{
    const r=await api('office-qr',{locationId:office.locationId});
    if(version!==consoleState.version||request!==consoleState.requests.qr)return;
    if(typeof r.imageDataUrl!=='string'||!r.imageDataUrl.startsWith('data:image/png;base64,'))throw Error('QR unavailable.');
    currentOfficeQr={office,dataUrl:r.imageDataUrl,locationName:r.locationName,url:r.url};
    if($('qr-title'))$('qr-title').textContent=r.locationName;
    if($('qr-modal-title'))$('qr-modal-title').textContent=r.locationName+' - Registration Standee';
    if($('qr-poster-location'))$('qr-poster-location').textContent=r.locationName;
    if($('qr-image'))$('qr-image').src=r.imageDataUrl;
    if($('qr-link'))$('qr-link').textContent=r.url;
    if($('qr-download')){
      $('qr-download').href=r.imageDataUrl;
      $('qr-download').download='GatePass-'+office.locationCode+'-QR.png';
    }
    if($('office-qr'))$('office-qr').hidden=false;
    if($('qr-dialog'))$('qr-dialog').showModal();
  }catch(e){
    if(version===consoleState.version&&request===consoleState.requests.qr)fail(e);
  }
}
function range(fromId,toId){const from=$(fromId).value,to=$(toId).value;if(!from||!to||from>to||Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z')>30*86400000)throw Error('Choose an ordered date range of at most 31 days.');return{from,to};}
// Register filters/sorts are applied by SQL to the entire authorized range, before paging.
const registerColumns=[['localVisitDate','Visit date'],['submittedAtUtc','Registered at'],['personName','Name'],['employeeId','Employee ID'],['personEmail','Email'],['personPhone','Mobile'],['companyName','Company'],['deviceTypes','Devices'],['locationName','Office'],['projectName','Project'],['hostName','Host'],['hostEmail','Host email'],['requestType','Type'],['reason','Purpose'],['publicReference','Request reference'],['publicPassNumber','Pass number'],['status','Approval'],['passStatus','Pass status'],['presence','Recorded presence'],['printStatus','Printed / returned'],['returnedAtUtc','Returned at'],['validFromUtc','Valid from'],['validUntilUtc','Valid until'],['firstEntryAtUtc','First entry'],['lastEntryAtUtc','Latest entry'],['lastExitAtUtc','Latest exit']];
const registerChoices={status:['PENDING','APPROVED','DENIED','CANCELLED'],passStatus:['PENDING','ACTIVE','DENIED','REVOKED'],requestType:['EXTERNAL','EMPLOYEE_PROJECT','DIGITAL_ID'],presence:['INSIDE','OUTSIDE'],printStatus:['NOT_PRINTED','PRINTED','RETURNED'],deviceTypes:['LAPTOP','TABLET','PEN_DRIVE','CAMERA','OTHER']};
const registerState={page:1,rows:[],total:0,filter:null,loading:false,visible:new Set(['localVisitDate','submittedAtUtc','personName','projectName','hostName','requestType','publicReference','status','presence','printStatus'])};
for(const [key,label] of registerColumns){$('register-sort').add(new Option(label,key));const l=node('label',''),c=document.createElement('input');c.type='checkbox';c.checked=registerState.visible.has(key);c.addEventListener('change',()=>{if(c.checked)registerState.visible.add(key);else registerState.visible.delete(key);if(!registerState.visible.size){registerState.visible.add(key);c.checked=true;}renderRegister();});l.append(c,document.createTextNode(label));$('register-columns').append(l);}
$('register-sort').value='submittedAtUtc';
const pillKeys=new Set(['status','passStatus','presence','printStatus']),pillTone={APPROVED:'ok',ACTIVE:'ok',INSIDE:'info',PRINTED:'info',RETURNED:'info',PENDING:'warn',DENIED:'bad',REVOKED:'bad'};
const registerCell=(key,raw)=>raw==null||raw===''?'—':key==='localVisitDate'?raw:key.endsWith('Utc')?dateTime(raw):registerChoices[key]&&key!=='deviceTypes'?human(raw):raw;
function addRegisterFilter(){const wrapper=node('div','','register-filter'),field=document.createElement('select'),holder=node('div','','register-filter-value');field.setAttribute('aria-label','Filter field');for(const [key,label] of registerColumns)field.add(new Option(label,key));field.value='personName';const change=()=>{holder.replaceChildren();const input=document.createElement(registerChoices[field.value]?'select':'input');input.setAttribute('aria-label','Filter value');input.required=true;if(registerChoices[field.value])for(const v of registerChoices[field.value])input.add(new Option(human(v),v));else{input.maxLength=200;input.placeholder=field.value.endsWith('Utc')?'Contains UTC date / time…':'Contains…';}holder.append(input);};field.addEventListener('change',change);change();wrapper.append(field,holder,button('Remove',()=>wrapper.remove(),'quiet'));$('register-filters').append(wrapper);}
function renderRegisterHeader(){const head=node('tr','');for(const [key,label] of registerColumns)if(registerState.visible.has(key)){const th=node('th','');th.scope='col';th.setAttribute('aria-sort',$('register-sort').value===key?($('register-direction').value==='ASC'?'ascending':'descending'):'none');th.append(button(label+($('register-sort').value===key?($('register-direction').value==='ASC'?' ↑':' ↓'):''),()=>{$('register-direction').value=$('register-sort').value===key&&$('register-direction').value==='ASC'?'DESC':'ASC';$('register-sort').value=key;void loadReports();},'register-sort-button'));head.append(th);}$('register-head').replaceChildren(head);}
function registerNotice(message){renderRegisterHeader();const row=node('tr',''),cell=node('td',message,'register-notice');cell.colSpan=registerState.visible.size;row.append(cell);$('report-list').replaceChildren(row);}
function registerScopeLabel(){return state.office.locationName+(consoleState.pair?' · '+consoleState.pair.projectName:' · All authorized projects');}
function registerSortLabel(filter){const label=registerColumns.find(([key])=>key===filter.sort)?.[1]??'Registered at',order=filter.direction==='ASC'?'ascending':'descending';return 'Sorted by '+label+' ('+order+')';}
function renderRegister(){renderRegisterHeader();$('report-list').replaceChildren();for(const v of registerState.rows){const tr=node('tr','','register-row');tr.addEventListener('click',event=>{if(!event.target.closest('button'))void viewAdminVisit(v);});for(const [key] of registerColumns)if(registerState.visible.has(key)){const td=node('td',''),value=registerCell(key,v[key]);if(key==='personName')td.append(button(value,()=>viewAdminVisit(v),'register-name'));else if(pillKeys.has(key)&&v[key])td.append(node('span',value,'cell-pill'+(pillTone[v[key]]?' pill-'+pillTone[v[key]]:'')));else td.textContent=value;tr.append(td);}$('report-list').append(tr);}if(!registerState.rows.length)registerNotice('No visits found in this scope. Change the office, dates or filters.');const pages=Math.max(1,Math.ceil(registerState.total/50));$('register-page').textContent='Page '+registerState.page+' of '+pages;$('register-previous').disabled=registerState.loading||registerState.page<=1;$('reports-more').hidden=registerState.page*50>=registerState.total;$('reports-more').disabled=registerState.loading;}
async function loadReports(more=false,previous=false,retainPage=false){const version=consoleState.version,request=requestToken('reports');let filter;try{if(!more&&!previous&&!retainPage){const filters={};for(const wrapper of $('register-filters').children){const key=wrapper.querySelector('select').value,value=wrapper.querySelector('.register-filter-value').firstElementChild.value.trim();if(!value)throw Error('Enter a value for every field filter.');if(Object.hasOwn(filters,key))throw Error('Use one filter per field.');filters[key]=value;}const reference=$('report-reference').value.trim();if(reference){if(filters.publicReference)throw Error('Use one request reference filter.');filters.publicReference=reference;}for(const [id,key] of [['quick-name','personName'],['quick-status','status'],['quick-presence','presence'],['quick-type','requestType']]){const value=$(id).value.trim();if(!value)continue;if(Object.hasOwn(filters,key))throw Error('Use one filter per field.');filters[key]=value;}filter={...scopeBody(),...range('report-from','report-to'),filters,sort:$('register-sort').value,direction:$('register-direction').value};}else filter=registerState.filter;if(!filter)return;const page=more?registerState.page+1:previous?registerState.page-1:retainPage?registerState.page:1;registerState.loading=true;$('register-apply').disabled=true;$('register-export').disabled=true;$('register-previous').disabled=true;$('reports-more').disabled=true;$('report-status').textContent=registerScopeLabel()+' · Loading visits…';registerNotice('Loading visit register…');const r=await api('register',{...filter,page});if(version!==consoleState.version||request!==consoleState.requests.reports)return;registerState.filter=filter;registerState.page=r.page;registerState.total=r.total;registerState.rows=r.rows;registerState.loading=false;renderRegister();$('report-status').textContent=registerScopeLabel()+' · '+(r.total?((page-1)*50+1)+'–'+((page-1)*50+r.rows.length)+' of '+r.total+' matching visits':'No visits match these filters')+' · '+registerSortLabel(filter);}catch(e){if(version===consoleState.version&&request===consoleState.requests.reports){$('report-status').textContent=registerScopeLabel()+' · '+e.message;registerNotice('Visits could not be loaded. Use Apply filters to retry.');registerState.total=0;registerState.rows=[];fail(e);}}finally{if(version===consoleState.version&&request===consoleState.requests.reports){registerState.loading=false;$('register-apply').disabled=false;$('register-export').disabled=!registerState.total||!!registerState.exporting;$('register-previous').disabled=registerState.page<=1;$('reports-more').disabled=false;$('reports-more').hidden=!registerState.total||registerState.page*50>=registerState.total;}}}
$('register-add-filter').addEventListener('click',addRegisterFilter);
$('register-previous').addEventListener('click',()=>loadReports(false,true));
$('register-reset').addEventListener('click',()=>{$('register-filters').replaceChildren();$('report-reference').value='';for(const id of ['quick-name','quick-status','quick-presence','quick-type'])$(id).value='';$('report-from').value=consoleState.scope.currentDate;$('report-to').value=consoleState.scope.currentDate;$('register-sort').value='submittedAtUtc';$('register-direction').value='DESC';syncReportChips();void loadReports();});
function syncReportChips(){const from=$('report-from').value,to=$('report-to').value,today=consoleState.scope?.currentDate;for(const b of document.querySelectorAll('[data-report-days]'))b.setAttribute('aria-pressed',String(!!today&&to===today&&from===shiftDay(today,1-Number(b.dataset.reportDays))));}
for(const b of document.querySelectorAll('[data-report-days]'))b.addEventListener('click',()=>{const today=consoleState.scope?.currentDate;if(!today||registerState.loading)return;$('report-to').value=today;$('report-from').value=shiftDay(today,1-Number(b.dataset.reportDays));syncReportChips();void loadReports();});
for(const id of ['report-from','report-to'])$(id).addEventListener('change',()=>{syncReportChips();void loadReports();});
for(const id of ['quick-status','quick-presence','quick-type','register-sort','register-direction'])$(id).addEventListener('change',()=>{void loadReports();});
// Minimal XLSX writer: stored (uncompressed) ZIP of inline-string cells, so no library or network is needed.
const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function zipStore(files){
 const enc=new TextEncoder(),parts=[],central=[],u16=v=>[v&255,v>>>8&255],u32=v=>[v&255,v>>>8&255,v>>>16&255,v>>>24&255];let offset=0;
 for(const [name,text] of files){
  const nameBytes=enc.encode(name),data=enc.encode(text),crc=crc32(data);
  const local=new Uint8Array([0x50,0x4b,3,4,...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0x21),...u32(crc),...u32(data.length),...u32(data.length),...u16(nameBytes.length),...u16(0)]);
  parts.push(local,nameBytes,data);
  central.push(new Uint8Array([0x50,0x4b,1,2,...u16(20),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0x21),...u32(crc),...u32(data.length),...u32(data.length),...u16(nameBytes.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset)]),nameBytes);
  offset+=local.length+nameBytes.length+data.length;
 }
 const size=central.reduce((n,p)=>n+p.length,0),end=new Uint8Array([0x50,0x4b,5,6,...u16(0),...u16(0),...u16(files.length),...u16(files.length),...u32(size),...u32(offset),...u16(0)]);
 return new Blob([...parts,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
const xmlText=s=>String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu,'').replace(/[&<>"]/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const colName=i=>{let n=i+1,s='';while(n){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=Math.floor((n-1)/26);}return s;};
function sheetXml(header,rows){
 const cell=(r,c,v,style)=>'<c r="'+colName(c)+r+'"'+(style?' s="1"':'')+' t="inlineStr"><is><t xml:space="preserve">'+xmlText(v)+'</t></is></c>';
 const lines=[header,...rows].map((row,r)=>'<row r="'+(r+1)+'">'+row.map((v,c)=>cell(r+1,c,v,r===0)).join('')+'</row>');
 const widths=header.map((h,c)=>rows.slice(0,200).reduce((w,row)=>Math.max(w,String(row[c]).length+2),Math.max(10,h.length+2))).map(w=>Math.min(48,w));
 return'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('')+'</cols><sheetData>'+lines.join('')+'</sheetData><autoFilter ref="A1:'+colName(header.length-1)+(rows.length+1)+'"/></worksheet>';
}
function xlsxBlob(header,rows){
 const ns='http://schemas.openxmlformats.org/',head='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
 return zipStore([
  ['[Content_Types].xml',head+'<Types xmlns="'+ns+'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
  ['_rels/.rels',head+'<Relationships xmlns="'+ns+'package/2006/relationships"><Relationship Id="rId1" Type="'+ns+'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml',head+'<workbook xmlns="'+ns+'spreadsheetml/2006/main" xmlns:r="'+ns+'officeDocument/2006/relationships"><sheets><sheet name="Visit register" sheetId="1" r:id="rId1"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels',head+'<Relationships xmlns="'+ns+'package/2006/relationships"><Relationship Id="rId1" Type="'+ns+'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="'+ns+'officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
  ['xl/styles.xml',head+'<styleSheet xmlns="'+ns+'spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
  ['xl/worksheets/sheet1.xml',sheetXml(header,rows)]
 ]);
}
async function exportRegister(){
 const filter=registerState.filter,version=consoleState.version;if(!filter||registerState.loading||registerState.exporting)return;
 const attempt={version};registerState.exporting=attempt;$('register-export').disabled=true;
 try{
  const rows=[],ids=new Set();let pages=1,total=null,datasetVersion=null;
  for(let page=1;page<=pages;page++){
   $('report-status').textContent='Preparing Excel file… '+rows.length+' of '+(total??registerState.total)+' visits';
   const r=await api('register',{...filter,page,export:true});if(version!==consoleState.version||registerState.exporting!==attempt)return;
   if(page===1){
    if(!Number.isSafeInteger(r.total)||r.total<1)throw Error('No visits remain in this scope. Refresh the register.');
    pages=Math.ceil(r.total/50);if(pages>200)throw Error('Too many visits to export at once. Narrow the dates or filters.');
    if(typeof r.datasetVersion!=='string'||!/^[a-f0-9]{64}$/u.test(r.datasetVersion))throw Error('Refresh the register before exporting.');
    total=r.total;datasetVersion=r.datasetVersion;
   }
   if(r.datasetVersion!==datasetVersion||r.total!==total||r.page!==page||!Array.isArray(r.rows)||r.rows.length!==Math.min(50,total-(page-1)*50))throw Error('Visit register changed during export. Refresh the register and try again.');
   for(const row of r.rows){const id=String(row.visitRequestId).toLowerCase();if(ids.has(id))throw Error('Visit register changed during export. Refresh the register and try again.');ids.add(id);rows.push(row);}
  }
  if(rows.length!==total)throw Error('Visit register changed during export. Refresh the register and try again.');
  const header=registerColumns.map(([,label])=>label),body=rows.map(v=>registerColumns.map(([key])=>{const x=registerCell(key,v[key]);return x==='—'?'':x;}));
  const url=URL.createObjectURL(xlsxBlob(header,body)),link=document.createElement('a'),tag=s=>String(s).replace(/[^A-Za-z0-9_-]+/gu,'-');
  link.href=url;link.download='GatePass-Visit-Register-'+tag(state.office.locationName)+'-'+filter.from+'_to_'+filter.to+'.xlsx';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
  $('report-status').textContent=rows.length+' visits exported to Excel.';toasts.show('Excel file downloaded.','success');
 }catch(e){if(version===consoleState.version&&registerState.exporting===attempt){$('report-status').textContent=e.message;fail(e);}}
 finally{if(registerState.exporting===attempt){registerState.exporting=false;if(version===consoleState.version)$('register-export').disabled=!registerState.total||registerState.loading;}}
}
$('register-export').addEventListener('click',()=>void exportRegister());

const auditClock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}),auditDay=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',weekday:'long',day:'numeric',month:'long',year:'numeric'});
function logLine(ev){
 const line=node('article','','log-line'),time=node('time',ev.occurredAtUtc?auditClock.format(new Date(ev.occurredAtUtc)):'—','log-time'),level=node('span',human(ev.resultCode),'log-level'),msg=node('div','','log-msg'),target=[human(ev.targetType),ev.targetDisplayName].filter(Boolean).join(' ');
 if(ev.occurredAtUtc)time.dateTime=ev.occurredAtUtc;level.dataset.result=ev.resultCode;
 msg.append(node('span',human(ev.actionCode),'log-action'),' by ',node('span',ev.actorDisplayName,'log-actor'),' → ',node('span',target,'log-target'));
 for(const [key,value] of [['staff',ev.staffCode],['role',ev.roleCode?human(ev.roleCode):null],['scope',ev.scopeName]])if(value)msg.append(' ',node('span',key+'='+value,'log-meta'));
 line.append(time,level,msg);if(ev.reason)line.append(node('p',ev.reason,'log-reason'));return line;
}
function renderAudit(){
 const result=$('audit-result').value,q=$('audit-search').value.trim().toLowerCase(),all=auditState.events;
 const shown=all.filter(ev=>(!result||ev.resultCode===result)&&(!q||[ev.actionCode,ev.actorDisplayName,ev.targetType,ev.targetDisplayName,ev.staffCode,ev.roleCode,ev.scopeName,ev.reason].filter(Boolean).join(' ').toLowerCase().includes(q)));
 const nodes=[];let day='';
 for(const ev of shown){const label=ev.occurredAtUtc?auditDay.format(new Date(ev.occurredAtUtc)):'Unknown date';if(label!==day){day=label;nodes.push(node('h3',label,'log-day'));}nodes.push(logLine(ev));}
 $('audit-list').replaceChildren(...nodes);
 $('audit-status').textContent=(shown.length===all.length?all.length+' events loaded':shown.length+' of '+all.length+' loaded events match')+(auditState.hasMore?' · more available':'');
}
$('audit-result').addEventListener('change',renderAudit);$('audit-search').addEventListener('input',renderAudit);
async function loadAudit(more=false){const version=consoleState.version,request=requestToken('audit');try{if(!more)consoleState.auditFilter={...range('audit-from','audit-to'),all:!$('audit-all-label').hidden&&$('audit-all').checked};const {from,to}=consoleState.auditFilter;if(!more){consoleState.auditCursor=null;auditState.events=[];$('audit-list').replaceChildren();}$('audit-status').textContent='Loading audit events…';const r=await api('audit',{...(consoleState.auditFilter.all?{}:scopeBody()),fromUtc:indiaStart(from),untilUtc:indiaStart(dayAfter(to)),pageSize:50,...(more&&consoleState.auditCursor?{afterAuditEventId:consoleState.auditCursor}:{})});if(version!==consoleState.version||request!==consoleState.requests.audit)return;consoleState.auditCursor=r.afterAuditEventId;auditState.events.push(...r.events);auditState.hasMore=r.hasMore;renderAudit();$('audit-more').hidden=!r.hasMore;}catch(e){if(version===consoleState.version&&request===consoleState.requests.audit){$('audit-status').textContent=e.message;fail(e);}}}
const chipTone={APPROVED:'ok',ACTIVE:'ok',INSIDE:'info',PRINTED:'info',RETURNED:'info',PENDING:'warn',DENIED:'bad',REVOKED:'bad'};
function timelineItem(e){const li=node('li','','timeline-item'+(e.tone?' '+e.tone:'')),dot=node('span','','timeline-dot'),body=node('div','','timeline-body');dot.setAttribute('aria-hidden','true');body.append(node('strong',e.title));if(e.at){const t=node('time',dateTime(e.at));t.dateTime=e.at;body.append(t);}if(e.meta)body.append(node('p',e.meta));li.append(dot,body);return li;}
function renderVisitHistory(v,r){
 $('admin-visit-chips').replaceChildren(...[['Approval',r.status],['Pass',r.passStatus??v.passStatus],['Presence',v.presence],['Printed',v.printStatus]].filter(([,x])=>x).map(([k,x])=>node('span',k+': '+human(x),'status-chip '+(chipTone[x]??''))));
 const events=[],add=(at,title,meta,tone='')=>{if(at)events.push({at,title,meta,tone});},moves=r.movements??[];
 add(v.submittedAtUtc,'Request registered',[human(v.requestType),v.publicReference].filter(Boolean).join(' · '));
 add(r.validFromUtc,'Pass valid from',r.publicPassNumber?'Pass '+r.publicPassNumber:'');
 for(const m of moves)add(m.occurredAtUtc,m.eventType==='ENTRY'?'Entered premises':'Left premises',[m.guardName,human(m.entryMethod)].filter(Boolean).join(' · '),m.eventType==='ENTRY'?'tl-entry':'tl-exit');
 add(v.returnedAtUtc,'Pass returned','','tl-returned');
 add(r.validUntilUtc,'Pass valid until','');
 events.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 const items=events.map(timelineItem);
 if(!moves.length)items.push(timelineItem({title:'No gate movement recorded yet'}));
 if(r.movementsHasMore)items.push(timelineItem({title:'More movements exist than are listed here'}));
 $('admin-visit-timeline').replaceChildren(...items);
}
async function viewAdminVisit(v){const version=++consoleState.detailVersion;$('admin-visit-chips').replaceChildren();$('admin-visit-fields').replaceChildren();$('admin-visit-timeline').replaceChildren();$('admin-visit-status').textContent='Loading visit…';$('admin-visit-title').textContent=v.personName;$('admin-visit-dialog').showModal();try{const r=await api('visit-detail',{visitRequestId:v.visitRequestId});if(version!==consoleState.detailVersion)return;const entries=[...(r.companyName?[['Company',r.companyName]]:[]),...(r.deviceTypes?.length?[['Devices',r.deviceTypes.map(code=>({LAPTOP:'Laptop',TABLET:'Tablet / iPad',PEN_DRIVE:'Pen Drive',CAMERA:'Camera',OTHER:'Other'})[code]).join(', ')]]:[]),['Name',r.personName],['Status',human(r.status)],['Office',r.locationName],['Project',r.projectName??'Digital ID'],['Host',r.hostName??'Not applicable'],['Purpose',r.reason],['Pass',r.publicPassNumber],['Valid from',dateTime(r.validFromUtc)],['Valid until',dateTime(r.validUntilUtc)],...[['Email',v.personEmail],['Mobile',v.personPhone],['Employee ID',v.employeeId],['Host email',v.hostEmail],['Request reference',v.publicReference],['Type',v.requestType?human(v.requestType):null]].filter(([,x])=>x)];for(const [key,value] of entries){const pair=node('div','','detail-pair');pair.append(node('dt',key),node('dd',value??'Unavailable'));$('admin-visit-fields').append(pair);}renderVisitHistory(v,r);$('admin-visit-status').textContent='';}catch(e){if(version===consoleState.detailVersion){$('admin-visit-status').textContent=e.message;fail(e);}}}
for(const b of document.querySelectorAll('[data-admin-view]'))b.addEventListener('click',()=>{if(!consoleState.writing)void showAdminView(b.dataset.adminView);});
$('console-project').addEventListener('change',async()=>{if(consoleState.writing||state.busy||commonState.busy)return;const pair=state.projects.find(p=>p.projectLocationId===$('console-project').value)??null;clearConsole();consoleState.pair=pair;try{const version=consoleState.version,scope=await api('scope',scopeBody());if(version!==consoleState.version)return;consoleState.scope=scope;setScope();await showAdminView(consoleState.view);}catch(e){$('page-status').textContent='This scope is unavailable. Choose an assigned project.';fail(e);}});
initOverviewControls();$('staff-role').addEventListener('change',renderCapabilities);$('subject-form').addEventListener('submit',e=>{e.preventDefault();void searchSubjects();});$('subjects-more').addEventListener('click',()=>searchSubjects(true));$('role-state').addEventListener('change',()=>loadRoles());$('roles-more').addEventListener('click',()=>loadRoles(true));$('report-form').addEventListener('submit',e=>{e.preventDefault();void loadReports();});$('reports-more').addEventListener('click',()=>loadReports(true));$('audit-form').addEventListener('submit',e=>{e.preventDefault();void loadAudit();});$('audit-more').addEventListener('click',()=>loadAudit(true));
function closeAccount(){$('account-menu').hidden=true;$('account-toggle').setAttribute('aria-expanded','false');}
$('account-toggle').addEventListener('click',()=>{const open=$('account-menu').hidden;$('account-menu').hidden=!open;$('account-toggle').setAttribute('aria-expanded',String(open));if(open)$('admin-profile').focus();});document.addEventListener('click',e=>{if(!$('staff-session').contains(e.target))closeAccount();});$('account-menu').addEventListener('keydown',e=>{if(e.key==='Escape'){closeAccount();$('account-toggle').focus();}if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const buttons=[...$('account-menu').querySelectorAll('button')],i=buttons.indexOf(document.activeElement);buttons[(i+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();}});
$('admin-profile').addEventListener('click',async()=>{closeAccount();const version=consoleState.version;try{const r=await api('context'),sc=await api('scope',scopeBody());if(version!==consoleState.version)return;$('profile-content').replaceChildren(row([$('staff-name').textContent,...sc.roles.map(x=>human(x.roleCode)+' · '+human(x.scopeType))]),...r.locations.map(o=>row([o.locationName,o.locationCode])),row(['Projects in '+state.office.locationName,...state.projects.map(p=>p.projectName)]));$('admin-profile-dialog').showModal();}catch(e){fail(e);}});
$('admin-confirm-dialog').addEventListener('cancel',e=>{if(consoleState.writing)e.preventDefault();});
for(const b of document.querySelectorAll('[data-close]'))b.addEventListener('click',()=>{if(consoleState.writing)return;$(b.dataset.close).close();if(b.dataset.close==='admin-visit-dialog')consoleState.detailVersion++;});
if($('qr-download-poster'))$('qr-download-poster').addEventListener('click',()=>{if(currentOfficeQr)void downloadPosterPng(currentOfficeQr.office,currentOfficeQr.dataUrl,currentOfficeQr.locationName,currentOfficeQr.url);});
if($('qr-print-pdf'))$('qr-print-pdf').addEventListener('click',()=>{window.print();});
const qrDialog=$('qr-dialog');
if(qrDialog&&!('closedBy' in HTMLDialogElement.prototype)){
  qrDialog.addEventListener('click',event=>{
    if(event.target!==qrDialog)return;
    const rect=qrDialog.getBoundingClientRect();
    if(event.clientY<rect.top||event.clientY>rect.bottom||event.clientX<rect.left||event.clientX>rect.right)qrDialog.close();
  });
}
window.addEventListener('pagehide',()=>{clearConsole();for(const d of document.querySelectorAll('dialog[open]'))d.close();});
// Initial dates come from the authorized server scope, independent of browser clock skew.

// Setup credentials remain in memory only and are cleared on close, navigation and scope loss.
const onboarding={attempt:null,token:null,target:null,busy:false};
function clearOnboarding(){onboarding.attempt=null;onboarding.token=null;onboarding.target=null;$('new-staff-link').value='';$('new-staff-result').hidden=true;$('new-staff-summary').textContent=$('new-staff-expiry').textContent=$('reset-staff-copy').textContent=$('new-staff-status').textContent='';$('add-staff-form').reset();$('staff-reset-form').reset();if($('add-staff-dialog').open)$('add-staff-dialog').close();}
function closeOnboarding(){if(!onboarding.busy)clearOnboarding();}
function setupRoles(){const role=$('new-staff-role').value;$('new-staff-scope').textContent='Scope: '+(role==='PLATFORM_ADMIN'?'Platform':role==='INDIA_ADMIN'?'India':state.office.locationName);$('new-staff-capabilities').replaceChildren(node('legend','Permissions'));for(const cap of roleCaps[role]??[]){const label=node('label',''),input=document.createElement('input');input.type='checkbox';input.value=cap;input.checked=true;label.append(input,document.createTextNode(human(cap)));$('new-staff-capabilities').append(label);}$('new-guard-project-label').hidden=role!=='GUARD'||!consoleState.pair||!consoleState.scope.canAssignGuards;}
function openOnboarding(guard=false,reset=false){if(consoleState.writing||onboarding.busy)return;clearOnboarding();if(reset){const u=consoleState.subject;if(!u?.localAccount||!u.active||!consoleState.scope.canResetLocalStaff||u.userId===consoleState.scope.userId)return;onboarding.target=u;$('add-staff-title').textContent='Reset password setup';$('reset-staff-copy').textContent='Generate a new one-time setup link for '+u.displayName+'. Existing password, sessions and unused setup links will be revoked.';}else{const roles=(consoleState.scope?.provisionableRoles??[]).filter(r=>guard?r.roleCode==='GUARD':r.roleCode!=='GUARD');if(!roles.length)return;$('add-staff-title').textContent=guard?'Add guard':'Add user';$('new-staff-help').textContent=guard?'Create a guard account for your authorized office. You can assign project duty here or from Guard assignments.':'Create a reception or administrator account from the roles available to you. Corporate employees use their existing SSO identity under Find staff.';$('new-staff-role').replaceChildren(...roles.map(r=>new Option(human(r.roleCode),r.roleCode)));setupRoles();$('new-guard-project').checked=guard&&!!consoleState.pair;}$('add-staff-form').hidden=reset;$('staff-reset-form').hidden=!reset;$('add-staff-dialog').showModal();}
async function submitOnboarding(event,reset){event.preventDefault();if(onboarding.busy||consoleState.writing)return;const form=$(reset?'staff-reset-form':'add-staff-form');if(!form.reportValidity())return;const version=consoleState.version;try{const payload=reset?{targetUserId:onboarding.target.userId,reason:$('staff-reset-reason').value.trim()}:{displayName:$('new-staff-name').value.trim(),loginId:$('new-staff-login').value.trim().toLowerCase(),roleCode:$('new-staff-role').value,locationId:state.office.locationId,capabilities:[...$('new-staff-capabilities').querySelectorAll('input:checked')].map(x=>x.value),reason:$('new-staff-reason').value.trim(),...(!$('new-guard-project-label').hidden&&$('new-guard-project').checked?{projectLocationId:consoleState.pair.projectLocationId}:{})};if(!reset&&(!payload.capabilities.length||(['GUARD','RECEPTION'].includes(payload.roleCode)&&!payload.capabilities.includes('VISITS_READ'))))throw Error('Choose workspace permissions, including visit reading for guards and reception.');const fingerprint=JSON.stringify(payload);if(onboarding.attempt?.fingerprint!==fingerprint){const bytes=crypto.getRandomValues(new Uint8Array(32));onboarding.token=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');bytes.fill(0);onboarding.attempt={fingerprint,key:crypto.randomUUID()};}onboarding.busy=consoleState.writing=true;const locked=[...document.querySelectorAll('#add-staff-dialog button,#add-staff-dialog input,#add-staff-dialog select,#admin-office,#console-project,.admin-header button,.admin-nav button,.admin-content button')].map(el=>[el,el.disabled]);for(const [el] of locked)el.disabled=true;$('new-staff-status').textContent='Saving account and audit trail…';try{const result=await api(reset?'reset-staff-setup':'create-staff',{...payload,setupToken:onboarding.token,clientKey:onboarding.attempt.key});if(version!==consoleState.version)return;$('new-staff-link').value=location.origin+'/#staff-setup='+onboarding.token;$('new-staff-summary').textContent=result.displayName+' · '+result.loginId+' · '+human(result.roleCode);$('new-staff-expiry').textContent='Setup link expires '+dateTime(result.setupExpiresAtUtc);form.hidden=true;$('new-staff-result').hidden=false;$('new-staff-status').textContent='Saved. Account creation/setup is recorded in the audit log.';consoleState.auditCursor=null;$('audit-list').replaceChildren();if(!reset&&consoleState.view==='assignments')await loadAssignments();}finally{onboarding.busy=consoleState.writing=false;for(const [el,disabled] of locked)if(el.isConnected)el.disabled=disabled;}}catch(error){if(version===consoleState.version){$('new-staff-status').textContent=error.status===409?'This login ID is already used, or this request changed. Check the account before retrying.':error.message;fail(error);}}}
$('add-staff-open').addEventListener('click',()=>openOnboarding());$('add-guard-open').addEventListener('click',()=>openOnboarding(true));$('reset-staff-setup').addEventListener('click',()=>openOnboarding(false,true));$('new-staff-role').addEventListener('change',setupRoles);$('close-add-staff').addEventListener('click',closeOnboarding);$('add-staff-dialog').addEventListener('cancel',e=>{e.preventDefault();closeOnboarding();});$('add-staff-form').addEventListener('submit',e=>void submitOnboarding(e,false));$('staff-reset-form').addEventListener('submit',e=>void submitOnboarding(e,true));$('copy-staff-setup').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('new-staff-link').value);toasts.show('Setup link copied. Share it privately.','success');}catch{$('new-staff-link').focus();$('new-staff-link').select();toasts.show('Select and copy the setup link.','info');}});

void initialize();

async function refreshVisibleAdmin(){
 const version=consoleState.version,view=consoleState.view;
 try{const scope=await api('scope',scopeBody());if(version!==consoleState.version)return;if(JSON.stringify(scope)!==JSON.stringify(consoleState.scope)){await prepareConsole();return;}}
 catch(error){if(version===consoleState.version)fail(error);return;}
 if(view==='projects'){
  try{
   const projects=[],seen=new Set();let cursor=null;do{const r=await api('projects',{locationId:state.office.locationId,...(cursor?{cursor}:{})});if(version!==consoleState.version)return;projects.push(...r.projects);cursor=r.cursor;if(cursor){const key=JSON.stringify(cursor);if(seen.has(key)||!r.projects.length||projects.length>10000)throw Error('Project list changed. Refresh to retry.');seen.add(key);}}while(cursor);
   const old=state.projects.map(({leadSlot,leadPreview,leadRevision,...p})=>p);
   if(JSON.stringify(old)!==JSON.stringify(projects)){await prepareConsole();return;}
   if(state.office.canManageCommonAreas){const result=await readCommonCatalogue(state.office.locationId,()=>version===consoleState.version);if(!result)return;if(JSON.stringify(result.areas)!==JSON.stringify(state.areas)||JSON.stringify(result.assignments)!==JSON.stringify(state.areaAssignments)){state.areas=result.areas;state.areaAssignments=result.assignments;state.areasLoaded=true;renderProjects();}}
  }catch(error){if(version===consoleState.version)fail(error);}
 }else if(view==='overview')await loadSummary();
 else if(view==='reports')await loadReports(false,false,true);
 else if(view==='assignments')await loadAssignments();
 else if(view==='audit')await loadAudit();
}
const liveRefresh=new LiveRefresh(refreshVisibleAdmin,()=>!!consoleState.scope&&!$('console-project').disabled&&$('overview-range').getAttribute('aria-busy')!=='true'&&!consoleState.writing&&!state.busy&&!commonState.busy&&!registerState.loading&&!registerState.exporting&&consoleState.view!=='staff'&&workspaceIdle(),20000,()=>consoleState.scope&&state.office&&consoleState.view!=='staff'?{workspace:'ADMIN',...scopeBody()}:null);

window.addEventListener('pageshow',event=>{if(event.persisted)void initialize();});

new ActionCentre({mount:document.getElementById('refresh').parentElement,scope:async()=>state.office&&consoleState.scope?{body:{workspace:'ADMIN',locationId:state.office.locationId,dutyKind:'OFFICE',dutyId:'0'},label:state.office.locationName+' · Authorized projects'}:null,openRecord:row=>viewAdminVisit(row)});
