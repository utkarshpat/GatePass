import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function login(page: Page, user: string) {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Email or Staff ID", exact: true })
    .fill(user);
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("Sopra@123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
test("Admin folder children change the protected query without replacing the shell", async ({
  page,
}) => {
  await login(page, "admin1@example.com");
  await page.waitForURL("**/admin");
  await page
    .locator(".admin-header")
    .evaluate((el) => el.setAttribute("data-retained", "yes"));
  const nav = page.getByRole("navigation", {
    name: "Administration",
    exact: true,
  });
  for (const [folder, label] of [
    ["ASSIGNED", "Assigned to me"],
    ["PARTICIPATING", "Participating"],
    ["MY", "My visits"],
  ]) {
    const request = page.waitForRequest(
      (r) =>
        r.url().endsWith("/api/coordination/list") &&
        r.postDataJSON().folder === folder,
    );
    await nav.getByRole("link", { name: label, exact: true }).click();
    await request;
    await expect(page).toHaveURL(
      new RegExp("view=coordination.*folder=" + folder),
    );
    await expect(
      nav.getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".admin-header")).toHaveAttribute(
      "data-retained",
      "yes",
    );
  }
});
for (const width of [390, 1366]) {
  test(`host has three sidebar folders and persists the selected folder at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page, "employee1@example.com");
    await expect(page).toHaveURL(/\/coordination$/);
    await expect(
      page.getByRole("heading", { name: "Visit Coordination", exact: true }),
    ).toBeVisible();
    expect(
      await page
        .getByRole("navigation", { name: "Visit folders", exact: true })
        .count(),
    ).toBe(0);
    if (width < 901)
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    const nav =
      width < 901
        ? page.getByRole("dialog", { name: "Navigation", exact: true })
        : page.locator(".staff-section-navigation");
    for (const label of ["My visits", "Assigned to me", "Participating"])
      await expect(
        nav.getByRole("link", { name: label, exact: true }),
      ).toBeVisible();
    await expect(
      nav.getByRole("link", { name: "Overview", exact: true }),
    ).toHaveCount(0);
    const request = page.waitForRequest(
      (r) =>
        r.url().endsWith("/api/coordination/list") &&
        r.postDataJSON().folder === "ASSIGNED",
    );
    await nav
      .getByRole("link", { name: "Assigned to me", exact: true })
      .click();
    await request;
    await expect(page).toHaveURL(/folder=ASSIGNED/);
    await page.reload();
    if (width < 901)
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    await expect(
      nav.getByRole("link", { name: "Assigned to me", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("button", { name: "Planning settings", exact: true }),
    ).toHaveCount(0);
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
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  });
  test(`account projects, area groups and simple policies stay in the Admin shell at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page, "admin1@example.com");
    await page.waitForURL("**/admin");
    await page.goto("/admin?view=projects");
    await page
      .getByRole("button", { name: "Projects & visit hosts", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Projects & visit hosts",
        exact: true,
      }),
    ).toBeVisible();
    const selected = await page
      .getByRole("combobox", { name: "Account / office", exact: true })
      .inputValue();
    expect(selected).not.toBe("");
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Account / office", exact: true }),
    ).toHaveValue(selected);
    await page
      .getByRole("button", { name: "All accounts", exact: false })
      .click();
    await page
      .getByRole("button", { name: "Areas & groups", exact: true })
      .click();
    await expect(
      page.locator("#projects .project-card:not(.area-card)"),
    ).toHaveCount(0);
    await page
      .getByRole("button", {
        name: "Approval & notification groups",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Create visit group", exact: false }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Create visit group", exact: false }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Approvals & responsibilities",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Approvals & responsibilities",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "3. Visit limits", exact: true })
      .click();
    await expect(
      page.getByLabel("Longest visit allowed (days)", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Who must approve?", { exact: true }),
    ).not.toBeVisible();
    await page
      .getByRole("button", { name: "2. Support & people", exact: true })
      .click();
    await expect(
      page.getByLabel("Inform for every visit", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".admin-header")).toHaveCount(1);
    await expect(page.locator(".cp-header")).toHaveCount(0);
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
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    await page.screenshot({
      path: `output/planning-setup-${width}.png`,
      fullPage: true,
    });
  });
}
