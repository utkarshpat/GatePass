import{test,expect}from'@playwright/test';
const id='11111111-1111-4111-8111-111111111111';
const row=(n:number)=>({visitRequestId:`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,personName:'Visitor '+String(n).padStart(3,'0'),requestType:'EXTERNAL',publicPassNumber:'GP-'+n,publicReference:'V-'+n,projectName:'Project Alpha',hostName:'Aditi Sharma',status:'APPROVED',passStatus:'ACTIVE',isInside:false,photoAvailable:false,validFromUtc:new Date(Date.now()-3600000).toISOString(),validUntilUtc:new Date(Date.now()+86400000).toISOString()});
test('guard pages its rendered cards, fetches photos near the viewport and automatically receives fresh backend rows',async({page,context})=>{
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 let extra=false,photoCalls=0;const offsets:number[]=[];
 await page.route('**/api/guard/**',async route=>{
  const action=new URL(route.request().url()).pathname.split('/').at(-1),d=route.request().postDataJSON();
  if(action==='context')return route.fulfill({json:{displayName:'Guard',locations:[{locationId:1,locationName:'Noida'}]}});
  if(action==='duties')return route.fulfill({json:{duties:[{kind:'PROJECT',dutyId:'1',name:'Project Alpha'}]}});
  if(action==='visitors'){offsets.push(d.offset);const rows=Array.from({length:extra?61:60},(_,i)=>({...row(i),photoAvailable:true}));return route.fulfill({json:{visitors:rows.slice(d.offset,d.offset+30),hasMore:d.offset+30<rows.length}});}
  if(action==='photo'){photoCalls++;return route.fulfill({json:{mimeType:'image/png',imageBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1kAAAAASUVORK5CYII='}});}
  return route.fulfill({json:{}});
 });
 await page.clock.install();await page.setViewportSize({width:390,height:844});await page.goto('/guard');await expect(page.locator('.guard-id-card')).toHaveCount(24);expect(offsets).toEqual([0,30]);
 await expect.poll(()=>photoCalls).toBeGreaterThan(0);expect(photoCalls).toBeLessThan(12);const requests=offsets.length;
 await page.locator('#load-more').click();await expect(page.locator('.guard-id-card')).toHaveCount(48);expect(offsets).toHaveLength(requests);
 extra=true;await page.clock.runFor(20000);await expect(page.locator('#recent-status')).toHaveText('48 / 61');await expect(page.locator('.guard-id-card')).toHaveCount(48);
});
test('reception paginates the DOM while complete matching counts and filters cover every server page',async({page,context})=>{
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 let extra=false,listCalls=0;
 await page.route('**/api/reception/**',async route=>{
  const action=new URL(route.request().url()).pathname.split('/').at(-1),d=route.request().postDataJSON();
  if(action==='me')return route.fulfill({json:{displayName:'Reception',currentDate:'2026-10-24',locations:[{locationId:1,locationName:'Noida',canPrint:false}]}});
  if(action==='list'){listCalls++;const rows=Array.from({length:extra?121:120},(_,i)=>({...row(i),printCount:0})),offset=d.cursor?60:0;return route.fulfill({json:{visits:rows.slice(offset,offset?undefined:60),cursor:offset?null:{submittedAtUtc:'2026-10-24T00:00:00Z',visitRequestId:id}}});}
  return route.fulfill({json:{}});
 });
 await page.clock.install();await page.goto('/reception');await expect(page.locator('#visit-rows tr')).toHaveCount(50);await expect(page.locator('#stat-total')).toHaveText('120');const initial=listCalls;
 await page.locator('#load-more').click();await expect(page.locator('#visit-rows tr')).toHaveCount(100);expect(listCalls).toBe(initial);
 await page.locator('#load-more').click();await expect(page.locator('#visit-rows tr')).toHaveCount(120);await expect(page.locator('#load-more')).toBeHidden();
 extra=true;await page.clock.runFor(20000);await expect(page.locator('#stat-total')).toHaveText('121');
});

test('a live guard authorization denial clears protected cards and stops polling until explicit access reload',async({page,context})=>{
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 let denied=false,duties=0;
 await page.route('**/api/guard/**',async route=>{
  const action=new URL(route.request().url()).pathname.split('/').at(-1);
  if(action==='context')return route.fulfill({json:{displayName:'Guard',locations:[{locationId:1,locationName:'Noida'}]}});
  if(action==='duties'){duties++;return denied?route.fulfill({status:403,json:{}}):route.fulfill({json:{duties:[{kind:'PROJECT',dutyId:'1',name:'Project Alpha'}]}});}
  if(action==='visitors')return route.fulfill({json:{visitors:[row(1)],hasMore:false}});
  return route.fulfill({json:{}});
 });
 await page.clock.install();await page.goto('/guard');await expect(page.locator('.guard-id-card')).toHaveCount(1);
 denied=true;await page.clock.runFor(20000);await expect(page.locator('.guard-id-card')).toHaveCount(0);await expect(page.locator('#retry-context')).toBeVisible();await expect(page.locator('#scan-fab')).toBeDisabled();
 const stopped=duties;await page.clock.runFor(40000);expect(duties).toBe(stopped);
 denied=false;await page.locator('#retry-context').click();await expect(page.locator('.guard-id-card')).toHaveCount(1);await expect(page.locator('#retry-context')).toBeHidden();
});
