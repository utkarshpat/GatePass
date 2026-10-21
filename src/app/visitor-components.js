/* Shared country-aware phone field and toast presentation. All assets stay on this origin. */
const PhoneNumbers=(()=>{
  const names=new Intl.DisplayNames(['en'],{type:'region'});
  const countries=libphonenumber.getCountries().map(code=>({code,name:names.of(code),dial:'+'+libphonenumber.getCountryCallingCode(code)})).sort((a,b)=>a.name.localeCompare(b.name));
  function parse(value,country){
    if(typeof value!=='string'||value.length>30||!/^[+\d\s().-]+$/.test(value))return null;
    const number=libphonenumber.parsePhoneNumberFromString(value,{defaultCountry:country,extract:false});
    return number?.isValid()&&number.country===country&&!number.ext?number:null;
  }
  return {countries,parse};
})();

function countryDialogBounds(width,height,left=0,top=0){
  const mobile=width<=760,gutter=mobile?0:16;
  const panelWidth=Math.max(0,Math.min(mobile?width:416,width-gutter*2));
  const panelHeight=Math.max(0,Math.min(mobile?576:544,height-(mobile?16:32)));
  return {width:panelWidth,height:panelHeight,left:left+(width-panelWidth)/2,top:top+(mobile?height-panelHeight:(height-panelHeight)/2)};
}
const CountryPicker=(()=>{
  const dialog=document.createElement('dialog');dialog.className='country-dialog';dialog.setAttribute('aria-labelledby','country-title');
  const heading=document.createElement('div');heading.className='country-heading';
  const title=document.createElement('h2');title.id='country-title';title.textContent='Country code';
  const close=document.createElement('button');close.type='button';close.className='quiet';close.textContent='×';close.setAttribute('aria-label','Close country list');heading.append(title,close);
  const search=document.createElement('input');search.type='search';search.placeholder='Search country or code';search.setAttribute('aria-label','Search country or calling code');search.autocomplete='off';
  const results=document.createElement('div');results.className='country-results';results.id='country-results';results.setAttribute('role','group');results.setAttribute('aria-label','Countries');
  search.setAttribute('aria-controls',results.id);dialog.append(heading,search,results);document.body.append(dialog);
  let owner=null;
  function fit(){
    if(!dialog.open)return;
    const viewport=window.visualViewport,bounds=countryDialogBounds(viewport?.width??window.innerWidth,viewport?.height??window.innerHeight,viewport?.offsetLeft??0,viewport?.offsetTop??0);
    dialog.style.inset='auto';dialog.style.margin='0';
    for(const key of ['width','height','left','top'])dialog.style[key]=bounds[key]+'px';
  }
  window.addEventListener('resize',fit);window.visualViewport?.addEventListener('resize',fit);window.visualViewport?.addEventListener('scroll',fit);
  function render(){
    results.replaceChildren();const query=search.value.trim().toLowerCase();
    const matches=PhoneNumbers.countries.filter(country=>(country.name+' '+country.code+' '+country.dial).toLowerCase().includes(query));
    for(const country of matches){
      const button=document.createElement('button');button.type='button';button.className='country-option';button.setAttribute('aria-pressed',String(country.code===owner.country));
      const flag=document.createElement('img');flag.className='country-flag';flag.src='/assets/flags/'+country.code.toLowerCase()+'.svg';flag.alt='';flag.width=24;flag.height=18;flag.loading='lazy';
      const name=document.createElement('span'),dial=document.createElement('span');name.textContent=country.name;dial.textContent=country.dial;dial.className='country-dial';button.append(flag,name,dial);
      button.addEventListener('click',()=>{owner.setCountry(country.code);dialog.close();});results.append(button);
    }
    if(!matches.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='No countries found';results.append(empty);}
  }
  search.addEventListener('input',render);close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{owner?.trigger.focus();owner=null;});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
  dialog.addEventListener('keydown',event=>{
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||(['Home','End'].includes(event.key)&&event.target===search))return;
    const buttons=[...results.querySelectorAll('button')];if(!buttons.length)return;event.preventDefault();
    const index=buttons.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowDown'?1:-1)));buttons[next].focus();
  });
  return{open(field){owner=field;search.value='';render();dialog.showModal();fit();search.focus({preventScroll:true});fit();},close(){if(dialog.open)dialog.close();}};
})();

class VisitorPhoneField {
  constructor(container,country='IN',value=''){
    this.country=country;this.input=container.querySelector('[name="phone"]');this.trigger=container.querySelector('.phone-country');this.hint=container.parentElement.querySelector('.phone-feedback');
    this.input.value=value;this.trigger.addEventListener('click',()=>CountryPicker.open(this));
    this.input.addEventListener('input',()=>{this.input.setCustomValidity('');this.input.removeAttribute('aria-invalid');this.hint.textContent='';});
    this.input.addEventListener('blur',()=>{if(this.input.value.trim())this.validate();});this.setCountry(country,false);
  }
  setCountry(code,recheck=true){
    this.country=code;const country=PhoneNumbers.countries.find(row=>row.code===code);
    this.trigger.replaceChildren();const flag=document.createElement('img');flag.src='/assets/flags/'+code.toLowerCase()+'.svg';flag.className='country-flag';flag.alt='';flag.width=24;flag.height=18;
    const dial=document.createElement('span');dial.textContent=country.dial;const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('width','14');icon.setAttribute('height','14');icon.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','m6 9 6 6 6-6');icon.append(path);
    this.trigger.setAttribute('aria-label','Country code: '+country.name+' '+country.dial);this.trigger.append(flag,dial,icon);this.input.setAttribute('aria-label','Mobile number, '+country.name);
    if(recheck&&this.input.value.trim())this.validate();
  }
  validate(){
    const valid=!!PhoneNumbers.parse(this.input.value.trim(),this.country),country=PhoneNumbers.countries.find(row=>row.code===this.country);
    const message=valid?'':'Enter a valid mobile number for '+country.name+'.';this.input.setCustomValidity(message);this.input.setAttribute('aria-invalid',String(!valid));this.hint.textContent=message;return valid;
  }
  get number(){return PhoneNumbers.parse(this.input.value.trim(),this.country)?.number??'';}
}

