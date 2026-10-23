import{test,expect,type BrowserContext,type Page}from'@playwright/test';
import{execFileSync}from'node:child_process';import{randomUUID}from'node:crypto';
declare const liveRefresh:{online:boolean;dirty:boolean;running:boolean;close():void};
const run=randomUUID();
const fixture=(action:string)=>execFileSync('pwsh',['-NoProfile','-File','tests/browser/AdminConsoleFixture.ps1','-RunId',run,'-Action',action],{encoding:'utf8',timeout:60000});
async function login(page:Page,email:string){await page.goto('/');await page.getByRole('textbox',{name:'Email or Staff ID',exact:true}).fill(email);await page.getByRole('textbox',{name:'Password',exact:true}).fill('Sopra@123');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/\/admin$/u);await expect(page.locator('#summary-cards article')).toHaveCount(4);await page.locator('[data-admin-view="projects"]').click();}
test('real scoped streams reject foreign scope and deliver a committed area to an independent staff session',async({page,browser})=>{
 test.setTimeout(180000);let observerContext:BrowserContext|undefined;
 try{
  const f=JSON.parse(fixture('Create'));await login(page,f.login);
  observerContext=await browser.newContext({baseURL:'http://localhost:18447'});const observer=await observerContext.newPage();await login(observer,f.login);await observer.locator('#project-search').fill(f.prefix);await observer.locator('[data-admin-view="projects"]').focus();await observer.waitForFunction(()=>liveRefresh.online&&!liveRefresh.dirty&&!liveRefresh.running);
  const area=f.prefix+' Live lounge';await page.locator('#add-project-open').click();await page.locator('#new-workspace-type').selectOption('area');await page.locator('#new-project-name').fill(area);await page.locator('#new-project-reason').fill('Owned live delivery verification');
  const start=Date.now();await page.locator('#new-project-submit').click();await expect(page.locator('#add-project-dialog')).toBeHidden();await expect(observer.locator('.area-card').filter({hasText:area})).toBeVisible({timeout:15000});expect(Date.now()-start).toBeLessThan(15000);
  const results=await page.evaluate(async({foreign})=>{const csrf=document.cookie.split('; ').find(c=>c.startsWith('gp-staff-csrf='))?.split('=')[1];const post=async(body:unknown,token=csrf)=>{const r=await fetch('/api/workspace/events',{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-CSRF-Token':token}:{})},body:JSON.stringify(body)});return r.status;};return[await post({workspace:'ADMIN',locationId:foreign}),await post({workspace:'ADMIN',locationId:1},''),await post({workspace:'GUARD',locationId:1,projectLocationId:'1'})];},{foreign:f.otherLocationId});
  expect(results).toEqual([403,403,400]);
 }finally{await page.evaluate(()=>{if(typeof liveRefresh!=='undefined')liveRefresh.close();}).catch(()=>{});await observerContext?.close();fixture('Cleanup');}
});
