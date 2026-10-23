"use strict";
// Ephemeral tab memory only. Never persist names in browser storage or a service worker.
class GuardNameReadings {
 constructor(request,mode,hint=()=>'* Reading aid; pronunciation may be inaccurate.'){this.request=request;this.mode=mode;this.hint=hint;this.cache=new Map();this.busy=false;let scheduled=false;document.addEventListener('scroll',()=>{if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;this.schedule();});}},{capture:true,passive:true});window.addEventListener('resize',()=>this.schedule(),{passive:true});}
 key(name,locale){return locale+':'+name.normalize('NFC').trim().replace(/\s+/gu,' ');}
 bind(element,name){element.dataset.personName=name??'';this.paint(element);this.schedule();return element;}
 paint(element){
  const name=element.dataset.personName,locale=this.mode().split('-')[1],cached=locale?this.cache.get(this.key(name,locale)):null;
  const reading=cached&&cached.until>Date.now()?cached.reading:null;
  element.replaceChildren();element.classList.toggle('has-name-reading',!!reading);element.title=name;
  if(!reading){element.textContent=name;element.removeAttribute('lang');return;}
  const original=document.createElement('span');original.className='name-reading-original';original.lang='en';original.textContent=name;
  const local=document.createElement('small');local.className='name-reading-local';local.lang=locale;local.textContent='('+reading+') *';local.title=this.hint();
  element.append(original,document.createTextNode(' '),local);
 }
 refresh(){for(const node of document.querySelectorAll('[data-person-name]'))this.paint(node);this.schedule();}
 schedule(){if(!this.busy){this.busy=true;queueMicrotask(()=>this.drain());}}
 visible(){return [...document.querySelectorAll('[data-person-name]')].filter(el=>{if(el.closest('[hidden]')||el.closest('dialog:not([open])'))return false;const rect=el.getBoundingClientRect();return rect.bottom>=-600&&rect.top<=innerHeight+600;});}
 async drain(){
  try{for(;;){
   const locale=this.mode().split('-')[1];if(!locale)return;
   const names=[...new Set(this.visible().map(el=>el.dataset.personName))].filter(name=>{
    const cached=this.cache.get(this.key(name,locale));return name&&/[a-z]/iu.test(name)&&(!cached||cached.until<=Date.now());
   }).slice(0,10);
   if(!names.length)return;
   let items=[];
   try{const result=await this.request('name-readings',{locale,names});
    if(result.locale===locale&&Array.isArray(result.items)&&result.items.length===names.length&&result.items.every((v,i)=>v?.name===names[i]&&(v.reading===null||typeof v.reading==='string'&&v.reading.length<=400)))items=result.items;
   }catch{} // Optional readings must not hide or delay the authorized cards.
   for(const name of names){const reading=items.find(v=>v.name===name)?.reading??null;this.cache.set(this.key(name,locale),{reading,until:Date.now()+(reading?86400000:60000)});}
   while(this.cache.size>1000)this.cache.delete(this.cache.keys().next().value);
   // Read current mode and nodes now; an old request cannot repaint a new language/filter.
   for(const node of this.visible())this.paint(node);
  }}finally{this.busy=false;}
 }
}
