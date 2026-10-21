'use strict';
const $=id=>document.getElementById(id),toasts=new ToastNotifications();
const csrf=()=>document.cookie.split('; ').find(v=>v.startsWith('gp-staff-csrf='))?.split('=')[1];
async function staffApi(action,body={}){const headers={'Content-Type':'application/json'};if(csrf())headers['X-CSRF-Token']=csrf();let response;try{response=await fetch('/api/staff/'+action,{method:'POST',headers,credentials:'same-origin',body:JSON.stringify(body)});}catch{throw new Error('Connection lost. Please retry.');}if(!response.ok)throw new Error(response.status===401?'Unable to sign in. Check your email or staff ID and password.':response.status===403?'Your staff access is unavailable.':response.status===429?'Too many attempts. Please wait.':'Unable to complete sign-in. Please retry.');return response.json();}
function display(context){
 const destinations={GUARD:'/guard',ADMIN:'/admin',RECEPTION:'/reception'};if(context.workspaces.length===1&&destinations[context.workspaces[0].code]){location.replace(destinations[context.workspaces[0].code]);return;}
 $('staff-entry').hidden=true;$('staff-access').hidden=false;$('entry-name').textContent=context.displayName;$('entry-workspaces').replaceChildren();
 for(const workspace of context.workspaces){if(!destinations[workspace.code])continue;const link=document.createElement('a');link.className='primary';link.href=destinations[workspace.code];link.textContent=workspace.name;$('entry-workspaces').append(link);}
 $('entry-unavailable').hidden=context.workspaces.length>0;
}
$('entry-form').addEventListener('submit',async event=>{event.preventDefault();if($('entry-submit').disabled||!$('entry-form').reportValidity())return;$('entry-submit').disabled=true;try{const context=await staffApi('login',{login:$('entry-login').value.trim(),password:$('entry-password').value});$('entry-password').value='';display(context);}catch(error){toasts.show(error.message,'error');$('entry-password').value='';$('entry-password').focus();}finally{$('entry-submit').disabled=false;}});
$('entry-password-toggle').addEventListener('click',()=>{const show=$('entry-password').type==='password';$('entry-password').type=show?'text':'password';$('entry-password-toggle').setAttribute('aria-pressed',String(show));$('entry-password-toggle').setAttribute('aria-label',show?'Hide password':'Show password');});
$('entry-logout').addEventListener('click',async()=>{try{await staffApi('logout');location.reload();}catch(error){toasts.show(error.message,'error');}});
if(csrf()){$('staff-entry').hidden=true;$('entry-loading').hidden=false;staffApi('me').then(display).catch(()=>{$('staff-entry').hidden=false;}).finally(()=>{$('entry-loading').hidden=true;});}
