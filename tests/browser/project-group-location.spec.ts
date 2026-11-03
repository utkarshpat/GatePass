import {test,expect,type Page,type BrowserContext} from '@playwright/test';
const actor='10000000-0000-4000-8000-000000000001',guard='20000000-0000-4000-8000-000000000001';
async function setup(page:Page,context:BrowserContext,projectOnly=false){
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic-group-location',url:'http://localhost:18447'})));
 const state={groupSuffix:'',calls:[] as {action:string;body:any}[],groupFailure:0,holdNextGroups:false,groupsHeld:false,releaseGroups:()=>{},delayedGroupStatus:200,holdNextProjects:false,projectsHeld:false,releaseProjects:()=>{}};
 const projects=(locationId:number)=>[{projectLocationId:String(locationId*10+1),projectId:String(locationId),projectName:locationId===1?'Noida Project':'Chennai Project',projectCode:'P'+locationId,directoryCurrent:true}];
 await page.route('**/api/**',async route=>{
  const action=new URL(route.request().url()).pathname.split('/').at(-1)!,d=route.request().postDataJSON(),reply=(json:any)=>route.fulfill({json});state.calls.push({action,body:d});
  if(action==='context')return reply({displayName:'Scoped admin',locations:[{locationId:1,locationCode:'NOIDA',locationName:'Noida'},{locationId:2,locationCode:'CHENNAI',locationName:'Chennai'}]});
  if(action==='scope'){
   if(projectOnly&&!d.projectLocationId)return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});
   return reply({userId:actor,currentDate:'2026-10-26',canReport:false,canReadVisits:false,canAudit:false,canManageRoles:false,canAssignGuards:true,canManageProjectGroups:!projectOnly,roles:[{roleCode:projectOnly?'PROJECT_ADMIN':'LOCATION_ADMIN',scopeType:projectOnly?'PROJECT_LOCATION':'LOCATION'}],delegations:[]});
  }
  if(action==='projects'){
   if(state.holdNextProjects){state.holdNextProjects=false;state.projectsHeld=true;await new Promise<void>(resolve=>state.releaseProjects=resolve);}
   return reply({projects:projects(d.locationId),cursor:null});
  }
  if(action==='project-groups'){
   const groups=[{groupId:String(d.locationId),name:(d.locationId===1?'Noida Entry':'Chennai Entry')+state.groupSuffix,revision:1,projects:projects(d.locationId),assignments:[]}];
   if(state.holdNextGroups){state.holdNextGroups=false;state.groupsHeld=true;await new Promise<void>(resolve=>state.releaseGroups=resolve);if(state.delayedGroupStatus!==200)return route.fulfill({status:state.delayedGroupStatus,json:{error:'STALE_SCOPE'}});}
   if(state.groupFailure)return route.fulfill({status:state.groupFailure,json:{error:'UNAVAILABLE'}});
   return reply({groups});
  }
  if(action==='guards')return reply({guards:[{userId:guard,displayName:'Scoped guard',canAllocate:true,overlappingAssignment:false}],hasMore:false});
  if(action==='assignments')return reply({assignments:[],cursor:null});
  if(action==='leads')return reply({leads:[],cursor:null});
  return reply({items:[],counts:{pending:0,expiredInside:0,unreturned:0},cursor:null});
 });
 await page.goto('/admin');await expect(page.locator('#projects')).toContainText('Noida Project');return state;
}

test('group management loads independently of guard roster, preserves its tab on retry and clears denied scope',async({page,context})=>{
 const state=await setup(page,context);state.groupFailure=503;await page.locator('[data-project-tab=groups]').click();await expect(page.locator('#project-groups-status')).toContainText('could not be loaded');await expect(page.locator('#project-group-list')).toBeEmpty();expect(state.calls.some(c=>['guards','assignments'].includes(c.action))).toBe(false);
 state.groupFailure=0;await page.locator('#refresh').click();await expect(page.locator('[data-project-tab=groups]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#project-group-list')).toContainText('Noida Entry');await expect(page.locator('#add-project-open')).toBeHidden();expect(state.calls.some(c=>['guards','assignments'].includes(c.action))).toBe(false);
 await page.locator('#create-project-group').click();await expect(page.locator('#project-group-dialog')).toBeVisible();state.groupFailure=403;await page.evaluate('loadProjectGroups()');await expect(page.locator('#project-group-dialog')).toBeHidden();await expect(page.locator('#project-group-list')).toBeEmpty();await expect(page.locator('#project-groups-panel')).toBeHidden();await expect(page.locator('#page-status')).toContainText('permissions changed');
});

test('project-only administrator retains individual duty assignment without group-management controls',async({page,context})=>{
 const state=await setup(page,context,true);await expect(page.locator('[data-project-tab=groups]')).toHaveCount(0);await expect(page.locator('#create-project-group')).toBeHidden();await page.evaluate("document.getElementById('create-project-group').click()");await expect(page.locator('#project-group-dialog')).toBeHidden();await page.locator('[data-admin-view=assignments]').click();await expect(page.locator('#roster-status')).toContainText('Showing');await page.locator('#assign-guard-open').click();await expect(page.locator('#allocation-kind-field')).toBeHidden();await expect(page.locator('#allocation-project-field')).toBeVisible();expect(state.calls.some(c=>c.action==='project-groups')).toBe(false);
});

for(const status of [200,401,403])test(`late project-group ${status} response cannot repaint or redirect a different office`,async({page,context})=>{
 const state=await setup(page,context);state.holdNextGroups=true;state.delayedGroupStatus=status;await page.locator('[data-project-tab=groups]').click();await expect.poll(()=>state.groupsHeld).toBe(true);await page.locator('#admin-office-trigger').click();await page.getByRole('option',{name:'Chennai',exact:true}).click();await expect(page.locator('#project-group-list')).toContainText('Chennai Entry');
 const oldResponse=page.waitForResponse(r=>r.url().endsWith('/api/admin/project-groups')&&r.request().postDataJSON().locationId===1);state.releaseGroups();await(await oldResponse).finished();await expect(page.locator('#project-group-list')).toContainText('Chennai Entry');await expect(page.locator('#project-group-list')).not.toContainText('Noida Entry');await expect(page).toHaveURL(/\/admin(?:\?[^#]*)?$/u);
});

test('pending group editor metadata cannot open a management dialog after switching to guard assignments',async({page,context})=>{
 const state=await setup(page,context);await page.locator('[data-project-tab=groups]').click();await expect(page.locator('#project-group-list')).toContainText('Noida Entry');state.holdNextProjects=true;await page.locator('#create-project-group').click();await expect.poll(()=>state.projectsHeld).toBe(true);await page.locator('[data-admin-view=assignments]').click();await expect(page.locator('#roster-status')).toContainText('Showing');
 const oldResponse=page.waitForResponse(r=>r.url().endsWith('/api/admin/projects'));state.releaseProjects();await(await oldResponse).finished();await expect(page.locator('#project-group-dialog')).toBeHidden();await expect(page.locator('#admin-assignments')).toBeVisible();await expect(page.locator('#project-groups-panel')).toBeHidden();
});

test('late guard-roster group data cannot overwrite the visible project group manager',async({page,context})=>{
 const state=await setup(page,context);state.holdNextGroups=true;await page.locator('[data-admin-view=assignments]').click();await expect.poll(()=>state.groupsHeld).toBe(true);state.groupSuffix=' updated';await page.locator('[data-admin-view=projects]').click();await page.locator('[data-project-tab=groups]').click();await expect(page.locator('#project-group-list')).toContainText('Noida Entry updated');
 const oldResponse=page.waitForResponse(r=>r.url().endsWith('/api/admin/project-groups')&&r.request().postDataJSON().locationId===1);state.releaseGroups();await(await oldResponse).finished();await expect(page.locator('#project-group-list h3')).toHaveText('Noida Entry updated');await expect(page.locator('#project-groups-panel')).toBeVisible();
});
