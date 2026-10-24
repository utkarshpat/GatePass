import{summaryRange}from'./summary-fixture.ts';
import {test,expect} from '@playwright/test';
const id='11111111-1111-4111-8111-111111111111';
test('admin initializes from server date, preserves filters on refresh and hides unsupported modules',async({page,context})=>{
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 const summaries:any[]=[];
 await page.route('**/api/admin/**',async route=>{
  const action=route.request().url().split('/').at(-1),body=route.request().postDataJSON();
  const responses:any={context:{displayName:'Scoped administrator',locations:[{locationId:1,locationCode:'NOIDA',locationName:'Noida',canManageCommonAreas:false}]},projects:{projects:['10','20'].map(n=>({projectLocationId:n,projectId:n,projectName:'Project '+n,projectCode:n,directoryCurrent:true,canAssignProject:false,canAssignLocation:false})),cursor:null},scope:{userId:id,currentDate:'2030-06-15',canReport:true,canReadVisits:false,canAudit:false,canManageRoles:false,canAssignGuards:false,roles:[{roleCode:'LOCATION_ADMIN',scopeType:'LOCATION'}],delegations:[]},summary:{visits:{total:'0',pending:'0',approved:'0',denied:'0',cancelled:'0'},recordedPresence:{projectVisitsInside:'0',digitalIdsInside:'0'}}};
  if(action==='summary-range'){summaries.push(body);await route.fulfill({json:summaryRange(body,responses.summary)});return;}await route.fulfill({json:responses[action!]});
 });
 await page.goto('/admin');await expect(page.locator('#summary-cards article')).toHaveCount(4);await expect(page.locator('#overview-to')).toHaveValue('2030-06-15');await expect(page.locator('#overview-from')).toHaveValue('2030-06-15');await expect(page.locator('#chart-status svg')).toBeVisible();await expect(page.locator('#summary-cards')).not.toContainText('Cancelled');
 for(const key of ['staff','assignments','reports','audit'])await expect(page.locator('[data-admin-view='+key+']')).toBeHidden();
 await page.locator('#console-project').selectOption('20');await expect(page.locator('#summary-cards article')).toHaveCount(4);await page.locator('#overview-to').fill('2030-06-14');await expect(page.locator('#overview-from')).toHaveValue('2030-06-14');await expect.poll(()=>summaries.at(-1)?.to).toBe('2030-06-14');await page.locator('#refresh').click();await expect(page.locator('#summary-cards article')).toHaveCount(4);await expect(page.locator('#console-project')).toHaveValue('20');await expect(page.locator('#overview-to')).toHaveValue('2030-06-14');expect(summaries.at(-1)).toMatchObject({projectLocationId:'20',from:'2030-06-14',to:'2030-06-14'});
 await page.locator('#overview-from').fill('2030-06-10');await expect(page.locator('#chart-trend svg.chart-columns')).toBeVisible();await expect.poll(()=>summaries.at(-1)).toMatchObject({from:'2030-06-10',to:'2030-06-14'});
});

test('admin clears protected dialogs, lists and navigation after a fresh authorization denial',async({page,context})=>{
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 let denied=false;
 await page.route('**/api/admin/**',async route=>{
  const action=route.request().url().split('/').at(-1);if(action==='leads'&&denied)return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});
  const responses:any={context:{displayName:'Scoped administrator',locations:[{locationId:1,locationCode:'NOIDA',locationName:'Noida',canManageCommonAreas:true}]},projects:{projects:[{projectLocationId:'1',projectId:'1',projectName:'Private project',projectCode:'PRIVATE',directoryCurrent:true,canAssignProject:false,canAssignLocation:true}],cursor:null},scope:{userId:id,currentDate:'2030-06-15',canReport:false,canReadVisits:false,canAudit:false,canManageRoles:true,canAssignGuards:false,roles:[{roleCode:'LOCATION_ADMIN',scopeType:'LOCATION'}],delegations:[]},leads:{leads:[{roleGrantId:'1',displayName:'Protected lead',employeeId:'EMP001',email:'private@example.invalid',scopeType:'PROJECT_LOCATION',canRemove:true}],cursor:null}};
  await route.fulfill({json:responses[action!]});
 });
 await page.goto('/admin');await page.getByRole('button',{name:'Project leads',exact:true}).click();await expect(page.locator('#lead-list')).toContainText('Protected lead');await page.locator('#close-leads').click();denied=true;await page.getByRole('button',{name:'Project leads',exact:true}).click();await expect(page.locator('#lead-dialog')).not.toBeVisible();await expect(page.locator('#lead-list')).toBeEmpty();await expect(page.locator('#projects')).toBeEmpty();await expect(page.locator('[data-admin-view]:visible')).toHaveCount(0);await expect(page.locator('.area-card')).toHaveCount(0);await expect(page.locator('#page-status')).toContainText('permissions changed');
});
