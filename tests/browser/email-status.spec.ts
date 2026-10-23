import {test,expect} from '@playwright/test';
const visit='11111111-1111-4111-8111-111111111111';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1cAAAAASUVORK5CYII=';
const row=()=>({visitRequestId:visit,status:'PENDING',passStatus:'PENDING',personName:'Visitor 1',companyName:'Acme Corp',deviceTypes:['LAPTOP','TABLET'],publicReference:'V-test',locationName:'Noida',projectName:'Project 1',hostName:'Employee 19',reason:'Meeting',validFromUtc:new Date(Date.now()-3600000).toISOString(),validUntilUtc:new Date(Date.now()+3600000).toISOString()});
for(const phase of ['headers','body'])test('approval detail timeout recovers after stalled '+phase,async({page})=>{
 await page.clock.install();await page.addInitScript(phase=>{
  const original=window.fetch.bind(window);let first=true;
  window.fetch=async(input,init)=>{if(first&&String(input).endsWith('/host/detail')){first=false;const wait=()=>new Promise<never>((_,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));if(phase==='headers')return wait();return{ok:true,json:wait} as unknown as Response;}return original(input,init);};
 },phase);
 await page.route('**/api/email/host/detail',route=>route.fulfill({json:{...row(),canDecide:true,photoAvailable:false,snapshotVersion:1,snapshotHash:'a'.repeat(64)}}));
 await page.goto('/approval/'+visit);await expect(page.locator('#refresh')).toBeDisabled();await page.clock.fastForward(30001);await expect(page.locator('#message')).toContainText('Request timed out');await expect(page.locator('#refresh')).toBeEnabled();await page.locator('#refresh').click();await expect(page.locator('#approve')).toBeEnabled();
});
test('timed-out decision releases controls and retains the same retry key after refresh',async({page})=>{
 await page.clock.install();await page.addInitScript(()=>{const original=window.fetch.bind(window);let first=true;(window as any).decisionKeys=[];window.fetch=async(input,init)=>{if(String(input).endsWith('/host/decide')){(window as any).decisionKeys.push(JSON.parse(String(init!.body)).clientKey);if(first){first=false;return new Promise<never>((_,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}}return original(input,init);};});
 let approved=false;await page.route('**/api/email/host/**',route=>{if(route.request().url().endsWith('/decide')){approved=true;return route.fulfill({json:{visitRequestId:visit,decision:'APPROVED'}});}return route.fulfill({json:{...row(),status:approved?'APPROVED':'PENDING',passStatus:approved?'ACTIVE':'PENDING',canDecide:!approved,photoAvailable:false,snapshotVersion:1,snapshotHash:'a'.repeat(64)}});});
 await page.goto('/approval/'+visit);await page.locator('#approve').click();await page.clock.fastForward(30001);await expect(page.locator('#message')).toContainText('Request timed out');await expect(page.locator('#refresh')).toBeEnabled();await page.locator('#refresh').click();await page.locator('#approve').click();await expect(page.locator('#message')).toHaveText('Approved');const keys=await page.evaluate(()=>(window as any).decisionKeys);expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
});
test('host approval waits for login detail and photo loading before accepting one click',async({page})=>{
 let signedIn=false,approved=false,decisions=0,release:()=>void=()=>{};const photo=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/dev/sso/login',route=>{signedIn=true;return route.fulfill({json:{ok:true}});});
 await page.route('**/api/email/host/**',async route=>{
  const action=route.request().url().split('/').at(-1);
  if(!signedIn)return route.fulfill({status:401,json:{error:'UNAUTHORIZED'}});
  if(action==='photo'){await photo;return route.fulfill({status:503,json:{error:'UNAVAILABLE'}});}
  if(action==='decide'){decisions++;approved=true;return route.fulfill({json:{visitRequestId:visit,decision:'APPROVED'}});}
  return route.fulfill({json:{...row(),status:approved?'APPROVED':'PENDING',passStatus:approved?'ACTIVE':'PENDING',canDecide:!approved,photoAvailable:true,snapshotVersion:1,snapshotHash:'a'.repeat(64)}});
 });
 await page.goto('/approval/'+visit);await expect(page.locator('#login')).toBeVisible();await page.locator('#email').fill('employee19@example.com');await page.locator('#password').fill('Sopra@123');await page.locator('#sign-in').click();
 await expect(page.locator('#actions')).toBeVisible();await expect(page.locator('#approve')).toBeDisabled();expect(decisions).toBe(0);release();await expect(page.locator('#approve')).toBeEnabled();await page.locator('#approve').click();await expect(page.locator('#message')).toHaveText('Approved');expect(decisions).toBe(1);
});
for(const width of [390,1366])test('external status reload, HttpOnly and revocation at '+width+'px',async({page,context})=>{
 await page.setViewportSize({width,height:width===390?844:768});let current=row(),exchanges=0,forbidden=0;
 await page.route('**/api/email/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session')){exchanges++;return route.fulfill({json:{visitRequestId:visit},headers:{'set-cookie':'gp-dev-holder=synthetic; Path=/api/email/external/'+visit+'/; HttpOnly; SameSite=Strict'}});}
  if(!path.includes('/external/'+visit+'/')){forbidden++;return route.fulfill({status:401,json:{error:'UNAUTHORIZED'}});}
  if(!route.request().headers().cookie?.includes('gp-dev-holder=synthetic'))return route.fulfill({status:403,json:{error:'UNAUTHORIZED'}});
  return route.fulfill({json:path.endsWith('/detail')?current:{mimeType:'image/png',imageBase64:png}});
 });
 await page.goto('/request/'+visit+'#link=synthetic');await expect(page.locator('#message')).toHaveText('Approval pending');await expect(page.locator('#fields')).toContainText('Acme Corp');await expect(page.locator('#fields')).toContainText('Laptop, Tablet / iPad');await expect(page).toHaveURL('/request/'+visit);
 const cookie=(await context.cookies()).find(c=>c.name==='gp-dev-holder')!;expect(cookie.httpOnly).toBe(true);expect(cookie.path).toBe('/api/email/external/'+visit+'/');
 expect(await page.evaluate(()=>document.cookie.includes('gp-dev-holder')||!!localStorage.getItem('link')||!!sessionStorage.getItem('link'))).toBe(false);
 await page.reload();await expect(page.locator('#message')).toHaveText('Approval pending');expect(exchanges).toBe(1);
 current={...current,status:'APPROVED',passStatus:'ACTIVE'};await page.locator('#refresh').click();await expect(page.locator('#card')).toBeVisible();
 current={...current,status:'CANCELLED',passStatus:'REVOKED'};await page.locator('#refresh').click();await expect(page.locator('#message')).toHaveText('Revoked');await expect(page.locator('#card')).toBeHidden();await expect(page.locator('#download')).toBeHidden();
 await context.clearCookies();await page.locator('#refresh').click();await expect(page.locator('#message')).toContainText('unavailable');await expect(page.locator('#request')).toBeHidden();await expect(page.locator('#login')).toBeHidden();expect(forbidden).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('late card response cannot restore media after cancelled refresh',async({page})=>{
 let current={...row(),status:'APPROVED',passStatus:'ACTIVE'},release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});let imageRequested=false;
 await page.route('**/api/email/**',async route=>{
  const path=new URL(route.request().url()).pathname;if(path.endsWith('/session'))return route.fulfill({json:{visitRequestId:visit}});
  if(path.endsWith('/image')){imageRequested=true;await gate;return route.fulfill({json:{mimeType:'image/png',imageBase64:png}}).catch(()=>{});}return route.fulfill({json:current});
 });
 await page.goto('/request/'+visit+'#link=synthetic');await expect.poll(()=>imageRequested).toBe(true);await expect(page.locator('#refresh')).toBeEnabled();
 current={...current,status:'CANCELLED',passStatus:'REVOKED'};await page.locator('#refresh').click();await expect(page.locator('#message')).toHaveText('Revoked');release();
 await page.waitForLoadState('networkidle');await expect(page.locator('#card')).toBeHidden();await expect(page.locator('#download')).toBeHidden();
});
test('failed holder exchange retries without persisting or discarding original proof',async({page})=>{
 let exchanges=0;await page.route('**/api/email/**',async route=>{
  const path=new URL(route.request().url()).pathname;if(path.endsWith('/session')){exchanges++;return exchanges===1?route.fulfill({status:503,json:{error:'UNAVAILABLE'}}):route.fulfill({json:{visitRequestId:visit}});}
  return route.fulfill({json:path.endsWith('/detail')?row():{mimeType:'image/png',imageBase64:png}});
 });
 await page.goto('/request/'+visit+'#link=synthetic');await expect(page.locator('#message')).toContainText('unavailable');await expect(page).toHaveURL(/#link=synthetic$/);await page.locator('#refresh').click();
 await expect(page.locator('#message')).toHaveText('Approval pending');expect(exchanges).toBe(2);await expect(page).toHaveURL('/request/'+visit);
});
test('open approved status removes its card when validity expires',async({page})=>{
 await page.clock.install();const current={...row(),status:'APPROVED',passStatus:'ACTIVE',validUntilUtc:new Date(Date.now()+60000).toISOString()};
 await page.route('**/api/email/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({json:path.endsWith('/session')?{visitRequestId:visit}:path.endsWith('/detail')?current:{mimeType:'image/png',imageBase64:png}});});
 await page.goto('/request/'+visit+'#link=synthetic');await expect(page.locator('#card')).toBeVisible();await page.clock.fastForward(61000);await expect(page.locator('#message')).toHaveText('Expired');await expect(page.locator('#card')).toBeHidden();await expect(page.locator('#download')).toBeHidden();
});

test('an open approved status notices remote revocation without waiting for pass expiry',async({page})=>{
 await page.clock.install();let revoked=false,reads=0;
 await page.route('**/api/email/**',route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('/session'))return route.fulfill({json:{visitRequestId:visit}});if(path.endsWith('/detail')){reads++;return route.fulfill({json:{...row(),status:revoked?'CANCELLED':'APPROVED',passStatus:revoked?'REVOKED':'ACTIVE'}});}return route.fulfill({json:{mimeType:'image/png',imageBase64:png}});});
 await page.goto('/request/'+visit+'#link=synthetic');await expect(page.locator('#card')).toBeVisible();expect(reads).toBe(1);revoked=true;
 await page.clock.fastForward(30001);await expect(page.locator('#message')).toHaveText('Revoked');await expect(page.locator('#card')).toBeHidden();await expect(page.locator('#download')).toBeHidden();expect(reads).toBe(2);
});
test('two holder tabs remain isolated and uppercase/trailing-slash links use canonical cookie paths',async({page,context})=>{
 const other='abcdefab-cdef-4abc-8def-abcdefabcdef';
 await context.route('**/api/email/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session')){
   const id=route.request().postDataJSON().link==='second'?other:visit;
   return route.fulfill({json:{visitRequestId:id},headers:{'set-cookie':'gp-dev-holder='+id+'; Path=/api/email/external/'+id+'/; HttpOnly; SameSite=Strict'}});
  }
  const id=path.includes(other)?other:visit;
  if(!route.request().headers().cookie?.includes('gp-dev-holder='+id))return route.fulfill({status:403,json:{error:'UNAUTHORIZED'}});
  return route.fulfill({json:path.endsWith('/detail')?{...row(),visitRequestId:id,personName:id===other?'Visitor 2':'Visitor 1'}:{mimeType:'image/png',imageBase64:png}});
 });
 await page.goto('/request/'+visit+'#link=first');await expect(page.locator('#fields')).toContainText('Visitor 1');
 const second=await context.newPage();await second.goto('/request/'+other.toUpperCase()+'/#link=second');await expect(second.locator('#fields')).toContainText('Visitor 2');
 await page.reload();await expect(page.locator('#fields')).toContainText('Visitor 1');await second.reload();await expect(second.locator('#fields')).toContainText('Visitor 2');
 expect((await context.cookies()).filter(c=>c.name==='gp-dev-holder')).toHaveLength(2);
});
