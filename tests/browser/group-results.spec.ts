import {test,expect} from '@playwright/test';
const alice='ffffffff-ffff-4fff-8fff-ffffffffffff',bob='11111111-1111-4111-8111-111111111111';
async function render(page:any,variant='reversed'){
 await page.route('**/api/**',(route:any)=>route.fulfill({status:401,json:{error:'NOT_AUTHENTICATED'}}));
 await page.goto('/office/noida');
 // Exercise the actual renderer with confirmed synthetic results, without issuing identities.
 const rows=[{clientPersonKey:bob,publicPassNumber:'GP-BOB',status:'DENIED',reused:false},{clientPersonKey:alice.toUpperCase(),publicPassNumber:'GP-ALICE',status:'APPROVED',reused:false}];
 if(variant==='unknown')rows[0].clientPersonKey='22222222-2222-4222-8222-222222222222';
 if(variant==='duplicate')rows[0].clientPersonKey=alice;
 await page.evaluate('state.mode="visitor";state.jobs='+JSON.stringify([{body:{requestType:'EXTERNAL'},people:[{key:alice,name:'Alice'},{key:bob,name:'Bob'}],result:{visits:rows}}])+';showResults();');
}
for(const width of [390,1366])test('group results bind reordered pass numbers and decisions to their person keys at '+width+'px',async({page})=>{
 await page.setViewportSize({width,height:844});await render(page);
 const cards=page.locator('#submission-results .result-card');await expect(cards).toHaveCount(2);
 await expect(cards.nth(0)).toContainText('Bob');await expect(cards.nth(0)).toContainText('GP-BOB');await expect(cards.nth(0).locator('.status-pill')).toHaveText('Denied');
 await expect(cards.nth(1)).toContainText('Alice');await expect(cards.nth(1)).toContainText('GP-ALICE');await expect(cards.nth(1).locator('.status-pill')).toHaveText('Approved');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
for(const variant of ['unknown','duplicate'])test('group results fail closed on '+variant+' participant bindings',async({page})=>{
 await render(page,variant);await expect(page.locator('#submission-results .result-card')).toHaveCount(0);await expect(page.locator('#submission-results')).toContainText('could not be matched');
});
