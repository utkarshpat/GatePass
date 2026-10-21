function enhanceSelect(select) {
  const field=document.createElement('div'),trigger=document.createElement('button'),caption=document.createElement('span'),chevron=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path'),list=document.createElement('div');
  field.className='select-control';trigger.className='select-trigger';trigger.type='button';trigger.id=select.id+'-trigger';
  const label=document.querySelector(`label[for="${select.id}"]`);
  if(label){if(!label.id)label.id=select.id+'-label';trigger.setAttribute('aria-labelledby',label.id+' '+select.id+'-value');label.addEventListener('click',event=>{event.preventDefault();trigger.focus();});}
  caption.id=select.id+'-value';chevron.setAttribute('viewBox','0 0 24 24');chevron.setAttribute('aria-hidden','true');chevron.setAttribute('width','18');chevron.setAttribute('height','18');path.setAttribute('d','m6 9 6 6 6-6');chevron.append(path);trigger.append(caption,chevron);
  trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',select.id+'-list');trigger.setAttribute('aria-required',String(select.required));
  list.className='select-menu';list.id=select.id+'-list';list.setAttribute('role','listbox');list.setAttribute('aria-labelledby',label?.id??trigger.id);list.hidden=true;
  if(typeof list.showPopover==='function')list.setAttribute('popover','manual');
  select.after(field);field.append(trigger);document.body.append(list);select.hidden=true;select.tabIndex=-1;
  let active=-1,rows=[],search='',searchTimeout;
  const available=()=>rows.filter(row=>!row.option.disabled&&row.option.value!=='');
  function highlight(index) {
    active=index;
    for(const row of rows)row.element.classList.toggle('is-active',row.index===active);
    if(rows[active]){trigger.setAttribute('aria-activedescendant',rows[active].element.id);rows[active].element.scrollIntoView({block:'nearest'});}
    else trigger.removeAttribute('aria-activedescendant');
  }
  function close() {
    if(list.hasAttribute('popover')&&list.matches(':popover-open'))list.hidePopover();
    if(!list.hidden)list.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-activedescendant');
  }
  function refresh() {
    caption.textContent=select.selectedOptions[0]?.textContent??'';trigger.disabled=select.disabled;
    trigger.classList.toggle('is-placeholder',!select.value);trigger.setAttribute('aria-invalid',select.getAttribute('aria-invalid')??'false');
    if(select.disabled||select.parentElement?.closest('[hidden]'))close();
  }
  function choose(index) {
    const row=rows[index];if(!row||row.option.disabled||row.option.value==='')return;
    select.value=row.option.value;select.removeAttribute('aria-invalid');refresh();close();trigger.focus();
    select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function open() {
    if(trigger.disabled)return;
    document.dispatchEvent(new CustomEvent('gp-select-open',{detail:select.id}));
    list.replaceChildren();rows=[];
    for(const [index,option] of [...select.options].entries()) {
      const item=document.createElement('div');item.className='select-option';item.id=select.id+'-option-'+index;item.setAttribute('role','option');item.setAttribute('aria-label',option.textContent);item.setAttribute('aria-selected',String(option.selected&&option.value!==''));item.textContent=option.textContent;
      const disabled=option.disabled||option.value==='';item.setAttribute('aria-disabled',String(disabled));
      item.addEventListener('pointerdown',event=>event.preventDefault());item.addEventListener('click',()=>choose(index));
      list.append(item);rows.push({element:item,option,index});
    }
    const rect=trigger.getBoundingClientRect(),viewport=window.visualViewport,gap=8,edge=12;
    const top=viewport?.offsetTop??0,height=viewport?.height??window.innerHeight,width=viewport?.width??window.innerWidth,left=viewport?.offsetLeft??0;
    const below=top+height-rect.bottom-gap-edge,above=rect.top-top-gap-edge;
    const upwards=below<200&&above>below,maxHeight=Math.max(44,Math.min(288,upwards?above:below));
    list.style.width=Math.min(rect.width,width-edge*2)+'px';list.style.maxHeight=maxHeight+'px';list.style.left=Math.max(left+edge,Math.min(rect.left,left+width-rect.width-edge))+'px';
    const parent=select.closest('dialog')??document.body;if(list.parentElement!==parent)parent.append(list);
    list.hidden=false;if(list.hasAttribute('popover'))list.showPopover();
    const menuHeight=Math.min(list.scrollHeight,maxHeight);
    list.style.top=(upwards?Math.max(top+edge,rect.top-gap-menuHeight):rect.bottom+gap)+'px';
    trigger.setAttribute('aria-expanded','true');highlight(select.value?select.selectedIndex:(available()[0]?.index??-1));
  }
  trigger.addEventListener('click',()=>list.hidden?open():close());
  trigger.addEventListener('keydown',event=>{
    if(event.key==='Tab'){close();return;}
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
    if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)) {
      event.preventDefault();const wasClosed=list.hidden;if(wasClosed)open();
      if(event.key==='Enter'||event.key===' '){if(!wasClosed)choose(active);return;}
      const valid=available();if(!valid.length)return;
      if(wasClosed&&(event.key==='ArrowDown'||event.key==='ArrowUp')&&!select.value){highlight(valid[event.key==='ArrowDown'?0:valid.length-1].index);return;}
      const position=valid.findIndex(row=>row.index===active);
      const next=event.key==='Home'?0:event.key==='End'?valid.length-1:Math.max(0,Math.min(valid.length-1,position+(event.key==='ArrowDown'?1:-1)));
      highlight(valid[next].index);return;
    }
    if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
      event.preventDefault();if(list.hidden)open();clearTimeout(searchTimeout);search+=event.key.toLocaleLowerCase();searchTimeout=setTimeout(()=>{search='';},700);
      const match=available().find(row=>row.option.textContent.toLocaleLowerCase().startsWith(search));if(match)highlight(match.index);
    }
  });
  select.addEventListener('change',refresh);select.addEventListener('invalid',event=>{event.preventDefault();select.setAttribute('aria-invalid','true');refresh();trigger.focus();});
  select.form?.addEventListener('reset',()=>{close();queueMicrotask(refresh);});
  new MutationObserver(()=>{close();refresh();}).observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','selected','aria-invalid']});
  new MutationObserver(()=>{if(select.parentElement?.closest('[hidden]'))close();}).observe(select.form??document.body,{subtree:true,attributes:true,attributeFilter:['hidden']});
  document.addEventListener('pointerdown',event=>{if(!field.contains(event.target)&&!list.contains(event.target))close();});
  document.addEventListener('focusin',event=>{if(!field.contains(event.target))close();});
  document.addEventListener('gp-select-open',event=>{if(event.detail!==select.id)close();});
  document.addEventListener('scroll',event=>{if(!list.contains(event.target))close();},true);
  window.addEventListener('resize',close);window.addEventListener('popstate',close);window.visualViewport?.addEventListener('resize',close);
  refresh();
}
