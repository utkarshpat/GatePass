import { test, expect } from "@playwright/test";
for (const workspace of ["admin", "reception"] as const)
  test(`native ${workspace} remount clears protected dialogs and replaces an aborted context read`, async ({
    page,
    context,
  }) => {
    await context.addCookies(
      ["gp-staff-session", "gp-staff-csrf"].map((name) => ({
        name,
        value: "synthetic-native-remount",
        url: "http://localhost:18447",
      })),
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let reads = 0,
      release = () => {};
    await page.route(`**/api/${workspace}/**`, async (route) => {
      const action = new URL(route.request().url()).pathname.split("/").at(-1);
      if (action === (workspace === "admin" ? "context" : "me")) {
        const first = ++reads === 1;
        if (first)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return route.fulfill({
          json: {
            displayName: first ? "Retired context" : "Current operator",
            currentDate: "2026-10-28",
            locations: [
              {
                locationId: 1,
                locationCode: "NOIDA",
                locationName: "Noida",
                canPrint: true,
              },
            ],
          },
        });
      }
      if (action === "projects")
        return route.fulfill({ json: { projects: [], cursor: null } });
      if (action === "scope")
        return route.fulfill({
          json: {
            userId: "11111111-1111-4111-8111-111111111111",
            currentDate: "2026-10-28",
            roles: [],
            delegations: [],
            canReadVisits: false,
            canReport: false,
            canManageRoles: false,
            canAssignGuards: false,
            canAudit: false,
          },
        });
      return route.fulfill({ json: { visits: [], cursor: null } });
    });
    await page.goto("/" + workspace);
    await expect.poll(() => reads).toBe(1);
    await page.evaluate(() => (window as any).__gatepassReactTest.unmount());
    expect(
      await page.evaluate(() =>
        (window as any).__gatepassReactTest.diagnostics(),
      ),
    ).toEqual({ scopes: 0, timers: 0, streams: 0 });
    await expect(page.locator("#app")).toBeEmpty();
    await expect(
      page.locator(".toast-region,.select-menu,#action-centre"),
    ).toHaveCount(0);
    await page.evaluate(() => (window as any).__gatepassReactTest.remount());
    await expect(page.locator("#staff-name")).toHaveText("Current operator");
    release();
    await expect(page.locator("#staff-name")).not.toContainText("Retired");
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__gatepassReactTest.diagnostics().scopes,
        ),
      )
      .toBe(1);
    expect(reads).toBe(2);
    expect(errors).toEqual([]);
  });
test("React guard remount releases widget timers, streams, portals and stale callbacks", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/guard/context")
      return route.fulfill({
        json: {
          displayName: "Guard",
          locations: [
            { locationId: 1, locationCode: "NOIDA", locationName: "Noida" },
          ],
        },
      });
    if (url.pathname === "/api/guard/duties")
      return route.fulfill({ json: { duties: [] } });
    return route.fulfill({
      json: { visitors: [], total: 0, hasMore: false, cursor: null },
    });
  });
  await page.goto("/guard");
  // The server's existing cookie gate still applies before any React script is served.
  if (new URL(page.url()).pathname === "/") {
    await page.context().addCookies([
      {
        name: "gp-staff-session",
        value: "synthetic-react-shell",
        url: "http://localhost:18447",
      },
    ]);
    await page.goto("/guard");
  }
  await expect(page.locator("#scan-fab")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__gatepassReactTest?.diagnostics().scopes,
      ),
    )
    .toBe(1);
  await page.evaluate(() => (window as any).__gatepassReactTest.unmount());
  await expect(page.locator("#app")).toBeEmpty();
  expect(
    await page.evaluate(() =>
      (window as any).__gatepassReactTest.diagnostics(),
    ),
  ).toEqual({ scopes: 0, timers: 0, streams: 0 });
  await expect(
    page.locator(".toast-region,.select-menu,#action-centre"),
  ).toHaveCount(0);
  await page.evaluate(() => (window as any).__gatepassReactTest.remount());
  await expect(page.locator("#scan-fab")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__gatepassReactTest.diagnostics().scopes,
      ),
    )
    .toBe(1);
  await expect(page.locator("#action-centre")).toHaveCount(1);
  expect(errors).toEqual([]);
});
test("React staff remount installs one submit handler and clears password state", async ({
  page,
}) => {
  let logins = 0;
  await page.route("**/api/staff/**", (route) => {
    if (route.request().url().endsWith("/login")) {
      logins++;
      return route.fulfill({
        status: 401,
        json: { error: "NOT_AUTHENTICATED" },
      });
    }
    return route.fulfill({ status: 401, json: { error: "NOT_AUTHENTICATED" } });
  });
  await page.goto("/");
  await page.locator("#entry-password").fill("private-unsubmitted-test");
  await page.evaluate(() => (window as any).__gatepassReactTest.unmount());
  await page.evaluate(() => (window as any).__gatepassReactTest.remount());
  await expect(page.locator("#entry-password")).toHaveValue("");
  await page.locator("#entry-login").fill("guard@example.invalid");
  await page.locator("#entry-password").fill("wrong-test-passphrase");
  await page.locator("#entry-submit").click();
  await expect(page.getByRole("alert")).toContainText("Unable to sign in");
  expect(logins).toBe(1);
});
test("restored staff bootstrap replaces the aborted session probe", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "gp-staff-csrf",
      value: "synthetic-react-restore",
      url: "http://localhost:18447",
    },
  ]);
  let reads = 0,
    release = () => {};
  await page.route("**/api/staff/me", async (route) => {
    const first = ++reads === 1;
    if (first)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return route.fulfill({
      json: {
        displayName: first ? "Obsolete staff" : "Restored staff",
        workspaces: [],
      },
    });
  });
  await page.goto("/");
  await expect(page.locator("#entry-loading")).toBeVisible();
  await expect.poll(() => reads).toBe(1);
  await page.evaluate(() => {
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
  });
  await expect(page.locator("#entry-name")).toHaveText("Restored staff");
  release();
  await expect(page.locator("#entry-loading")).toBeHidden();
  await expect(page.locator("#entry-name")).not.toContainText("Obsolete");
  expect(reads).toBe(2);
});
test("retired visitor initialization cannot write into a remounted page", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let resets = 0,
    release = () => {};
  await page.route("**/api/registration/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/reset") && ++resets === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return route.fulfill({
      json: path.endsWith("/options")
        ? {
            locationId: 1,
            locationCode: "NOIDA",
            locationName: "Noida",
            currentDate: "2026-10-28",
            maxVisitDate: "2027-01-26",
            projects: [],
            hosts: [],
          }
        : {},
    });
  });
  await page.goto("/office/noida");
  await page.locator("#visitor-choice").click();
  await expect.poll(() => resets).toBe(1);
  await page.evaluate(() => (window as any).__gatepassReactTest.unmount());
  await page.evaluate(() => (window as any).__gatepassReactTest.remount());
  release();
  await expect(page.locator("#landing")).toBeVisible();
  await page.locator("#visitor-choice").click();
  await expect(page.locator("#flow")).toBeVisible();
  await expect(page.locator("#next-step")).toBeEnabled();
  await expect(page.locator(".toast-region [role=alert]")).toHaveCount(0);
  expect(errors).toEqual([]);
});
