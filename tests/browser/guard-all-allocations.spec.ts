import {test,expect,type Page,type BrowserContext} from '@playwright/test';
const shared='10000000-0000-4000-8000-000000000001',asha='10000000-0000-4000-8000-000000000002',nikhil='10000000-0000-4000-8000-000000000003',lobby='10000000-0000-4000-8000-000000000004';
const duties=[{kind:'PROJECT',dutyId:'1',name:'Project Alpha'},{kind:'PROJECT',dutyId:'2',name:'Project Beta'},{kind:'COMMON',dutyId:'1',name:'Lobby'}];
const until=new Date(Date.now()+86400000).toISOString();
function visit(id:string,name:string,projectName:string,type='EXTERNAL'){return{visitRequestId:id,personName:name,projectName,requestType:type,hostName:type==='EXTERNAL'?'Meera Singh':null,publicReference:'V-'+name.replaceAll(' ',''),publicPassNumber:'GP-'+id.slice(-6),status:'APPROVED',passStatus:'ACTIVE',isInside:false,validFromUtc:new Date(Date.now()-3600000).toISOString(),validUntilUtc:until,photoAvailable:false,employeeProjects:type==='DIGITAL_ID'?{available:true,total:2,items:[{name:'Project Alpha'},{name:'Project Beta'}]}:undefined};}
const people=[visit(shared,'Arjun Rao','Project Alpha','DIGITAL_ID'),visit(asha,'Asha Mehta','Project Alpha'),visit(nikhil,'Nikhil Shah','Project Beta'),visit(lobby,'Saima Khan','Project Gamma')];
async function setup(page:Page,context:BrowserContext,options:{commonOnly?:boolean;delayed?:boolean}={}){
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 const calls:{action:string;body:any}[]=[];let denied=false,release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/guard/**',async route=>{
  const action=new URL(route.request().url()).pathname.split('/').at(-1)!,body=route.request().postDataJSON();calls.push({action,body});const reply=(json:unknown)=>route.fulfill({json});
  if(action==='context')return reply({displayName:'Assigned Guard',locations:[{locationId:1,locationName:'Noida'}]});
  if(action==='duties')return reply({locationId:1,duties:options.commonOnly?duties.filter(d=>d.kind==='COMMON'):duties});
  if(action==='name-readings')return reply({locale:body.locale,items:body.names.map((name:string)=>({name,reading:null}))});
  expect(body.dutyKind).not.toBe('ALL');expect(duties.some(d=>d.kind===body.dutyKind&&d.dutyId===body.dutyId)).toBe(true);expect(body.locationId).toBe(1);
  if(action==='visitors'){
   if(options.delayed&&body.dutyKind==='PROJECT'&&body.dutyId==='2')await gate;
   if(denied&&body.dutyKind==='PROJECT'&&body.dutyId==='2')return route.fulfill({status:403,json:{}});
   let rows=body.dutyKind==='COMMON'?people:body.dutyId==='1'?[people[1],people[0]]:[people[2],people[0]];
   if(body.queue==='INSIDE'){expect(body.dutyKind).toBe('PROJECT');rows=body.dutyId==='1'?[people[0]]:[people[2]];rows=rows.map(v=>({...v,isInside:true}));}
   if(body.search)rows=rows.filter(v=>v.personName.toLowerCase().includes(body.search.toLowerCase()));
   const paged=body.dutyKind==='PROJECT'&&body.dutyId==='1',size=paged?1:50;
   return reply({visitors:rows.slice(body.offset,body.offset+size),hasMore:rows.length>body.offset+size});
  }
  if(action==='detail'||action==='verify'){
   const row=people.find(v=>v.visitRequestId===body.visitRequestId)??people[0];return reply(action==='verify'?{outcome:'VALID',visit:{...row,accessPassId:'20000000-0000-4000-8000-000000000001',locationName:'Noida',dutyKind:body.dutyKind,dutyId:body.dutyId,canEnter:body.dutyKind==='PROJECT',canExit:false,canReconcileExit:false,movements:[]}}:{...row,accessPassId:'20000000-0000-4000-8000-000000000001',locationName:'Noida',dutyKind:body.dutyKind,dutyId:body.dutyId,canEnter:body.dutyKind==='PROJECT',canExit:false,canReconcileExit:false,movements:[]});
  }
  return route.fulfill({status:500,json:{}});
 });
 await page.goto('/guard');await expect(page.locator('#project-filter-trigger')).toBeEnabled();await expect(page.locator('.guard-id-card')).toHaveCount(options.commonOnly?4:2);
 return{calls,release,deny:()=>{denied=true;}};
}
async function all(page:Page){await page.locator('#project-filter-trigger').click();await page.getByRole('option',{name:'All allocations',exact:true}).click();}
for(const width of [390,1366])test(`all allocations combines authorized paged results and binds detail to a chosen allocation at ${width}px`,async({page,context})=>{
 await page.setViewportSize({width,height:900});const fixture=await setup(page,context);await all(page);await expect(page.locator('.guard-id-card')).toHaveCount(4);
 await expect(page.locator('.guard-card-person strong')).toHaveText(['Arjun Rao','Asha Mehta','Nikhil Shah','Saima Khan']);
 const arjun=page.locator('.guard-id-card').filter({has:page.locator('strong',{hasText:'Arjun Rao'})});await expect(arjun.locator('.guard-card-projects')).toHaveText('Projects: Project Alpha · Project Beta');
 await arjun.click();await expect(page.locator('#allocation-dialog')).toBeVisible();expect(fixture.calls.filter(c=>c.action==='detail')).toHaveLength(0);
 await page.locator('#allocation-select-trigger').click();await page.getByRole('option',{name:'Project Beta · Project',exact:true}).click();await page.locator('#allocation-form').getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.locator('#person-name')).toHaveText('Arjun Rao');await expect(page.locator('#pass-fields')).toContainText('Project Beta · Project');await expect(page.locator('#mark-entry')).toBeVisible();
 expect(fixture.calls.filter(c=>c.action==='detail').at(-1)?.body).toMatchObject({dutyKind:'PROJECT',dutyId:'2',visitRequestId:shared});
 await page.locator('#close-pass').click();await page.getByRole('tab',{name:'Inside',exact:true}).click();await expect(page.locator('.guard-id-card')).toHaveCount(2);
 expect(fixture.calls.filter(c=>c.action==='visitors'&&c.body.queue==='INSIDE').every(c=>c.body.dutyKind==='PROJECT')).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('combined view preserves search language and requires a concrete allocation before scanning',async({page,context})=>{
 await page.setViewportSize({width:390,height:844});
 const f=await setup(page,context);await all(page);await expect(page.locator('.guard-id-card')).toHaveCount(4);
 await page.getByRole('searchbox').fill('Nikhil');await expect(page.locator('.guard-id-card')).toHaveCount(1);await expect(page.locator('.guard-card-person strong')).toHaveText('Nikhil Shah');
 await page.locator('#scan-fab').click();await expect(page.locator('#allocation-dialog')).toBeVisible();await expect(page.locator('#scanner-dialog')).not.toBeVisible();await page.locator('#allocation-cancel').click();expect(f.calls.filter(c=>c.action==='verify')).toHaveLength(0);
 for(const [label,translation] of [['English + हिन्दी','सारी ड्यूटी'],['English + ಕನ್ನಡ','ಎಲ್ಲಾ ಡ್ಯೂಟಿಗಳು'],['English + தமிழ்','எல்லா டியூட்டிகளும்'],['English + मराठी','सर्व ड्युटी']]){
  await page.locator('#account-toggle').click();await page.locator('#language-menu').click();await page.getByRole('menuitemradio',{name:label,exact:true}).click();
  await expect(page.locator('#project-filter-trigger')).toContainText(translation);await expect(page.locator('.guard-card-projects')).toContainText('Projects / ');
  expect(await page.locator('#project-filter-trigger span').evaluate(span=>span.scrollWidth<=span.clientWidth+1)).toBe(true);
  await page.locator('#account-toggle').click();
 }
});
test('a late combined response cannot replace a new individual filter and a denied allocation clears the union',async({page,context})=>{
 const f=await setup(page,context,{delayed:true});await all(page);await expect.poll(()=>f.calls.some(c=>c.action==='visitors'&&c.body.dutyId==='2')).toBe(true);
 await page.locator('#project-filter-trigger').click();await page.getByRole('option',{name:'Project Alpha · Project',exact:true}).click();await expect(page.locator('.guard-id-card')).toHaveCount(2);f.release();await expect(page.locator('#project-filter-trigger')).toHaveText('Project Alpha · Project');
 f.deny();await all(page);await expect(page.locator('#recent-status')).toContainText('Visitors unavailable');await expect(page.locator('.guard-id-card')).toHaveCount(0);
});
test('a common-only guard can combine identities without movement queues or actions',async({page,context})=>{
 await setup(page,context,{commonOnly:true});await all(page);await expect(page.locator('.guard-id-card')).toHaveCount(4);await expect(page.locator('.guard-queue-tabs')).toBeHidden();
 await page.locator('.guard-id-card').first().click();await expect(page.locator('#person')).toBeVisible();await expect(page.locator('#mark-entry')).toBeHidden();await expect(page.locator('#mark-exit')).toBeHidden();await expect(page.locator('#allocation-dialog')).not.toBeVisible();
});
