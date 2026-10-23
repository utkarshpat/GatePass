import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {execFileSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
const id='11111111-1111-4111-8111-111111111111';
for(const width of [390,1366])test(`register combines filters, sorts the full result and pages without losing scope at ${width}px`,async({page,context})=>{
 await page.setViewportSize({width,height:844});await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 const calls:any[]=[];let deny=false;
 await page.route('**/api/admin/**',async route=>{
  const action=route.request().url().split('/').at(-1),d=route.request().postDataJSON();
  const responses:any={context:{displayName:'Scoped Admin',locations:[{locationId:1,locationCode:'NOIDA',locationName:'Noida',canManageCommonAreas:false}]},projects:{projects:[{projectLocationId:'10',projectId:'10',projectName:'Project Alpha',projectCode:'A',canAssignProject:false,canAssignLocation:false}],cursor:null},scope:{userId:id,currentDate:'2026-10-22',canReport:false,canReadVisits:true,canAudit:false,canManageRoles:false,canAssignGuards:false,roles:[{roleCode:'LOCATION_ADMIN',scopeType:'LOCATION'}],delegations:[]}};
  if(action==='register'){calls.push(d);if(deny)return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});return route.fulfill({json:{rows:[{visitRequestId:id,personName:d.page===2?'Visitor page two':'Visitor page one',projectName:'Project Alpha',status:'APPROVED',presence:'OUTSIDE',printStatus:'NOT_PRINTED',publicReference:'V-TEST',hostName:'Synthetic Host'}],total:51,page:d.page,pageSize:50}});}
  return route.fulfill({json:responses[action!]});
 });
 await page.goto('/admin');await page.locator('[data-admin-view=reports]').click();await expect(page.locator('#report-list')).toContainText('Visitor page one');
 await page.locator('#console-project').selectOption('10');await expect.poll(()=>calls.at(-1)?.projectLocationId).toBe('10');
 await page.locator('#register-add-filter').click();await page.getByRole('combobox',{name:'Filter field',exact:true}).selectOption('status');await page.getByRole('combobox',{name:'Filter value',exact:true}).selectOption('APPROVED');await page.locator('#report-reference').fill('V-');await page.locator('#register-apply').click();await expect.poll(()=>calls.at(-1)?.filters).toEqual({status:'APPROVED',publicReference:'V-'});
 await page.locator('#register-head').getByRole('button',{name:'Name',exact:true}).click();await expect.poll(()=>calls.at(-1)?.sort).toBe('personName');expect(calls.at(-1)).toMatchObject({page:1,direction:'ASC',locationId:1,projectLocationId:'10'});
 await page.locator('#reports-more').click();await expect(page.locator('#report-list')).toContainText('Visitor page two');expect(calls.at(-1)).toMatchObject({page:2,filters:{status:'APPROVED',publicReference:'V-'},sort:'personName'});await page.locator('#register-previous').click();await expect(page.locator('#report-list')).toContainText('Visitor page one');
 await page.getByText('Columns',{exact:true}).click();await page.locator('#register-columns').getByLabel('Email',{exact:true}).check();await expect(page.locator('#register-head')).toContainText('Email');
 const axe=await new AxeBuilder({page}).include('#admin-reports').withTags(['wcag2a','wcag2aa']).analyze();expect(axe.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 deny=true;await page.locator('#register-apply').click();await expect(page.locator('#report-list')).toBeEmpty();await expect(page.locator('[data-admin-view=reports]')).toBeHidden();
});

test('live SQL register filters and sorts owned records through the authenticated admin API',async({page})=>{
 test.setTimeout(90000);const run=randomUUID();const fixture=(action:string)=>execFileSync('pwsh',['-NoProfile','-File','tests/browser/AdminConsoleFixture.ps1','-RunId',run,'-Action',action],{encoding:'utf8',timeout:60000});
 try{const f=JSON.parse(fixture('Create'));await page.goto('/');await page.getByRole('textbox',{name:'Email or Staff ID',exact:true}).fill(f.login);await page.getByRole('textbox',{name:'Password',exact:true}).fill('Sopra@123');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/\/admin$/u);await page.locator('[data-admin-view=reports]').click();await page.locator('#report-reference').fill(f.prefix);await page.locator('#register-apply').click();await expect(page.locator('#report-status')).toContainText('matching visits');await expect(page.locator('#report-list tr')).toHaveCount(24);
 await page.locator('#register-add-filter').click();await page.getByRole('combobox',{name:'Filter field',exact:true}).selectOption('status');await page.getByRole('combobox',{name:'Filter value',exact:true}).selectOption('PENDING');await page.locator('#register-apply').click();await expect(page.locator('#report-list tr')).toHaveCount(9);await page.locator('#register-sort').selectOption('personName');await page.locator('#register-direction').selectOption('ASC');await page.locator('#register-apply').click();await expect(page.locator('#register-head th[aria-sort=ascending]')).toContainText('Name');await page.locator('#report-list button').first().click();await expect(page.locator('#admin-visit-dialog')).toBeVisible();await expect(page.locator('#admin-visit-fields')).toContainText('Synthetic');
 }finally{fixture('Cleanup');}
});
