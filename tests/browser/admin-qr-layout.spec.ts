import {test,expect} from '@playwright/test';
import QRCode from 'qrcode';
for(const viewport of [{width:390,height:844},{width:620,height:1024},{width:1366,height:768}])test(`QR poster preserves its proportions and scrolls inside the modal at ${viewport.width}px`,async({page,context})=>{
 await page.setViewportSize(viewport);await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 const qr=await QRCode.toDataURL('http://localhost:18447/office/bengaluru',{width:600,margin:4});
 await page.route('**/api/admin/**',async route=>{
  const action=route.request().url().split('/').at(-1);
  const replies:any={context:{displayName:'Test Admin',locations:[{locationId:2,locationCode:'BENGALURU',locationName:'Bengaluru',canManageCommonAreas:false}]},projects:{projects:[],cursor:null},scope:{userId:'11111111-1111-4111-8111-111111111111',currentDate:'2026-10-23',canReport:false,canReadVisits:false,canAudit:false,canAssignGuards:false,canManageRoles:false,roles:[],delegations:[]},'office-qr':{locationName:'Bengaluru',url:'http://localhost:18447/office/bengaluru',imageDataUrl:qr}};
  await route.fulfill({json:replies[action!]});
 });
 await page.goto('/admin');await page.locator('[data-admin-view=offices]').click();
 // Ensure there is a genuinely scrollable background to exercise scroll chaining.
 await page.evaluate(()=>{document.body.style.minHeight='2400px';window.scrollTo(0,150);});
 const background=await page.evaluate(()=>window.scrollY);await page.getByRole('button',{name:'Registration QR'}).click();await expect(page.locator('#qr-dialog')).toBeVisible();
 const body=page.locator('.qr-modal-body');const metrics=await page.evaluate(()=>{const d=document.querySelector('#qr-dialog')!,p=document.querySelector('#qr-poster')!,q=document.querySelector('#qr-image')!,f=document.querySelector('.poster-footer')!;const bounds=(e:Element)=>e.getBoundingClientRect().toJSON();return{dialog:bounds(d),poster:bounds(p),qr:bounds(q),footer:bounds(f),width:innerWidth,height:innerHeight};});
 expect(metrics.dialog.x).toBeGreaterThanOrEqual(0);expect(metrics.dialog.bottom).toBeLessThanOrEqual(viewport.height);expect(metrics.qr.width).toBeGreaterThan(metrics.poster.width*.78);expect(Math.abs(metrics.qr.width-metrics.qr.height)).toBeLessThan(1);expect(metrics.footer.bottom).toBeLessThanOrEqual(metrics.poster.bottom);expect(metrics.poster.bottom-metrics.footer.bottom).toBeLessThan(30);
 await body.hover();await page.mouse.wheel(0,500);if(await body.evaluate(e=>e.scrollHeight>e.clientHeight))await expect.poll(()=>body.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);await body.evaluate(e=>e.scrollTop=e.scrollHeight);await page.mouse.wheel(0,700);expect(await page.evaluate(()=>window.scrollY)).toBe(background);await expect(page.locator('#qr-download-poster')).toBeVisible();
 await page.screenshot({path:`output/admin-qr-layout-${viewport.width}.png`});
 const download=page.waitForEvent('download');await page.locator('#qr-download-poster').click();const poster=await download;expect(poster.suggestedFilename()).toBe('GatePass-BENGALURU-Welcome-Poster.png');if(viewport.width===1366)await poster.saveAs('output/admin-qr-poster.png');
 await page.getByRole('button',{name:'Close registration standee'}).click();await expect(page.locator('#qr-dialog')).toBeHidden();expect(await page.evaluate(()=>getComputedStyle(document.documentElement).overflowY)).not.toBe('hidden');
});
