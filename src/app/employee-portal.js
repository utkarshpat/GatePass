'use strict';

const $ = id => document.getElementById(id);
const state = { mode:null, employee:null, options:null, step:0, accessEditor:false, host:null, hosts:[], extras:[], people:[], photoIndex:0, jobs:null, busy:false, searchVersion:0 };
const camera = new CameraSession(() => navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:960},height:{ideal:1280}},audio:false}));
let searchTimer;
let restoringNavigation=false;
let flowVersion=0;
const navigationState=()=>({gatepass:true,view:document.body.dataset.view,step:state.step,flow:flowVersion});
history.replaceState(navigationState(),'');
function rememberNavigation() {
  if(restoringNavigation)return;
  const next=navigationState(),current=history.state;
  if(current?.view===next.view&&current?.step===next.step&&current?.flow===next.flow)return;
  history.pushState(next,'');
}
window.addEventListener('popstate',event=>{
  if(!event.state?.gatepass)return;
  if(state.busy||state.jobs){history.pushState(navigationState(),'');return;}
  restoringNavigation=true;
  try {
    clearPassword();syncPeople();
    const target=event.state;
    if(target.view==='sign-in-screen'){screen('sign-in-screen');$('employee-email').focus();}
    else if(target.view==='flow'&&target.flow===flowVersion&&state.options){screen('flow');renderStep(target.step);}
    else {screen('landing');}
  }finally{restoringNavigation=false;history.replaceState(navigationState(),'');}
});
const person = () => ({key:crypto.randomUUID(),name:'',phone:'',phoneRaw:'',country:'IN',email:'',expanded:true,file:null,url:null});
const toasts=new ToastNotifications();
const cookie = name => document.cookie.split('; ').find(value=>value.startsWith(name+'='))?.split('=')[1];
const steps = () => state.mode==='employee'?['Details','Photo','Review']:['People','Visit','Photo','Review'];
const photoStep = () => steps().length-2;

function notify(message='',tone='info') { toasts.show(message,tone); }

async function send(path,body={},binary=false) {
  const headers={'Content-Type':binary?body.type:'application/json'};
  if(cookie('gp-dev-csrf')) headers['X-CSRF-Token']=cookie('gp-dev-csrf');
  if(cookie('gp-dev-intake-csrf')) headers['X-Intake-CSRF-Token']=cookie('gp-dev-intake-csrf');
  let response;
  try { response=await fetch(path,{method:'POST',credentials:'same-origin',headers,body:binary?body:JSON.stringify(body)}); }
  catch { throw new Error('Connection lost. Please retry.'); }
  if(!response.ok) {
    const messages={400:'Check the details and photo.',401:'Session expired. Sign in again.',403:'Request expired or access denied. Start again.',409:'Request changed. Start again.',429:'Too many attempts. Please wait.'};
    throw Object.assign(new Error(messages[response.status]??'Unable to complete the request. Please retry.'),{status:response.status});
  }
  return response.json();
}
const auth=(action,body={})=>send('/api/dev/sso/'+action,body);

function stopCamera() {
  camera.close();
  $('camera-video').srcObject=null;
  $('camera-video').hidden=true;
  $('capture-photo').hidden=true;
  if($('upload-photo-label'))$('upload-photo-label').hidden=false;
  const entry=state.people?.[state.photoIndex];
  const hasPhoto=!!entry?.url;
  $('open-camera').hidden=hasPhoto;
  $('retake-photo').hidden=!hasPhoto;
  if($('photo-zoom-controls'))$('photo-zoom-controls').hidden=!hasPhoto;
  $('open-camera').disabled=state.busy;
}

function screen(name) {
  closeAccessDialog({focus:false});stopCamera();CountryPicker.close();
  for(const id of ['landing','sign-in-screen','flow','success']) $(id).hidden=id!==name;
  document.body.dataset.view=name;
  rememberNavigation();
  notify();
}

function busy(value,{initializing=false}={}) {
  state.busy=value;
  const frozen=value||!!state.jobs;
  for(const id of ['employee-choice','visitor-choice','sign-in','sign-in-back','success-home','retry-pending']) $(id).disabled=value;
  for(const control of $('registration').querySelectorAll('input,select,textarea,button')) {
    const localField=initializing&&control.closest('#details-step')&&control.matches('input,select,textarea,.phone-country,.select-trigger');
    control.disabled=frozen&&!localField;
  }
  $('next-step').disabled=value;
  $('submit').disabled=value;
  $('close-flow').disabled=frozen;
  $('flow').setAttribute('aria-busy',String(value&&!initializing));
  $('next-step').setAttribute('aria-busy',String(value));
  if(!frozen) { $('host-search').disabled=!$('project').value; $('add-visitor').disabled=state.people.length>=10; }
  $('stepper').querySelectorAll('button').forEach((button,index)=>button.disabled=frozen||index>state.step);
}

function reset() {
  for(const job of state.jobs??[])if(job.cardUrl)URL.revokeObjectURL(job.cardUrl);
  closeAccessDialog({focus:false});
  flowVersion++;
  stopCamera();clearTimeout(searchTimer);state.searchVersion++;
  for(const entry of state.people){if(entry.url)URL.revokeObjectURL(entry.url);if(entry.croppedUrl)URL.revokeObjectURL(entry.croppedUrl);}
  state.options=null;state.step=0;state.accessEditor=false;state.host=null;state.hosts=[];state.extras=[];state.people=[person()];state.photoIndex=0;state.jobs=null;
  $('registration').reset();$('reason-details').required=false;$('purpose-details').required=false;
  $('reason-optional').textContent=$('purpose-optional').textContent='(optional)';
  $('extra-projects').replaceChildren();$('submission-results').replaceChildren();$('host-results').replaceChildren();$('host-results').hidden=true;
  $('host-search').setAttribute('aria-expanded','false');$('host-feedback').textContent='';
  $('toggle-access').setAttribute('aria-expanded','false');$('retry-pending').hidden=true;
  busy(false);
}

function setEmployee(employee) {
  state.employee=employee;
  const initials=employee.displayName.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase();
  $('employee-avatar').textContent=initials;
  $('employee-name').textContent=employee.displayName;
  $('employee-id').textContent=employee.employeeId+' · '+employee.officialEmail;
  $('employee-projects').replaceChildren();
  for(const project of employee.projects) {const chip=document.createElement('span');chip.className='chip';chip.textContent=project.projectName;$('employee-projects').append(chip);}
  if(!employee.projects.length) $('employee-projects').textContent='No assigned projects';
}

function syncPeople() {
  if(state.mode!=='visitor')return;
  for(const card of $('visitors').children) {
    const entry=state.people.find(row=>row.key===card.dataset.key);if(!entry)continue;
    for(const key of ['name','email'])entry[key]=card.querySelector(`[name="${key}"]`).value.trim();
    entry.phoneRaw=card.phoneField.input.value.trim();entry.country=card.phoneField.country;entry.phone=card.phoneField.number;
  }
}

function setVisitorExpanded(card,entry,expanded){
  entry.expanded=expanded;card.querySelector('.visitor-details').hidden=!expanded;card.querySelector('.visitor-summary').hidden=expanded;
  card.querySelector('.edit-visitor').hidden=expanded;card.querySelector('.edit-visitor').setAttribute('aria-expanded',String(expanded));
  card.querySelector('h2').textContent=expanded?'Visitor '+(state.people.indexOf(entry)+1):entry.name;
  card.querySelector('.visitor-summary').textContent=[entry.phone,entry.email].filter(Boolean).join(' · ');
}
function validateVisitorCard(card){
  const entry=state.people.find(row=>row.key===card.dataset.key);
  const phoneValid=card.phoneField.validate();
  const valid=phoneValid&&[...card.querySelectorAll('input')].every(input=>input.checkValidity());
  if(!valid){setVisitorExpanded(card,entry,true);checkControls(card);if(!phoneValid)notify('Check the mobile number and country code.','error');}
  return valid;
}
function renderPeople() {
  CountryPicker.close();$('visitors').replaceChildren();
  state.people.forEach((entry,index)=>{
    const fragment=$('visitor-template').content.cloneNode(true),card=fragment.querySelector('.visitor-card');card.dataset.key=entry.key;
    for(const key of ['name','email'])card.querySelector(`[name="${key}"]`).value=entry[key];
    const input=card.querySelector('[name="phone"]');input.id='mobile-'+entry.key;card.querySelector('.mobile-label').htmlFor=input.id;
    const feedback=card.querySelector('.phone-feedback');feedback.id=input.id+'-feedback';input.setAttribute('aria-describedby',feedback.id);
    card.phoneField=new VisitorPhoneField(card.querySelector('.phone-control'),entry.country,entry.phoneRaw);
    setVisitorExpanded(card,entry,entry.expanded);
    card.querySelector('.edit-visitor').addEventListener('click',()=>{syncPeople();setVisitorExpanded(card,entry,true);card.querySelector('[name="name"]').focus();});
    const remove=card.querySelector('.remove-visitor');remove.hidden=state.people.length===1;
    remove.addEventListener('click',()=>{syncPeople();if(entry.url)URL.revokeObjectURL(entry.url);if(entry.croppedUrl)URL.revokeObjectURL(entry.croppedUrl);state.people=state.people.filter(row=>row!==entry);if(!state.people.some(row=>row.expanded))state.people[0].expanded=true;renderPeople();notify('Visitor removed.');});
    $('visitors').append(fragment);
  });
  $('add-visitor').disabled=state.people.length>=10;
}

function renderProjects() {
  const own=new Set((state.employee?.projects??[]).map(row=>row.projectCode));
  $('project').replaceChildren(new Option('Select project',''));
  for(const project of state.options.projects) {
    if(state.mode==='employee'&&(own.has(project.projectCode)||state.extras.some(row=>row.projectLocationId===project.projectLocationId)))continue;
    $('project').append(new Option(project.projectName,project.projectLocationId));
  }
  $('toggle-access').hidden=state.mode==='employee'&&$('project').options.length<=1;
}

async function beginFlow(mode) {
  reset();state.mode=mode;
  $('flow-title').textContent=mode==='employee'?'Digital ID':'Visitor registration';
  $('employee-summary').hidden=$('employee-fields').hidden=mode!=='employee';$('visitor-fields').hidden=mode!=='visitor';
  if(mode==='employee') {state.people[0].name=state.employee.displayName;setEmployee(state.employee);} else renderPeople();
  screen('flow');renderStep(0);busy(true,{initializing:true});
  try {
    await send('/api/registration/reset');
    await send('/api/registration/start',{requestType:mode==='employee'?'DIGITAL_ID':'EXTERNAL'});
    state.options=await send('/api/registration/options');
    if(state.options.locationCode!==document.querySelector('meta[name="gp-office"]').content)throw new Error('Office changed. Reload this page.');
    $('visit-date').value=$('visit-date').min=state.options.currentDate;$('visit-date').max=state.options.maxVisitDate;
    renderProjects();
  } catch(error) {screen('landing');notify(error.message,'error');}
  finally {busy(false);}
}

function renderStep(step) {
  closeAccessDialog({focus:false});
  stopCamera();state.step=step;state.accessEditor=false;
  $('flow-title').textContent=state.mode==='employee'?'Digital ID':'Visitor registration';
  const labels=steps();$('stepper').replaceChildren();
  labels.forEach((label,index)=>{
    const item=document.createElement('li'),button=document.createElement('button'),number=document.createElement('span'),text=document.createElement('span');
    number.className='step-number';number.textContent=index<step?'✓':String(index+1);text.textContent=label;
    button.type='button';button.append(number,text);button.disabled=index>step||!!state.jobs;
    if(index===step)button.setAttribute('aria-current','step');
    button.addEventListener('click',async()=>{if(state.busy||state.jobs)return;if(state.step===photoStep()&&index>state.step){busy(true);try{await commitPhotoCrop(state.people[state.photoIndex]);}catch(error){notify(error.message,'error');return;}finally{busy(false);}}renderStep(index);});item.dataset.state=index<step?'done':index===step?'active':'next';item.append(button);$('stepper').append(item);
  });
  const current=step===0?'details-step':step===photoStep()?'photo-step':step===labels.length-1?'review-step':'visit-step';
  for(const id of ['details-step','visit-step','photo-step','review-step'])$(id).hidden=id!==current;
  $('previous-step').hidden=false;$('next-step').hidden=step===labels.length-1;$('submit').hidden=step!==labels.length-1;
  $('add-project-access').hidden=true;$('visitor-date-field').hidden=state.mode==='employee';
  if(current==='photo-step')renderPhoto();
  if(current==='review-step')renderReview();
  $('next-step').textContent=step===photoStep()?'Review':'Continue';
  $('flow-title').focus();notify();rememberNavigation();
}

function checkControls(container) {
  for(const input of container.querySelectorAll('input,select,textarea')) if(!input.disabled&&!input.reportValidity())return false;
  return true;
}

function validateDetails() {
  if(state.mode==='visitor') {
    syncPeople();
    for(const card of $('visitors').children)if(!validateVisitorCard(card))return false;
    if(state.people.some(entry=>!entry.name||!entry.phone)){notify('Enter a name and mobile number for each visitor.','error');return false;}
    return true;
  }
  if(!$('reason').value){$('reason').focus();notify('Select a reason.','error');return false;}
  if($('reason').value==='OTHER'&&!$('reason-details').value.trim()){$('reason-details').focus();notify('Add the reason.','error');return false;}
  return $('reason-details').reportValidity();
}

function validateVisit() {
  if(!$('project').value){$('project-trigger').focus();notify('Select a project.','error');return false;}
  if(!state.host){$('host-search').focus();notify('Select a host from the search results.','error');return false;}
  if(!$('purpose').value){$('purpose-trigger').focus();notify('Select a purpose.','error');return false;}
  if($('purpose').value==='Other'&&!$('purpose-details').value.trim()){$('purpose-details').focus();notify('Add the purpose.','error');return false;}
  if(!$('purpose-details').reportValidity())return false;
  return state.mode==='employee'||$('visit-date').reportValidity();
}

function purpose(){return $('purpose').value+($('purpose-details').value.trim()?' · '+$('purpose-details').value.trim():'');}
function projectSelection(){return state.options.projects.find(row=>row.projectLocationId===$('project').value);}

function renderExtras() {
  $('extra-projects').replaceChildren();
  state.extras.forEach(entry=>{
    const row=document.createElement('div'),copy=document.createElement('div'),title=document.createElement('strong'),host=document.createElement('small'),remove=document.createElement('button');
    row.className='access-row';title.textContent=entry.projectName;host.textContent=entry.host.displayName+' · '+entry.host.officialEmail;copy.append(title,host);
    remove.type='button';remove.className='quiet';remove.textContent='Remove';remove.addEventListener('click',()=>{state.extras=state.extras.filter(value=>value!==entry);renderExtras();});row.append(copy,remove);$('extra-projects').append(row);
  });
  renderProjects();
}

function fitAccessDialog(){
  const dialog=$('project-access-dialog');if(!dialog.open)return;
  const view=window.visualViewport,bounds=countryDialogBounds(view?.width??window.innerWidth,view?.height??window.innerHeight,view?.offsetLeft??0,view?.offsetTop??0);
  dialog.style.inset='auto';dialog.style.margin='0';
  for(const key of ['width','height','left','top'])dialog.style[key]=bounds[key]+'px';
}
function closeAccessDialog({focus=true}={}){
  const dialog=$('project-access-dialog');if(!state.accessEditor&&!dialog.open)return;
  state.accessEditor=false;clearTimeout(searchTimer);state.searchVersion++;
  $('visit-step').hidden=true;$('photo-step').before($('visit-step'));$('add-project-access').hidden=true;
  $('host-results').hidden=true;$('host-search').setAttribute('aria-expanded','false');
  $('toggle-access').setAttribute('aria-expanded','false');
  document.body.append(toasts.region);toasts.clear();
  if(dialog.open)dialog.close();
  if(focus)($('toggle-access').hidden?$('flow-title'):$('toggle-access')).focus({preventScroll:true});
}
function editAccess() {
  if(state.busy||state.jobs||!state.options)return;
  stopCamera();state.accessEditor=true;renderProjects();state.host=null;$('host-search').value='';$('host-search').disabled=true;$('host-results').hidden=true;$('host-feedback').textContent='';
  $('purpose').value='';$('purpose').dispatchEvent(new Event('change'));$('purpose-details').value='';$('purpose-details').required=false;
  $('project-dialog-fields').append($('visit-step'));$('visit-step').hidden=false;$('visitor-date-field').hidden=true;$('add-project-access').hidden=false;
  $('toggle-access').setAttribute('aria-expanded','true');
  const dialog=$('project-access-dialog');dialog.append(toasts.region);dialog.showModal();fitAccessDialog();
  $('project-trigger').focus({preventScroll:true});
}
$('close-project-dialog').addEventListener('click',()=>closeAccessDialog());
$('cancel-project-dialog').addEventListener('click',()=>closeAccessDialog());
$('project-access-dialog').addEventListener('cancel',event=>{event.preventDefault();closeAccessDialog();});
window.addEventListener('resize',fitAccessDialog);window.visualViewport?.addEventListener('resize',fitAccessDialog);window.visualViewport?.addEventListener('scroll',fitAccessDialog);

async function searchHosts() {
  const version=++state.searchVersion,query=$('host-search').value.trim(),projectId=$('project').value;
  state.host=null;state.hosts=[];$('host-results').replaceChildren();$('host-results').hidden=true;$('host-search').setAttribute('aria-expanded','false');
  if(query.length<2||!projectId){$('host-feedback').textContent=query.length?'Type at least 2 characters.':'';return;}
  $('host-feedback').textContent='Searching…';
  try {
    const result=await send('/api/registration/options',{projectLocationId:projectId,search:query});
    if(version!==state.searchVersion||projectId!==$('project').value)return;
    state.hosts=result.hosts;$('host-feedback').textContent=result.hosts.length?'':'No matching host for this project.';
    result.hosts.forEach((host,index)=>{
      const button=document.createElement('button'),name=document.createElement('strong'),email=document.createElement('span');
      button.type='button';button.id='host-option-'+index;button.setAttribute('role','option');button.setAttribute('aria-selected','false');name.textContent=host.displayName;email.textContent=host.officialEmail;button.append(name,email);
      button.addEventListener('click',()=>{button.setAttribute('aria-selected','true');state.host=host;$('host-search').value=host.displayName;$('host-results').hidden=true;$('host-search').setAttribute('aria-expanded','false');$('host-feedback').textContent=host.officialEmail;});
      $('host-results').append(button);
    });
    $('host-results').hidden=!result.hosts.length;$('host-search').setAttribute('aria-expanded',String(!!result.hosts.length));
  } catch(error) {if(version===state.searchVersion)$('host-feedback').textContent=error.message;}
}

function applyPhotoTransform() {
  const entry=state.people[state.photoIndex];
  if(!entry||!entry.url)return;
  const pan=entry.pan||{x:0,y:0};
  const zoom=entry.zoom||1;
  const preview=$('photo-preview');
  if(preview){const frame=$('capture-stage')?.querySelector('.capture-corners');if(frame&&preview.naturalWidth&&preview.clientWidth){const fit=Math.max(preview.clientWidth/preview.naturalWidth,preview.clientHeight/preview.naturalHeight),maxX=Math.max(0,(preview.naturalWidth*fit*zoom-frame.getBoundingClientRect().width)/2),maxY=Math.max(0,(preview.naturalHeight*fit*zoom-frame.getBoundingClientRect().height)/2);pan.x=Math.min(maxX,Math.max(-maxX,pan.x));pan.y=Math.min(maxY,Math.max(-maxY,pan.y));entry.pan=pan;}preview.style.transform=`translate(${pan.x}px, ${pan.y}px) scale(${zoom}) scaleX(${entry.flipped?-1:1})`;}
  if($('zoom-slider'))$('zoom-slider').value=String(zoom);
}

async function commitPhotoCrop(entry) {
 if(!entry?.url||typeof Image==='undefined')throw new Error('Add a photo first.');
 const frame=$('capture-stage')?.querySelector('.capture-corners'),preview=$('photo-preview'),sourceUrl=entry.url;
 if(!frame||!preview||preview.hidden)throw new Error('Photo preview unavailable.');
 const img=new Image();img.src=sourceUrl;await img.decode();
 if(entry.url!==sourceUrl||state.people[state.photoIndex]!==entry)throw new Error('Photo changed. Please retry.');
 applyPhotoTransform();const crop=photoCropSource(img.naturalWidth,img.naturalHeight,preview.getBoundingClientRect(),frame.getBoundingClientRect(),!!entry.flipped);
 const canvas=document.createElement('canvas');canvas.width=600;canvas.height=800;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Photo editor unavailable.');
 if(entry.flipped){ctx.translate(600,0);ctx.scale(-1,1);}ctx.drawImage(img,crop.sx,crop.sy,crop.sw,crop.sh,0,0,600,800);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.9));if(!blob?.size)throw new Error('Photo could not be saved. Please retry.');
 entry.file=new File([blob],'photo.jpg',{type:'image/jpeg'});if(entry.croppedUrl)URL.revokeObjectURL(entry.croppedUrl);entry.croppedUrl=URL.createObjectURL(blob);
}

function renderPhoto() {
  const entry=state.people[state.photoIndex];
  $('photo-title').textContent=state.mode==='employee'?'Your photo':entry.name||'Visitor '+(state.photoIndex+1);
  $('photo-position').textContent=state.people.length>1?`${state.photoIndex+1} / ${state.people.length}`:'';
  const hasPhoto=!!entry.url;
  $('photo-preview').hidden=!hasPhoto;
  $('photo-placeholder').hidden=hasPhoto;
  $('retake-photo').hidden=!hasPhoto;
  $('open-camera').hidden=hasPhoto;
  if($('upload-photo-label'))$('upload-photo-label').hidden=false;
  if($('upload-label-text'))$('upload-label-text').textContent=hasPhoto?'Upload new':'Upload photo';
  if($('photo-zoom-controls'))$('photo-zoom-controls').hidden=!hasPhoto;
  if(hasPhoto){
    $('photo-preview').src=entry.url;
    applyPhotoTransform();
  }else{
    $('photo-preview').removeAttribute('src');
    $('photo-preview').style.transform='';
  }
  $('photo-people').replaceChildren();
  if(state.people.length>1)state.people.forEach((row,index)=>{
    const button=document.createElement('button');button.type='button';button.className='person-photo';button.textContent=(row.file?'✓ ':'')+(row.name||'Visitor '+(index+1));
    if(index===state.photoIndex)button.setAttribute('aria-current','true');
    button.addEventListener('click',async()=>{if(state.busy||state.jobs||index===state.photoIndex)return;busy(true);try{if(entry.url)await commitPhotoCrop(entry);stopCamera();state.photoIndex=index;renderPhoto();}catch(error){notify(error.message,'error');}finally{busy(false);}});
    $('photo-people').append(button);
  });
}

function selectPhoto(file) {
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>5242880){notify('Choose a JPG, PNG or WebP photo up to 5 MB.','error');return;}
  const entry=state.people[state.photoIndex];if(entry.url)URL.revokeObjectURL(entry.url);
  entry.file=file;entry.rawFile=file;entry.flipped=false;entry.pan={x:0,y:0};entry.zoom=1;entry.url=URL.createObjectURL(file);stopCamera();renderPhoto();notify();
}

async function openCamera() {
  if(!navigator.mediaDevices?.getUserMedia){notify('Camera unavailable. Choose a photo instead.','error');return;}
  $('open-camera').disabled=true;
  try {
    const stream=await camera.open();if(!stream)return;
    if(state.step!==photoStep()||$('flow').hidden){stopCamera();return;}
    $('camera-video').srcObject=stream;await $('camera-video').play();
    if(camera.stream!==stream)return;
    $('camera-video').hidden=false;$('photo-preview').hidden=true;$('photo-placeholder').hidden=true;
    $('open-camera').hidden=true;$('retake-photo').hidden=true;
    if($('upload-photo-label'))$('upload-photo-label').hidden=true;
    if($('photo-zoom-controls'))$('photo-zoom-controls').hidden=true;
    $('capture-photo').hidden=false;notify();
  } catch {stopCamera();if(!$('photo-step').hidden)notify('Camera unavailable. Allow camera access or choose a photo.','error');}
  finally {$('open-camera').disabled=false;}
}

async function capture() {
  const video=$('camera-video'),entry=state.people[state.photoIndex],stream=camera.stream;
  if(!stream||!video.videoWidth){notify('Camera is still starting.','error');return;}
  const canvas=document.createElement('canvas'),scale=Math.min(1,1280/Math.max(video.videoWidth,video.videoHeight));
  canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
  const ctx=canvas.getContext('2d');ctx.translate(canvas.width,0);ctx.scale(-1,1);ctx.drawImage(video,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));
  if(camera.stream!==stream||state.people[state.photoIndex]!==entry)return;
  if(blob)selectPhoto(new File([blob],'photo.jpg',{type:'image/jpeg'}));
}

function reviewItem(label,value) {
  const row=document.createElement('div'),term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.textContent=value;row.append(term,description);return row;
}

function renderReview() {
  $('review-people').replaceChildren();
  for(const entry of state.people) {
    const row=document.createElement('div'),img=document.createElement('img'),copy=document.createElement('div'),name=document.createElement('strong'),contact=document.createElement('span');
    row.className='review-person';img.src=entry.croppedUrl??entry.url;img.alt=entry.name;name.textContent=entry.name;contact.textContent=state.mode==='employee'?state.employee.employeeId:[entry.phone,entry.email].filter(Boolean).join(' · ');copy.append(name,contact);row.append(img,copy);$('review-people').append(row);
  }
  const rows=[reviewItem('Office',state.options.locationName)];
  if(state.mode==='employee') {rows.push(reviewItem('Reason',$('reason').selectedOptions[0].textContent));if($('reason-details').value.trim())rows.push(reviewItem('Details',$('reason-details').value.trim()));}
  else rows.push(reviewItem('Project',projectSelection().projectName),reviewItem('Host',state.host.displayName+' · '+state.host.officialEmail),reviewItem('Purpose',purpose()),reviewItem('Date',new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date($('visit-date').value+'T12:00:00.000Z'))));
  $('review-details').replaceChildren(...rows);$('review-access').replaceChildren();$('review-access').hidden=!state.extras.length;
  if(state.extras.length){const title=document.createElement('h2');title.textContent='Additional project access';$('review-access').append(title);for(const entry of state.extras)$('review-access').append(reviewItem(entry.projectName,entry.host.displayName+' · '+entry.host.officialEmail));}
}

function prepareJobs() {
  const first={requestType:state.mode==='employee'?'DIGITAL_ID':'EXTERNAL',clientKey:crypto.randomUUID(),reason:state.mode==='employee'?$('reason-details').value.trim()||$('reason').selectedOptions[0].textContent:purpose()};
  if(state.mode==='employee')first.digitalIdReason=$('reason').value;
  else {first.visitDate=$('visit-date').value;first.projectLocationId=$('project').value;first.hostEmployeeId=state.host.employeeId;}
  const jobs=[{body:first,people:state.people.map(entry=>({...entry})),started:true,photos:[],result:null,label:state.mode==='employee'?'Digital ID':projectSelection().projectName}];
  for(const extra of state.extras)jobs.push({body:{requestType:'EMPLOYEE_PROJECT',clientKey:crypto.randomUUID(),projectLocationId:extra.projectLocationId,hostEmployeeId:extra.host.employeeId,reason:extra.reason},people:[{...state.people[0],key:crypto.randomUUID()}],started:false,photos:[],result:null,label:extra.projectName});
  return jobs;
}

async function renderDigitalCard(job,container){
  const preview=document.createElement('div');preview.className='digital-card-preview';
  const message=document.createElement('p');message.className='hint';message.textContent='Preparing card…';preview.append(message);container.append(preview);
  const display=()=>{
    preview.replaceChildren();const image=document.createElement('img');image.src=job.cardUrl;image.alt='Digital ID for '+job.people[0].name;image.width=1712;image.height=1080;preview.append(image);
    const actions=document.createElement('div'),download=document.createElement('a');actions.className='digital-card-actions';download.className='primary';download.href=job.cardUrl;download.download=job.cardFileName;download.textContent='Download image';actions.append(download);container.append(actions);
  };
  if(job.cardUrl){display();return;}
  try {
    const result=await send('/api/employee/digital-id/image',{visitRequestId:job.result.visits[0].visitRequestId});
    if(!state.jobs?.includes(job)||!container.isConnected)return;
    if(result.mimeType!=='image/png'||typeof result.imageBase64!=='string'||result.imageBase64.length>7340032)throw new Error('Unable to load the card. Please retry.');
    const bytes=Uint8Array.from(atob(result.imageBase64),char=>char.charCodeAt(0));job.cardUrl=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));job.cardFileName=result.fileName;display();
  }catch(error){
    if(!container.isConnected)return;
    message.textContent='Card could not be loaded.';const retry=document.createElement('button');retry.type='button';retry.className='secondary';retry.textContent='Retry card';
    retry.addEventListener('click',()=>{preview.remove();retry.remove();renderDigitalCard(job,container);});container.append(retry);notify(error.message,'error');
  }
}

function showResults() {
  screen('success');$('submission-results').replaceChildren();
  const done=state.jobs.filter(job=>job.result);$('success-title').textContent=state.mode==='employee'?'Digital ID created':'Visit submitted';
  for(const job of done)job.result.visits.forEach((visit,index)=>{
    const card=document.createElement('div'),heading=document.createElement('div'),name=document.createElement('strong'),badge=document.createElement('span'),reference=document.createElement('div');
    const liveStatus=job.detail?(job.detail.status==='CANCELLED'?'CANCELLED':Date.parse(job.detail.validUntilUtc)<=Date.parse(job.detail.checkedAtUtc)?'EXPIRED':job.detail.passStatus):visit.status;
    card.className='result-card';heading.className='result-card-heading';name.textContent=state.mode==='visitor'?job.people[index].name:job.label;badge.className='status-pill';badge.dataset.status=liveStatus;badge.textContent=(visit.reused?'Existing · ':'')+liveStatus.charAt(0)+liveStatus.slice(1).toLowerCase();heading.append(name,badge);
    reference.className='result-reference';reference.textContent=visit.publicPassNumber;card.append(heading,reference);
    if(job.detail){const validity=document.createElement('div');validity.className='meta';validity.textContent='Valid until '+new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(job.detail.validUntilUtc));card.append(validity);}
    $('submission-results').append(card);
    if(job.body.requestType==='DIGITAL_ID'){card.className='digital-card-result';card.replaceChildren();renderDigitalCard(job,card);}
  });
  $('retry-pending').hidden=done.length===state.jobs.length;$('success-title').focus();
}

async function submitJobs() {
  if(state.busy)return;
  if(!state.jobs)state.jobs=prepareJobs();
  busy(true);stopCamera();$('submit').textContent='Submitting…';
  try {
    for(const job of state.jobs) {
      if(job.result)continue;
      if(!job.started){await send('/api/registration/reset');await send('/api/registration/start',{requestType:job.body.requestType});job.started=true;}
      for(let index=0;index<job.people.length;index++)if(!job.photos[index])job.photos[index]=(await send('/api/registration/photo',job.people[index].file,true)).photoAssetId;
      if(!job.payload)job.payload={...job.body,people:job.people.map((entry,index)=>({clientPersonKey:entry.key,photoAssetId:job.photos[index],...(job.body.requestType==='EXTERNAL'?{name:entry.name,phone:entry.phone,...(entry.email?{email:entry.email}:{})}:{})}))};
      job.result=await send('/api/registration/submit',job.payload);
      if(job.body.requestType==='DIGITAL_ID'){
        try{job.detail=await send('/api/employee/digital-id/detail',{visitRequestId:job.result.visits[0].visitRequestId});}catch{/* Confirmed creation is retained if the subsequent read is unavailable. */}
      }
    }
    showResults();notify('Request submitted.','success');
  } catch(error) {
    const saved=state.jobs.some(job=>job.result);
    if(saved){showResults();notify('Digital ID saved. '+error.message,'error');}
    else if([400,403,409].includes(error.status)){state.jobs=null;notify(error.message,'error');}
    else if(error.status===401){state.jobs=null;screen('sign-in-screen');notify(error.message,'error');}
    else notify(error.message+' Retry will use the same request.','error');
  } finally {$('submit').textContent=state.jobs?'Retry same request':'Submit';busy(false);}
}

$('employee-choice').addEventListener('click',async()=>{
  if(state.busy)return;state.mode='employee';screen('sign-in-screen');busy(true);
  try {
    $('employee-email').focus();
  }catch(error){notify(error.message,'error');}finally{busy(false);}
});
$('visitor-choice').addEventListener('click',()=>{if(!state.busy)beginFlow('visitor');});
function clearPassword() {
  $('employee-password').value='';$('employee-password').type='password';
  $('toggle-password').setAttribute('aria-label','Show password');$('toggle-password').setAttribute('aria-pressed','false');
}
$('toggle-password').addEventListener('click',()=>{
  const show=$('employee-password').type==='password';$('employee-password').type=show?'text':'password';
  $('toggle-password').setAttribute('aria-label',show?'Hide password':'Show password');$('toggle-password').setAttribute('aria-pressed',String(show));
});
$('sign-in-back').addEventListener('click',()=>{clearPassword();screen('landing');});
$('login').addEventListener('submit',async event=>{
  event.preventDefault();if(state.busy||!$('login').reportValidity())return;
  notify();busy(true);$('sign-in').textContent='Signing in…';
  try {
    const result=await auth('login',{email:$('employee-email').value.trim(),password:$('employee-password').value});
    clearPassword();setEmployee(result.employee);busy(false);await beginFlow('employee');
  }catch(error){
    clearPassword();notify(error.status===401?'Email or password is incorrect.':error.message,'error');$('employee-password').focus();
  }finally{$('sign-in').textContent='Sign in';busy(false);}
});
async function leaveFlow(){
  if(state.busy)return;busy(true);
  try {if(state.employee)try{await auth('logout');}catch(error){if(error.status!==401&&error.status!==403)throw error;}
    reset();state.employee=null;screen('landing');
  }catch(error){notify(error.message,'error');}finally{busy(false);}
}
$('close-flow').addEventListener('click',()=>{if(!state.jobs)leaveFlow();});
$('success-home').addEventListener('click',leaveFlow);
$('add-visitor').addEventListener('click',()=>{
  syncPeople();if(state.people.length>=10)return;
  for(const card of $('visitors').children)if(!validateVisitorCard(card))return;
  state.people.forEach(entry=>entry.expanded=false);state.people.push(person());renderPeople();
  const card=$('visitors').lastElementChild;card.querySelector('[name="name"]').focus();card.scrollIntoView({block:'nearest'});
});
$('reason').addEventListener('change',()=>{$('reason-details').required=$('reason').value==='OTHER';$('reason-optional').textContent=$('reason-details').required?'(required)':'(optional)';});
$('purpose').addEventListener('change',()=>{$('purpose-details').required=$('purpose').value==='Other';$('purpose-optional').textContent=$('purpose-details').required?'(required)':'(optional)';});
$('toggle-access').addEventListener('click',editAccess);
$('add-project-access').addEventListener('click',()=>{if(state.busy||!validateVisit())return;const project=projectSelection();state.extras.push({...project,host:{...state.host},reason:purpose()});renderExtras();closeAccessDialog();notify('Project added.','success');});
$('project').addEventListener('change',()=>{clearTimeout(searchTimer);state.searchVersion++;state.host=null;$('host-search').value='';$('host-search').disabled=!$('project').value;$('host-results').hidden=true;$('host-search').setAttribute('aria-expanded','false');$('host-feedback').textContent='';});
$('host-search').addEventListener('input',()=>{state.host=null;clearTimeout(searchTimer);state.searchVersion++;searchTimer=setTimeout(searchHosts,350);});
$('host-search').addEventListener('keydown',event=>{if(event.key==='Escape'){$('host-results').hidden=true;$('host-search').setAttribute('aria-expanded','false');}if(event.key==='ArrowDown'&&!$('host-results').hidden){event.preventDefault();$('host-results').firstElementChild?.focus();}});
$('host-results').addEventListener('keydown',event=>{if(event.key==='Escape'){$('host-results').hidden=true;$('host-search').setAttribute('aria-expanded','false');$('host-search').focus();}if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const next=event.key==='ArrowDown'?event.target.nextElementSibling:event.target.previousElementSibling;next?.focus();}});
$('open-camera').addEventListener('click',openCamera);$('capture-photo').addEventListener('click',capture);
$('retake-photo').addEventListener('click',()=>{const entry=state.people[state.photoIndex];if(entry.url)URL.revokeObjectURL(entry.url);if(entry.croppedUrl)URL.revokeObjectURL(entry.croppedUrl);entry.croppedUrl=null;entry.rawFile=null;entry.url=null;entry.file=null;renderPhoto();openCamera();});
$('photo-file').addEventListener('change',()=>{selectPhoto($('photo-file').files[0]);$('photo-file').value='';});
$('edit-details').addEventListener('click',()=>{if(!state.jobs)renderStep(0);});
$('previous-step').addEventListener('click',()=>{if(state.jobs)return;if(state.accessEditor){renderStep(0);return;}if(state.step===0){reset();screen('landing');}else renderStep(state.step-1);});
function setupPhotoEditor() {
  const stage=$('capture-stage');
  if(!stage)return;
  const activePointers=new Map();
  let drag=null;
  let pinchDist=null;
  let startZoom=1;

  stage.addEventListener('pointerdown',e=>{
    if(state.busy||e.target.closest('#photo-zoom-controls'))return;
    const entry=state.people[state.photoIndex];
    if(state.busy||!entry||!entry.url||!$('camera-video').hidden)return;
    e.preventDefault();
    activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    try{stage.setPointerCapture(e.pointerId);}catch{}
    stage.classList.add('is-dragging');

    if(activePointers.size===1){
      drag={startX:e.clientX,startY:e.clientY,panX:entry.pan?.x||0,panY:entry.pan?.y||0};
      pinchDist=null;
    }else if(activePointers.size===2){
      const [p1,p2]=Array.from(activePointers.values());
      pinchDist=Math.hypot(p1.x-p2.x,p1.y-p2.y);
      startZoom=entry.zoom||1;
      drag=null;
    }
  });

  stage.addEventListener('pointermove',e=>{
    if(state.busy||!activePointers.has(e.pointerId))return;
    e.preventDefault();
    activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const entry=state.people[state.photoIndex];
    if(!entry)return;

    if(activePointers.size===1&&drag){
      entry.pan={x:drag.panX+(e.clientX-drag.startX),y:drag.panY+(e.clientY-drag.startY)};
      applyPhotoTransform();
    }else if(activePointers.size===2&&pinchDist){
      const [p1,p2]=Array.from(activePointers.values());
      const currentDist=Math.hypot(p1.x-p2.x,p1.y-p2.y);
      if(currentDist>0){
        const scaleFactor=currentDist/pinchDist;
        entry.zoom=Math.min(3,Math.max(1,Math.round(startZoom*scaleFactor*100)/100));
        applyPhotoTransform();
      }
    }
  });

  const finishDrag=e=>{
    activePointers.delete(e.pointerId);
    try{stage.releasePointerCapture(e.pointerId);}catch{}
    if(activePointers.size===0){
      drag=null;
      pinchDist=null;
      stage.classList.remove('is-dragging');
    }else if(activePointers.size===1){
      const entry=state.people[state.photoIndex];
      const [remaining]=Array.from(activePointers.values());
      drag={startX:remaining.x,startY:remaining.y,panX:entry?.pan?.x||0,panY:entry?.pan?.y||0};
      pinchDist=null;
    }
  };
  stage.addEventListener('pointerup',finishDrag);
  stage.addEventListener('pointercancel',finishDrag);

  stage.addEventListener('wheel',e=>{
    const entry=state.people[state.photoIndex];
    if(!entry||!entry.url||!$('camera-video').hidden)return;
    e.preventDefault();
    const delta=e.deltaY<0?0.1:-0.1;
    entry.zoom=Math.min(3,Math.max(1,Math.round(((entry.zoom||1)+delta)*100)/100));
    applyPhotoTransform();
  },{passive:false});

  $('zoom-in')?.addEventListener('click',()=>{
    const entry=state.people[state.photoIndex];if(!entry||!entry.url)return;
    entry.zoom=Math.min(3,Math.round(((entry.zoom||1)+0.15)*100)/100);
    applyPhotoTransform();
  });
  $('zoom-out')?.addEventListener('click',()=>{
    const entry=state.people[state.photoIndex];if(!entry||!entry.url)return;
    entry.zoom=Math.max(1,Math.round(((entry.zoom||1)-0.15)*100)/100);
    applyPhotoTransform();
  });
  $('zoom-slider')?.addEventListener('input',e=>{
    const entry=state.people[state.photoIndex];if(!entry||!entry.url)return;
    entry.zoom=parseFloat(e.target.value)||1;
    applyPhotoTransform();
  });
  $('zoom-flip')?.addEventListener('click',()=>{const entry=state.people[state.photoIndex];if(state.busy||!entry?.url)return;entry.flipped=!entry.flipped;entry.pan={x:-(entry.pan?.x||0),y:entry.pan?.y||0};applyPhotoTransform();});
  $('zoom-reset')?.addEventListener('click',()=>{
    const entry=state.people[state.photoIndex];if(!entry||!entry.url)return;
    entry.pan={x:0,y:0};entry.zoom=1;
    applyPhotoTransform();
  });
}
setupPhotoEditor();

$('next-step').addEventListener('click',async()=>{
  if(state.busy||state.jobs)return;
  if(state.step===0&&!validateDetails())return;
  if(state.mode==='visitor'&&state.step===1&&!validateVisit())return;
  if(state.step===photoStep()) {
    const missing=state.people.findIndex(row=>!row.file);
    if(missing>=0){state.photoIndex=missing;renderPhoto();notify('Add a photo for '+(state.people[missing].name||'this visitor')+'.','error');return;}
    busy(true);try{await commitPhotoCrop(state.people[state.photoIndex]);}catch(error){notify(error.message,'error');return;}finally{busy(false);}
  }
  renderStep(state.step+1);
});
$('registration').addEventListener('submit',event=>{event.preventDefault();if(state.step!==steps().length-1)return;submitJobs();});
$('retry-pending').addEventListener('click',submitJobs);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera();});
window.addEventListener('pagehide',stopCamera);

// Enhance native selects while retaining their values, validation and change events.
for(const select of $('registration').querySelectorAll('select'))enhanceSelect(select);
