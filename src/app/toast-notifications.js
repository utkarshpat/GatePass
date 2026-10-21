class ToastNotifications {
  constructor(){this.region=document.createElement('div');this.region.className='toast-region';this.region.setAttribute('role','region');this.region.setAttribute('aria-label','Notifications');this.region.setAttribute('aria-live','polite');this.region.setAttribute('aria-relevant','additions');document.body.append(this.region);this.timers=new Map();}
  clear(){for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();this.region.replaceChildren();}
  show(message,tone='info'){
    this.clear();if(!message)return;
    const toast=document.createElement('div');toast.className='toast toast-'+tone;toast.setAttribute('role',tone==='error'?'alert':'status');toast.setAttribute('aria-atomic','true');
    const icon=document.createElement('span');icon.className='toast-icon';icon.setAttribute('aria-hidden','true');icon.textContent=tone==='error'?'!':tone==='success'?'✓':'i';
    const text=document.createElement('p');text.textContent=message;const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='toast-dismiss';dismiss.setAttribute('aria-label','Dismiss notification');dismiss.textContent='×';dismiss.addEventListener('click',()=>this.clear());toast.append(icon,text,dismiss);this.region.append(toast);
    const expire=()=>{clearTimeout(this.timers.get(toast));this.timers.set(toast,setTimeout(()=>this.clear(),tone==='error'?12000:6000));};
    toast.addEventListener('pointerenter',()=>clearTimeout(this.timers.get(toast)));toast.addEventListener('pointerleave',expire);toast.addEventListener('focusin',()=>clearTimeout(this.timers.get(toast)));toast.addEventListener('focusout',expire);expire();
  }
}
