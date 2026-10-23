import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const id='11111111-1111-4111-8111-111111111111';
for(const width of [390,1366])test(`project creation is bound to authorized office and refreshes the list at ${width}px`,async({page,context})=>{
 await page.setViewportSize({width,height:844});await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 const writes:any[]=[];let created=false,deny=false,attempts=0;
 await page.route('**/api/admin/**',async route=>{
  const action=new URL(route.request().url()).pathname.split('/').at(-1),d=route.request().postDataJSON(),reply=(json:any)=>route.fulfill({json});
  if(action==='context')return reply({displayName:'Noida Administrator',locations:[{locationId:1,locationCode:'NOIDA',locationName:'Noida',canCreateProject:true}]});
  if(action==='scope')return reply({userId:id,currentDate:'2026-10-23',canReport:false,canReadVisits:false,canAudit:false,canAssignGuards:false,canManageRoles:true,roles:[{roleCode:'LOCATION_ADMIN',scopeType:'LOCATION'}],delegations:[]});
  if(action==='projects')return reply({projects:created?[{projectLocationId:'14',projectId:'9',projectName:'Digital Workplace Transformation',projectCode:'DWT-NOI',directoryCurrent:true,canAssignProject:false,canAssignLocation:true}]:[],cursor:null});
  if(action==='create-project'){
   writes.push(d);attempts++;
   if(deny)return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});
   if(attempts===1)return route.fulfill({status:503,json:{error:'UNAVAILABLE'}});
   created=true;return reply({projectId:'9',projectLocationId:'14',locationId:1});
  }
  return reply({leads:[],cursor:null});
 });
 await page.goto('/admin');await page.getByRole('button',{name:'Add',exact:true}).click();await expect(page.locator('#new-project-office')).toHaveText('Location: Noida · Your authorized office scope');await expect(page.locator('#add-project-dialog select')).toHaveCount(1);
 await page.getByLabel('Project name',{exact:true}).fill('Digital Workplace Transformation');await page.getByLabel('Project code',{exact:true}).fill('dwt-noi');await page.getByLabel('Reason for adding this project',{exact:true}).fill('New workplace modernisation programme');
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.getByRole('button',{name:'Create project',exact:true}).click();await expect(page.locator('#new-project-status')).toContainText('Unable to complete');await page.getByRole('button',{name:'Create project',exact:true}).click();await expect(page.locator('#add-project-dialog')).toBeHidden();await expect(page.locator('#projects')).toContainText('Digital Workplace Transformation');await expect(page.locator('#console-project option[value="14"]')).toHaveCount(1);
 expect(writes).toHaveLength(2);expect(writes[0]).toEqual(writes[1]);expect(writes[0]).toMatchObject({locationId:1,projectCode:'DWT-NOI'});expect(Object.keys(writes[0]).sort()).toEqual(['clientKey','locationId','projectCode','projectName','reason']);
 await page.screenshot({path:`output/add-project-${width}.png`});
 // Permission revocation must remove the modal and clear all previously authorized data.
 await page.getByRole('button',{name:'Add',exact:true}).click();deny=true;await page.getByLabel('Project name',{exact:true}).fill('Denied project');await page.getByLabel('Project code',{exact:true}).fill('DENIED-NOI');await page.getByLabel('Reason for adding this project',{exact:true}).fill('Scope changed');await page.getByRole('button',{name:'Create project',exact:true}).click();await expect(page.locator('#add-project-dialog')).toBeHidden();await expect(page.locator('#add-project-open')).toBeHidden();await expect(page.locator('#projects')).toBeEmpty();
});

test('project-scoped admin cannot open sibling project creation',async({page,context})=>{
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 await page.route('**/api/admin/**',async route=>{const action=new URL(route.request().url()).pathname.split('/').at(-1),d=route.request().postDataJSON();
  if(action==='context')return route.fulfill({json:{displayName:'Project Lead',locations:[{locationId:1,locationName:'Noida',locationCode:'NOIDA',canCreateProject:false}]}});
  if(action==='projects')return route.fulfill({json:{projects:[{projectLocationId:'14',projectId:'9',projectName:'Assigned project',projectCode:'ASSIGNED',directoryCurrent:true,canAssignProject:false,canAssignLocation:true}],cursor:null}});
  if(action==='scope'&&!d.projectLocationId)return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});
  if(action==='scope')return route.fulfill({json:{userId:id,currentDate:'2026-10-23',canReport:false,canReadVisits:false,canAudit:false,canAssignGuards:true,canManageRoles:true,roles:[{roleCode:'PROJECT_ADMIN',scopeType:'PROJECT_LOCATION'}],delegations:[]}});
  return route.fulfill({json:{leads:[],cursor:null}});
 });
 await page.goto('/admin');await expect(page.locator('#projects')).toContainText('Assigned project');await expect(page.locator('#add-project-open')).toBeHidden();await expect(page.locator('#add-project-dialog')).toBeHidden();
});
