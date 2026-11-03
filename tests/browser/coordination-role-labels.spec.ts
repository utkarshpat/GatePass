import { test, expect } from "@playwright/test";
for (const owner of [true, false])
  test(`coordination distinguishes Visit owner and destination Host (${owner ? "owner" : "host"})`, async ({
    page,
  }) => {
    const id = "00000000-0000-0000-0000-000000009991",
      actor = "00000000-0000-0000-0000-000000009992",
      project = "00000000-0000-0000-0000-000000009993";
    const row = {
      id,
      revision: 1,
      state: owner ? "DRAFT" : "SUBMITTED",
      visitorName: "Synthetic role guest",
      hostName: "Synthetic invitation creator",
      locationId: 1,
      locationName: "Noida",
      vip: false,
      startsAtUtc: new Date(Date.now() + 86400000).toISOString(),
      untilUtc: new Date(Date.now() + 90000000).toISOString(),
    };
    // Presentation fixtures only; real staff sign-in and Admin shell permissions are retained.
    await page.route("**/api/coordination/options", (route) =>
      route.fulfill({
        json: {
          actorId: actor,
          displayName: "Synthetic user",
          locations: [
            {
              locationId: 1,
              name: "Noida",
              canManage: false,
              canHostLocation: true,
            },
          ],
          accounts: [],
          projects: [],
          policies: [],
          people: [],
          hosts: [],
        },
      }),
    );
    await page.route("**/api/coordination/list", (route) =>
      route.fulfill({ json: { visits: [row], hasMore: false } }),
    );
    await page.route("**/api/coordination/detail", (route) =>
      route.fulfill({
        json: {
          ...row,
          version: 1,
          actorId: actor,
          canEdit: owner,
          canManage: false,
          projects: [],
          approvals: owner
            ? []
            : [
                {
                  id: project,
                  name: "Destination access",
                  kind: "PROJECT",
                  mode: "ALL",
                  subProjectId: project,
                  status: "PENDING",
                  approvers: [
                    { userId: actor, name: "Synthetic destination host" },
                  ],
                  canDecide: true,
                  canDiscuss: true,
                  decisions: [],
                },
              ],
          tasks: [],
          threads: [],
          activity: [],
        },
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
    await expect(page.locator(".cp-visit-host")).toHaveText(
      "Visit owner: Synthetic invitation creator",
    );
    await page.locator(".cp-visit").click();
    await expect(page.locator(".cp-your-role strong")).toHaveText(
      owner ? "Visit owner" : "Host",
    );
    await expect(
      page
        .locator(".cp-person-row")
        .filter({ hasText: "Synthetic invitation creator" }),
    ).toContainText("Visit owner");
    if (!owner)
      await expect(
        page.getByText("Assigned hosts: Synthetic destination host", {
          exact: true,
        }),
      ).toBeVisible();
  });
