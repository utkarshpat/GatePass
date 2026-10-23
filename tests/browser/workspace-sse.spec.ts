import{test,expect,type Page,type BrowserContext}from'@playwright/test';
async function fixture(page:Page,context:BrowserContext){
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 await page.clock.install();
 await page.addInitScript(()=>{
  const original=window.fetch.bind(window);let stream:ReadableStreamDefaultController<Uint8Array>,offline=false,heartbeat:ReturnType<typeof setInterval>;
  (window as any).streamRequests=0;(window as any).signal=()=>stream.enqueue(new TextEncoder().encode('event: invalidate\ndata: {}\n\n'));
  (window as any).disconnect=()=>{offline=true;clearInterval(heartbeat);stream.close();};
  window.fetch=async(input,options)=>{
   if(String(input)!=='/api/workspace/events')return original(input,options);
   (window as any).streamRequests++;if(offline)return new Response('{}',{status:503});
   let timer:ReturnType<typeof setInterval>;const body=new ReadableStream<Uint8Array>({start(c){stream=c;c.enqueue(new TextEncoder().encode('event: ready\ndata: {}\n\n'));heartbeat=timer=setInterval(()=>c.enqueue(new TextEncoder().encode(': keepalive\n\n')),15000);},cancel(){clearInterval(timer);}});
   options!.signal!.addEventListener('abort',()=>{clearInterval(timer);try{stream.error(Error('aborted'));}catch{}},{once:true});
   return new Response(body,{headers:{'Content-Type':'text/event-stream'}});
  };
 });
 let count=1,reads=0;
 await page.route('**/api/guard/**',route=>{
  const action=new URL(route.request().url()).pathname.split('/').at(-1);
  if(action==='context')return route.fulfill({json:{displayName:'Guard',locations:[{locationId:1,locationName:'Noida'}]}});
  if(action==='duties')return route.fulfill({json:{duties:[{kind:'PROJECT',dutyId:'10',name:'Project Alpha'}]}});
  if(action==='visitors'){reads++;return route.fulfill({json:{visitors:Array.from({length:count},(_,n)=>({visitRequestId:'10000000-0000-4000-8000-'+String(n).padStart(12,'0'),personName:'Visitor '+n,publicPassNumber:'GP-'+n,requestType:'EXTERNAL',projectName:'Project Alpha',hostName:'Aditi Sharma',status:'APPROVED',passStatus:'ACTIVE',isInside:false,photoAvailable:false,validUntilUtc:new Date(Date.now()+86400000).toISOString()})),hasMore:false}});}
  return route.fulfill({json:{}});
 });
 await page.goto('/guard');await expect(page.locator('.guard-id-card')).toHaveCount(1);await page.clock.runFor(2000);await expect.poll(()=>page.evaluate('liveRefresh.online')).toBe(true);await expect(page.locator('#recent-scans')).toHaveAttribute('aria-busy','false');
 return{reads:()=>reads,add(){count++;}};
}
test('healthy SSE uses three complete safety reads over three idle minutes instead of nine polls',async({page,context})=>{
 const f=await fixture(page,context),start=f.reads();
 for(let i=1;i<=3;i++){await page.clock.runFor(60000);await expect.poll(()=>f.reads()).toBe(start+i);await expect(page.locator('#recent-scans')).toHaveAttribute('aria-busy','false');}
 expect(await page.evaluate('streamRequests')).toBe(1);
});
test('a burst invalidates once, new cards appear and an active field edit defers the fresh read',async({page,context})=>{
 const f=await fixture(page,context),start=f.reads();f.add();await page.evaluate(()=>{for(let i=0;i<100;i++)(window as any).signal();});await page.clock.runFor(1000);await expect(page.locator('.guard-id-card')).toHaveCount(2);expect(f.reads()).toBe(start+1);
 await page.locator('#visitor-search').focus();f.add();await page.evaluate('signal()');await page.clock.runFor(5000);expect(f.reads()).toBe(start+1);await page.locator('#refresh-recent').focus();await page.clock.runFor(1000);await expect(page.locator('.guard-id-card')).toHaveCount(3);expect(f.reads()).toBe(start+2);
});
test('disconnect restores ordinary polling while reconnect attempts back off',async({page,context})=>{
 const f=await fixture(page,context),start=f.reads();await page.evaluate('disconnect()');await expect.poll(()=>page.evaluate('liveRefresh.online')).toBe(false);f.add();await page.clock.runFor(20000);await expect(page.locator('.guard-id-card')).toHaveCount(2);expect(f.reads()).toBe(start+1);expect(await page.evaluate('streamRequests')).toBeLessThanOrEqual(4);
});
