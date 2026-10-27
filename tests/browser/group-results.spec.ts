import {test,expect} from '@playwright/test';
const person='ffffffff-ffff-4fff-8fff-ffffffffffff';
async function render(page:any,variant='valid'){
 await page.route('**/api/**',(route:any)=>route.fulfill({status:401,json:{error:'NOT_AUTHENTICATED'}}));
 await page.goto('/office/noida');
 // Separate employee project requests retain independent results; visitor groups are removed.
 const jobs=[{label:'Project Beta',body:{requestType:'EMPLOYEE_PROJECT'},people:[{key:person,name:'Alice'}],result:{visits:[{clientPersonKey:person.toUpperCase(),publicPassNumber:'GP-BETA',status:'DENIED',reused:false}]}},{label:'Project Alpha',body:{requestType:'EMPLOYEE_PROJECT'},people:[{key:person,name:'Alice'}],result:{visits:[{clientPersonKey:person,publicPassNumber:'GP-ALPHA',status:'APPROVED',reused:false}]}}];
 if(variant==='unknown')jobs[0].result.visits[0].clientPersonKey='22222222-2222-4222-8222-222222222222';
 if(variant==='duplicate')jobs[0].result.visits.push({...jobs[0].result.visits[0]});
 await page.evaluate('state.mode="employee";state.jobs='+JSON.stringify(jobs)+';showResults();');
}
for(const width of [390,1366])test('separate employee project results retain their own references and decisions at '+width+'px',async({page})=>{
 await page.setViewportSize({width,height:844});await render(page);
 const cards=page.locator('#submission-results .result-card');await expect(cards).toHaveCount(2);
 await expect(cards.nth(0)).toContainText('Project Beta');await expect(cards.nth(0)).toContainText('GP-BETA');await expect(cards.nth(0).locator('.status-pill')).toHaveText('Denied');
 await expect(cards.nth(1)).toContainText('Project Alpha');await expect(cards.nth(1)).toContainText('GP-ALPHA');await expect(cards.nth(1).locator('.status-pill')).toHaveText('Approved');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
for(const variant of ['unknown','duplicate'])test('request results fail closed on '+variant+' participant bindings',async({page})=>{
 await render(page,variant);await expect(page.locator('#submission-results .result-card')).toHaveCount(0);await expect(page.locator('#submission-results')).toContainText('could not be matched');
});
