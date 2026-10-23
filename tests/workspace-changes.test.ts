import test from 'node:test';import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';import {Readable} from 'node:stream';
import {WorkspaceChanges} from '../src/development/WorkspaceChanges.ts';
import {WorkspaceEventRoutes} from '../src/development/WorkspaceEventRoutes.ts';
class Response extends EventEmitter{
 headers:Record<string,string>={};frames:string[]=[];destroyed=false;headersSent=false;accept=true;
 setHeader(key:string,value:string){this.headers[key]=value;}
 flushHeaders(){this.headersSent=true;}
 write(text:string){this.frames.push(text);return this.accept;}
 end(){this.destroyed=true;this.emit('close');}
}
const id=(n:number)=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const p=(location=1,project='10')=>({LocationId:{type:'int' as const,value:location},ProjectLocationId:{type:'bigint' as const,value:project}});
test('scoped signals coalesce and contain no identity, scope ID or pass data',t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const bus=new WorkspaceChanges();t.after(()=>bus.close());
 const a=new Response(),b=new Response(),c=new Response();bus.open('a',new Set(['p:1:10']),a as any);bus.open('b',new Set(['p:1:11']),b as any);bus.open('c',new Set(['p:2:10']),c as any);
 for(let n=0;n<100;n++)bus.publish(new Set(['p:1:10']));t.mock.timers.tick(250);
 assert.deepEqual(a.frames,['event: ready\ndata: {}\n\n','event: invalidate\ndata: {}\n\n']);assert.equal(b.frames.length,1);assert.equal(c.frames.length,1);
 assert.equal(a.headers['Content-Type'],'text/event-stream; charset=utf-8');assert.equal(a.headers['Cache-Control'],'no-store');
});
test('connection budgets, leases, backpressure and shutdown bound server resources',t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const bus=new WorkspaceChanges();
 const open=(key:string)=>{const r=new Response();bus.open(key,new Set(['o:1']),r as any);return r;};
 open('same');open('same');assert.throws(()=>open('same'),(e:any)=>e.status===429);open('b');const last=open('c');assert.throws(()=>open('d'),(e:any)=>e.status===429);
 last.accept=false;t.mock.timers.tick(15000);assert.equal(bus.connections,3);assert.equal(last.destroyed,true);
 const broken=open('broken');broken.emit('error',Error('reset'));assert.equal(bus.connections,3);assert.equal(broken.destroyed,true);
 t.mock.timers.tick(105000);assert.equal(bus.connections,0);const r=open('d');bus.close();assert.equal(r.destroyed,true);assert.throws(()=>open('e'),(e:any)=>e.status===503);
});
test('only committed submission notifies; later scoped mutations reuse bounded routing metadata without SQL',t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const bus=new WorkspaceChanges();t.after(()=>bus.close());const r=new Response();bus.open('a',new Set(['p:1:10']),r as any);
 bus.observe('gp.SubmitRegistration',p(),{status:'NEEDS_CREDENTIALS'});t.mock.timers.tick(250);assert.equal(r.frames.length,1);
 bus.observe('gp.SubmitRegistration',p(),{status:'SUBMITTED',visits:[{visitRequestId:id(1),personName:'Private Name'}]});t.mock.timers.tick(250);assert.equal(r.frames.length,2);
 bus.observe('gp.GetVisitDetail',{}, {visitRequestId:id(1),locationId:1,projectLocationId:'10'});t.mock.timers.tick(250);assert.equal(r.frames.length,2);
 // Common-area list rows can omit the numeric project; they must not erase a known route.
 bus.observe('gp.ListGuardDutyVisitors',{LocationId:{type:'int',value:1}}, {visitors:[{visitRequestId:id(1),requestType:'EXTERNAL'}]});
 bus.observe('gp.DecideVisit',{VisitRequestId:{type:'guid',value:id(1)}},{visitRequestId:id(1),decision:'APPROVED'});t.mock.timers.tick(250);assert.equal(r.frames.length,3);assert.ok(r.frames.every(f=>!f.includes('Private')&&!f.includes(id(1))));
 bus.observe('gp.DecideVisit',{VisitRequestId:{type:'guid',value:id(2)}},{visitRequestId:id(2),decision:'APPROVED'});t.mock.timers.tick(250);assert.equal(r.frames.length,3);
});
test('routing metadata expires and oldest entries are evicted; it never authorizes a read',t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});const bus=new WorkspaceChanges();t.after(()=>bus.close());
 for(let n=0;n<=4096;n++)bus.observe('gp.GetVisitDetail',{}, {visitRequestId:id(n),locationId:1,projectLocationId:'10'});
 const r=new Response();bus.open('a',new Set(['p:1:10']),r as any);
 bus.observe('gp.CancelVisit',{VisitRequestId:{type:'guid',value:id(0)}},{});t.mock.timers.tick(250);assert.equal(r.frames.length,1);
 bus.observe('gp.CancelVisit',{VisitRequestId:{type:'guid',value:id(4096)}},{});t.mock.timers.tick(250);assert.equal(r.frames.length,2);
 t.mock.timers.setTime(3602000);t.mock.timers.tick(1);const fresh=new Response();bus.open('b',new Set(['p:1:10']),fresh as any);bus.observe('gp.CancelVisit',{VisitRequestId:{type:'guid',value:id(4096)}},{});t.mock.timers.tick(250);assert.equal(fresh.frames.length,1);
});
test('Digital ID changes reach office Digital ID topics; project changes do not widen to other projects',t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const bus=new WorkspaceChanges();t.after(()=>bus.close());const r=new Response();bus.open('a',new Set(['d:1']),r as any);
 bus.observe('gp.SubmitRegistration',{...p(),RequestType:{type:'text',value:'TEMP_ID'}},{status:'SUBMITTED'});t.mock.timers.tick(250);assert.equal(r.frames.length,2);
 bus.observe('gp.SubmitRegistration',p(),{status:'SUBMITTED'});t.mock.timers.tick(250);assert.equal(r.frames.length,2);
});
function request(body:unknown){return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{headers:{'content-type':'application/json'}}) as any;}
test('stream route requires current staff authentication and authorized scope before sending headers',async t=>{
 const bus=new WorkspaceChanges();t.after(()=>bus.close());let valid=true,authorized=0;
 const staff={session(){return{sessionToken:'token',csrfToken:'csrf'};},async verify(){return valid;}};
 const route=new WorkspaceEventRoutes(staff,bus,async(_s,input)=>{authorized++;if(input.locationId!==1)throw Object.assign(Error(),{code:'NOT_AUTHORIZED'});return new Set(['o:1']);});
 const response=new Response();valid=false;await assert.rejects(route.handle(request({workspace:'ADMIN',locationId:1}),response as any),(e:any)=>e.status===401);assert.equal(authorized,0);
 valid=true;await assert.rejects(route.handle(request({workspace:'ADMIN',locationId:2}),response as any));assert.equal(response.headersSent,false);
 await assert.rejects(route.handle(request({workspace:'GUARD',locationId:1,projectLocationId:'10'}),response as any),(e:any)=>e.status===400);
 await assert.rejects(route.handle(request({workspace:['ADMIN'],locationId:1}),response as any),(e:any)=>e.status===400);
 await route.handle(request({workspace:'ADMIN',locationId:1}),response as any);assert.equal(response.headersSent,true);assert.equal(response.destroyed,false);assert.equal(bus.connections,1);
});

test('subscription capacity is reserved before authorization SQL work starts',async t=>{
 const bus=new WorkspaceChanges();t.after(()=>bus.close());let release=()=>{},calls=0;const gate=new Promise<void>(r=>release=r);
 const staff={session(){return{sessionToken:'same',csrfToken:'csrf'};},async verify(){return true;}};
 const route=new WorkspaceEventRoutes(staff,bus,async()=>{calls++;await gate;return new Set(['o:1']);});
 const a=route.handle(request({workspace:'ADMIN',locationId:1}),new Response() as any),b=route.handle(request({workspace:'ADMIN',locationId:1}),new Response() as any);
 for(let n=0;n<10&&calls<2;n++)await new Promise<void>(r=>setImmediate(r));
 assert.equal(calls,2);await assert.rejects(route.handle(request({workspace:'ADMIN',locationId:1}),new Response() as any),(e:any)=>e.status===429);assert.equal(calls,2);release();await Promise.all([a,b]);assert.equal(bus.connections,2);
});
