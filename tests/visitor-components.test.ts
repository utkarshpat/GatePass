import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';

const source=readFileSync(new URL('../src/app/visitor-components.js',import.meta.url),'utf8');
const scope={Intl};vm.createContext(scope);vm.runInContext(readFileSync(new URL('../node_modules/libphonenumber-js/bundle/libphonenumber-mobile.js',import.meta.url),'utf8'),scope);vm.runInContext(source.slice(0,source.indexOf('const CountryPicker='))+'\nglobalThis.phone=PhoneNumbers;',scope);
const phone=(scope as any).phone;
test('all supported countries have a dial code and locally available flag',()=>{
 assert.ok(phone.countries.length>240);
 for(const row of phone.countries){assert.match(row.dial,/^\+\d+$/);const flag=row.code==='AC'?'sh-ac':row.code==='TA'?'sh-ta':row.code.toLowerCase();assert.ok(existsSync(new URL('../node_modules/flag-icons/flags/4x3/'+flag+'.svg',import.meta.url)));}
});
test('country validation normalizes national and international input to E164',()=>{
 for(const [input,country,expected] of [['9876543210','IN','+919876543210'],['+91 98765 43210','IN','+919876543210'],['(213) 373-4253','US','+12133734253'],['07911 123456','GG','+447911123456'],['050 123 4567','AE','+971501234567'],['8123 4567','SG','+6581234567']])assert.equal(phone.parse(input,country)?.number,expected,input);
});
test('country mismatch, invalid lengths and embedded or extended numbers are rejected',()=>{
 for(const [input,country] of [['123','IN'],['1234567890','IN'],['9876543210000000','IN'],['+12133734253','IN'],['Call 9876543210','IN'],['9876543210 ext 2','IN'],['','IN']])assert.equal(phone.parse(input,country),null,input);
});
const app=readFileSync(new URL('../src/app/employee-portal.js',import.meta.url),'utf8');
test('collapsed visitor keeps summary and data and can expand again',()=>{
 const fields:any={'.visitor-details':{},'.visitor-summary':{},'.edit-visitor':{setAttribute(k:string,v:string){this[k]=v;}},h2:{}};
 const entry={name:'Visitor One',phone:'+919876543210',email:'one@example.com',expanded:true};const context={state:{people:[entry]}};
 vm.createContext(context);vm.runInContext(app.slice(app.indexOf('function setVisitorExpanded('),app.indexOf('function validateVisitorCard(')),context);
 const toggle=(context as any).setVisitorExpanded,card={querySelector:(name:string)=>fields[name]};
 toggle(card,entry,false);assert.equal(entry.expanded,false);assert.equal(fields.h2.textContent,entry.name);assert.match(fields['.visitor-summary'].textContent,/\+919876543210/);assert.equal(fields['.visitor-details'].hidden,true);
 toggle(card,entry,true);assert.equal(fields['.visitor-details'].hidden,false);assert.equal(entry.phone,'+919876543210');assert.equal(fields.h2.textContent,'Visitor 1');
});

test('toasts use accessible roles, replace stale messages and allow dismissal',()=>{
 class Element extends EventTarget {children:any[]=[];attrs:any={};className='';textContent='';append(...nodes:any[]){this.children.push(...nodes);}replaceChildren(){this.children=[];}setAttribute(k:string,v:string){this.attrs[k]=v;}}
 const body=new Element(),timers=new Map();let next=0;const context={document:{body,createElement:()=>new Element()},setTimeout:(fn:any)=>{const id=++next;timers.set(id,fn);return id;},clearTimeout:(id:any)=>timers.delete(id)};
 vm.createContext(context);vm.runInContext(readFileSync(new URL('../src/app/toast-notifications.js',import.meta.url),'utf8')+'\nglobalThis.toasts=new ToastNotifications();',context);
 const toasts=(context as any).toasts;toasts.show('Check mobile number','error');assert.equal(toasts.region.children[0].attrs.role,'alert');
 toasts.show('Saved','success');assert.equal(toasts.region.children.length,1);assert.equal(toasts.region.children[0].attrs.role,'status');assert.equal(timers.size,1);
 toasts.region.children[0].children[2].dispatchEvent(new Event('click'));assert.equal(toasts.region.children.length,0);assert.equal(timers.size,0);
});

test('country panel remains inside mobile, landscape, keyboard and desktop viewports',()=>{
 const bounds=(scope as any).countryDialogBounds;
 for(const [width,height,left,top] of [[378,840,0,0],[390,340,0,0],[844,390,0,0],[1280,800,0,0],[320,568,15,25]]){
  const box=bounds(width,height,left,top);assert.ok(box.width<=width&&box.height<=height);assert.ok(box.left>=left&&box.top>=top);assert.ok(box.left+box.width<=left+width);assert.ok(box.top+box.height<=top+height);
 }
});
test('initial setup allows every local detail field while continuing and submitting stay disabled',()=>{
 const make=(local=false)=>({disabled:false,closest:()=>local,matches:()=>local,setAttribute(){},querySelectorAll:()=>[]});
 const local=make(true),country=make(true),project=make(false),fields=[local,country,project];const elements:any={registration:{querySelectorAll:()=>fields},stepper:{querySelectorAll:()=>[]},project:{value:''}};
 const context={state:{busy:false,jobs:null,step:0,people:[]},$:(id:string)=>elements[id]??(elements[id]=make())};
 vm.createContext(context);vm.runInContext(app.slice(app.indexOf('function busy('),app.indexOf('function reset(')),context);
 const busy=(context as any).busy;busy(true,{initializing:true});assert.equal(local.disabled,false);assert.equal(country.disabled,false);assert.equal(project.disabled,true);assert.equal(elements['next-step'].disabled,true);assert.equal(elements.submit.disabled,true);
 busy(true);assert.equal(local.disabled,true);assert.equal(country.disabled,true);
 busy(false);assert.equal(local.disabled,false);assert.equal(country.disabled,false);assert.equal(elements['next-step'].disabled,false);
});

test('closing project dialog restores shared visitor fields and preserves added projects',()=>{
 const log:any[]=[];const fields:any={
  'project-access-dialog':{open:true,close(){this.open=false;log.push('closed');}},
  'visit-step':{hidden:false},'photo-step':{before(node:any){log.push(node);}},'add-project-access':{},'host-results':{},'host-search':{setAttribute(){}},
  'toggle-access':{hidden:false,setAttribute(k:string,v:string){this[k]=v;},focus(){log.push('focus');}},'flow-title':{focus(){}}
 };
 const context={state:{accessEditor:true,searchVersion:1,extras:[{projectName:'Saved'}]},searchTimer:null,clearTimeout(){},document:{body:{append(){}}},toasts:{region:{},clear(){}},$:(id:string)=>fields[id]};
 vm.createContext(context);vm.runInContext(app.slice(app.indexOf('function closeAccessDialog('),app.indexOf('function editAccess(')),context);
 (context as any).closeAccessDialog();assert.equal(fields['project-access-dialog'].open,false);assert.equal(fields['visit-step'].hidden,true);assert.equal(fields['add-project-access'].hidden,true);assert.equal(fields['toggle-access']['aria-expanded'],'false');assert.equal(context.state.extras.length,1);assert.equal(context.state.searchVersion,2);assert.ok(log.includes('focus'));
});
test('project Add action validates first and retains an independent host/project snapshot',()=>{
 let handler:any,valid=false,closed=0;const project={projectLocationId:'12',projectName:'Project 12'},host={employeeId:'EMP002',displayName:'Host 2'};
 const context={state:{busy:false,extras:[] as any[],host},$(){return{addEventListener(_event:string,cb:any){handler=cb;}};},validateVisit:()=>valid,projectSelection:()=>project,purpose:()=>'Business meeting',renderExtras(){},closeAccessDialog(){closed++;},notify(){}};
 vm.createContext(context);const line=app.split('\n').find(line=>line.startsWith("$('add-project-access').addEventListener"))!;vm.runInContext(line,context);
 handler();assert.equal(context.state.extras.length,0);assert.equal(closed,0);
 valid=true;handler();assert.equal(context.state.extras[0].projectLocationId,'12');assert.equal(context.state.extras[0].reason,'Business meeting');host.displayName='Changed';assert.equal(context.state.extras[0].host.displayName,'Host 2');assert.equal(closed,1);
});
