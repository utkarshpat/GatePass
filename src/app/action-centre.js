/* On-demand follow-up list. Reminders require an explicit click; no automatic operational actions. */
class ActionCentre{
 constructor({mount,scope,openRecord,decorateName,translate=value=>value}){
  this.scope=scope;this.openRecord=openRecord;this.decorateName=decorateName;this.t=translate;this.version=0;this.rows=[];this.cursor=null;this.busy=false;this.category='PENDING';this.reminders=new Map();this.reminderKeys=new Map();this.notifyNodes=new Map();
  const el=(tag,value)=>{const n=document.createElement(tag);if(value)n.textContent=value;return n;};this.el=el;
  this.button=el('button',this.t('Action centre'));this.button.dataset.i18n='Action centre';this.button.type='button';this.button.id='open-action-centre';this.button.className='secondary btn outline';mount.append(this.button);
  const dialog=this.dialog=el('dialog');dialog.className='app-dialog action-centre';dialog.id='action-centre';dialog.setAttribute('aria-labelledby','action-centre-title');
  const heading=el('div');heading.className='dialog-heading';const title=el('h2',this.t('Action centre'));title.dataset.i18n='Action centre';title.id='action-centre-title';const close=el('button','×');close.type='button';close.className='quiet';close.setAttribute('aria-label',this.t('Close action centre'));heading.append(title,close);
  const navigation=el('div');navigation.className='action-navigation';this.scopeLabel=el('p');this.scopeLabel.className='hint';this.filter=el('div');this.filter.id='action-category';this.filter.className='action-tabs';this.filter.setAttribute('role','tablist');this.filter.setAttribute('aria-label',this.t('Follow-up type'));navigation.append(this.scopeLabel,this.filter);
  const body=this.panel=el('div');body.id='action-panel';body.className='dialog-body';body.setAttribute('role','tabpanel');this.status=el('p');this.status.setAttribute('role','status');this.list=el('div');this.list.id='action-items';
  this.more=el('button',this.t('Load more'));this.more.type='button';this.more.className='secondary';this.more.hidden=true;const refresh=el('button',this.t('Refresh'));refresh.type='button';refresh.className='secondary';
  body.append(this.status,this.list,this.more,refresh);dialog.append(heading,navigation,body);document.body.append(dialog);
  this.button.addEventListener('click',async()=>{if(dialog.open)return;const selected=await scope();if(!selected)return;this.selected=selected;this.scopeLabel.textContent=selected.label;this.buildTabs(selected.body.workspace);this.rows=[];this.cursor=null;this.denied=false;this.list.replaceChildren();this.more.hidden=true;dialog.showModal();void this.load();});
  const cancel=()=>{this.version++;this.controller?.abort();this.busy=false;dialog.close();this.rows=[];this.list.replaceChildren();this.notifyNodes.clear();this.updateCounts();};close.addEventListener('click',cancel);dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();});
  this.filter.addEventListener('keydown',event=>{const tabs=[...this.filter.querySelectorAll('[role="tab"]')],index=tabs.indexOf(document.activeElement);if(index<0)return;let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();tabs[next].focus();this.selectCategory(tabs[next].dataset.category);});refresh.addEventListener('click',()=>this.load());this.more.addEventListener('click',()=>this.load(true));
  // A closed panel costs no polling requests. Visible refresh retains only loaded pages.
  this.timer=setInterval(()=>{if(dialog.open&&!document.hidden&&!this.busy&&!this.denied)void this.load(false,true);},20000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&dialog.open&&!this.busy)void this.load(false,true);});
  window.addEventListener('pagehide',()=>{cancel();clearInterval(this.timer);});
  for(const id of ['guard-office','admin-office','reception-location','project-filter','console-project'])document.getElementById(id)?.addEventListener('change',cancel);
 }
 buildTabs(workspace){
  const categories=[['PENDING','Approval overdue','pending'],['EXPIRED_INSIDE','Expired but inside','expiredInside'],['UNRETURNED','Pass return pending','unreturned']].filter(([value])=>value!=='UNRETURNED'||workspace!=='GUARD');
  if(!categories.some(([value])=>value===this.category))this.category='PENDING';
  this.filter.replaceChildren(...categories.map(([value,label,countKey])=>{const tab=this.el('button');tab.type='button';tab.id='action-tab-'+value;tab.dataset.category=value;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','action-panel');const text=this.el('span');text.className='action-tab-label';text.dataset.i18n=label;const [english,...regional]=this.t(label).split('\n');text.append(document.createTextNode(english));if(regional.length)text.append(this.el('small',regional.join(' ')));const count=this.el('span');count.className='action-tab-count';count.dataset.count=countKey;count.hidden=true;tab.append(text,count);tab.addEventListener('click',()=>this.selectCategory(value));return tab;}));
  this.syncTabs();
 }
 syncTabs(){for(const tab of this.filter.querySelectorAll('[role="tab"]')){const active=tab.dataset.category===this.category;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}this.panel.setAttribute('aria-labelledby','action-tab-'+this.category);}
 updateCounts(counts){for(const badge of this.filter.querySelectorAll('[data-count]')){badge.textContent=counts?String(counts[badge.dataset.count]):'';badge.hidden=!counts;}}
 selectCategory(value){if(value===this.category)return;this.category=value;this.syncTabs();this.rows=[];this.cursor=null;this.list.replaceChildren();this.notifyNodes.clear();this.more.hidden=true;void this.load();}
 reminderKey(row,scope){return [scope.workspace,scope.locationId,scope.dutyKind,scope.dutyId,row.visitRequestId].join(':');}
 renderRows(){
  this.list.replaceChildren();this.notifyNodes.clear();
  for(const row of this.rows){const group=this.el('div');group.className='action-row';const button=this.el('button');button.type='button';button.className='secondary action-item';const name=this.el('strong',row.personName);this.decorateName?.(name,row.personName);button.append(name,this.el('span',row.publicPassNumber));const scope={...this.selected.body};button.addEventListener('click',()=>{this.dialog.close();this.version++;void this.openRecord(row,scope);});group.append(button);
   if(this.category==='PENDING'){const box=this.el('div');box.className='action-notify-wrap';const notify=this.el('button');notify.type='button';notify.className='secondary action-notify';notify.dataset.notify=row.visitRequestId;const status=this.el('small');status.className='action-notify-status';status.setAttribute('role','status');box.append(notify,status);const key=this.reminderKey(row,scope);this.notifyNodes.set(key,{notify,status,row});notify.addEventListener('click',()=>this.remind(row,scope));group.append(box);this.paintReminder(key);}
   this.list.append(group);
  }
 }
 paintReminder(key){
  const nodes=this.notifyNodes.get(key);if(!nodes)return;const state=this.reminders.get(key),locked=state?.busy||state?.until>Date.now(),label=state?.busy?'Notifying…':locked&&state?.queued?'Queued':state?.error?'Retry':'Notify';
  const [english,...regional]=this.t(label).split('\n'),text=this.el('span',english);text.className='action-notify-label';if(regional.length)text.append(this.el('small',regional.join(' ')));nodes.notify.replaceChildren(text);nodes.notify.disabled=!!locked;nodes.notify.setAttribute('aria-label',this.t(label)+': '+nodes.row.personName);nodes.status.textContent=state?.message??'';
 }
 async remind(row,scope){
  const key=this.reminderKey(row,scope),current=this.reminders.get(key);if(current?.busy||current?.until>Date.now())return;if(!this.reminderKeys.has(key))this.reminderKeys.set(key,crypto.randomUUID());this.reminders.set(key,{busy:true,message:''});this.paintReminder(key);
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
  try{
   const cookie=name=>document.cookie.split('; ').find(v=>v.startsWith(name+'='))?.split('=')[1],csrf=cookie('gp-staff-csrf')??cookie('gp-reception-csrf');
   const response=await fetch('/api/operations/remind',{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf??''},body:JSON.stringify({...scope,visitRequestId:row.visitRequestId,clientKey:this.reminderKeys.get(key)})});if(!response.ok)throw Object.assign(new Error(),{status:response.status});const result=await response.json();
   if(!['QUEUED','ALREADY_QUEUED','COOLDOWN'].includes(result.outcome)||!Number.isFinite(Date.parse(result.nextReminderAtUtc)))throw new Error();this.reminderKeys.delete(key);
   const message=this.t(result.outcome==='COOLDOWN'?'Please wait five minutes between reminders.':result.outcome==='ALREADY_QUEUED'?'Approval email is already queued.':'Reminder queued.');
   this.reminders.set(key,{queued:result.mailStatus==='QUEUED',until:Math.max(Date.now()+20000,Date.parse(result.nextReminderAtUtc)),message});
  }catch(error){
   this.reminders.set(key,{error:true,message:this.t(error.status===409?'Request changed. Refresh to check.':'Reminder not confirmed. Retry to check.')});
   if([401,403].includes(error.status)&&this.dialog.open&&JSON.stringify(this.selected.body)===JSON.stringify(scope)){this.version++;this.controller?.abort();this.busy=false;this.denied=true;this.rows=[];this.cursor=null;this.list.replaceChildren();this.list.setAttribute('aria-busy','false');this.notifyNodes.clear();this.updateCounts();this.more.hidden=true;this.status.textContent=this.t('Follow-ups unavailable. Refresh to retry.');}
  }finally{clearTimeout(timeout);this.paintReminder(key);}
 }
 async load(more=false,quiet=false){
  if(!this.dialog.open||more&&!this.cursor)return;const version=++this.version;this.controller?.abort();const controller=this.controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
  const category=this.category,rows=more?[...this.rows]:[],target=quiet?Math.max(24,this.rows.length):24;let cursor=more?this.cursor:null,result;this.busy=true;this.more.disabled=true;this.list.setAttribute('aria-busy','true');if(!quiet)this.status.textContent=this.t('Loading follow-ups…');
  try{const cursors=new Set();do{
   const cookie=name=>document.cookie.split('; ').find(v=>v.startsWith(name+'='))?.split('=')[1],csrf=cookie('gp-staff-csrf')??cookie('gp-reception-csrf');
   const response=await fetch('/api/operations/actions',{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf??''},body:JSON.stringify({...this.selected.body,category,...(cursor?{cursor}:{})})});
   if(!response.ok)throw Object.assign(new Error(),{status:response.status});result=await response.json();if(version!==this.version)return;
   const known=new Set(rows.map(r=>r.visitRequestId));for(const row of result.items)if(!known.has(row.visitRequestId)){known.add(row.visitRequestId);rows.push(row);}cursor=result.cursor;
   if(cursor){const key=JSON.stringify(cursor);if(cursors.has(key))throw new Error();cursors.add(key);}
  }while(quiet&&cursor&&rows.length<target);
  this.rows=rows;this.cursor=cursor;this.list.replaceChildren();
  this.renderRows();
  this.updateCounts(result.counts);
  this.status.textContent=rows.length?rows.length+' / '+result.counts[category==='PENDING'?'pending':category==='EXPIRED_INSIDE'?'expiredInside':'unreturned']+' · '+this.t('Updated')+' '+new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(result.checkedAtUtc))+' IST':this.t('No follow-ups in this category.');this.more.hidden=!cursor;
  }catch(error){if(version!==this.version)return;if([401,403].includes(error.status)){this.denied=true;this.rows=[];this.cursor=null;this.list.replaceChildren();this.notifyNodes.clear();this.updateCounts();this.more.hidden=true;}this.status.textContent=this.t('Follow-ups unavailable. Refresh to retry.');}
  finally{clearTimeout(timeout);if(version===this.version){this.busy=false;this.more.disabled=false;this.list.setAttribute('aria-busy','false');}}
 }
}
