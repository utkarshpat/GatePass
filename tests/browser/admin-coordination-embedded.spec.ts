import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
for (const width of [390, 1366])
  test(`coordination retains the Admin shell at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page
      .getByRole("textbox", { name: "Email or Staff ID", exact: true })
      .fill("admin1@example.com");
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill("Sopra@123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/admin");
    await expect(page.locator("#account-toggle")).toBeEnabled();
    await page
      .locator(".admin-header")
      .evaluate((header) => header.setAttribute("data-retained-shell", "yes"));
    if (width < 901)
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    await (
      width < 901
        ? page.getByRole("dialog", { name: "Navigation", exact: true })
        : page.getByRole("navigation", { name: "Administration", exact: true })
    )
      .getByRole("link", { name: "Visit coordination", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\?view=coordination/u);
    await expect(page.locator(".admin-layout")).toHaveCount(1);
    await expect(page.locator(".cp-header")).toHaveCount(0);
    await expect(page.locator(".staff-section-navigation")).toHaveCount(0);
    await expect(page.locator(".admin-header")).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "Visit Coordination", exact: true }),
    ).toBeVisible();
    if (width >= 901)
      await expect(page.locator(".admin-header")).toHaveAttribute(
        "data-retained-shell",
        "yes",
      );
    await page.locator("#account-toggle").click();
    await expect(
      page.getByRole("menuitem", { name: "Profile", exact: true }),
    ).toBeVisible();
    await page.locator("#account-toggle").click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      axe.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
    await page.screenshot({
      path: `output/admin-embedded-coordination-${width}.png`,
      fullPage: true,
    });
    if (width < 901) {
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
      await page
        .getByRole("link", { name: "Accounts & areas", exact: true })
        .click();
    } else await page.locator('[data-admin-view="projects"]').click();
    await expect(
      page.getByRole("heading", {
        name: "Accounts & areas",
        exact: true,
        level: 2,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Areas & groups", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Approval & notification groups",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Create visit group", exact: false }),
    ).toBeVisible();
    await expect(page.locator(".admin-header")).toHaveCount(1);
  });
test("old coordination links resolve into the authorized Admin layout", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Email or Staff ID", exact: true })
    .fill("admin1@example.com");
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("Sopra@123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin");
  await page.goto("/coordination?settings=groups&office=1");
  await expect(page).toHaveURL(/\/admin\?.*view=coordination/u);
  await expect(
    page.getByRole("button", { name: "Create visit group", exact: false }),
  ).toBeVisible();
  await expect(page.locator(".admin-header")).toHaveCount(1);
});

test("embedded visit deep links and settings retain their Admin route through reload", async ({
  page,
}) => {
  const id = "00000000-0000-0000-0000-000000009999",
    guest = "Synthetic embedded route guest",
    start = new Date(Date.now() + 86400000).toISOString(),
    until = new Date(Date.now() + 90000000).toISOString();
  const row = {
    id,
    revision: 1,
    state: "SUBMITTED",
    visitorName: guest,
    locationName: "Noida",
    locationId: 1,
    vip: false,
    hostName: "Synthetic host",
    startsAtUtc: start,
    untilUtc: until,
  };
  // Only synthetic visit content is stubbed. Admin authentication, office, profile and scope are real.
  await page.route("**/api/coordination/list", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ visits: [row], hasMore: false }),
    }),
  );
  await page.route("**/api/coordination/detail", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...row,
        version: 1,
        actorId: id,
        canEdit: false,
        canManage: true,
        projects: [],
        approvals: [],
        tasks: [],
        threads: [],
        activity: [],
      }),
    }),
  );
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Email or Staff ID", exact: true })
    .fill("admin1@example.com");
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("Sopra@123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin");
  await page.goto("/admin?view=coordination");
  await page.locator(".cp-visit").filter({ hasText: guest }).click();
  await expect(page).toHaveURL(new RegExp("view=coordination.*#visit=" + id));
  await expect(
    page.getByRole("heading", { name: guest, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: guest, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".admin-header")).toHaveCount(1);
  await page.getByRole("button", { name: "All visits", exact: false }).click();
  await expect(page).toHaveURL(/view=coordination(?!.*#visit)/);
  await page.locator('[data-admin-view="projects"]').click();
  await page
    .getByRole("button", { name: "Approvals & responsibilities", exact: true })
    .click();
  await expect(page).toHaveURL(/view=projects.*setup=policies/);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Approvals & responsibilities",
      exact: true,
    }),
  ).toBeVisible();
});
