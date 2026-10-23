import {test,expect} from '@playwright/test';
const visit='10000000-0000-4000-8000-000000000021',person='20000000-0000-4000-8000-000000000021';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1kAAAAASUVORK5CYII=';
const job={body:{requestType:'DIGITAL_ID'},label:'Digital ID',people:[{key:person,name:'Sample Employee'}],result:{visits:[{visitRequestId:visit,clientPersonKey:person,publicPassNumber:'GP-TEST',status:'APPROVED',reused:false}]}};
test('repeated results share one pending image request and retain one downloadable blob',async({page})=>{
 let count=0,release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/**',async route=>{
  if(!route.request().url().endsWith('/api/employee/digital-id/image'))return route.fulfill({status:401,json:{}});
  count++;await gate;return route.fulfill({json:{mimeType:'image/png',fileName:'Digital-ID-test.png',imageBase64:png}});
 });
 await page.goto('/office/noida');
 await page.evaluate('state.mode="employee";state.jobs='+JSON.stringify([job])+';digitalCardRequest(state.jobs[0]);showResults();showResults();');
 await expect.poll(()=>count).toBe(1);await expect(page.locator('.digital-card-preview')).toContainText('Preparing card');release();
 await expect(page.getByRole('link',{name:'Download image'})).toHaveCount(1);
 const href=await page.getByRole('link',{name:'Download image'}).getAttribute('href');expect(href).toMatch(/^blob:/u);
 await page.evaluate('showResults()');await expect(page.getByRole('link',{name:'Download image'})).toHaveAttribute('href',href!);expect(count).toBe(1);
 expect(await page.evaluate('state.jobs[0].cardRequest')).toBeNull();
});
test('failed prefetch is shown once and the explicit retry makes one fresh image request',async({page})=>{
 let count=0;
 await page.route('**/api/**',route=>{
  if(!route.request().url().endsWith('/api/employee/digital-id/image'))return route.fulfill({status:401,json:{}});
  count++;return count===1?route.fulfill({status:503,json:{}}):route.fulfill({json:{mimeType:'image/png',fileName:'Digital-ID-test.png',imageBase64:png}});
 });
 await page.goto('/office/noida');await page.evaluate('state.mode="employee";state.jobs='+JSON.stringify([job])+';void digitalCardRequest(state.jobs[0]);');
 await expect.poll(()=>count).toBe(1);await page.evaluate('showResults()');await expect(page.getByRole('button',{name:'Retry card'})).toBeVisible();expect(count).toBe(1);
 await page.getByRole('button',{name:'Retry card'}).click();await expect(page.getByRole('link',{name:'Download image'})).toBeVisible();expect(count).toBe(2);
});
test('confirmed Digital ID submission starts the card without a redundant blocking detail call',async({page})=>{
 const actions:string[]=[];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;actions.push(path);
  if(path==='/api/registration/submit')return route.fulfill({json:job.result});
  if(path==='/api/employee/digital-id/image')return route.fulfill({json:{mimeType:'image/png',fileName:'Digital-ID-test.png',imageBase64:png}});
  return route.fulfill({status:401,json:{}});
 });
 await page.goto('/office/noida');
 const pending={...job,result:null,started:true,photos:['synthetic-photo'],payload:{synthetic:true}};
 await page.evaluate('state.mode="employee";state.jobs='+JSON.stringify([pending])+';void submitJobs();');
 await expect(page.getByRole('link',{name:'Download image'})).toBeVisible();
 expect(actions.filter(p=>p==='/api/employee/digital-id/image')).toHaveLength(1);expect(actions).not.toContain('/api/employee/digital-id/detail');expect(actions.filter(p=>p==='/api/registration/submit')).toHaveLength(1);
});
