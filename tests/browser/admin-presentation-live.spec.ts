import {test,expect} from '@playwright/test';
import {statSync} from 'node:fs';
test('retained Noida presentation register loads, sorts, exports and opens visitor history',async({page})=>{
 test.skip(process.env.GATEPASS_RETAIN_DEMO!=='true','Requires the explicitly retained local presentation dataset.');
 test.setTimeout(120000);await page.setViewportSize({width:1366,height:900});
 await page.goto('/');await page.getByRole('textbox',{name:'Email or Staff ID',exact:true}).fill('admin2@example.com');await page.getByRole('textbox',{name:'Password',exact:true}).fill('Sopra@123');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/\/admin$/u);await expect(page.locator('#summary-cards .admin-stat')).toHaveCount(4);
 await page.locator('#console-project').selectOption({label:'Project 1 · DEMO-PRJ-001'});await page.locator('[data-admin-view=reports]').click();
 // Retained presentation history belongs to this date, independently of today's server date.
 await page.locator('#report-from').fill('2026-10-23');await page.locator('#report-to').fill('2026-10-23');await page.locator('#register-apply').click();
 await expect(page.locator('#report-status')).toContainText('matching visits');await expect(page.locator('#report-list')).toContainText('Aarav Sharma');await expect(page.locator('#report-list')).toContainText('Meera Iyer');
 await page.locator('#register-sort').selectOption('personName');await page.locator('#register-direction').selectOption('ASC');await expect(page.locator('#report-status')).toContainText('Sorted by Name (ascending)');await expect(page.locator('#report-list .register-name').first()).toHaveText('Aarav Sharma');await expect(page.locator('#register-head th[aria-sort=ascending]')).toContainText('Name');
 const scrollbar=await page.locator('.register-table-wrap').evaluate(el=>({width:getComputedStyle(el,'::-webkit-scrollbar').width,thumb:getComputedStyle(el,'::-webkit-scrollbar-thumb').backgroundColor}));expect(scrollbar).toEqual({width:'8px',thumb:'rgb(200, 16, 46)'});
 await page.screenshot({path:'output/presentation/visit-register-sorted-final.png',fullPage:true});
 const downloading=page.waitForEvent('download');await page.locator('#register-export').click();const download=await downloading;expect(download.suggestedFilename()).toMatch(/\.xlsx$/u);const file=await download.path();expect(file&&statSync(file).size).toBeGreaterThan(1000);
 await page.getByRole('button',{name:'Meera Iyer',exact:true}).click();await expect(page.locator('#admin-visit-dialog')).toBeVisible();await expect(page.locator('#admin-visit-fields')).toContainText('Meera Iyer');await expect(page.locator('#admin-visit-timeline')).toContainText('Entered premises');await page.screenshot({path:'output/presentation/visit-register-history-final.png'});await page.locator('[data-close=admin-visit-dialog]').click();
 await page.locator('[data-admin-view=projects]').click();await expect(page.locator('.area-card')).not.toHaveCount(0);await expect(page.getByRole('button',{name:'Add',exact:true})).toBeVisible();await page.screenshot({path:'output/presentation/unified-projects-areas-final.png',fullPage:true});
});
