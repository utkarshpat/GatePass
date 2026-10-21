/* Install is optional; never reload a registration or printing flow for an update. */
(() => {
 'use strict';
 if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
 const install = document.getElementById('pwa-install');
 const label = document.getElementById('entry-header-label');
 let prompt;
 const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
 const hide = () => {if(install)install.hidden=true;if(label)label.hidden=false;prompt=undefined;};
 window.addEventListener('beforeinstallprompt', event => {
  if(!install || standalone())return;
  event.preventDefault();prompt=event;install.hidden=false;if(label)label.hidden=true;
 });
 install?.addEventListener('click',async()=>{
  if(!prompt)return;install.disabled=true;
  try{await prompt.prompt();await prompt.userChoice;}catch{ /* Browser dismissal leaves the normal sign-in flow intact. */ }finally{hide();install.disabled=false;}
 });
 window.addEventListener('appinstalled',hide);
 window.addEventListener('load',()=>{
  navigator.serviceWorker.register('/service-worker.js',{scope:'/',updateViaCache:'none'})
   .catch(()=>{ /* A blocked worker must not block sign-in or registration. */ });
 },{once:true});
})();
