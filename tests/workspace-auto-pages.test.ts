import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
function nodes(){const all=new Map();return(id:string)=>{if(!all.has(id))all.set(id,{value:id==='project-filter'?'ALL':'',hidden:false,disabled:false,textContent:'',children:[],setAttribute(){},replaceChildren(){}});return all.get(id);};}
test('guard automatically loads every scoped server page and keeps filters unchanged across batches',async()=>{
 const source=readFileSync(new URL('../src/app/guard.js',import.meta.url),'utf8'),calls:any[]=[],state={office:{locationId:1},duty:{kind:'PROJECT',dutyId:'17'},queue:'EXPECTED',recentVersion:0,recentRows:[],hasMore:false},$=nodes();
 $('visitor-search').value='Visitor';$('project-filter').value='17';const context:any={state,$,dutyContext:()=>({locationId:1,dutyKind:'PROJECT',dutyId:'17'}),i18n:{t:(s:string)=>s},notify:(e:any)=>{throw e},renderRecent(){},async api(_action:string,p:any){calls.push(p);return calls.length===1?{visitors:[{visitRequestId:'a'}],hasMore:true}:{visitors:[{visitRequestId:'b'}],hasMore:false};}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function recent('),source.indexOf('\nlet searchTimer;'))+';globalThis.load=recent;',context);await context.load();
 assert.equal(state.recentRows.length,2);assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.offset),[0,1]);assert.ok(calls.every(c=>c.locationId===1&&c.dutyKind==='PROJECT'&&c.dutyId==='17'&&c.search==='Visitor'));assert.equal($('load-more').hidden,true);assert.equal($('refresh-recent').disabled,false);
});
test('reception completes its keyset chain before publishing complete-list counters',async()=>{
 const source=readFileSync(new URL('../src/app/reception.js',import.meta.url),'utf8'),calls:any[]=[],renders:any[]=[],state={context:{},location:{locationId:1},status:'ALL',listVersion:0,listBusy:false,rows:[],cursor:null},$=nodes();
 const context:any={state,$,toasts:{show:(message:string)=>{throw Error(message)}},renderRows(){renders.push({length:state.rows.length,busy:state.listBusy});},async api(_action:string,p:any){calls.push(p);return calls.length===1?{visits:[{visitRequestId:'a'}],cursor:{submittedAtUtc:'stamp',visitRequestId:'a'}}:{visits:[{visitRequestId:'b'}],cursor:null};}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function loadVisits('),source.indexOf('\nfunction clearProtectedVisits'))+';globalThis.load=loadVisits;',context);await context.load();
 assert.equal(calls.length,2);assert.equal(calls[1].cursor.visitRequestId,'a');assert.deepEqual(renders,[{length:2,busy:false}]);assert.equal(state.rows.length,2);assert.equal($('load-more').hidden,true);
});

test('reception partial-list failure never presents partial metrics as complete totals',()=>{
 const source=readFileSync(new URL('../src/app/reception.js',import.meta.url),'utf8'),$=nodes(),state={rows:[],listComplete:false,listFailed:true,listBusy:false,cursor:null};
 const context:any={state,$,document:{createElement(){return{};}}};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function renderRows('),source.indexOf('async function loadVisits('))+';renderRows();',context);
 for(const id of ['stat-total','stat-pending','stat-inside','stat-returns'])assert.equal($(id).textContent,'—');assert.equal($('empty-visits').hidden,true);assert.match($('list-status').textContent,/Could not update visits/u);
});

 test('failed refresh preserves the previous complete list and counters through a partial page chain',async()=>{
 const source=readFileSync(new URL('../src/app/reception.js',import.meta.url),'utf8'),$=nodes(),previous=[{visitRequestId:'existing'}],state={context:{},location:{locationId:1},listVersion:0,listComplete:true,listBusy:false,rows:previous,cursor:null};
 $('stat-total').textContent='1';let calls=0,renders=0;const context:any={state,$,toasts:{show(){}},renderRows(){renders++;},async api(){if(++calls===1)return{visits:[{visitRequestId:'partial'}],cursor:{visitRequestId:'partial',submittedAtUtc:'stamp'}};throw Error('Connection lost');}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function loadVisits('),source.indexOf('\nfunction clearProtectedVisits'))+';globalThis.load=loadVisits;',context);await context.load();
 assert.equal(calls,2);assert.equal(renders,0);assert.equal(state.rows,previous);assert.equal($('stat-total').textContent,'1');assert.match($('list-status').textContent,/previous list/u);assert.equal($('refresh').disabled,false);
 });
