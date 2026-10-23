import {test,expect} from '@playwright/test';
const id='11111111-1111-4111-8111-111111111111';
const scope={userId:id,currentDate:'2026-10-23',canReport:false,canReadVisits:false,canAudit:false,canAssignGuards:true,canManageRoles:true,roles:[],delegations:[]};
test('common area permission loss clears cards, fixed area and assignment dialog',async({page,context})=>{
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));let denied=false;
 await page.route('**/api/admin/**',async route=>{const action=new URL(route.request().url()).pathname.split('/').at(-1),reply=(json:any)=>route.fulfill({json});
  if(action==='context')return reply({displayName:'Noida Admin',locations:[{locationId:1,locationName:'Noida',locationCode:'NOIDA',canManageCommonAreas:true,canCreateProject:false}]});
  if(action==='scope')return reply(scope);if(action==='projects')return reply({projects:[],cursor:null});
  if(action==='common-duties'){if(denied)return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});return reply({areas:[{areaId:'3',name:'Private Reception'}],guards:[],assignments:[],hasMore:false});}
  return reply({});
 });
 await page.goto('/admin');await expect(page.locator('.area-card')).toContainText('Private Reception');denied=true;await page.getByRole('button',{name:'Assign guard to Private Reception',exact:true}).click();await expect(page.locator('#common-dialog')).toBeHidden();await expect(page.locator('#projects')).toBeEmpty();await expect(page.locator('#common-area')).toBeEmpty();await expect(page.locator('#add-project-open')).toBeHidden();await expect(page.locator('[data-admin-view]:visible')).toHaveCount(0);
});

test('late common areas from a previous office cannot replace the new office catalogue',async({page,context})=>{
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));let release:(()=>void)|undefined;const blocked=new Promise<void>(resolve=>{release=resolve;});let oldRequested=false;
 await page.route('**/api/admin/**',async route=>{const action=new URL(route.request().url()).pathname.split('/').at(-1),d=route.request().postDataJSON(),reply=(json:any)=>route.fulfill({json});
  if(action==='context')return reply({displayName:'India Admin',locations:[{locationId:1,locationName:'Noida',locationCode:'NOIDA',canManageCommonAreas:true},{locationId:2,locationName:'Chennai',locationCode:'CHENNAI',canManageCommonAreas:true}]});
  if(action==='scope')return reply(scope);if(action==='projects')return reply({projects:[],cursor:null});
  if(action==='common-duties'){if(d.locationId===1){oldRequested=true;await blocked;}return reply({areas:[{areaId:String(d.locationId),name:d.locationId===1?'Noida Private Lobby':'Chennai Reception'}],guards:[],assignments:[],hasMore:false});}
  return reply({});
 });
 await page.goto('/admin');await expect.poll(()=>oldRequested).toBe(true);await page.locator('#admin-office-trigger').click();await page.getByRole('option',{name:'Chennai',exact:true}).click();await expect(page.locator('.area-card')).toContainText('Chennai Reception');release!();await expect(page.locator('#common-catalog-status')).toBeEmpty();await expect(page.locator('.area-card')).toHaveCount(1);await expect(page.locator('#projects')).not.toContainText('Noida Private Lobby');await page.getByRole('button',{name:'Assign guard to Chennai Reception',exact:true}).click();await expect(page.locator('#common-title')).toHaveText('Chennai Reception · Chennai');
});
