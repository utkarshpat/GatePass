import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const visit='11111111-1111-4111-8111-111111111111',pass='22222222-2222-4222-8222-222222222222';
for(const width of [390,1366])test(`printed pass returns and older pending return queue at ${width}px`,async({page,context})=>{
 await page.setViewportSize({width,height:844});await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 let returned=false,inside=true,fail=false;const keys:string[]=[],queues:boolean[]=[];
 const row=()=>({visitRequestId:visit,accessPassId:pass,personName:'Synthetic Return Visitor',requestType:'EXTERNAL',publicReference:'V-RETURN',publicPassNumber:'P-RETURN',status:'APPROVED',passStatus:returned?'REVOKED':'ACTIVE',projectName:'Project One',hostName:'Test Host',hostEmail:'host@example.com',isInside:inside,validFromUtc:'2026-10-20T01:00:00.000Z',validUntilUtc:'2026-10-21T18:30:00.000Z',submittedAtUtc:'2026-10-20T00:00:00.000Z',printCount:3,returnedAtUtc:returned?'2026-10-22T12:00:00.000Z':null});
 await page.route('**/api/reception/**',async route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();
  if(path.endsWith('/me'))return route.fulfill({json:{displayName:'Reception Operator',currentDate:'2026-10-22',locations:[{locationId:1,locationCode:'NOIDA',locationName:'Noida',canPrint:true}]}});
  if(path.endsWith('/list')){queues.push(body.pendingReturns===true);return route.fulfill({json:{visits:body.pendingReturns&&!returned?[row()]:[],pendingReturnCount:returned?0:1,cursor:null}});}
  if(path.endsWith('/return')){keys.push(body.clientKey);expect(body.visitRequestId).toBe(visit);expect(body.expectedPassId).toBe(pass);if(fail)return route.fulfill({status:503,json:{error:'UNAVAILABLE'}});returned=true;return route.fulfill({json:{visitRequestId:visit,accessPassId:pass,returnedAtUtc:'2026-10-22T12:00:00.000Z'}});}
  return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});
 });
 await page.goto('/reception');await expect(page.locator('#stat-returns')).toHaveText('1');await expect(page.locator('#visit-rows tr')).toHaveCount(0);
 await page.locator('#kpi-returns').click();await expect(page.locator('#visit-rows tr')).toHaveCount(1);await expect(page.getByRole('button',{name:'Mark printed pass returned for Synthetic Return Visitor'})).toBeDisabled();await expect(page.locator('.cell-actions .primary')).toBeHidden();
 inside=false;await page.locator('#refresh').click();const button=page.getByRole('button',{name:'Mark printed pass returned for Synthetic Return Visitor'});await expect(button).toBeEnabled();
 fail=true;await button.click();await expect(button).toBeEnabled();expect(keys).toHaveLength(1);fail=false;await button.click();await expect(page.locator('#stat-returns')).toHaveText('0');await expect(page.locator('#visit-rows tr')).toHaveCount(0);expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);expect(queues).toContain(true);
 // History retains the returned receipt and never offers print/return actions again.
 await page.unroute('**/api/reception/**');await page.route('**/api/reception/list',route=>route.fulfill({json:{visits:[row()],pendingReturnCount:0,cursor:null}}));
 await page.locator('#kpi-total').click();await expect(page.locator('.cell-card')).toHaveText('Returned');await expect(page.locator('.return-pass')).toHaveCount(0);await expect(page.locator('.cell-actions .primary')).toBeHidden();
 const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(a11y.violations.map(v=>v.id)).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:`output/reception-returns-${width}.png`});
});
