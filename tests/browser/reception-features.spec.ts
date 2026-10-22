import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const id='11111111-1111-4111-8111-111111111111';
for(const width of [390,1366])test(`reception profile, history, host and expired pass controls at ${width}px`,async({page,context})=>{
 await page.setViewportSize({width,height:844});
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 const base={visitRequestId:id,accessPassId:id,personName:'Synthetic Employee',employeeId:'EMP001',requestType:'EMPLOYEE_PROJECT',publicReference:'V-SYN',publicPassNumber:'P-SYN',status:'APPROVED',passStatus:'ACTIVE',projectName:'Destination Project',hostName:'Actual Host',hostEmail:'actual.host@example.com',isInside:false,validFromUtc:new Date(Date.now()-86400000).toISOString(),validUntilUtc:new Date(Date.now()-3600000).toISOString(),submittedAtUtc:new Date().toISOString(),printCount:0};
 const dates:string[]=[];let previews=0;
 await page.route('**/api/reception/**',async route=>{const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();
  if(path.endsWith('/me'))return route.fulfill({json:{displayName:'Reception Operator',currentDate:'2026-10-22',locations:[{locationId:1,locationCode:'NOIDA',locationName:'Noida',canPrint:true}]}});
  if(path.endsWith('/list')){dates.push(body.visitDate);return route.fulfill({json:{visits:[base],cursor:null}});}
  if(path.endsWith('/detail'))return route.fulfill({json:{...base,locationName:'Noida',reason:'Meeting',photoAvailable:false,movements:[{accessEventId:'2',eventType:'EXIT',entryMethod:'RECONCILE',guardName:'Exit Guard',occurredAtUtc:'2026-10-22T08:00:00Z'},{accessEventId:'1',eventType:'ENTRY',entryMethod:'SCAN',guardName:'Entry Guard',occurredAtUtc:'2026-10-22T07:00:00Z'}],movementsHasMore:false}});
  if(path.endsWith('/preview'))previews++;
  return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});
 });
 await page.goto('/reception');await expect(page.locator('#visit-rows tr')).toHaveCount(1);
 await expect(page.locator('.cell-host')).toContainText('Actual Host');await expect(page.locator('.cell-host')).toContainText('actual.host@example.com');
 await expect(page.locator('.cell-actions .primary')).toBeHidden();await expect(page.locator('#reception-date')).toBeHidden();
 await page.locator('#account-toggle').click();await expect(page.getByText('Language',{exact:true})).toHaveCount(0);await page.locator('#open-profile').click();await expect(page.locator('#profile-dialog')).toContainText('Reception Operator');await expect(page.locator('#profile-offices')).toContainText('Noida · View and print');await page.locator('#close-profile').click();
 await page.locator('#open-history').click();await page.locator('#history-date').fill('2026-10-20');await page.locator('#history-date').press('Tab');await expect.poll(()=>dates.includes('2026-10-20')).toBe(true);await expect(page.locator('#reception-date')).toHaveValue('2026-10-22');await expect(page.locator('#history-rows .history-row')).not.toHaveCount(0);await page.locator('#history-dialog').evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished));});if(width===1366){const r=await page.locator('.history-range').evaluate(el=>{const input=el.querySelector('input')!.getBoundingClientRect(),button=el.querySelector('button')!.getBoundingClientRect();return{inputBottom:input.bottom,buttonBottom:button.bottom};});expect(Math.abs(r.inputBottom-r.buttonBottom)).toBeLessThan(3);}await page.screenshot({path:`output/reception-history-${width}.png`});await page.locator('#close-history').click();
 await page.locator('.visit-person').click();await expect(page.locator('#detail-fields')).toContainText('Actual Host');await expect(page.locator('#detail-fields')).toContainText('actual.host@example.com');await expect(page.locator('#detail-fields .info').filter({hasText:'Actual Host'})).toContainText('actual.host@example.com');await expect(page.locator('#detail-print')).toBeHidden();expect(previews).toBe(0);
 await expect(page.locator('#detail-timeline li')).toHaveCount(2);await expect(page.locator('#detail-timeline li').first()).toContainText('Entry Guard');await expect(page.locator('#detail-timeline li').last()).toContainText('Reconciled exit');
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('manual registration embeds the real isolated intake form and stops its frame on close',async({page,context})=>{
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 const calls:string[]=[];
 await page.route('**/api/reception/**',async route=>{const path=new URL(route.request().url()).pathname;calls.push(path);
  if(path.endsWith('/me'))return route.fulfill({json:{displayName:'Reception Test',currentDate:'2026-10-22',locations:[{locationId:1,locationCode:'NOIDA',locationName:'Noida',canPrint:true}]}});
  if(path.endsWith('/list'))return route.fulfill({json:{visits:[],cursor:null}});
  if(path.endsWith('/manual/options'))return route.fulfill({json:{locationId:1,locationCode:'NOIDA',locationName:'Noida',currentDate:'2026-10-22',maxVisitDate:'2027-01-20',projects:[{projectLocationId:'1',projectName:'Project One'}]}});
  return route.fulfill({json:{ok:true}});
 });
 await page.goto('/reception');await expect(page.locator('#stat-total')).toHaveText('0');await page.locator('#assistedFab').click();
 const frame=page.frameLocator('#manual-content iframe');await expect(frame.getByRole('textbox',{name:/^Name/})).toBeEnabled();await frame.getByRole('textbox',{name:/^Name/}).fill('Synthetic Visitor');await frame.getByRole('textbox',{name:/^Mobile/}).fill('9876543210');await frame.getByRole('button',{name:'Continue',exact:true}).click();await expect(frame.locator('#project')).toBeEnabled();await expect(frame.locator('#purpose option').filter({hasText:/^(Contractor|Support staff)$/})).toHaveCount(2);await frame.locator('#purpose-trigger').click();await frame.getByRole('option',{name:'Contractor',exact:true}).click();await expect(frame.locator('#purpose')).toHaveValue('Contractor');
 expect(calls).toContain('/api/reception/manual/start');expect(calls.some(c=>c.startsWith('/api/registration/'))).toBe(false);
 await page.locator('#close-assisted').click();await expect(page.locator('#manual-content iframe')).toHaveCount(0);
});

 test('reception retains rows during refresh, opens the row and queues an idempotent host reminder',async({page,context})=>{
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 const base={visitRequestId:id,accessPassId:id,personName:'Reminder Visitor',requestType:'EXTERNAL',publicReference:'V-REMINDER',publicPassNumber:'P-REMINDER',status:'PENDING',passStatus:'PENDING',projectName:'Project One',hostName:'Actual Host',hostEmail:'host@example.com',isInside:false,validFromUtc:new Date(Date.now()-3600000).toISOString(),validUntilUtc:new Date(Date.now()+3600000).toISOString(),submittedAtUtc:new Date().toISOString(),printCount:0};
 let hold=false,release:()=>void=()=>{},queued=false,actions=0;const dates:string[]=[];
 await page.route('**/api/reception/**',async route=>{const path=new URL(route.request().url()).pathname,d=route.request().postDataJSON();
 if(path.endsWith('/me'))return route.fulfill({json:{displayName:'Reception',currentDate:'2026-10-22',locations:[{locationId:1,locationCode:'NOIDA',locationName:'Noida',canPrint:false}]}});
 if(path.endsWith('/list')){dates.push(d.visitDate);if(hold)await new Promise<void>(r=>release=r);return route.fulfill({json:{visits:[base],cursor:null}});}
 if(path.endsWith('/detail'))return route.fulfill({json:{...base,locationName:'Noida',reason:'Visit',photoAvailable:false,movements:[]}});
 if(path.endsWith('/remind-host')){if(d.clientKey){expect(d.visitRequestId).toBe(id);actions++;queued=true;}return route.fulfill({json:{eligible:true,outcome:d.clientKey?'QUEUED':'STATUS',mailStatus:queued?'QUEUED':'SENT',lastQueuedAtUtc:'2026-10-21T00:00:00.000Z',nextReminderAtUtc:'2026-10-21T00:05:00.000Z'}});}
 return route.fulfill({status:400});});
 await page.goto('/reception');await expect(page.locator('#stat-total')).toHaveText('1');hold=true;await page.locator('#refresh').click();await expect(page.locator('#visit-rows tr')).toHaveCount(1);await expect(page.locator('#stat-total')).toHaveText('1');await expect(page.locator('#stat-pending')).toHaveText('1');hold=false;release();await expect(page.locator('#refresh')).toBeEnabled();
 await page.locator('.cell-project').click();await expect(page.locator('#visit-dialog')).toBeVisible();await expect(page.locator('#remind-host')).toBeEnabled();await page.locator('#remind-host').click();await expect(page.locator('#remind-host')).toBeDisabled();expect(actions).toBe(1);await expect(page.locator('#reminder-status')).toContainText('queued');
 await page.locator('#close-visit').click();await page.reload();await expect(page.locator('#stat-total')).toHaveText('1');
 await page.locator('#open-history').click();await page.locator('#history-date').fill('2026-10-20');await page.locator('#history-end').fill('2026-10-21');await page.locator('#refresh-history').click();await expect(page.locator('#history-status')).toHaveText('2 registrations');expect(dates).toContain('2026-10-20');expect(dates).toContain('2026-10-21');
 await page.locator('#history-date').fill('2026-10-22');await expect(page.locator('#history-status')).toHaveText('From date must be on or before To date.');
 });
