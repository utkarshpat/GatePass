import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/app/select-control.js',import.meta.url),'utf8');
const component=source;
function fixture(hiddenOffice=false,labelId=''){
 const elements:any[]=[];const observers:any[]=[];const mutations:Array<()=>void>=[];
 class Element extends EventTarget {
  attrs=new Map();children:any[]=[];_hidden=false;get hidden(){return this._hidden;}set hidden(v:boolean){this._hidden=v;for(const o of observers)if(o.options?.attributeFilter?.includes('hidden')&&(o.target===this||o.options.subtree&&o.target.contains(this)))mutations.push(o.callback); }disabled=false;style:any={};id='';className='';textContent='';parentElement:any=null;focused=false;
  constructor(){super();elements.push(this);}
  classList={toggle:(_name:string,_value:boolean)=>{}};
  setAttribute(k:string,v:any){this.attrs.set(k,String(v));}getAttribute(k:string){return this.attrs.get(k)??null;}hasAttribute(k:string){return this.attrs.has(k);}removeAttribute(k:string){this.attrs.delete(k);}
  append(...items:any[]){this.children.push(...items);for(const item of items)item.parentElement=this;}
  replaceChildren(...items:any[]){this.children=[];this.append(...items);}after(_item:any){}closest(){return null;}
  focus(){this.focused=true;}scrollIntoView(){}get scrollHeight(){return this.children.length*44;}
  getBoundingClientRect(){return{top:500,bottom:544,left:24,width:320};}
  contains(item:any):boolean{return item===this||this.children.some(child=>child.contains(item));}
 }
 const document:any=new EventTarget();document.body=new Element();document.createElement=()=>new Element();document.createElementNS=()=>new Element();const label=new Element();label.id=labelId;document.querySelector=()=>label;
 const root=new Element(),select:any=new Element();select.id='purpose';select.required=true;select.form=new Element();
 if(hiddenOffice){root.hidden=true;document.body.append(root);root.append(select);select.form=null;}
 select.options=[{value:'',textContent:'Select purpose'},{value:'Meeting',textContent:'Business meeting'},{value:'Delivery',textContent:'Delivery'},{value:'Other',textContent:'Other'}];
 let value='';Object.defineProperties(select,{value:{get:()=>value,set:(v:string)=>{value=v;select.options.forEach((o:any)=>o.selected=o.value===v);}},selectedOptions:{get:()=>select.options.filter((o:any)=>o.value===value)},selectedIndex:{get:()=>select.options.findIndex((o:any)=>o.value===value)}});select.value='';
 const context={document,window:Object.assign(new EventTarget(),{innerWidth:390,innerHeight:650}),Event,CustomEvent,MutationObserver:class{callback:any;constructor(cb:any){this.callback=cb;}observe(target:any,options:any){observers.push({target,options,callback:this.callback});}},queueMicrotask,setTimeout,clearTimeout,$:()=>root};
 vm.createContext(context);vm.runInContext(component,context);(context as any).enhanceSelect(select);
 const trigger=elements.find(el=>el.id==='purpose-trigger'),list=elements.find(el=>el.id==='purpose-list');
 function key(k:string){const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:k});trigger.dispatchEvent(event);}
 function flush(){let count=0;while(mutations.length){if(++count>20)throw Error('Hidden-state observer did not settle');mutations.shift()!();}return count;}
 return{select,trigger,list,key,observers,flush,label};
}
test('styled select supports keyboard choice, change events and selected value',()=>{
 const f=fixture();let changes=0;f.select.addEventListener('change',()=>changes++);
 f.key('Enter');assert.equal(f.list.hidden,false);assert.equal(f.trigger.getAttribute('aria-expanded'),'true');
 f.key('End');f.key('Enter');assert.equal(f.select.value,'Other');assert.equal(changes,1);assert.equal(f.list.hidden,true);assert.equal(f.trigger.getAttribute('aria-expanded'),'false');
 assert.equal(f.trigger.children[0].textContent,'Other');
});
test('list opens above a low viewport control and Escape leaves value unchanged',()=>{
 const f=fixture();f.key('Enter');assert.ok(parseFloat(f.list.style.top)<500);assert.equal(f.list.style.width,'320px');
 f.key('Escape');assert.equal(f.list.hidden,true);assert.equal(f.select.value,'');
});
test('invalid required select focuses the visible control and disabled state is reflected',()=>{
 const f=fixture();const invalid=new Event('invalid',{cancelable:true});f.select.dispatchEvent(invalid);
 assert.equal(invalid.defaultPrevented,true);assert.equal(f.trigger.focused,true);assert.equal(f.trigger.getAttribute('aria-invalid'),'true');
 f.select.disabled=true;f.observers.find(o=>o.target===f.select).callback();assert.equal(f.trigger.disabled,true);
});
test('pointer selection dispatches input/change and placeholder cannot be selected',()=>{
 const f=fixture();f.trigger.dispatchEvent(new Event('click'));let inputs=0;f.select.addEventListener('input',()=>inputs++);
 f.list.children[0].dispatchEvent(new Event('click'));assert.equal(inputs,0);
 f.list.children[2].dispatchEvent(new Event('click'));assert.equal(f.select.value,'Delivery');assert.equal(inputs,1);
});

test('hidden office selector settles its body observer without starving the page',()=>{const f=fixture(true);assert.equal(f.list.hidden,true);assert.ok(f.flush()<=1);f.list.hidden=true;assert.equal(f.flush(),1);assert.equal(f.trigger.getAttribute('aria-expanded'),'false');});

test('enhancing a select preserves an existing label id used by page initialisation',()=>{const f=fixture(true,'office-selector');assert.equal(f.label.id,'office-selector');assert.equal(f.trigger.getAttribute('aria-labelledby'),'office-selector purpose-value');assert.ok(f.flush()<=1);});
