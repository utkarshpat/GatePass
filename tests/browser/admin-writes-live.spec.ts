import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const run=randomUUID();
function fixture(action:string){return execFileSync('pwsh',['-NoProfile','-File','tests/browser/AdminConsoleFixture.ps1','-RunId',run,'-Action',action],{encoding:'utf8',timeout:60000});}
test('real reception-independent admin UI grants and revokes a lead, allocates and removes a guard, creates a common area',async({page})=>{
 test.setTimeout(180000);
 let f:any;
 try{
  f=JSON.parse(fixture('Create'));
  await page.goto('/');await page.getByRole('textbox',{name:'Email or Staff ID',exact:true}).fill(f.login);await page.getByRole('textbox',{name:'Password',exact:true}).fill('Sopra@123');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/\/admin$/u);await expect(page.locator('#summary-cards .admin-stat')).toHaveCount(5);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await expect(page.locator('#console-project option[value="'+f.pair+'"]')).toHaveCount(1);
  await page.locator('#console-project').selectOption(f.pair);
  await page.locator('[data-admin-view="projects"]').click();
  const project=page.locator('#projects .project-row').filter({hasText:f.prefix+'-A'});await project.getByRole('button',{name:'Project leads'}).click();
  await page.locator('#employee-search').fill(f.prefix+'-OTHERHOST');await page.locator('#employee-results button').click();await page.locator('#grant-reason').fill('Owned admin UI audit');await page.locator('#add-lead').click();await expect(page.locator('#lead-list')).toContainText('Synthetic OTHERHOST');await page.locator('#lead-list button').click();await page.locator('#remove-reason').fill('Owned audit cleanup');await page.locator('#remove-form button[type=submit]').click();await expect(page.locator('#lead-status')).toContainText('No project leads');await page.locator('#close-leads').click();
  await page.locator('[data-admin-view="staff"]').click();await page.locator('#subject-search').fill('Synthetic OTHERHOST');await page.locator('#subject-form button').click();await page.getByRole('button',{name:'Manage access',exact:true}).click();await page.locator('#staff-role').selectOption({label:'Reception · Location'});await page.locator('#staff-reason').fill('Owned reception-role audit');await page.locator('#staff-grant').click();await expect(page.locator('#staff-roles')).toContainText('Reception');await page.getByRole('button',{name:'Revoke',exact:true}).click();await page.locator('#admin-confirm-reason').fill('End owned test role');await page.locator('#admin-confirm-submit').click();await expect(page.locator('#staff-roles')).toContainText('No roles');
  // GUARD2 is already on Alpha; removing and allocating it again exercises both real writes.
  await page.locator('[data-admin-view="assignments"]').click();const guard=page.locator('#assignment-list > .admin-row').filter({hasText:'Synthetic GUARD2'});await guard.getByRole('button',{name:'Remove',exact:true}).click();await page.locator('#admin-confirm-reason').fill('Owned shift change');await page.locator('#admin-confirm-submit').click();await expect(guard).toHaveCount(0);await page.locator('#guards-load').click();await page.locator('#allocation-guard').selectOption(f.guard);await page.locator('#allocation-reason').fill('Owned guard audit');await page.locator('#allocate-button').click();await expect(guard).toHaveCount(1);
  await page.locator('#common-duties-open').click();await page.getByRole('tab',{name:'New Area',exact:true}).click();await page.locator('#common-name').fill(f.prefix+' UI area');await page.locator('#common-create-reason').fill('Owned area audit');await page.locator('#common-create button[type=submit]').click();await expect(page.locator('#common-area')).toContainText(f.prefix+' UI area');
  expect(errors).toEqual([]);
 }finally{fixture('Cleanup');}
});
