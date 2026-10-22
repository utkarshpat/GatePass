import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) }))).toEqual([]);
}
async function staffLogin(page: Page, id: string) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Email or Staff ID', exact: true }).fill(id);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Sopra@123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

for (const size of [{ width: 390, height: 844 }, { width: 1366, height: 768 }]) {
  test(`public entry and visitor form fit ${size.width}px and are accessible`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/office/noida');
    await expect(page.getByRole('button', { name: /SSI Employee/u })).toBeVisible();
    await noHorizontalOverflow(page);
    await accessible(page);
    await page.getByRole('button', { name: /Visitor Check-in/u }).click();
    await expect(page.getByRole('textbox', { name: /^Name/u })).toBeEnabled();
    await noHorizontalOverflow(page);
    await accessible(page);
    await page.getByRole('textbox', { name: /^Name/u }).fill('CI Visitor');
    await page.getByRole('textbox', { name: /^Mobile/u }).fill('9876543210');
    await page.getByRole('button', { name: '+ Add visitor', exact: true }).click();
    await expect(page.locator('.visitor-summary').first()).toBeVisible();
    await noHorizontalOverflow(page);
    await page.locator('.remove-visitor').last().click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('combobox', { name: /^Project/u })).toBeEnabled();
    await expect(page.locator('#host-search')).toBeDisabled();
    await noHorizontalOverflow(page);
    await accessible(page);
  });
}

test('employee authentication resolves assigned identity and photo crop review', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/office/noida');
  await page.getByRole('button', { name: /SSI Employee/u }).click();
  await page.getByRole('textbox', { name: 'Sopra Steria Email', exact: true }).fill('employee2@example.com');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Sopra@123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#employee-name')).toHaveText('Employee 2');
  await page.getByRole('combobox', { name: /^Reason/u }).click();
  await page.getByRole('option', { name: 'Forgot my card', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const sharp = (await import('sharp')).default;
  const picture = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#365870' } }).png().toBuffer();
  await page.locator('#photo-file').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: picture });
  await expect(page.locator('#photo-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.locator('#review-step')).toBeVisible();
  await expect(page.locator('#review-people img')).toHaveJSProperty('naturalWidth', 600);
  await expect(page.locator('#review-people img')).toHaveJSProperty('naturalHeight', 800);
  await noHorizontalOverflow(page);
  await accessible(page);
  // Submit/QR decoding, scope changes and idempotency are tested by the SQL/HTTP
  // harness. This browser case intentionally leaves no issued identity behind.
});

test('guard dashboard, project filter, language and profile work without a sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await staffLogin(page, 'gaurd1@example.com');
  await expect(page).toHaveURL(/\/guard$/u);
  await expect(page.locator('#scan-fab')).toBeEnabled();
  await expect(page.getByRole('searchbox')).toBeEnabled();
  await expect(page.locator('aside, .guard-sidebar')).toHaveCount(0);
  await noHorizontalOverflow(page);
  await accessible(page);
  await page.locator('#project-filter-trigger').click();
  await expect(page.getByRole('option', { name: 'Project 1 · Project', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#account-toggle').click();
  await page.locator('#language-menu').click();
  await page.getByRole('menuitemradio', { name: 'English + हिन्दी', exact: true }).click();
  await expect(page.locator('#visitor-search-form')).toContainText('आगंतुक खोजें');
  await page.locator('[data-open-profile]').click();
  await expect(page.locator('#profile-assignments')).toContainText('Project 1');
  await page.locator('#close-profile').click();
  await noHorizontalOverflow(page);
});

test('reception and administration resolve their authorised workspaces', async ({ page }) => {
  await staffLogin(page, 'reception1@example.com');
  await expect(page).toHaveURL(/\/reception$/u);
  await expect(page.locator('#staff-loading')).toBeHidden();
  await noHorizontalOverflow(page);
  await accessible(page);
  // A new page/context prevents mixing role cookies in the same session.
});

test('admin sign-in resolves scoped management', async ({ page }) => {
  await staffLogin(page, 'admin1@example.com');
  await expect(page).toHaveURL(/\/admin$/u);
  await expect(page.locator('#page-status')).not.toContainText('Loading');
  await noHorizontalOverflow(page);
  await accessible(page);
});


test('employee in another office gets an approval flow and exact local project choices', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/office/bengaluru');
  await page.getByRole('button',{name:/SSI Employee/u}).click();
  await page.getByRole('textbox',{name:'Sopra Steria Email',exact:true}).fill('employee1@example.com');
  await page.getByRole('textbox',{name:'Password',exact:true}).fill('Sopra@123');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.locator('#employee-projects')).toHaveText('Access to this office requires host approval.');
  await page.getByRole('combobox',{name:/^Reason/u}).click();
  await page.getByRole('option',{name:'Forgot my card',exact:true}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.locator('#details-step')).toBeVisible();
  await expect(page.locator('#photo-step')).toBeHidden();
  await page.getByRole('button',{name:'+ Request project access',exact:true}).click();
  await page.locator('#project-trigger').click();
  await expect(page.getByRole('option',{name:'Project 1',exact:true})).toBeVisible();
  await page.getByRole('option',{name:'Project 1',exact:true}).click();
  await page.locator('#host-search').fill('employee1@example.com');
  await expect(page.locator('#host-feedback')).toContainText('No');
  await expect(page.locator('#host-results')).not.toContainText('employee1@example.com');
  await noHorizontalOverflow(page);
});


test('common duty hides movement queues and scoped admin can open guard assignment controls',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await staffLogin(page,'gaurd1@example.com');
 await expect(page.locator('#scan-fab')).toBeEnabled();
 await page.locator('#project-filter-trigger').click();
 await page.getByRole('option',{name:'Cafeteria · Common area',exact:true}).click();
 await expect(page.locator('.guard-queue-tabs')).toBeHidden();
 await noHorizontalOverflow(page);await accessible(page);
 await page.locator('#account-toggle').click();await page.locator('#staff-logout').click();await expect(page).toHaveURL(/\/$/u);
 await staffLogin(page,'admin1@example.com');
 await page.locator('#admin-office-trigger').click();await page.getByRole('option',{name:'Noida',exact:true}).click();await expect(page.locator('#office-name')).toHaveText('Noida');
 await expect(page.locator('#common-duties-open')).toBeVisible();
 const commonResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/common-duties');
 await page.locator('#common-duties-open').click();
 await expect(page.locator('#common-dialog')).toBeVisible();
 expect((await commonResponse).status(),'Common-duty read must succeed before rendering assignment options').toBe(200);
 await expect(page.locator('#common-area option').filter({hasText:/^Lobby$/u})).toHaveCount(1);
 await expect(page.locator('#common-area option').filter({hasText:/^Cafeteria$/u})).toHaveCount(1);
 await page.getByRole('tab',{name:'Assign Duty',exact:true}).click();
 await page.locator('#common-guard-search').fill('Guard 1');
 await expect(page.locator('#common-guard-results')).toContainText('Guard 1');
 await page.locator('#common-guard-results').getByRole('button',{name:'Guard 1',exact:true}).click();
 await expect(page.locator('#common-assign-button')).toBeEnabled();
 await noHorizontalOverflow(page);await accessible(page);
 await page.locator('#common-close').click();
});
for(const size of [{width:390,height:844},{width:1366,height:768}]){
 test(`email approval link is an accessible isolated sign-in at ${size.width}px without automatic decisions`,async({page})=>{
  await page.setViewportSize(size);const writes:string[]=[];page.on('request',r=>{if(r.url().includes('/api/email/host/decide'))writes.push(r.url());});
  await page.goto('/approval/00000000-0000-0000-0000-000000000001#decision=APPROVED');
  await expect(page.locator('#login')).toBeVisible();await expect(page.locator('#actions')).toBeHidden();await expect(page).toHaveURL(/\/approval\/00000000-0000-0000-0000-000000000001$/u);
  await expect(page.getByRole('textbox',{name:'Sopra Steria email'})).toBeVisible();expect(writes).toEqual([]);await noHorizontalOverflow(page);await accessible(page);
 });
}
