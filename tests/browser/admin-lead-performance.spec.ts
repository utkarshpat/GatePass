import{test,expect}from'@playwright/test';import type{Page,BrowserContext,Route}from'@playwright/test';
const user='11111111-1111-4111-8111-111111111111';
async function setup(page:Page,context:BrowserContext,options:{count?:number;offices?:boolean;onLead?:(route:Route,index:number)=>Promise<void>}={}){
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 const calls:{id:string;location:number}[]=[];let location=1;
 await page.route('**/api/admin/**',async route=>{
  const action=new URL(route.request().url()).pathname.split('/').at(-1),d=route.request().postDataJSON(),reply=(json:unknown)=>route.fulfill({json});
  if(action==='context')return reply({displayName:'Synthetic Admin',locations:[{locationId:1,locationCode:'NOIDA',locationName:'Noida',canManageCommonAreas:false},...(options.offices?[{locationId:2,locationCode:'CHENNAI',locationName:'Chennai',canManageCommonAreas:false}]:[])]});
  if(action==='projects'){location=d.locationId;return reply({projects:Array.from({length:options.count??60},(_,i)=>({projectLocationId:String(d.locationId*1000+i+1),projectId:String(i+1),projectName:'Project '+String(i+1).padStart(2,'0'),projectCode:'SYN-'+i,directoryCurrent:true,canAssignProject:false,canAssignLocation:false})),cursor:null});}
  if(action==='scope')return reply({userId:user,currentDate:'2026-10-24',canReport:true,canReadVisits:false,canAudit:false,canManageRoles:false,canAssignGuards:false,roles:[{roleCode:'LOCATION_ADMIN',scopeType:'LOCATION'}],delegations:[]});
  if(action==='summary')return reply({visits:{total:'0',pending:'0',approved:'0',denied:'0',cancelled:'0'},recordedPresence:{projectVisitsInside:'0',digitalIdsInside:'0'}});
  if(action==='leads'){calls.push({id:d.projectLocationId,location});if(options.onLead)return options.onLead(route,calls.length);return reply({leads:[{displayName:'Lead '+d.projectLocationId,employeeId:'EMP001',scopeType:'PROJECT_LOCATION',canRemove:false}],cursor:null});}
  return reply({});
 });
 await page.goto('/admin');await expect(page.locator('#summary-cards article')).toHaveCount(4);
 return calls;
}
for(const width of[390,1366])test(`hidden overview makes no lead requests; visible cards and project 60 load on demand at ${width}px`,async({page,context})=>{
 await page.setViewportSize({width,height:844});const calls=await setup(page,context);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));expect(calls).toHaveLength(0);
 await page.locator('[data-admin-view="projects"]').click();await expect(page.locator('#projects .project-card').first()).toContainText('Lead 1001');
 await expect.poll(()=>page.evaluate('leadPreview.active===0&&leadPreview.queue.length===0')).toBe(true);
 expect(calls.length).toBeLessThan(20);expect(calls.some(c=>c.id==='1060')).toBe(false);
 await page.locator('#more-projects').click();await page.locator('#more-projects').click();await expect(page.locator('#projects .project-card')).toHaveCount(60);await page.locator('#projects .project-card').last().scrollIntoViewIfNeeded();await expect(page.locator('#projects .project-card').last()).toContainText('Lead 1060');
 await page.locator('#project-search').fill('Project 60');await expect(page.locator('#projects .project-card')).toHaveCount(1);await expect(page.locator('#projects')).toContainText('Lead 1060');expect(calls.filter(c=>c.id==='1060')).toHaveLength(1);
});
test('a pending preview and first dialog read share one request; reopening performs a fresh authorization check',async({page,context})=>{
 let release=()=>{};const gate=new Promise<void>(resolve=>release=resolve);
 const calls=await setup(page,context,{count:1,onLead:async(route,index)=>{if(index===1){await gate;return route.fulfill({json:{leads:[{displayName:'Approved Lead',employeeId:'EMP001',scopeType:'PROJECT_LOCATION',canRemove:false}],cursor:null}});}return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});}});
 await page.locator('[data-admin-view="projects"]').click();await expect.poll(()=>calls.length).toBe(1);await page.getByRole('button',{name:'Project leads',exact:true}).click();
 await expect(page.locator('#lead-status')).toContainText('Loading');expect(calls).toHaveLength(1);release();await expect(page.locator('#lead-list')).toContainText('Approved Lead');
 await page.locator('#close-leads').click();await page.getByRole('button',{name:'Project leads',exact:true}).click();await expect(page.locator('#projects')).toBeEmpty();await expect(page.locator('#lead-dialog')).toBeHidden();expect(calls).toHaveLength(2);
});
test('preview concurrency stays at three and queued work pauses when the projects tab is hidden',async({page,context})=>{
 let release=()=>{};const gate=new Promise<void>(resolve=>release=resolve);let active=0,maximum=0;
 const calls=await setup(page,context,{onLead:async route=>{active++;maximum=Math.max(maximum,active);await gate;active--;await route.fulfill({json:{leads:[],cursor:null}});}});
 await page.locator('[data-admin-view="projects"]').click();await page.evaluate(()=>document.querySelector('#workspace')!.scrollTop=300);await expect.poll(()=>calls.length).toBe(3);
 await page.locator('[data-admin-view="overview"]').click();release();await expect.poll(()=>active).toBe(0);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));expect(calls).toHaveLength(3);expect(maximum).toBe(3);
});
test('a new office never reuses a pending read or paints the previous office lead',async({page,context})=>{
 let release=()=>{};const gate=new Promise<void>(resolve=>release=resolve);
 const calls=await setup(page,context,{count:1,offices:true,onLead:async route=>{const id=route.request().postDataJSON().projectLocationId;if(id==='1001')await gate;return route.fulfill({json:{leads:[{displayName:id==='1001'?'Old Noida Lead':'Current Chennai Lead'}],cursor:null}});}});
 await page.locator('[data-admin-view="projects"]').click();await expect.poll(()=>calls.length).toBe(1);await page.locator('#admin-office-trigger').click();await page.getByRole('option',{name:'Chennai',exact:true}).click();
 await expect(page.locator('#projects')).toContainText('Current Chennai Lead');release();await expect.poll(()=>calls.length).toBe(2);await expect(page.locator('#projects')).not.toContainText('Old Noida Lead');
});
test('a changed lead revision bypasses an older pending request and ignores its late preview result',async({page,context})=>{
 let release=()=>{};const gate=new Promise<void>(resolve=>release=resolve);
 const calls=await setup(page,context,{count:1,onLead:async(route,index)=>{if(index===1)await gate;return route.fulfill({json:{leads:[{displayName:index===1?'Old Lead':'New Lead',scopeType:'PROJECT_LOCATION',canRemove:false}],cursor:null}});}});
 await page.locator('[data-admin-view="projects"]').click();await expect.poll(()=>calls.length).toBe(1);
 await page.evaluate('state.project=state.projects[0];invalidateProjectLeads();openLeads(state.project);');await expect(page.locator('#lead-list')).toContainText('New Lead');release();await expect.poll(()=>calls.length).toBe(2);
 await expect(page.locator('#projects')).toContainText('New Lead');await expect(page.locator('#projects')).not.toContainText('Old Lead');
});
