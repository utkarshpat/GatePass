import {test,expect,type Page,type BrowserContext} from '@playwright/test';
const visitId='10000000-0000-4000-8000-000000000011';
const visitor={visitRequestId:visitId,personName:'Rohan Mehta',hostName:'Meera Singh',projectName:'Project Alpha',requestType:'EXTERNAL',publicReference:'V-demo',publicPassNumber:'GP-DEMO001',status:'APPROVED',passStatus:'ACTIVE',isInside:false,validFromUtc:new Date(Date.now()-3600000).toISOString(),validUntilUtc:new Date(Date.now()+86400000).toISOString(),photoAvailable:false};
const names:Record<string,string[]>={hi:['रोहन मेहता','मीरा सिंह'],kn:['ರೋಹನ್ ಮೆಹ್ತಾ','ಮೀರಾ ಸಿಂಗ್'],ta:['ரோஹன் மேத்தா','மீரா சிங்'],mr:['रोहन मेहता','मीरा सिंह']};
async function fixture(page:Page,context:BrowserContext,{delay=false,fail=false,many=0}={}){
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 await page.addInitScript(()=>localStorage.setItem('gp-guard-language','en-hi'));
 let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});const calls:any[]=[];
 await page.route('**/api/guard/**',async route=>{
  const action=new URL(route.request().url()).pathname.split('/').at(-1),body=route.request().postDataJSON();
  if(action==='context')return route.fulfill({json:{displayName:'Security Guard',locations:[{locationId:1,locationName:'Noida'}]}});
  if(action==='duties')return route.fulfill({json:{locationId:1,duties:[{kind:'PROJECT',dutyId:'1',name:'Project Alpha'}]}});
  if(action==='visitors')return route.fulfill({json:{visitors:many?Array.from({length:many},(_,i)=>({...visitor,visitRequestId:visitId.slice(0,-3)+String(i).padStart(3,'0'),personName:'Person '+i})):[visitor],hasMore:false}});
  if(action==='name-readings'){
   calls.push(body);if(delay&&body.locale==='hi')await gate;
   if(fail)return route.fulfill({status:503,json:{}});
   return route.fulfill({json:{locale:body.locale,items:body.names.map((name:string)=>({name,reading:names[body.locale][name==='Rohan Mehta'?0:1]}))}});
  }
  if(action==='detail')return route.fulfill({json:{...visitor,accessPassId:'20000000-0000-4000-8000-000000000011',locationName:'Noida',dutyKind:'PROJECT',dutyId:'1',canEnter:true,canExit:false,canReconcileExit:false,movements:[]}});
  return route.fulfill({status:500,json:{}});
 });
 await page.goto('/guard');await expect(page.locator('.guard-id-card')).toHaveCount(Math.min(many||1,24));
 return{calls,release};
}
async function language(page:Page,label:string){await page.locator('#account-toggle').click();await page.locator('#language-menu').click();await page.getByRole('menuitemradio',{name:label,exact:true}).click();await page.locator('#account-toggle').click();}
test('cards render before readings and preserve English names, host and projects in four languages',async({page,context})=>{
 await page.setViewportSize({width:390,height:844});const f=await fixture(page,context,{delay:true});
 await expect(page.locator('#recent-scans')).toHaveAttribute('aria-busy','false');await expect(page.locator('.guard-card-person strong')).toHaveText('Rohan Mehta');
 await expect.poll(()=>f.calls.length).toBe(1);f.release();
 for(const [locale,label]of [['hi','English + हिन्दी'],['kn','English + ಕನ್ನಡ'],['ta','English + தமிழ்'],['mr','English + मराठी']]){
  if(locale!=='hi')await language(page,label);
  const name=page.locator('.guard-card-person strong');await expect(name.locator('.name-reading-local')).toHaveText('('+names[locale][0]+') *');await expect(name.locator('.name-reading-original')).toHaveText('Rohan Mehta');await expect(name.locator('.name-reading-local')).toHaveAttribute('lang',locale);
  expect(await name.evaluate(el=>[...el.children].every(child=>getComputedStyle(child).display==='inline'))).toBe(true);
  await expect(page.locator('.guard-host-name .name-reading-local')).toHaveText('('+names[locale][1]+') *');await expect(page.locator('.guard-card-projects')).toContainText('Project Alpha');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const boxes=await page.locator('.guard-id-card').evaluate(card=>{const person=card.querySelector('.guard-card-person')!.getBoundingClientRect(),footer=card.querySelector('.guard-card-footer')!.getBoundingClientRect();return{bottom:person.bottom,top:footer.top};});expect(boxes.bottom).toBeLessThanOrEqual(boxes.top+1);
 }
 await expect(page.locator('#name-reading-note')).toHaveCount(0);await page.locator('.guard-card-person strong .name-reading-local').hover();await expect(page.locator('.guard-card-person strong .name-reading-local')).toHaveAttribute('title',/Reading aid; pronunciation may be inaccurate/u);expect(await page.locator('.guard-card-person strong').evaluate(el=>[...el.children].map(n=>n.className))).toEqual(['name-reading-original','name-reading-local']);await page.screenshot({path:'output/guard-name-readings-mobile.png'});
 const requests=f.calls.length;await language(page,'English + हिन्दी');await expect(page.locator('strong .name-reading-local')).toHaveText('('+names.hi[0]+') *');expect(f.calls.length).toBe(requests);
 await page.locator('.guard-id-card').click();await expect(page.locator('#person-name .name-reading-local')).toHaveText('('+names.hi[0]+') *');await expect(page.locator('#pass-fields .name-reading-local')).toHaveText('('+names.hi[1]+') *');await page.locator('#close-pass').click();
 await language(page,'English only');await expect(page.locator('.guard-card-person strong')).toHaveText('Rohan Mehta');await expect(page.locator('.name-reading-local')).toHaveCount(0);await expect(page.locator('#name-reading-note')).toBeHidden();
});
test('a late response cannot overwrite a new language and provider failure leaves usable English cards',async({page,context})=>{
 const f=await fixture(page,context,{delay:true});await expect.poll(()=>f.calls.length).toBe(1);
 await language(page,'English + ಕನ್ನಡ');f.release();await expect(page.locator('strong .name-reading-local')).toHaveText('('+names.kn[0]+') *');await expect(page.locator('strong .name-reading-local')).toHaveAttribute('lang','kn');
});
test('optional provider outage does not break card details or keep the main list busy',async({page,context})=>{
 await fixture(page,context,{fail:true});await expect(page.locator('.guard-card-person strong')).toHaveText('Rohan Mehta');await expect(page.locator('#recent-scans')).toHaveAttribute('aria-busy','false');await page.locator('.guard-id-card').click();await expect(page.locator('#person-name')).toHaveText('Rohan Mehta');await expect(page.locator('#mark-entry')).toBeVisible();
});
test('readings prefetch near the viewport and load later cards when scrolling',async({page,context})=>{
 await page.setViewportSize({width:390,height:844});const f=await fixture(page,context,{many:40});
 await expect(page.locator('.guard-id-card').first().locator('.name-reading-local').first()).toBeVisible();
 expect(f.calls.flatMap(c=>c.names)).not.toContain('Person 39');
 await page.locator('#load-more').click();await expect(page.locator('.guard-id-card')).toHaveCount(40);await page.locator('.guard-id-card').last().scrollIntoViewIfNeeded();
 await expect(page.locator('.guard-id-card').last().locator('strong .name-reading-local')).toBeVisible();
 expect(f.calls.flatMap(c=>c.names)).toContain('Person 39');
});
