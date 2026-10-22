import {test,expect} from '@playwright/test';
test.use({timezoneId:'America/New_York'});
async function setup(page:any,context:any){
 await context.addCookies([{name:'gp-staff-session',value:'synthetic',url:'http://localhost:18447'},{name:'gp-staff-csrf',value:'synthetic',url:'http://localhost:18447'}]);
 let day='2026-10-22',delay:Promise<void>|null=null;const dates:string[]=[];
 await page.route('**/api/reception/**',async(route:any)=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/me')){if(delay)await delay;return route.fulfill({json:{displayName:'Reception Test',currentDate:day,locations:[{locationId:1,locationName:'Noida',canPrint:true}]}});}
  const body=route.request().postDataJSON();dates.push(body.visitDate);return route.fulfill({json:{visits:[],visitDate:body.visitDate,cursor:null}});
 });
 await page.goto('/reception');await expect(page.locator('#stat-total')).toHaveText('0');
 return{day:(value:string)=>{day=value;},delay:(value:Promise<void>|null)=>{delay=value;},dates};
}
test('Today gets the new India day and updates bounds despite a different browser timezone',async({page,context})=>{
 const f=await setup(page,context);f.day('2026-10-23');await page.locator('#today').click();
 await expect(page.locator('#reception-date')).toHaveValue('2026-10-23');await expect.poll(()=>f.dates.at(-1)).toBe('2026-10-23');await expect(page.locator('#reception-date')).toHaveAttribute('min','2026-09-23');
});
test('automatic India rollover refreshes today but preserves manually selected historical dates',async({page,context})=>{
 await page.clock.install({time:new Date('2026-10-22T18:29:30.000Z')});const f=await setup(page,context);f.day('2026-10-23');
 await page.clock.fastForward(61000);await expect(page.locator('#reception-date')).toHaveValue('2026-10-23');
 await page.locator('#reception-date').fill('2026-10-20');await page.locator('#reception-date').press('Tab');await expect.poll(()=>f.dates.at(-1)).toBe('2026-10-20');
 f.day('2026-10-24');await page.clock.fastForward(86400000);await expect(page.locator('#reception-date')).toHaveValue('2026-10-20');
});
test('slow Today response cannot overwrite a newer manual date selection',async({page,context})=>{
 const f=await setup(page,context);let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});f.delay(gate);f.day('2026-10-23');
 await page.locator('#today').click();await page.locator('#reception-date').fill('2026-10-20');await page.locator('#reception-date').press('Tab');await expect.poll(()=>f.dates.at(-1)).toBe('2026-10-20');release();
 await expect(page.locator('#today')).toBeEnabled();await expect(page.locator('#reception-date')).toHaveValue('2026-10-20');
});

test('reception inside count deduplicates replacement employee IDs but keeps independent visitors',async({page,context})=>{
 await setup(page,context);
 await page.evaluate(`state.rows=[{visitRequestId:'1',employeeId:'EMP001',requestType:'DIGITAL_ID',personName:'Employee',publicReference:'V-1',status:'APPROVED',passStatus:'ACTIVE',isInside:true,validUntilUtc:new Date(Date.now()+3600000).toISOString(),printCount:0},{visitRequestId:'2',employeeId:'EMP001',requestType:'DIGITAL_ID',personName:'Employee',publicReference:'V-2',status:'APPROVED',passStatus:'ACTIVE',isInside:true,validUntilUtc:new Date(Date.now()+3600000).toISOString(),printCount:0},{visitRequestId:'3',requestType:'EXTERNAL',personName:'Visitor',publicReference:'V-3',status:'APPROVED',passStatus:'ACTIVE',isInside:true,validUntilUtc:new Date(Date.now()+3600000).toISOString(),printCount:0}];state.listComplete=true;state.listFailed=false;renderRows();`);
 await expect(page.locator('#stat-total')).toHaveText('3');await expect(page.locator('#stat-inside')).toHaveText('2');
});
