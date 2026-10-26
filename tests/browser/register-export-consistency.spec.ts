import {test,expect,type Page,type BrowserContext} from '@playwright/test';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const rows=(start:number,count:number)=>Array.from({length:count},(_,i)=>({visitRequestId:id(start+i),personName:'Visitor '+(start+i),status:'APPROVED',presence:'OUTSIDE',printStatus:'NOT_PRINTED'}));
async function setup(page:Page,context:BrowserContext,register:(d:any,route:any)=>Promise<any>,permission:boolean|((d:any)=>boolean)=true){
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 await page.route('**/api/admin/**',async route=>{
  const action=route.request().url().split('/').at(-1),d=route.request().postDataJSON();
  if(action==='register')return register(d,route);
  const responses:any={context:{displayName:'Scoped Admin',locations:[{locationId:1,locationName:'Noida',locationCode:'NOIDA'},{locationId:2,locationName:'Chennai',locationCode:'CHENNAI'}]},projects:{projects:[],cursor:null},scope:{userId:id(999),currentDate:'2026-10-23',canReadVisits:true,canExport:true,canReport:false,canAudit:false,canManageRoles:false,canAssignGuards:false,roles:[{roleCode:'LOCATION_ADMIN',scopeType:'LOCATION'}],delegations:[]}};
  if(action==='scope')responses.scope.canExport=typeof permission==='function'?permission(d):permission;
  return route.fulfill({json:responses[action!]??{}});
 });
 await page.goto('/admin');await page.locator('[data-admin-view=reports]').click();if(permission===false)await expect(page.locator('#register-export')).toBeHidden();else await expect(page.locator('#register-export')).toBeEnabled();
}
test('stable export reads the fresh total and downloads every page',async({page,context})=>{
 const calls:number[]=[];await setup(page,context,async(d,route)=>{if(d.export)calls.push(d.page);return route.fulfill({json:{rows:rows(d.page===2?51:1,d.export?50:1),total:d.export?100:1,page:d.page,pageSize:50,datasetVersion:d.export?'a'.repeat(64):null}});});
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#register-export').click()]);expect(download.suggestedFilename()).toMatch(/\.xlsx$/u);expect(calls).toEqual([1,2]);await expect(page.locator('#report-status')).toHaveText('100 visits exported to Excel.');
});
test('export accepts 200-row chunks and retains the exact final chunk boundary',async({page,context})=>{
 const calls:number[]=[];await setup(page,context,async(d,route)=>{if(d.export){calls.push(d.page);return route.fulfill({json:{rows:rows((d.page-1)*200+1,d.page===1?200:1),total:201,page:d.page,pageSize:200,datasetVersion:'a'.repeat(64)}});}return route.fulfill({json:{rows:rows(1,1),total:1,page:1,pageSize:50}});});
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#register-export').click()]);expect(download.suggestedFilename()).toMatch(/\.xlsx$/u);expect(calls).toEqual([1,2]);await expect(page.locator('#report-status')).toHaveText('201 visits exported to Excel.');
});

for(const changed of [false,true])test('snapshot export '+(changed?'refuses failed final validation':'validates once before downloading'),async({page,context})=>{
 const snapshotId=id(9000),calls:any[]=[];let downloads=0;page.on('download',()=>downloads++);
 await setup(page,context,async(d,route)=>{
  if(!d.export)return route.fulfill({json:{rows:rows(1,1),total:1,page:1,pageSize:50}});
  calls.push(d);if(d.cancelExport)return route.fulfill({json:{cancelled:true}});
  if(d.finishExport&&changed)return route.fulfill({status:409,json:{error:'CONFLICT'}});
  return route.fulfill({json:{rows:rows(d.page===2?201:1,d.page===2?1:200),total:201,page:d.page,pageSize:200,datasetVersion:'a'.repeat(64),exportSnapshotId:snapshotId,...(d.finishExport?{exportValidated:true}:{})}});
 });
 if(changed){await page.locator('#register-export').click();await expect(page.locator('#report-status')).toContainText('changed during export');await expect.poll(()=>calls.some(d=>d.cancelExport)).toBe(true);expect(downloads).toBe(0);}
 else{const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#register-export').click()]);expect(download.suggestedFilename()).toMatch(/\.xlsx$/u);expect(calls.map(d=>[d.page,!!d.finishExport])).toEqual([[1,false],[2,false],[1,true]]);}
 expect(calls[0].snapshot).toBe(true);expect(calls[0].snapshotId).toBeUndefined();expect(calls[1].snapshotId).toBe(snapshotId);
});
for(const change of ['insertion','same-count edit','duplicate row'])test('export refuses '+change+' between pages',async({page,context})=>{
 let downloads=0;page.on('download',()=>downloads++);
 await setup(page,context,async(d,route)=>route.fulfill({json:{rows:rows(d.page===2?(change==='duplicate row'?50:51):1,50),total:d.page===2&&change==='insertion'?101:100,page:d.page,pageSize:50,datasetVersion:d.page===2&&change!=='duplicate row'?'b'.repeat(64):'a'.repeat(64)}}));
 await page.locator('#register-export').click();await expect(page.locator('#report-status')).toContainText('changed during export');await expect(page.locator('#register-export')).toBeEnabled();expect(downloads).toBe(0);
});

for(const rejection of [409,403])test('export revalidates '+(rejection===409?'data changes':'revoked permission')+' after workbook generation',async({page,context})=>{
 const snapshotId=id(9990);let finished=0,cancelled=0,downloads=0;page.on('download',()=>downloads++);
 await setup(page,context,async(d,route)=>{
  if(!d.export)return route.fulfill({json:{rows:rows(1,1),total:1,page:1,pageSize:50}});
  if(d.cancelExport){cancelled++;return route.fulfill({json:{cancelled:true}});}
  if(d.finishExport){finished++;return route.fulfill({status:rejection,json:{error:'CHANGED'}});}
  return route.fulfill({json:{rows:rows(1,1),total:1,page:1,pageSize:200,datasetVersion:'a'.repeat(64),exportSnapshotId:snapshotId}});
 });
 await page.evaluate(`workbookBlob=async()=>{globalThis.workbookHeld=true;return new Promise(resolve=>{globalThis.releaseWorkbook=()=>resolve(new Blob(['synthetic workbook']));});};`);
 await page.locator('#register-export').click();await expect.poll(()=>page.evaluate('globalThis.workbookHeld===true')).toBe(true);expect(finished).toBe(0);
 await page.evaluate('releaseWorkbook()');await expect.poll(()=>finished).toBe(1);await expect.poll(()=>cancelled).toBe(1);expect(downloads).toBe(0);
 if(rejection===409)await expect(page.locator('#report-status')).toContainText('changed during export');else expect(await page.evaluate('consoleState.scope')).toBeNull();
});
test('old office export denial cannot clear or interrupt a new office export',async({page,context})=>{
 let release:()=>void=()=>{},releaseNew:()=>void=()=>{},pending=false,newPending=false;const gate=new Promise<void>(r=>release=r),newGate=new Promise<void>(r=>releaseNew=r);
 await setup(page,context,async(d,route)=>{if(d.export&&d.locationId===1){pending=true;await gate;return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});}if(d.export){newPending=true;await newGate;}return route.fulfill({json:{rows:rows(d.locationId,1),total:1,page:d.page,pageSize:50,datasetVersion:'a'.repeat(64)}});});
 await page.locator('#register-export').click();await expect.poll(()=>pending).toBe(true);await page.locator('#admin-office-trigger').click();await page.getByRole('option',{name:'Chennai',exact:true}).click();await expect(page.locator('#report-list')).toContainText('Visitor 2');await expect(page.locator('#register-export')).toBeEnabled();await page.locator('#register-export').click();await expect.poll(()=>newPending).toBe(true);
 const oldResponse=page.waitForResponse(r=>r.status()===403&&r.url().endsWith('/register'));release();await oldResponse;await expect(page.locator('[data-admin-view=reports]')).toBeVisible();await expect(page.locator('#report-list')).toContainText('Visitor 2');await expect(page.locator('#register-export')).toBeDisabled();const downloading=page.waitForEvent('download');releaseNew();const download=await downloading;expect(download.suggestedFilename()).toContain('Chennai');await expect(page.locator('#register-export')).toBeEnabled();
});

test('obsolete export 401 cannot redirect the newly selected office',async({page,context})=>{
 let release:()=>void=()=>{},held=false;const gate=new Promise<void>(resolve=>release=resolve);
 await setup(page,context,async(d,route)=>{if(d.export&&d.locationId===1){held=true;await gate;return route.fulfill({status:401,json:{error:'UNAUTHENTICATED'}});}return route.fulfill({json:{rows:rows(d.locationId,1),total:1,page:1,pageSize:50}});});
 await page.locator('#register-export').click();await expect.poll(()=>held).toBe(true);await page.locator('#admin-office-trigger').click();await page.getByRole('option',{name:'Chennai',exact:true}).click();await expect(page.locator('#report-list')).toContainText('Visitor 2');
 const response=page.waitForResponse(r=>r.status()===401&&r.url().endsWith('/register'));release();await response;await expect(page).toHaveURL(/\/admin$/u);await expect(page.locator('#report-list')).toContainText('Visitor 2');await expect(page.locator('#register-export')).toBeEnabled();
});

test('visit read permission permits the register while export remains unavailable',async({page,context})=>{
 let exports=0;await setup(page,context,async(d,route)=>{if(d.export)exports++;return route.fulfill({json:{rows:rows(1,1),total:1,page:1,pageSize:50}});},false);
 await expect(page.locator('#report-list')).toContainText('Visitor 1');
 await page.evaluate(()=>{(window as any).exportRegister();});
 expect(exports).toBe(0);await expect(page.locator('#register-export')).toBeHidden();
});

test('changing to a scope without export authority hides the action after records load',async({page,context})=>{
 let exports=0;await setup(page,context,async(d,route)=>{if(d.export)exports++;return route.fulfill({json:{rows:rows(d.locationId,1),total:1,page:1,pageSize:50}});},d=>d.locationId===1);
 await page.locator('#admin-office-trigger').click();await page.getByRole('option',{name:'Chennai',exact:true}).click();
 await expect(page.locator('#report-list')).toContainText('Visitor 2');await expect(page.locator('#register-export')).toBeHidden();
 await page.evaluate(()=>{(window as any).exportRegister();});expect(exports).toBe(0);
});
