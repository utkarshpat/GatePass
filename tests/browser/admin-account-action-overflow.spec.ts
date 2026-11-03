import {test,expect} from '@playwright/test';
for(const width of [390,1024,1366,1920])test(`account actions remain within their cards at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('/');await page.getByRole('textbox',{name:'Email or Staff ID',exact:true}).fill('admin1@example.com');await page.getByRole('textbox',{name:'Password',exact:true}).fill('Sopra@123');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/admin');
 await page.goto('/admin?view=projects');await expect(page.locator('.project-card').first()).toBeVisible();
 const bad=await page.locator('.project-card').evaluateAll(cards=>cards.flatMap(card=>{const bounds=card.getBoundingClientRect();return [...card.querySelectorAll('.project-card-actions button')].filter(button=>{const rect=button.getBoundingClientRect();return rect.width>0&&(rect.left<bounds.left-1||rect.right>bounds.right+1);}).map(button=>button.textContent);}));
 expect(bad).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await expect(page.getByRole('button',{name:'Areas & groups',exact:true})).toBeVisible();await page.screenshot({path:`output/account-card-actions-${width}.png`,fullPage:true});
});
