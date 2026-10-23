import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const admin='11111111-1111-4111-8111-111111111111',guard='22222222-2222-4222-8222-222222222222';
for(const width of [390,1366])test(`unified Add creates an area and area cards manage only their own guards at ${width}px`,async({page,context})=>{
 await page.setViewportSize({width,height:844});await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 let created=false,assigned=false,createAttempts=0;const writes:any[]=[],offsets:number[]=[];
 const initial={assignmentId:'51',areaId:'3',areaName:'Main Lobby',guardName:'Neha Saini',guardUserId:'33333333-3333-4333-8333-333333333333'};
 await page.route('**/api/admin/**',async route=>{
  const action=new URL(route.request().url()).pathname.split('/').at(-1),d=route.request().postDataJSON(),reply=(json:any)=>route.fulfill({json});
  if(action==='context')return reply({displayName:'Noida Admin',locations:[{locationId:1,locationCode:'NOIDA',locationName:'Noida',canCreateProject:true,canManageCommonAreas:true}]});
  if(action==='scope')return reply({userId:admin,currentDate:'2026-10-23',canReport:false,canReadVisits:false,canAudit:false,canAssignGuards:true,canManageRoles:true,roles:[{roleCode:'LOCATION_ADMIN',scopeType:'LOCATION'}],delegations:[]});
  if(action==='projects')return reply({projects:[{projectLocationId:'2',projectId:'1',projectName:'Workplace Transformation',projectCode:'DWT-NOI',directoryCurrent:true,canAssignProject:false,canAssignLocation:true}],cursor:null});
  if(action==='leads')return reply({leads:[{roleGrantId:'8',displayName:'Aditi Sharma'}],cursor:null});
  if(action==='common-duties'){
   const areas=[{areaId:'3',name:'Main Lobby'},{areaId:'4',name:'Cafeteria'},...(created?[{areaId:'5',name:'Visitor Welcome Lounge'}]:[])];
   if(d.search)return reply({areas,guards:[{userId:guard,displayName:'Rakesh Kumar'}],assignments:[],hasMore:false});
   offsets.push(d.offset);
   if(d.offset===0)return reply({areas,guards:[],assignments:Array.from({length:50},(_,i)=>({assignmentId:String(i+1),areaId:'4',areaName:'Cafeteria',guardName:'Security '+i,guardUserId:guard})),hasMore:true});
   return reply({areas,guards:[],assignments:[initial,...(assigned?[{assignmentId:'52',areaId:'3',areaName:'Main Lobby',guardName:'Rakesh Kumar',guardUserId:guard}]:[])],hasMore:false});
  }
  if(action==='common-duty'){
   writes.push(d);
   if(d.action==='CREATE_AREA'){createAttempts++;if(createAttempts===1)return route.fulfill({status:503,json:{error:'UNAVAILABLE'}});created=true;}
   if(d.action==='ASSIGN')assigned=true;if(d.action==='REMOVE')assigned=false;
   return reply({ok:true});
  }
  return reply({});
 });
 await page.goto('/admin');await expect(page.locator('#projects .area-card')).toHaveCount(2);expect(offsets).toContain(50);
 await expect(page.locator('#admin-projects .page-head-actions .primary')).toHaveCount(1);await expect(page.locator('#common-area-new')).toHaveCount(0);await expect(page.locator('#common-duties-open')).toHaveCount(0);
 const lobby=page.locator('.area-card').filter({has:page.getByRole('heading',{name:'Main Lobby',exact:true})});await expect(lobby).toContainText('Neha Saini');await expect(lobby).not.toContainText('Security 0');await expect(lobby.getByRole('button',{name:/lead/iu})).toHaveCount(0);
 await page.getByRole('button',{name:'Add',exact:true}).click();await expect(page.locator('#add-project-dialog').getByLabel('Type',{exact:true}).locator('option')).toHaveCount(2);await page.locator('#add-project-dialog').getByLabel('Type',{exact:true}).selectOption('area');await expect(page.locator('#new-project-code-field')).toBeHidden();await expect(page.locator('#new-project-code')).toBeDisabled();await page.getByLabel('Area name',{exact:true}).fill('Visitor Welcome Lounge');await page.getByLabel('Reason for adding this area',{exact:true}).fill('Dedicated arrival space for scheduled visitors');
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.getByRole('button',{name:'Create area',exact:true}).click();await expect(page.locator('#new-project-status')).toContainText('Unable to complete');await page.getByRole('button',{name:'Create area',exact:true}).click();await expect(page.locator('#add-project-dialog')).toBeHidden();await expect(page.locator('.area-card')).toHaveCount(3);
 expect(writes[0]).toEqual(writes[1]);expect(writes[0]).toMatchObject({locationId:1,action:'CREATE_AREA',areaName:'Visitor Welcome Lounge'});expect(writes[0]).not.toHaveProperty('projectCode');
 await lobby.getByRole('button',{name:'Assign guard to Main Lobby',exact:true}).click();await expect(page.locator('#common-area')).toHaveText('Main Lobby');await expect(page.locator('#common-area option')).toHaveCount(1);await expect(page.locator('#common-assignments')).toContainText('Neha Saini');await expect(page.locator('#common-assignments')).not.toContainText('Security 0');await expect(page.getByRole('tab',{name:'New Area',exact:true})).toHaveCount(0);
 await page.getByLabel('Search guard',{exact:true}).fill('Rakesh');await page.locator('#common-guard-results button').click();await page.locator('#common-assign-reason').fill('Visitor lounge reception cover');await page.locator('#common-assign-button').click();await expect(page.locator('#common-assignments')).toContainText('Rakesh Kumar');expect(writes.find(w=>w.action==='ASSIGN')).toMatchObject({locationId:1,areaId:'3',guardUserId:guard});
 const assignedRow=page.locator('#common-assignments .lead-row').filter({hasText:'Rakesh Kumar'});await assignedRow.getByRole('button',{name:'Remove',exact:true}).click();await page.locator('#common-remove-reason').fill('End visitor reception cover');await page.locator('#common-remove button[type=submit]').click();await expect(page.locator('#common-assignments')).not.toContainText('Rakesh Kumar');expect(writes.find(w=>w.action==='REMOVE')).toMatchObject({assignmentId:'52',locationId:1});await page.locator('#common-close').click();
 await expect(lobby).toContainText('Neha Saini');await expect(lobby).not.toContainText('Rakesh Kumar');await page.locator('#project-search').fill('Welcome');await expect(page.locator('#projects .project-card')).toHaveCount(1);await page.locator('#project-search').fill('');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);await page.screenshot({path:`output/unified-projects-areas-${width}.png`});
});

for(const capability of ['project','area'])test(`unified creation offers only the authorized ${capability} type`,async({page,context})=>{
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 await page.route('**/api/admin/**',async route=>{const action=new URL(route.request().url()).pathname.split('/').at(-1);const json=action==='context'?{displayName:'Scoped Admin',locations:[{locationId:1,locationName:'Noida',locationCode:'NOIDA',canCreateProject:capability==='project',canManageCommonAreas:capability==='area'}]}:action==='scope'?{userId:admin,currentDate:'2026-10-23',canReport:false,canReadVisits:false,canAudit:false,canAssignGuards:true,canManageRoles:false,roles:[],delegations:[]}:action==='projects'?{projects:[],cursor:null}:{areas:[],assignments:[],hasMore:false};return route.fulfill({json});});
 await page.goto('/admin');await page.getByRole('button',{name:'Add',exact:true}).click();await expect(page.locator('#add-project-dialog').getByLabel('Type',{exact:true}).locator('option')).toHaveCount(1);await expect(page.locator('#add-project-dialog').getByLabel('Type',{exact:true})).toHaveValue(capability);
});
