import {test,expect} from '@playwright/test';
const visit='33333333-3333-4333-8333-333333333333',pass='44444444-4444-4444-8444-444444444444';
const contextData={displayName:'Reception Test',currentDate:'2026-10-22',locations:[{locationId:1,locationName:'Noida',locationCode:'NOIDA',canPrint:true}]};
const base=()=>({visitRequestId:visit,accessPassId:pass,personName:'Synthetic Visitor',publicReference:'V-AUDIT',publicPassNumber:'P-AUDIT',requestType:'EXTERNAL',status:'PENDING',passStatus:'PENDING',isInside:false,validFromUtc:new Date(Date.now()-3600000).toISOString(),validUntilUtc:new Date(Date.now()+3600000).toISOString(),submittedAtUtc:new Date().toISOString(),projectName:'Project One',printCount:1});
async function signIn(context:any){await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));}

test('closed and expired approvals do not inflate pending counters or filters',async({page,context})=>{
 await signIn(context);const live=base(),rows=[live,{...live,visitRequestId:'55555555-5555-4555-8555-555555555555',returnedAtUtc:new Date().toISOString(),passStatus:'REVOKED'},{...live,visitRequestId:'66666666-6666-4666-8666-666666666666',validUntilUtc:new Date(Date.now()-1000).toISOString()}];
 await page.route('**/api/reception/**',route=>route.fulfill({json:route.request().url().endsWith('/me')?contextData:{visits:rows,pendingReturnCount:2,cursor:null}}));
 await page.goto('/reception');await expect(page.locator('#stat-total')).toHaveText('3');await expect(page.locator('#stat-pending')).toHaveText('1');await page.locator('#kpi-pending').click();await expect(page.locator('#visit-rows tr')).toHaveCount(1);await expect(page.locator('#stat-pending')).toHaveText('1');
});

test('opening a stale list row reads the current return receipt and print total',async({page,context})=>{
 await signIn(context);const row=base();
 await page.route('**/api/reception/**',route=>{
 const action=new URL(route.request().url()).pathname;
 if(action.endsWith('/me'))return route.fulfill({json:contextData});
 if(action.endsWith('/list'))return route.fulfill({json:{visits:[row],pendingReturnCount:0,cursor:null}});
 if(action.endsWith('/detail'))return route.fulfill({json:{...row,passStatus:'REVOKED',returnedAtUtc:'2026-10-22T11:00:00.000Z',printCount:4,locationName:'Noida',reason:'Visit',photoAvailable:false,movements:[]}});
 return route.fulfill({status:403});});
 await page.goto('/reception');await expect(page.locator('#visit-rows tr')).toHaveCount(1);await page.locator('.visit-person').click();await expect(page.locator('#detail-fields')).toContainText('Returned');await expect(page.locator('#detail-print-count')).toHaveText('4');await expect(page.locator('#detail-print')).toBeHidden();await page.locator('#close-visit').click();await expect(page.locator('.cell-card')).toHaveText('Returned');await expect(page.locator('.return-pass')).toHaveCount(0);
});

test('changing authorized context clears old office data and resets return filters even if the new office fails',async({page,context})=>{
 await signIn(context);let release:()=>void=()=>{};
 await page.route('**/api/reception/**',async route=>{
 if(route.request().url().endsWith('/me'))return route.fulfill({json:contextData});
 const body=route.request().postDataJSON();if(body.locationId===2){await new Promise<void>(r=>release=r);return route.fulfill({status:503});}
 return route.fulfill({json:{visits:[base()],pendingReturnCount:77,cursor:null}});
 });
 await page.goto('/reception');await expect(page.locator('#stat-returns')).toHaveText('77');await page.locator('#kpi-returns').click();await expect(page.locator('#refresh')).toBeEnabled();
 await page.evaluate(()=>{(window as any).setContext({displayName:'Reception Test',currentDate:'2026-10-22',locations:[{locationId:2,locationName:'Pune',locationCode:'PUNE',canPrint:true}]});});
 await expect(page.locator('#printFilter')).toHaveValue('ALL');await expect(page.locator('#typeFilter')).toHaveValue('ALL');await expect(page.locator('#visit-rows tr')).toHaveCount(0);await expect(page.locator('#stat-returns')).toHaveText('…');release();await expect(page.locator('#refresh')).toBeEnabled();
 await page.evaluate(()=>(window as any).renderRows());await expect(page.locator('#list-status')).toContainText('Could not update visits');await expect(page.locator('#stat-returns')).toHaveText('—');
});

test('a stalled reception request times out and releases refresh without clearing existing visits',async({page,context})=>{
 await page.clock.install();await signIn(context);let stalled=false;
 await page.route('**/api/reception/**',async route=>{
 if(route.request().url().endsWith('/me'))return route.fulfill({json:contextData});
 if(stalled)return new Promise<void>(()=>{});
 return route.fulfill({json:{visits:[base()],pendingReturnCount:1,cursor:null}});
 });
 await page.goto('/reception');await expect(page.locator('#visit-rows tr')).toHaveCount(1);stalled=true;await page.locator('#refresh').click();await page.clock.fastForward(31000);await expect(page.locator('#refresh')).toBeEnabled();await expect(page.locator('#visit-rows tr')).toHaveCount(1);await expect(page.locator('#list-status')).toContainText('Could not update visits');
});

test('revoked office visibility clears cached visitor rows rather than retaining them as a failed refresh',async({page,context})=>{
 await signIn(context);let revoked=false;
 await page.route('**/api/reception/**',route=>{
 if(route.request().url().endsWith('/me'))return route.fulfill({json:contextData});
 if(revoked)return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});
 return route.fulfill({json:{visits:[base()],pendingReturnCount:1,cursor:null}});
 });
 await page.goto('/reception');await expect(page.locator('#visit-rows tr')).toHaveCount(1);revoked=true;await page.locator('#refresh').click();await expect(page.locator('#visit-rows tr')).toHaveCount(0);await expect(page.locator('#stat-returns')).toHaveText('—');await expect(page.locator('#list-status')).toContainText('Access to this office is unavailable');await expect(page.locator('#refresh')).toBeEnabled();
});
