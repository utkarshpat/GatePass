import {test,expect}from'@playwright/test';
for(const width of [390,1366])test('registration Back button has readable text immediately when re-enabled at '+width+'px',async({page})=>{
 await page.setViewportSize({width,height:844});await page.goto('/office/noida');await page.getByRole('button',{name:/Visitor Check-in/u}).click();const back=page.locator('#previous-step');await expect(back).toBeEnabled();await back.evaluate((el:HTMLButtonElement)=>{el.disabled=true;});await page.waitForTimeout(250);
 const contrast=await back.evaluate((el:HTMLButtonElement)=>{el.disabled=false;const s=getComputedStyle(el),luminance=(rgb:string)=>{const channels=rgb.match(/[\d.]+/g)!.slice(0,3).map(Number).map(c=>c/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;},a=luminance(s.color),b=luminance(s.backgroundColor);return(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);});expect(contrast).toBeGreaterThanOrEqual(4.5);
});
