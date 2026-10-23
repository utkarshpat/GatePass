import {test,expect} from '@playwright/test';import {randomUUID} from 'node:crypto';import {execFileSync} from 'node:child_process';import {homedir} from 'node:os';import {join} from 'node:path';import {localEmailLinks} from '../../src/email/LocalEmailLinks.ts';
const visit='11111111-1111-4111-8111-111111111111',pass='22222222-2222-4222-8222-222222222222';
const row=()=>({visitRequestId:visit,accessPassId:pass,canCancel:true,canDecide:false,status:'APPROVED',passStatus:'ACTIVE',personName:'Kunal Verma',companyName:'NovaWorks',validFromUtc:new Date(Date.now()-60000).toISOString(),validUntilUtc:new Date(Date.now()+3600000).toISOString()});
test('employee email revoke requires login, explicit confirmation, and hides a late pass response',async({page})=>{
 let signedIn=false,revoked=false,revokes=0,release:()=>void=()=>{},imageRequested=false;const gate=new Promise<void>(r=>release=r);
 await page.route('**/api/dev/sso/login',route=>{signedIn=true;return route.fulfill({json:{ok:true}});});
 await page.route('**/api/email/request/**',async route=>{
  if(!signedIn)return route.fulfill({status:401,json:{error:'UNAUTHORIZED'}});
  if(route.request().url().endsWith('/image')){imageRequested=true;await gate;return route.fulfill({json:{mimeType:'image/png',imageBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1cAAAAASUVORK5CYII='}}).catch(()=>{});}
  if(route.request().url().endsWith('/revoke')){revokes++;expect(route.request().postDataJSON()).toMatchObject({visitRequestId:visit,expectedPassId:pass,confirm:true});revoked=true;return route.fulfill({json:{status:'CANCELLED'}});}
  return route.fulfill({json:{...row(),status:revoked?'CANCELLED':'APPROVED',passStatus:revoked?'REVOKED':'ACTIVE',canCancel:!revoked}});
 });
 await page.goto('/request/'+visit+'#revoke=confirm');await expect(page.locator('#login')).toBeVisible();await expect(page.locator('#revoke')).toBeHidden();await page.locator('#email').fill('employee1@example.com');await page.locator('#password').fill('Sopra@123');await page.locator('#sign-in').click();await expect(page.locator('#revoke')).toBeEnabled();await expect.poll(()=>imageRequested).toBe(true);expect(revokes).toBe(0);
 page.once('dialog',dialog=>dialog.dismiss());await page.locator('#revoke').click();expect(revokes).toBe(0);await expect(page.locator('#revoke')).toBeEnabled();
 page.once('dialog',dialog=>dialog.accept());await page.locator('#revoke').click();await expect(page.locator('#message')).toHaveText('Revoked');release();await page.waitForLoadState('networkidle');await expect(page.locator('#card')).toBeHidden();await expect(page.locator('#download')).toBeHidden();await expect(page.locator('#revoke')).toBeHidden();expect(revokes).toBe(1);
});
test('revoke timeout requires refresh and reuses its original operation key',async({page})=>{
 await page.clock.install();await page.addInitScript(()=>{const original=window.fetch.bind(window);let first=true;(window as any).revokeKeys=[];window.fetch=async(input,init)=>{if(String(input).endsWith('/request/revoke')){(window as any).revokeKeys.push(JSON.parse(String(init!.body)).clientKey);if(first){first=false;return new Promise<never>((_,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}}return original(input,init);};});
 let revoked=false;await page.route('**/api/email/request/**',route=>{if(route.request().url().endsWith('/image'))return route.fulfill({status:503,json:{error:'UNAVAILABLE'}});if(route.request().url().endsWith('/revoke')){revoked=true;return route.fulfill({json:{status:'CANCELLED'}});}return route.fulfill({json:{...row(),status:revoked?'CANCELLED':'APPROVED',passStatus:revoked?'REVOKED':'ACTIVE',canCancel:!revoked}});});
 await page.goto('/request/'+visit+'#revoke=confirm');page.once('dialog',d=>d.accept());await page.locator('#revoke').click();await page.clock.fastForward(30001);await expect(page.locator('#message')).toContainText('Request timed out');await expect(page.locator('#refresh')).toBeEnabled();await page.locator('#refresh').click();page.once('dialog',d=>d.accept());await page.locator('#revoke').click();await expect(page.locator('#message')).toHaveText('Revoked');const keys=await page.evaluate(()=>(window as any).revokeKeys);expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
});
test('live visitor email exchanges separate capabilities and confirms one scoped SQL revocation',async({page,context})=>{
 const run=randomUUID(),fixture=(action:string)=>execFileSync('pwsh',['-NoProfile','-File','tests/browser/EmailRevokeFixture.ps1','-RunId',run,'-Action',action],{encoding:'utf8',timeout:60000});
 try{
  const data=JSON.parse(fixture('Create')),codec=await localEmailLinks(join(homedir(),'.gatepass','private-v1')),proof={v:1 as const,...data},link=await codec.issue(proof),revoke=await codec.issueRevoke(proof);
  await page.goto('/request/'+data.visit+'#link='+link);await expect(page.locator('#message')).toHaveText('Approval pending');await expect(page.locator('#revoke')).toBeHidden();
  await page.goto('/request/'+data.visit+'#link='+link+'&revoke='+revoke);await expect(page.locator('#revoke')).toBeVisible();await expect(page).toHaveURL('/request/'+data.visit);const cookie=(await context.cookies()).find(c=>c.name==='gp-dev-revoke')!;expect(cookie.httpOnly).toBe(true);expect(cookie.sameSite).toBe('Strict');expect(cookie.path).toBe('/api/email/external/'+data.visit+'/');await page.reload();await expect(page.locator('#revoke')).toBeEnabled();
  expect(await page.evaluate(()=>document.cookie.includes('gp-dev-revoke')||!!sessionStorage.getItem('revoke')||!!localStorage.getItem('revoke'))).toBe(false);
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#revoke').click();await expect(page.locator('#message')).toHaveText('Approval pending');page.once('dialog',dialog=>dialog.accept());await page.locator('#revoke').click();await expect(page.locator('#message')).toHaveText('Revoked');await expect(page.locator('#revoke')).toBeHidden();await expect(page.locator('#download')).toBeHidden();await page.reload();await expect(page.locator('#message')).toHaveText('Revoked');
 }finally{fixture('Cleanup');}
});
