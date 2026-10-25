import {test,expect,type Page,type BrowserContext} from '@playwright/test';

const first='10000000-0000-4000-8000-000000000001',second='10000000-0000-4000-8000-000000000002';
const visitor=(id=first)=>({visitRequestId:id,accessPassId:'20000000-0000-4000-8000-000000000001',personName:id===first?'Asha Rao':'Rohan Mehta',publicReference:'V-'+id,publicPassNumber:'GP-'+id,requestType:'EXTERNAL',status:'APPROVED',passStatus:'ACTIVE',isInside:false,projectLocationId:'1',dutyId:'1',projectName:'Project Alpha',hostName:'Meera Singh',locationName:'Noida',reason:'Synthetic regression',movements:[],photoAvailable:false,submittedAtUtc:'2026-10-24T06:00:00.000Z',validFromUtc:'2026-10-24T00:00:00.000Z',validUntilUtc:'2030-10-24T00:00:00.000Z',canEnter:true,canExit:false,canReconcileExit:false});
async function workspace(page:Page,context:BrowserContext,paging=true){
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic-guard-regression',url:'http://localhost:18447'})));
 await page.clock.install({time:new Date('2026-10-24T08:00:00.000Z')});
 const s={reads:[] as Record<string,unknown>[],photo:false};
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();
  if(path==='/api/guard/context')return route.fulfill({json:{queuePaging:paging,displayName:'Synthetic Guard',locations:[{locationId:1,locationName:'Noida'},{locationId:2,locationName:'Chennai'}]}});
  if(path==='/api/guard/duties')return route.fulfill({json:{duties:[{kind:'PROJECT',dutyId:'1',name:'Project Alpha'}]}});
  if(path==='/api/guard/queue'||path==='/api/guard/visitors'){s.reads.push(body);return route.fulfill({json:{visitors:[visitor(),visitor(second)],total:2,cursor:null,hasMore:false}});}
  if(path==='/api/guard/detail'||path==='/api/guard/verify'){const detail={...visitor(body.visitRequestId??first),photoAvailable:s.photo};return route.fulfill({json:path.endsWith('/verify')?{outcome:'VALID',visit:detail}:detail});}
  return route.fulfill({json:{eligible:false}});
 });
 await page.goto('/guard');await expect(page.locator('.guard-id-card')).toHaveCount(2);return s;
}
async function hold(page:Page,path:string,status=401){
 let held=false,release=()=>{};
 await page.route('**'+path,async route=>{if(held)return route.fallback();held=true;await new Promise<void>(resolve=>{release=resolve;});return route.fulfill({status,json:{error:'UNAUTHENTICATED'}});});
 return{wait:()=>expect.poll(()=>held).toBe(true),async finish(){const response=page.waitForResponse(r=>r.url().endsWith(path)&&r.status()===status);release();await response;await page.evaluate(()=>new Promise(r=>setTimeout(r,0)));}};
}
async function profile(page:Page){await page.locator('#account-toggle').click();await page.locator('[data-open-profile]').click();}
async function stays(page:Page){await expect(page).toHaveURL(/\/guard$/);await expect(page.locator('.guard-id-card')).toHaveCount(2);}

for(const close of ['button','escape','replacement'])test('obsolete profile 401 is ignored after '+close,async({page,context})=>{
 await workspace(page,context);const h=await hold(page,'/api/guard/duties');await profile(page);await h.wait();
 if(close==='escape')await page.keyboard.press('Escape');else await page.locator('#close-profile').click();
 if(close==='replacement'){await profile(page);await expect(page.locator('#profile-assignments')).toContainText('Project Alpha');}else{await page.locator('#refresh-recent').click();await expect(page.locator('#recent-scans')).toHaveAttribute('aria-busy','false');}
 await h.finish();await stays(page);if(close==='replacement')await expect(page.locator('#profile-assignments')).toContainText('Project Alpha');
});
for(const paging of [true,false])test('obsolete '+(paging?'paged':'legacy')+' queue 401 is ignored after a newer search',async({page,context})=>{
 const s=await workspace(page,context,paging),h=await hold(page,'/api/guard/'+(paging?'queue':'visitors'));await page.locator('#refresh-recent').click();await h.wait();await page.locator('#visitor-search').fill('Rohan');await page.clock.fastForward(251);await expect.poll(()=>s.reads.at(-1)?.search).toBe('Rohan');await expect(page.locator('#recent-scans')).toHaveAttribute('aria-busy','false');await h.finish();await stays(page);
});
test('obsolete queue 401 is ignored after switching to Inside',async({page,context})=>{
 const s=await workspace(page,context),h=await hold(page,'/api/guard/queue');await page.locator('#refresh-recent').click();await h.wait();await page.locator('[data-queue=INSIDE]').click();await expect.poll(()=>s.reads.at(-1)?.queue).toBe('INSIDE');await h.finish();await stays(page);await expect(page.locator('[data-queue=INSIDE]')).toHaveAttribute('aria-selected','true');
});
for(const path of ['detail','photo','remind-host'])test('obsolete pass '+path+' 401 is ignored when its dialog closes',async({page,context})=>{
 const s=await workspace(page,context);s.photo=path==='photo';if(path==='remind-host')await page.route('**/api/guard/detail',route=>route.fulfill({json:{...visitor(),status:'PENDING',passStatus:'PENDING',canEnter:false}}));
 const h=await hold(page,'/api/guard/'+path);await page.locator('.guard-id-card').first().click();await h.wait();await page.locator('#close-pass').click();await h.finish();await stays(page);await expect(page.locator('#pass-dialog')).not.toBeVisible();
});
test('obsolete thumbnail 401 is ignored after the queue is replaced',async({page,context})=>{
 await workspace(page,context);await page.route('**/api/guard/queue',route=>route.fulfill({json:{visitors:[{...visitor(),photoAvailable:true}],total:1,cursor:null}}));const h=await hold(page,'/api/guard/photo');await page.locator('#refresh-recent').click();await h.wait();await page.unroute('**/api/guard/queue');await page.locator('#visitor-search').fill('Rohan');await page.clock.fastForward(251);await expect(page.locator('.guard-id-card')).toHaveCount(2);await h.finish();await stays(page);
});
test('obsolete office duties 401 cannot redirect the newly selected office',async({page,context})=>{
 await workspace(page,context);const h=await hold(page,'/api/guard/duties');await profile(page);await h.wait();await page.locator('#close-profile').click();await page.locator('#guard-office').selectOption('2',{force:true});await expect(page.locator('#office-name')).toHaveText('Chennai');await expect(page.locator('.guard-id-card')).toHaveCount(2);await h.finish();await stays(page);
});
test('a request made with an old CSRF identity cannot redirect after session replacement',async({page,context})=>{
 await workspace(page,context);const h=await hold(page,'/api/guard/queue');await page.locator('#refresh-recent').click();await h.wait();await context.addCookies([{name:'gp-staff-csrf',value:'synthetic-renewed-identity',url:'http://localhost:18447'}]);await h.finish();await expect(page).toHaveURL(/\/guard$/);
});
for(const path of ['queue','duties','detail'])test('a current '+path+' 401 still returns to sign-in',async({page,context})=>{
 await workspace(page,context);await page.route('**/api/guard/'+path,route=>route.fulfill({status:401,json:{error:'UNAUTHENTICATED'}}));if(path==='duties')await profile(page);else if(path==='detail')await page.locator('.guard-id-card').first().click();else await page.locator('#refresh-recent').click();await expect(page).toHaveURL('http://localhost:18447/');
});
