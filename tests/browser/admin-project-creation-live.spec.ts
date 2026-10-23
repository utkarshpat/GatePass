import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const run=randomUUID();
function fixture(action:string){return execFileSync('pwsh',['-NoProfile','-File','tests/browser/AdminConsoleFixture.ps1','-RunId',run,'-Action',action],{encoding:'utf8',timeout:60000});}
test('real office admin creates a project, sees it after reload and can assign its lead and guard',async({page,context})=>{
 test.setTimeout(180000);
 try{
  const f=JSON.parse(fixture('Create')),code=(f.prefix+'-C').toUpperCase();
  await page.goto('/');await page.getByRole('textbox',{name:'Email or Staff ID',exact:true}).fill(f.login);await page.getByRole('textbox',{name:'Password',exact:true}).fill('Sopra@123');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/\/admin$/u);await expect(page.locator('#summary-cards .admin-stat')).toHaveCount(4);
  await page.locator('[data-admin-view="projects"]').click();await page.getByRole('button',{name:'Add project',exact:true}).click();await expect(page.locator('#new-project-office')).toContainText('Noida');await page.getByLabel('Project name',{exact:true}).fill('Owned Workplace Transformation');await page.getByLabel('Project code',{exact:true}).fill(code);await page.getByLabel('Reason for adding this project',{exact:true}).fill('Office programme approved by local administration');await page.getByRole('button',{name:'Create project',exact:true}).click();await expect(page.locator('#add-project-dialog')).toBeHidden();
  const card=page.locator('#projects .project-row').filter({hasText:code});await expect(card).toBeVisible();await page.reload();await page.locator('[data-admin-view="projects"]').click();await expect(card).toBeVisible();
  await card.getByRole('button',{name:'Project leads',exact:true}).click();await page.locator('#employee-search').fill(f.prefix+'-OTHERHOST');await page.locator('#employee-results button').click();await page.locator('#grant-reason').fill('Lead for new office programme');await page.locator('#add-lead').click();await expect(page.locator('#lead-list')).toContainText('Synthetic OTHERHOST');await page.locator('#close-leads').click();
  await page.locator('[data-admin-view="assignments"]').click();await page.locator('#assign-guard-open').click();await page.locator('#allocation-project').selectOption({label:'Owned Workplace Transformation · '+code});await page.locator('#allocation-guard').selectOption(f.guard.toLowerCase());await page.locator('#allocation-reason').fill('Security duty for new office programme');await page.locator('#allocate-button').click();await expect(page.locator('#assign-dialog')).toBeHidden();await expect(page.locator('#assignment-list > [data-user-id="'+f.guard.toLowerCase()+'"]')).toContainText('Owned Workplace Transformation');
  // Exercise the real HTTP boundary with a forged office and the same authenticated cookies.
  const csrf=(await context.cookies()).find(c=>c.name==='gp-staff-csrf')!.value;
  const forged=await page.request.post('/api/admin/create-project',{headers:{'X-CSRF-Token':csrf,Origin:'http://localhost:18447'},data:{locationId:f.otherLocationId,projectName:'Foreign Office Project',projectCode:'FOREIGN-'+run.slice(0,8).toUpperCase(),reason:'Must be denied',clientKey:randomUUID()}});expect(forged.status()).toBe(403);
 }finally{fixture('Cleanup');}
});
