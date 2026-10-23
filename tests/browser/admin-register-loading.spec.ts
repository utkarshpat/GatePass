import {test,expect} from '@playwright/test';
const id='11111111-1111-4111-8111-111111111111';
test('register honours sorting during initial loading and ignores the older response',async({page,context})=>{
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 let release:(()=>void)|undefined;const held=new Promise<void>(resolve=>{release=resolve;});const calls:any[]=[];let fail=false;
 await page.route('**/api/admin/**',async route=>{const action=route.request().url().split('/').at(-1),d=route.request().postDataJSON(),reply=(json:any)=>route.fulfill({json});
  if(action==='context')return reply({displayName:'Scoped Admin',locations:[{locationId:1,locationName:'Noida',locationCode:'NOIDA'}]});
  if(action==='projects')return reply({projects:[],cursor:null});
  if(action==='scope')return reply({userId:id,currentDate:'2026-10-23',canReport:false,canReadVisits:true,canAudit:false,canManageRoles:false,canAssignGuards:false,roles:[],delegations:[]});
  if(action==='register'){
   calls.push(d);const first=calls.length===1;if(first)await held;if(fail)return route.fulfill({status:503,json:{error:'UNAVAILABLE'}});
   return reply({rows:[{visitRequestId:id,personName:first?'Old arrival order':d.direction==='ASC'?'Aarav Sharma':'Meera Iyer',localVisitDate:'2026-10-23',submittedAtUtc:'2026-10-23T04:30:00.000Z',projectName:'Project 1',status:'APPROVED'}],total:1,page:1,pageSize:50});
  }
  return reply({});
 });
 await page.goto('/admin');await page.locator('[data-admin-view=reports]').click();await expect.poll(()=>calls.length).toBe(1);await expect(page.locator('#register-head')).toContainText('Registered at');await expect(page.locator('#report-list')).toContainText('Loading visit register');
 await page.locator('#register-sort').selectOption('personName');await page.locator('#register-direction').selectOption('ASC');await expect.poll(()=>calls.at(-1)?.direction).toBe('ASC');await expect(page.locator('#report-list')).toContainText('Aarav Sharma');await expect(page.locator('#report-status')).toContainText('Noida · All authorized projects');await expect(page.locator('#report-status')).toContainText('Sorted by Name (ascending)');release!();await expect(page.locator('#report-list')).not.toContainText('Old arrival order');
 fail=true;await page.locator('#register-apply').click();await expect(page.locator('#report-list')).toContainText('Visits could not be loaded');await expect(page.locator('#register-export')).toBeDisabled();await expect(page.locator('#register-apply')).toBeEnabled();fail=false;await page.locator('#register-apply').click();await expect(page.locator('#report-list')).toContainText('Aarav Sharma');
 await page.locator('#report-from').fill('2026-10-22');await page.locator('#report-from').press('Tab');await expect.poll(()=>calls.at(-1)?.from).toBe('2026-10-22');
});
