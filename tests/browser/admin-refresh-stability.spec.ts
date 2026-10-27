import {test,expect,type Page,type BrowserContext} from '@playwright/test';
import {summaryRange} from './summary-fixture.ts';
const actor='11111111-1111-4111-8111-111111111111',guard='22222222-2222-4222-8222-222222222222';
async function setup(page:Page,context:BrowserContext){
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'refresh-stability',url:'http://localhost:18447'})));
 const state={holdScope:false,scopeHeld:false,releaseScope:()=>{},scopeStatus:200,holdData:'',dataHeld:false,releaseData:()=>{},scopeReads:0};
 const project={projectLocationId:'1',projectId:'1',projectName:'Stable project',projectCode:'STABLE',directoryCurrent:true,canAssignLocation:true};
 await page.route('**/api/**',async route=>{
  const action=new URL(route.request().url()).pathname.split('/').at(-1)!,body=route.request().postDataJSON();
  if(action==='scope'){
   state.scopeReads++;if(state.holdScope){state.holdScope=false;state.scopeHeld=true;await new Promise<void>(r=>state.releaseScope=r);}
   if(state.scopeStatus!==200)return route.fulfill({status:state.scopeStatus,json:{error:'UNAVAILABLE'}});
  }
  if(action===state.holdData){state.holdData='';state.dataHeld=true;await new Promise<void>(r=>state.releaseData=r);}
  const scope={userId:actor,currentDate:'2026-10-26',canReport:true,canReadVisits:true,canExport:true,canAudit:true,canManageRoles:true,canAssignGuards:true,canManageProjectGroups:true,roles:[{roleCode:'LOCATION_ADMIN',scopeType:'LOCATION'}],delegations:[]};
  const replies:Record<string,any>={context:{displayName:'Synthetic admin',locations:[{locationId:1,locationCode:'NOIDA',locationName:'Noida'}]},scope,projects:{projects:[project],cursor:null},leads:{leads:[{displayName:'Existing lead'}],cursor:null},'project-groups':{groups:[{groupId:'1',name:'Stable entry',revision:1,projects:[project],assignments:[]}]},guards:{guards:[{userId:guard,displayName:'Existing guard',canAllocate:true}],hasMore:false},assignments:{assignments:[],cursor:null},subjects:{users:[{userId:guard,displayName:'Existing staff',active:true}],hasMore:false},roles:{grants:[{roleGrantId:'1',roleCode:'GUARD',scopeType:'LOCATION',locationId:1,capabilities:['VISITS_READ'],validFromUtc:'2026-01-01T00:00:00Z'}],hasMore:false},audit:{events:[{auditEventId:'1',occurredAtUtc:'2026-10-26T08:00:00Z',actionCode:'PROJECT_GROUP_CHANGED',actorDisplayName:'Synthetic admin',targetType:'PROJECT_GROUP',targetDisplayName:'Stable entry',resultCode:'SUCCESS',metadata:{}}],hasMore:false},register:{rows:[{visitRequestId:actor,localVisitDate:'2026-10-26',personName:'Existing visitor',projectName:'Stable project',requestType:'EXTERNAL',status:'APPROVED',presence:'OUTSIDE',printStatus:'NOT_PRINTED'}],total:1,page:body.page??1,pageSize:50}};
  if(action==='summary-range')return route.fulfill({json:summaryRange(body,{visits:{total:'1',pending:'0',approved:'1',denied:'0',cancelled:'0'},recordedPresence:{projectVisitsInside:'0',digitalIdsInside:'0'}})});
  return route.fulfill({json:replies[action]??{items:[],counts:{pending:0,expiredInside:0,unreturned:0},cursor:null}});
 });
 await page.goto('/admin');await expect(page.locator('#summary-cards article')).toHaveCount(4);await page.evaluate('liveRefresh.close()');return state;
}
const views=[['projects','projects','#projects','Stable project'],['groups','projects','#project-group-list','Stable entry'],['overview','overview','#summary-cards','Registered'],['assignments','assignments','#assignment-list','Existing guard'],['reports','reports','#report-list','Existing visitor'],['audit','audit','#audit-list','Stable entry'],['staff','staff','#staff-roles','Guard']] as const;
for(const width of [390,1366])for(const [name,view,content,text] of views)test(`manual refresh preserves ${name} structure and data at ${width}px`,async({page,context})=>{
 await page.setViewportSize({width,height:900});const state=await setup(page,context);await page.locator(`[data-admin-view=${view}]`).click();
 if(name==='groups')await page.locator('[data-project-tab=groups]').click();
 if(name==='staff'){await page.locator('#subject-search').fill('Existing');await page.locator('#subject-form').getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('button',{name:'Manage access',exact:true}).click();}
 await expect(page.locator(content)).toContainText(text);if(name==='projects')await expect(page.locator('#projects')).toContainText('Existing lead');
 const section=page.locator('#admin-'+view),before=await section.boundingBox();expect(before).not.toBeNull();
 await page.evaluate(()=>{(window as any).refreshMarker=true;(window as any).hiddenDuringRefresh=false;new MutationObserver(m=>{if(m.some(x=>x.attributeName==='hidden'&&(x.target as HTMLElement).hidden&&(x.target as HTMLElement).matches('.admin-nav button,main>section')))(window as any).hiddenDuringRefresh=true;}).observe(document.querySelector('main')!,{attributes:true,subtree:true,attributeFilter:['hidden']});});
 state.holdScope=true;state.holdData=({projects:'projects',groups:'project-groups',overview:'summary-range',assignments:'assignments',reports:'register',audit:'audit',staff:'roles'} as const)[name];
 const reads=state.scopeReads;await page.locator('#refresh').click();await expect.poll(()=>state.scopeHeld).toBe(true);await expect(page.locator(content)).toContainText(text);await expect(section).toBeVisible();await expect(page.locator('#refresh')).toBeDisabled();
 expect(await section.boundingBox()).toEqual(before);state.releaseScope();await expect.poll(()=>state.dataHeld).toBe(true);await expect(page.locator(content)).toContainText(text);expect(await section.boundingBox()).toEqual(before);
 state.releaseData();await expect(page.locator('#refresh')).toBeEnabled();await expect(page.locator(content)).toContainText(text);expect(state.scopeReads-reads).toBe(1);expect(await page.evaluate('refreshMarker && !hiddenDuringRefresh')).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);if(name==='projects'||name==='groups')await page.screenshot({path:`output/group-p0-refresh/refresh-${name}-${width}.png`});
});
for(const status of [403,503])test(`manual refresh ${status} ${status===403?'clears protected data':'retains the last successful view'}`,async({page,context})=>{
 const state=await setup(page,context);await page.locator('[data-admin-view=projects]').click();await expect(page.locator('#projects')).toContainText('Stable project');state.scopeStatus=status;await page.locator('#refresh').click();await expect(page.locator('#refresh')).toBeEnabled();
 if(status===403){await expect(page.locator('#projects')).toBeEmpty();await expect(page.locator('[data-admin-view]:visible')).toHaveCount(0);}else{await expect(page.locator('#projects')).toContainText('Stable project');await expect(page.locator('#admin-projects')).toBeVisible();state.scopeStatus=200;await page.locator('#refresh').click();await expect(page.locator('#refresh')).toBeEnabled();await expect(page.locator('#projects')).toContainText('Stable project');}
});
