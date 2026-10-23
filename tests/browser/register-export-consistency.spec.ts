import {test,expect,type Page,type BrowserContext} from '@playwright/test';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const rows=(start:number,count:number)=>Array.from({length:count},(_,i)=>({visitRequestId:id(start+i),personName:'Visitor '+(start+i),status:'APPROVED',presence:'OUTSIDE',printStatus:'NOT_PRINTED'}));
async function setup(page:Page,context:BrowserContext,register:(d:any,route:any)=>Promise<any>){
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 await page.route('**/api/admin/**',async route=>{
  const action=route.request().url().split('/').at(-1),d=route.request().postDataJSON();
  if(action==='register')return register(d,route);
  const responses:any={context:{displayName:'Scoped Admin',locations:[{locationId:1,locationName:'Noida',locationCode:'NOIDA'},{locationId:2,locationName:'Chennai',locationCode:'CHENNAI'}]},projects:{projects:[],cursor:null},scope:{userId:id(999),currentDate:'2026-10-23',canReadVisits:true,canReport:false,canAudit:false,canManageRoles:false,canAssignGuards:false,roles:[{roleCode:'LOCATION_ADMIN',scopeType:'LOCATION'}],delegations:[]}};
  return route.fulfill({json:responses[action!]??{}});
 });
 await page.goto('/admin');await page.locator('[data-admin-view=reports]').click();await expect(page.locator('#register-export')).toBeEnabled();
}
test('stable export reads the fresh total and downloads every page',async({page,context})=>{
 const calls:number[]=[];await setup(page,context,async(d,route)=>{if(d.export)calls.push(d.page);return route.fulfill({json:{rows:rows(d.page===2?51:1,d.export?50:1),total:d.export?100:1,page:d.page,pageSize:50,datasetVersion:d.export?'a'.repeat(64):null}});});
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#register-export').click()]);expect(download.suggestedFilename()).toMatch(/\.xlsx$/u);expect(calls).toEqual([1,2]);await expect(page.locator('#report-status')).toHaveText('100 visits exported to Excel.');
});
for(const change of ['insertion','same-count edit','duplicate row'])test('export refuses '+change+' between pages',async({page,context})=>{
 let downloads=0;page.on('download',()=>downloads++);
 await setup(page,context,async(d,route)=>route.fulfill({json:{rows:rows(d.page===2?(change==='duplicate row'?50:51):1,50),total:d.page===2&&change==='insertion'?101:100,page:d.page,pageSize:50,datasetVersion:d.page===2&&change!=='duplicate row'?'b'.repeat(64):'a'.repeat(64)}}));
 await page.locator('#register-export').click();await expect(page.locator('#report-status')).toContainText('changed during export');await expect(page.locator('#register-export')).toBeEnabled();expect(downloads).toBe(0);
});
test('old office export denial cannot clear or interrupt a new office export',async({page,context})=>{
 let release:()=>void=()=>{},releaseNew:()=>void=()=>{},pending=false,newPending=false;const gate=new Promise<void>(r=>release=r),newGate=new Promise<void>(r=>releaseNew=r);
 await setup(page,context,async(d,route)=>{if(d.export&&d.locationId===1){pending=true;await gate;return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});}if(d.export){newPending=true;await newGate;}return route.fulfill({json:{rows:rows(d.locationId,1),total:1,page:d.page,pageSize:50,datasetVersion:'a'.repeat(64)}});});
 await page.locator('#register-export').click();await expect.poll(()=>pending).toBe(true);await page.locator('#admin-office-trigger').click();await page.getByRole('option',{name:'Chennai',exact:true}).click();await expect(page.locator('#report-list')).toContainText('Visitor 2');await expect(page.locator('#register-export')).toBeEnabled();await page.locator('#register-export').click();await expect.poll(()=>newPending).toBe(true);
 const oldResponse=page.waitForResponse(r=>r.status()===403&&r.url().endsWith('/register'));release();await oldResponse;await expect(page.locator('[data-admin-view=reports]')).toBeVisible();await expect(page.locator('#report-list')).toContainText('Visitor 2');await expect(page.locator('#register-export')).toBeDisabled();const downloading=page.waitForEvent('download');releaseNew();const download=await downloading;expect(download.suggestedFilename()).toContain('Chennai');await expect(page.locator('#register-export')).toBeEnabled();
});
