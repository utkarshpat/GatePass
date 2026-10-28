import { test, expect } from '@playwright/test';

const id = '11111111-1111-4111-8111-111111111111';
const injected = '<img src="/__pentest_xss_probe" onerror="globalThis.__gatepassXss=1"><svg onload="globalThis.__gatepassXss=1">';
for (const width of [390, 1366]) {
  test(`reception renders hostile visitor, account, host and purpose fields as text at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 844 });
    await context.addCookies(['gp-staff-session', 'gp-staff-csrf'].map(name => ({ name, value: 'synthetic', url: 'http://localhost:18447' })));
    let probes = 0;
    await page.route('**/__pentest_xss_probe*', route => { probes++; return route.abort(); });
    const row = { visitRequestId: id, accessPassId: id, personName: injected, requestType: 'EXTERNAL', publicReference: 'V-SYN', publicPassNumber: 'GP-SYN', status: 'PENDING', passStatus: 'PENDING', projectName: injected, hostName: injected, hostEmail: 'host@example.invalid', isInside: false, validFromUtc: new Date(Date.now() - 3600000).toISOString(), validUntilUtc: new Date(Date.now() + 3600000).toISOString(), submittedAtUtc: new Date().toISOString(), printCount: 0 };
    await page.route('**/api/reception/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/me')) return route.fulfill({ json: { displayName: injected, currentDate: '2026-10-28', locations: [{ locationId: 1, locationCode: 'NOIDA', locationName: 'Noida', canPrint: false }] } });
      if (path.endsWith('/list')) return route.fulfill({ json: { visits: [row], cursor: null } });
      if (path.endsWith('/detail')) return route.fulfill({ json: { ...row, locationName: 'Noida', reason: injected, photoAvailable: false, movements: [] } });
      if (path.endsWith('/remind-host')) return route.fulfill({ json: { eligible: false, outcome: 'STATUS' } });
      return route.fulfill({ status: 403, json: { error: 'NOT_AUTHORIZED' } });
    });
    await page.goto('/reception');
    await expect(page.locator('#visit-rows tr')).toHaveCount(1);
    await expect(page.locator('.cell-project')).toContainText(injected);
    await expect(page.locator('.cell-host')).toContainText(injected);
    await page.locator('.visit-person').click();
    await expect(page.locator('#detail-fields')).toContainText(injected);
    await expect(page.locator('#visit-dialog img[src="/__pentest_xss_probe"], #visit-dialog svg[onload]')).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(globalThis, '__gatepassXss'))).toBeUndefined();
    expect(probes).toBe(0);
  });

  test(`authenticated email details render hostile identity and purpose fields as text at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    let probes = 0;
    await page.route('**/__pentest_xss_probe*', route => { probes++; return route.abort(); });
    await page.route('**/api/email/host/detail', route => route.fulfill({ json: { visitRequestId: id, personName: injected, publicReference: 'V-SYN', locationName: 'Noida', projectName: injected, hostName: injected, reason: injected, validFromUtc: new Date(Date.now() - 3600000).toISOString(), validUntilUtc: new Date(Date.now() + 3600000).toISOString(), status: 'PENDING', passStatus: 'PENDING', canDecide: false, canCancel: false, photoAvailable: false, snapshotVersion: 1, snapshotHash: 'a'.repeat(64) } }));
    await page.goto('/approval/' + id);
    await expect(page.locator('#fields')).toContainText(injected);
    await expect(page.locator('#fields img, #fields svg, #fields script')).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(globalThis, '__gatepassXss'))).toBeUndefined();
    expect(probes).toBe(0);
  });
}
