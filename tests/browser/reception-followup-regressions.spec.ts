import{test,expect,type Page,type BrowserContext}from'@playwright/test';
const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=';
const row=(id:string,name:string)=>({visitRequestId:id,accessPassId:'20000000-0000-4000-8000-000000000001',personName:name,publicReference:'V-'+name,publicPassNumber:'GP-'+name,requestType:'EXTERNAL',status:'APPROVED',passStatus:'ACTIVE',isInside:false,printCount:1,projectName:'Project Alpha',hostName:'Meera Singh',locationName:'Noida',reason:'Synthetic regression',movements:[],photoAvailable:false,submittedAtUtc:'2026-10-24T06:00:00.000Z',validFromUtc:'2026-10-24T00:00:00.000Z',validUntilUtc:'2030-10-24T00:00:00.000Z',returnedAtUtc:null as string|null});
async function fixture(page:Page,context:BrowserContext){
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic-regression',url:'http://localhost:18447'})));
 const state={denied:false,office:1,contextDenied:false,actionCalls:0,listCalls:0,historyFailure:0,holdList:false,releaseList:()=>{},returned:false};
 const visits=()=>[row(a,'Asha Rao'),row(b,'Rohan Mehta')].map(r=>({...r,...(state.returned&&r.visitRequestId===a?{returnedAtUtc:'2026-10-24T09:00:00.000Z',passStatus:'REVOKED'}:{})}));
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();
  if(path==='/api/reception/me')return route.fulfill(state.contextDenied?{status:403,json:{error:'NOT_AUTHORIZED'}}:{json:{currentDate:'2026-10-24',displayName:'Reception regression',locations:[{locationId:state.office,locationName:state.office===1?'Noida':'Chennai',canPrint:true}]}});
  if(path==='/api/reception/list'){
   state.listCalls++;if(state.holdList)await new Promise<void>(resolve=>{state.releaseList=resolve;});
   if(state.historyFailure){if(body.cursor)return route.fulfill({status:state.historyFailure,json:{error:'SYNTHETIC_FAILURE'}});return route.fulfill({json:{visits:[visits()[0]],cursor:{lastSubmittedAtUtc:'2026-10-24T06:00:00.000Z',lastVisitRequestId:a}}});}
   return route.fulfill({json:{visits:visits(),cursor:null,pendingReturnCount:0}});
  }
  if(path==='/api/reception/detail')return route.fulfill({json:visits().find(v=>v.visitRequestId===body.visitRequestId)});
  if(path==='/api/reception/preview')return route.fulfill({json:{mimeType:'image/png',imageBase64:png}});
  if(path==='/api/reception/return'){state.returned=true;state.holdList=true;return route.fulfill({json:{returnedAtUtc:'2026-10-24T09:00:00.000Z'}});}
  if(path==='/api/operations/actions'){state.actionCalls++;return route.fulfill(state.denied||body.locationId!==state.office?{status:403,json:{error:'NOT_AUTHORIZED'}}:{json:{category:body.category,checkedAtUtc:new Date().toISOString(),counts:{pending:1,expiredInside:0,unreturned:0},items:[{visitRequestId:a,personName:'Asha Rao',publicPassNumber:'GP-ASHA'}],cursor:null}});}
  if(path==='/api/operations/remind')return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});
  if(path.endsWith('/remind-host'))return route.fulfill({json:{eligible:false}});
  return route.fulfill({json:{}});
 });
 return state;
}
async function open(page:Page){await page.goto('/reception');await expect(page.locator('#visit-rows tr')).toHaveCount(2);await page.evaluate('liveRefresh.close()');}
for(const denial of ['read','notify'])test('Action centre resumes periodic reads after '+denial+' denial and successful manual retry',async({page,context})=>{
 const state=await fixture(page,context);await page.clock.install();await open(page);await page.locator('#open-action-centre').click();await expect(page.locator('.action-row')).toHaveCount(1);
 if(denial==='read'){state.denied=true;await page.locator('#action-centre').getByRole('button',{name:'Refresh',exact:true}).click();}else await page.locator('.action-notify').click();
 await expect(page.locator('.action-row')).toHaveCount(0);state.denied=false;await page.locator('#action-centre').getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.locator('.action-row')).toHaveCount(1);await expect(page.locator('#action-items')).toHaveAttribute('aria-busy','false');const before=state.actionCalls;await page.clock.fastForward(21000);await expect.poll(()=>state.actionCalls,{timeout:2000}).toBe(before+1);
});
for(const change of ['replacement','denial'])test('authoritative reception scope '+change+' clears the prior Action centre immediately',async({page,context})=>{
 const state=await fixture(page,context);await open(page);await page.locator('#open-action-centre').click();await expect(page.locator('.action-row')).toHaveCount(1);if(change==='replacement')state.office=2;else state.contextDenied=true;await page.evaluate('refreshCalendar()');
 await expect(page.locator('#action-centre')).toBeHidden({timeout:2000});await expect(page.locator('.action-row')).toHaveCount(0);await expect(page.locator('.action-tab-count:visible')).toHaveCount(0);
 if(change==='replacement'){await expect(page.locator('#office-name')).toHaveText('Chennai');await page.locator('#open-action-centre').click();await expect(page.locator('.action-navigation .hint')).toHaveText('Chennai');await expect(page.locator('.action-row')).toHaveCount(1);}else await expect(page.locator('#visit-rows tr')).toHaveCount(0);
});
for(const status of [403,500])test('history continuation '+status+' '+(status===403?'clears protected rows':'retains a marked partial result'),async({page,context})=>{
 const state=await fixture(page,context);await open(page);state.historyFailure=status;await page.locator('#open-history').click();
 if(status===403){await expect(page.locator('#history-dialog')).toBeHidden({timeout:2000});await expect(page.locator('#history-rows .history-row')).toHaveCount(0);await expect(page.locator('#visit-rows tr')).toHaveCount(0);expect(await page.evaluate('state.accessDenied')).toBe(true);}
 else{await expect(page.locator('#history-dialog')).toBeVisible();await expect(page.locator('#history-status')).toContainText('History could not be fully loaded.');await expect(page.locator('#history-rows .history-row')).toHaveCount(1);await expect(page.locator('#visit-rows tr')).toHaveCount(2);}
});
for(const selection of ['unchanged','newer','closed'])test('pass-return completion respects '+selection+' selection during its delayed list refresh',async({page,context})=>{
 const state=await fixture(page,context);await open(page);await page.getByRole('button',{name:'View pass for Asha Rao',exact:true}).click();await expect(page.locator('#detail-card-control select')).toBeVisible();await page.locator('#detail-card-control select').selectOption('RETURN');await page.locator('#confirm-devices-return').click();await expect(page.locator('#devices-return-dialog')).toBeHidden();await expect(page.locator('#visit-dialog')).toBeHidden();await expect.poll(()=>state.listCalls).toBe(2);
 if(selection!=='unchanged'){await page.getByRole('button',{name:'View pass for Rohan Mehta',exact:true}).click();await expect(page.locator('#detail-name')).toHaveText('Rohan Mehta');if(selection==='closed')await page.locator('#close-visit').click();}
 state.holdList=false;state.releaseList();await expect.poll(()=>page.evaluate('state.listBusy')).toBe(false);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 if(selection==='closed'){await expect(page.locator('#visit-dialog')).toBeHidden({timeout:2000});expect(await page.evaluate('state.selected')).toBeNull();}else{await expect(page.locator('#visit-dialog')).toBeVisible();await expect(page.locator('#detail-name')).toHaveText(selection==='newer'?'Rohan Mehta':'Asha Rao',{timeout:2000});}
});
