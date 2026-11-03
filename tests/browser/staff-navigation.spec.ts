import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
async function login(page: Page, id: string) {
  await page.goto("/?choose=1");
  await page
    .getByRole("textbox", { name: "Email or Staff ID", exact: true })
    .fill(id);
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("Sopra@123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
test("single-section employee bypasses the retired chooser, including old choose links", async ({
  page,
}) => {
  await login(page, "employee1@example.com");
  await expect(page).toHaveURL(/\/coordination$/u);
  await expect(
    page.getByRole("heading", { name: "Your Workspaces" }),
  ).toHaveCount(0);
  await expect(page.locator(".staff-section-navigation")).toHaveCount(1);
  await page.goto("/?choose=1");
  await expect(page).toHaveURL(/\/coordination$/u);
  await expect(
    page.getByRole("button", { name: "Open navigation", exact: true }),
  ).toBeHidden();
});
for (const width of [390, 1366])
  test(`authorized staff navigation replaces workspace switching at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page, "admin1@example.com");
    await expect(page).toHaveURL(/\/admin$/u);
    await expect(
      page.getByRole("link", { name: "Switch workspace", exact: true }),
    ).toHaveCount(0);
    const mobile = width < 901;
    if (mobile) {
      const toggle = page.getByRole("button", {
        name: "Open navigation",
        exact: true,
      });
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(
        page.getByRole("dialog", { name: "Navigation", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
      await toggle.click();
    }
    const navigation = mobile
      ? page
          .getByRole("dialog", { name: "Navigation", exact: true })
          .getByRole("navigation", { name: "Staff sections", exact: true })
      : page.getByRole("navigation", { name: "Staff sections", exact: true });
    await expect(
      page.getByRole("link", { name: "Administration", exact: true }),
    ).toHaveCount(0);
    if (mobile)
      await expect(
        navigation.getByRole("link", { name: "Overview", exact: true }),
      ).toBeVisible();
    else
      await expect(
        page.locator('[data-admin-view="overview"]'),
      ).toHaveAttribute("aria-current", "page");
    await expect(
      navigation.getByRole("link", { name: "Guard", exact: true }),
    ).toHaveCount(0);
    await expect(
      navigation.getByRole("link", { name: "Reception", exact: true }),
    ).toHaveCount(0);
    const adminA11y = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      adminA11y.violations.map((item) => ({
        id: item.id,
        targets: item.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
    await mkdir("output/staff-navigation", { recursive: true });
    await page.screenshot({
      path: `output/staff-navigation/${width}-administration.png`,
      fullPage: true,
    });
    await navigation
      .getByRole("link", { name: "Visit coordination", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\?view=coordination/u);
    await expect(page.locator(".staff-section-navigation")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Administration", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Workspaces", exact: true }),
    ).toHaveCount(0);
    if (mobile)
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    await expect(
      (mobile
        ? page.getByRole("dialog", { name: "Navigation", exact: true })
        : page.getByRole("navigation", { name: "Administration", exact: true })
      ).getByRole("link", { name: "Visit coordination", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const a11y = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      a11y.violations.map((item) => ({
        id: item.id,
        targets: item.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
    await mkdir("output/staff-navigation", { recursive: true });
    await page.screenshot({
      path: `output/staff-navigation/${width}-coordination.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    if (mobile) {
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Navigation", exact: true })
        .getByRole("link", { name: "Users & permissions", exact: true })
        .click();
    } else await page.locator('[data-admin-view="staff"]').click();
    await expect(page).toHaveURL(/\/admin\?view=staff$/u);
    await expect(page.locator('[data-admin-view="staff"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
test("revoked or failed staff navigation never leaves cross-section links cached", async ({
  page,
}) => {
  await login(page, "admin1@example.com");
  await expect(page).toHaveURL(/\/admin$/u);
  await expect(
    page.getByRole("navigation", { name: "Staff sections" }),
  ).toBeVisible();
  await page.route("**/api/staff/me", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: '{"error":"NOT_AUTHORIZED"}',
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".staff-section-navigation")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open navigation", exact: true }),
  ).toHaveCount(0);
});

for (const [loginId, path, code] of [
  ["gaurd1@example.com", "guard", "GUARD"],
  ["reception1@example.com", "reception", "RECEPTION"],
]) {
  for (const width of [390, 1366])
    test(`shared navigation fits ${path} with multiple assigned sections at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      // Only the navigation projection is stubbed; the operational page keeps its authenticated SQL flow.
      await page.route("**/api/staff/me", (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            displayName: "Synthetic station",
            workspaces: [
              { code, name: code },
              { code: "COORDINATION", name: "Coordination" },
            ],
          }),
        }),
      );
      await login(page, loginId);
      await expect(page).toHaveURL(new RegExp("/" + path + "$", "u"));
      await expect(page.locator(".staff-section-navigation")).toHaveCount(1);
      await expect(
        page.locator(path === "guard" ? "#scan-fab" : ".reception-scan-fab"),
      ).toBeEnabled();
      if (width < 901) {
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .click();
        await expect(
          page.getByRole("dialog", { name: "Navigation", exact: true }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    });
}
