import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
const base = "http://localhost:18463",
  csrf = Buffer.alloc(32, 255).toString("base64url");
const id = (n: number) =>
  "00000000-0000-0000-0000-" + String(n).padStart(12, "0");
async function login(context: BrowserContext, n: number) {
  await context.addCookies([
    {
      name: "gp-staff-session",
      value: Buffer.alloc(
        32,
        parseInt(String(n).padStart(2, "0"), 16),
      ).toString("base64url"),
      url: base,
      httpOnly: true,
      sameSite: "Strict",
    },
    { name: "gp-staff-csrf", value: csrf, url: base, sameSite: "Strict" },
  ]);
}
async function api(context: BrowserContext, action: string, data: unknown) {
  const response = await context.request.post(
    base + "/api/coordination/" + action,
    { headers: { origin: base, "X-CSRF-Token": csrf }, data },
  );
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
async function wizardStep(page:Page,target:number){
 const dialog=page.getByRole('dialog');let current=Number(await dialog.locator('[aria-current="step"] span').textContent());
 if(target<current){await dialog.getByRole('navigation',{name:'Invitation progress'}).getByRole('button',{name:new RegExp('^'+target+' ')}).click();return;}
 while(current<target){await dialog.getByRole('button',{name:'Next',exact:true}).click();await expect(dialog.locator('[aria-current="step"] span')).toHaveText(String(current+1));current++;}
}
async function fit(page: Page) {
  expect(
    await page.evaluate(() => getComputedStyle(document.body).fontFamily),
  ).toContain("Segoe UI");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
async function accessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}
async function create(context: BrowserContext, name: string, stay = false) {
  const start = new Date(Date.now() + 86400000),
    until = new Date(start.getTime() + 86400000);
  const draft = {
    locationId: 1,
    subProjectIds: [id(100)],
    visitorName: name,
    visitorEmail: "guest@example.invalid",
    purpose: "Browser planning rehearsal",
    startsAtUtc: start.toISOString(),
    untilUtc: until.toISOString(),
    vip: true,
    ...(stay
      ? {
          stay: {
            checkInDate: start.toISOString().slice(0, 10),
            checkOutDate: new Date(until.getTime() + 86400000)
              .toISOString()
              .slice(0, 10),
          },
        }
      : {}),
  };
  const plan = await api(context, "create", { clientKey: randomUUID(), draft });
  const result = await api(context, "change", {
    planId: plan.id,
    revision: plan.revision,
    clientKey: randomUUID(),
    command: { kind: "SUBMIT" },
  });
  return { id: plan.id as string, revision: result.revision as number };
}
for (const width of [390, 1366])
  test(`host creates, submits and discusses a planned visit at ${width}px`, async ({
    page,
    context,
  }) => {
    await login(context, 1);
    await page.setViewportSize({ width, height: 900 });
    const name = "Planning UI " + randomUUID().slice(0, 8);
    await page.goto("/coordination");
    await page
      .getByRole("button", { name: "Invite visitor", exact: true })
      .click();
    await page.getByLabel("Visitor name", { exact: true }).fill(name);
    await page
      .getByLabel("Email (optional)", { exact: true })
      .fill("guest@example.invalid");
    await page
      .getByLabel("Company (optional)", { exact: true })
      .fill("Synthetic company");
    await wizardStep(page,2);
    await page
      .getByRole("checkbox", { name: "Synthetic client / Alpha", exact: true })
      .check();
    await page
      .getByLabel("Purpose", { exact: true })
      .fill("Visitor planning rehearsal");
    await wizardStep(page,5);
    await page
      .getByRole("checkbox", { name: /Stay arrangement required/ })
      .check();
    await wizardStep(page,6);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Submit visit plan", exact: true })
      .click();
    await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
    await fit(page);
    await accessible(page);
    await page.screenshot({
      path: `output/coordination-approvals-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Discussion (0)", exact: true })
      .click();
    await page
      .getByLabel("Thread topic", { exact: true })
      .fill("Arrival coordination");
    await page
      .getByRole("button", { name: "Create thread", exact: true })
      .click();
    await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
    const body =
      '<img src=x onerror="window.__planningXss=true"> Please arrange arrival.';
    await page.getByLabel("Message", { exact: true }).fill(body);
    await page
      .getByRole("listbox", {
        name: "Mention participants (optional)",
        exact: true,
      })
      .selectOption(id(3));
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.locator(".cp-message-body")).toHaveText(body);
    expect(
      await page
        .locator(".cp-message-body img,.cp-message-body script")
        .count(),
    ).toBe(0);
    await page.getByRole("button", { name: "Resolve", exact: true }).click();
    await expect(page.getByText("This thread is resolved.")).toBeVisible();
    await page.getByRole("button", { name: "Reopen", exact: true }).click();
    await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
    await fit(page);
    await accessible(page);
    await page.screenshot({
      path: `output/coordination-browser-${width}.png`,
      fullPage: true,
    });
    const planId = page.url().split("#visit=")[1];
    await page.reload();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    expect(page.url()).toContain(planId);
  });
test("assigned authority, facilities and FYI recipient receive different live SQL projections", async ({
  browser,
  context,
  page,
}) => {
  await login(context, 1);
  const plan = await create(
    context,
    "Scoped browser visit " + randomUUID().slice(0, 8),
    true,
  );
  const authority = await browser.newContext(),
    operations = await browser.newContext(),
    fyi = await browser.newContext();
  try {
    await login(authority, 5);
    const a = await authority.newPage();
    await a.goto("/coordination#visit=" + plan.id);
    await a.getByLabel("Decision remarks").fill("Alpha authority reviewed");
    await a.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(a.getByText("Approved", { exact: true })).toBeVisible();
    await a
      .getByRole("button", { name: "Discussion (0)", exact: true })
      .click();
    await a.getByLabel("Thread topic").fill("Restricted authority review");
    await a
      .getByRole("combobox", { name: "Audience", exact: true })
      .selectOption({ label: "Private authority review · Alpha permission" });
    await a.getByRole("button", { name: "Create thread", exact: true }).click();
    await a
      .getByLabel("Message", { exact: true })
      .fill("Private authority remark");
    await a.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(a.locator(".cp-message-body")).toHaveText(
      "Private authority remark",
    );
    await page.goto("/coordination#visit=" + plan.id);
    await page
      .getByRole("button", { name: "Discussion (0)", exact: true })
      .click();
    await expect(
      page.getByText("Restricted authority review", { exact: true }),
    ).toHaveCount(0);
    await login(operations, 3);
    const p = await operations.newPage();
    await p.goto("/coordination#visit=" + plan.id);
    await p.getByRole("button", { name: "Arrangements", exact: true }).click();
    await p
      .getByRole("combobox", { name: "Arrangement result", exact: true })
      .selectOption("CONFIRMED");
    await p
      .getByLabel("Result / correction remarks")
      .fill("Guest house confirmed");
    await p
      .getByRole("button", { name: "Update arrangement", exact: true })
      .click();
    await expect(
      p.getByText("Guest house confirmed", { exact: true }),
    ).toBeVisible();
    expect(
      await p.getByRole("button", { name: "Approve", exact: true }).count(),
    ).toBe(0);
    expect(
      await p.getByText("guest@example.invalid", { exact: true }).count(),
    ).toBe(0);
    await login(fyi, 6);
    const denied = await fyi.request.post(base + "/api/coordination/detail", {
      headers: { origin: base, "X-CSRF-Token": csrf },
      data: { planId: plan.id },
    });
    expect(denied.status()).toBe(403);
    const injected = await context.request.post(
      base + "/api/coordination/change",
      {
        headers: { origin: base, "X-CSRF-Token": csrf },
        data: {
          planId: plan.id,
          revision: 1,
          clientKey: randomUUID(),
          command: { kind: "SUBMIT" },
          actorId: id(4),
        },
      },
    );
    expect(injected.status()).toBe(400);
  } finally {
    await authority.close();
    await operations.close();
    await fyi.close();
  }
});
test("thread history is keyset-paginated and scoped, and earlier messages remain readable", async ({
  context,
  page,
}) => {
  await login(context, 1);
  const plan = await create(
    context,
    "Thread paging " + randomUUID().slice(0, 8),
  );
  let revision = plan.revision;
  const threadId = randomUUID();
  let result = await api(context, "change", {
    planId: plan.id,
    revision,
    clientKey: randomUUID(),
    command: {
      kind: "THREAD",
      threadId,
      title: "Arrival history",
      audience: "GENERAL",
      subProjectId: null,
      targetId: null,
    },
  });
  revision = result.revision;
  for (let n = 1; n <= 51; n++) {
    result = await api(context, "change", {
      planId: plan.id,
      revision,
      clientKey: randomUUID(),
      command: {
        kind: "COMMENT",
        threadId,
        messageId: randomUUID(),
        body: "History message " + String(n).padStart(2, "0"),
        replyToId: null,
        mentionIds: [],
      },
    });
    revision = result.revision;
  }
  await page.goto("/coordination#visit=" + plan.id);
  await page
    .getByRole("button", { name: "Discussion (1)", exact: true })
    .click();
  await page.getByRole("button", { name: /Arrival history/ }).click();
  await expect(page.locator(".cp-message-body")).toHaveCount(50);
  await page
    .getByRole("button", { name: "Load earlier messages", exact: true })
    .click();
  await expect(page.locator(".cp-message-body")).toHaveCount(51);
  await expect(page.locator(".cp-message-body").first()).toHaveText(
    "History message 01",
  );
});
test("scoped settings create a real sub-project and reject office-policy escalation", async ({
  browser,
  context,
  page,
}) => {
  await login(context, 4);
  await page.goto("/coordination");
  await page.goto("/coordination?settings=planning");
  const name = "UI project " + randomUUID().slice(0, 8);
  await page
    .getByRole("combobox", { name: "Account / office", exact: true })
    .selectOption("1");
  await page.getByLabel("Project name", { exact: true }).fill(name);
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Owned browser project creation");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await fit(page);
  await accessible(page);
  const options = await api(context, "options", {}),
    limited = await browser.newContext();
  try {
    await login(limited, 10);
    const p = await limited.newPage();
    await p.goto("/coordination");
    await p.goto("/coordination?settings=planning");
    await p
      .getByRole("button", { name: "Policies & responsibilities", exact: true })
      .click();
    await expect(
      p.getByRole("combobox", { name: "Scope", exact: true }),
    ).not.toContainText("Office —");
    await expect(
      p.getByRole("combobox", { name: "Scope", exact: true }),
    ).not.toContainText("Beta-private");
    const denied = await limited.request.post(
      base + "/api/coordination/manage",
      {
        headers: { origin: base, "X-CSRF-Token": csrf },
        data: {
          clientKey: randomUUID(),
          action: "POLICY",
          payload: {
            locationId: 1,
            revision: 1,
            reason: "Escalation attempt",
            definition: options.policies.find(
              (x: any) => x.scopeKind === "LOCATION" && x.locationId === 1,
            ).definition,
          },
        },
      },
    );
    expect(denied.status()).toBe(403);
  } finally {
    await limited.close();
  }
});

test("a lost create response retries the same operation without creating a second visit", async ({
  context,
  page,
}) => {
  await login(context, 1);
  const name = "Retry draft " + randomUUID().slice(0, 8);
  let dropped = false;
  const keys: string[] = [];
  await page.route("**/api/coordination/create", async (route) => {
    keys.push(route.request().postDataJSON().clientKey);
    const response = await route.fetch();
    if (!dropped) {
      dropped = true;
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await page.goto("/coordination");
  await page
    .getByRole("button", { name: "Invite visitor", exact: true })
    .click();
  await page.getByLabel("Visitor name", { exact: true }).fill(name);
  await wizardStep(page,2);
  await page
    .getByRole("checkbox", { name: "Synthetic client / Alpha", exact: true })
    .check();
  await page
    .getByLabel("Purpose", { exact: true })
    .fill("Ambiguous network response rehearsal");
  await wizardStep(page,6);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Visitor name", { exact: true })).toHaveValue(
    name,
  );
  await wizardStep(page,6);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const listed = await api(context, "list", { folder: "MY", search: name });
  expect(listed.visits).toHaveLength(1);
});

test("settings persist policy and reversible approved-host changes through the React controls", async ({
  page,
  context,
}) => {
  await login(context, 4);
  const name = "UI configuration " + randomUUID().slice(0, 8);
  const project = await api(context, "manage", {
    clientKey: randomUUID(),
    action: "PROJECT",
    payload: {
      locationId: 1,
      accountOfficeId: "1",
      name,
      active: true,
      revision: 0,
      reason: "Owned UI configuration rehearsal",
    },
  });
  await page.goto("/coordination");
  await page.goto("/coordination?settings=planning");
  await page
    .getByRole("button", { name: "Policies & responsibilities", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Scope", exact: true })
    .selectOption(project.id);
  await page
    .getByLabel("Step name", { exact: true })
    .fill("Internal project authority");
  await page
    .getByRole("listbox", {
      name: "Who must approve?",
      exact: true,
    })
    .selectOption(id(5));
  await page
    .getByLabel("Reason for policy change", { exact: true })
    .fill("Configure reviewed authority");
  await page.getByRole("button", { name: "Save policy", exact: true }).click();
  await expect(
    page.getByText("Visit setup saved.", { exact: false }),
  ).toBeVisible();
  let options = await api(context, "options", {});
  expect(
    options.policies.find((p: any) => p.subProjectId === project.id).definition
      .approvalRules[0].approverIds,
  ).toEqual([id(5)]);
  await page
    .getByRole("button", { name: "Approved hosts", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Internal employee", exact: true })
    .selectOption(id(1));
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Approve current account host");
  await page
    .getByRole("button", { name: "Add approved host", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Temporary removal rehearsal");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Restore", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Restore reviewed host");
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Remove", exact: true }),
  ).toBeVisible();
  options = await api(context, "options", {});
  const host = options.hosts.find(
    (h: any) => h.subProjectId === project.id && h.userId === id(1),
  );
  expect(host.active).toBe(true);
  expect(host.revision).toBe(3);
  await page.reload();
  await expect(page.getByRole('heading',{name:'Projects & visit hosts',exact:true})).toBeVisible();
  await page
    .getByRole("button", { name: "Policies & responsibilities", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Scope", exact: true })
    .selectOption(project.id);
  await expect(page.getByLabel("Step name", { exact: true })).toHaveValue(
    "Internal project authority",
  );
});

test("page lifecycle clears private coordination data and rechecks changed identity before restoring it", async ({
  context,
  page,
}) => {
  await login(context, 1);
  const name = "Lifecycle privacy " + randomUUID().slice(0, 8),
    plan = await create(context, name);
  await page.goto("/coordination#visit=" + plan.id);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  expect(
    await page.evaluate((visitorName) => {
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: true }),
      );
      return !document.body.textContent?.includes(visitorName);
    }, name),
  ).toBe(true);
  await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
  await login(context, 6);
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  await expect(
    page.getByRole("heading", { name: "Access unavailable", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
  await expect(page.locator(".cp-visits")).toHaveCount(0);
});

for (const width of [390, 1366])
  test(`redesigned workspace, closed visit and invitation form remain clear at ${width}px`, async ({
    context,
    page,
  }) => {
    await login(context, 1);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    const name = "Ananya Mehta " + width,
      plan = await create(context, name);
    await api(context, "change", {
      planId: plan.id,
      revision: plan.revision,
      clientKey: randomUUID(),
      command: { kind: "CANCEL", reason: "Meeting rescheduled by the host" },
    });
    await page.goto("/coordination#visit=" + plan.id);
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("This visit was cancelled", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Revise / reschedule", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Submit visit plan", exact: true }),
    ).toHaveCount(0);
    expect(
      await page
        .locator(".cp-summary")
        .evaluate((e) => e.getBoundingClientRect().height),
    ).toBeLessThan(320);
    expect(
      await page
        .locator(".cp-page-heading h1")
        .evaluate((e) => e.getBoundingClientRect().height),
    ).toBeLessThan(60);
    const approvalPanel = page.getByRole("region", {
      name: "Approval progress",
      exact: true,
    });
    const widths = await approvalPanel.evaluate((panel) => ({
      panel: panel.getBoundingClientRect().width,
      track: panel.querySelector(".cp-progress-track")!.getBoundingClientRect()
        .width,
    }));
    expect(widths.track / widths.panel).toBeGreaterThan(0.85);
    await fit(page);
    await accessible(page);
    await page.screenshot({
      path: `output/coordination-redesign-closed-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "All visits", exact: true }).click();
    await page.getByLabel("Search visitors", { exact: true }).fill(name);
    await expect(page.locator(".cp-visit")).toHaveCount(1);
    await fit(page);
    await accessible(page);
    await page.screenshot({
      path: `output/coordination-redesign-list-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Invite visitor", exact: true })
      .click();
    await expect(
      page.getByLabel("Visitor name", { exact: true }),
    ).toBeVisible();
    await fit(page);
    await accessible(page);
    await page.screenshot({
      path: `output/coordination-redesign-form-${width}.png`,
      fullPage: true,
    });
  });

test("late evening stay defaults follow arrival and changing dates preserves valid checkout", async ({
  context,
  page,
}) => {
  await login(context, 1);
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  await page.clock.setFixedTime(new Date(today + "T21:30:00+05:30"));
  await page.goto("/coordination");
  await page
    .getByRole("button", { name: "Invite visitor", exact: true })
    .click();
  await page
    .getByLabel("Visitor name", { exact: true })
    .fill("Late evening stay rehearsal");
  await wizardStep(page,2);
  await page
    .getByRole("checkbox", { name: "Synthetic client / Alpha", exact: true })
    .check();
  await page
    .getByLabel("Purpose", { exact: true })
    .fill("Verify midnight and future arrival dates");
  await wizardStep(page,5);
  await page
    .getByRole("checkbox", { name: "Stay arrangement required", exact: true })
    .check();
  const arrival = await page
      .getByLabel("Expected arrival", { exact: true })
      .inputValue(),
    initialCheckIn = await page
      .getByLabel("Check-in date", { exact: true })
      .inputValue(),
    initialCheckOut = await page
      .getByLabel("Check-out date (exclusive)", { exact: true })
      .inputValue();
  expect(initialCheckIn).toBe(arrival.slice(0, 10));
  expect(initialCheckOut > initialCheckIn).toBe(true);
  const later =
    new Date(Date.now() + 3 * 86400000 + 330 * 60000)
      .toISOString()
      .slice(0, 10) + "T10:00";
  await wizardStep(page,2);
  await page.getByLabel("Expected arrival", { exact: true }).fill(later);
  await expect(page.getByLabel("Check-in date", { exact: true })).toHaveValue(
    later.slice(0, 10),
  );
  expect(
    (await page
      .getByLabel("Check-out date (exclusive)", { exact: true })
      .inputValue()) > later.slice(0, 10),
  ).toBe(true);
  expect(
    (await page
      .getByLabel("Expected departure", { exact: true })
      .inputValue()) > later,
  ).toBe(true);
  await wizardStep(page,6);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Late evening stay rehearsal",
      exact: true,
    }),
  ).toBeVisible();
});

// The fixture host belongs only to Alpha's account; Beta has neither membership nor a host grant.
test("source host selects cross-account destinations and each authority independently clears its project", async ({ page, context, browser }) => {
  await login(context, 1);
  const options = await api(context, "options", {});
  const beta = options.projects.find((p: { name: string }) => p.name === "Beta-private");
  expect(beta?.canHost).toBe(true);
  expect(options.people).toEqual([]);
  expect(options.policies).toEqual([]);
  expect(options.hosts).toEqual([]);
  const foreign = await api(context, "options", { locationId: 2 });
  expect(foreign.projects).toEqual([]);
  const name = "Cross-account guest " + randomUUID().slice(0, 8);
  await page.goto("/coordination");
  await page.getByRole("button", { name: "Invite visitor", exact: true }).click();
  await page.getByLabel("Visitor name", { exact: true }).fill(name);
  await wizardStep(page,2);
  await page.getByRole("checkbox", { name: "Synthetic client / Alpha", exact: true }).check();
  await page.getByRole("checkbox", { name: "Other client / Beta-private", exact: true }).check();
  await page.getByLabel("Purpose", { exact: true }).fill("Cross-account visit with independent authority review");
  await wizardStep(page,6);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const planId = decodeURIComponent(new URL(page.url()).hash.split("=")[1]);
  await page.getByRole("button", { name: "Submit visit plan", exact: true }).click();
  await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
  let detail = await api(context, "detail", { planId });
  const forbidden = await context.request.post(base + "/api/coordination/change", {
    headers: { origin: base, "X-CSRF-Token": csrf },
    data: { planId, revision: detail.revision, clientKey: randomUUID(), command: { kind: "DECIDE", stepId: id(211), decision: "APPROVED", reason: "Host cannot self approve" } },
  });
  expect(forbidden.status()).toBe(403);
  for (const [actor, step] of [[5, 210], [7, 202], [8, 211]]) {
    const authority = await browser.newContext();
    try {
      await login(authority, actor);
      await api(authority, "change", { planId, revision: detail.revision, clientKey: randomUUID(), command: { kind: "DECIDE", stepId: id(step), decision: "APPROVED", reason: "Reviewed by assigned destination authority" } });
      detail = await api(context, "detail", { planId });
      if (actor === 7) {
        expect(detail.projects.find((p: { subProjectId: string }) => p.subProjectId === id(100)).readiness).toBe("READY");
        expect(detail.projects.find((p: { subProjectId: string }) => p.subProjectId === beta.subProjectId).readiness).toBe("PENDING");
      }
    } finally { await authority.close(); }
  }
  expect(detail.projects.every((p: { readiness: string }) => p.readiness === "READY")).toBe(true);
  expect(detail).not.toHaveProperty("passId");
  const denied = await context.request.post(base + "/api/coordination/create", {
    headers: { origin: base, "X-CSRF-Token": csrf },
    data: { clientKey: randomUUID(), draft: { locationId: 2, subProjectIds: [id(101)], visitorName: name, purpose: "Outside source office", startsAtUtc: new Date(Date.now() + 86400000).toISOString(), untilUtc: new Date(Date.now() + 2 * 86400000).toISOString(), vip: false } },
  });
  expect(denied.status()).toBe(403);
});

for(const width of [390,1366])test(`invitation shows routing names, adds people and persists preparation at ${width}px`,async({page,context})=>{
 await login(context,1);await page.setViewportSize({width,height:900});await page.goto('/coordination');
 await page.getByRole('button',{name:'Invite visitor',exact:true}).click();
 const dialog=page.getByRole('dialog');const name='Preparation UI '+randomUUID().slice(0,8);
 await dialog.getByLabel('Visitor name',{exact:true}).fill(name);
 await wizardStep(page,2);
 await dialog.getByLabel('Purpose',{exact:true}).fill('VIP coordination rehearsal');
 await dialog.getByRole('checkbox',{name:'Synthetic client / Alpha',exact:true}).check();
 await wizardStep(page,3);
 await expect(dialog.locator('.cp-routing-names').filter({hasText:'Alpha permission'})).toContainText('Unassigned employee');
 await dialog.getByRole('button',{name:'Add approval / notify · Synthetic client / Alpha',exact:false}).click();
 await dialog.getByLabel('Add person · Synthetic client / Alpha',{exact:true}).fill('Leadership');
 await dialog.getByRole('button',{name:/Leadership FYI.*planning06/}).click();
 await dialog.getByRole('combobox',{name:'Send as',exact:true}).selectOption('APPROVAL');
 await dialog.getByRole('button',{name:'Add person',exact:true}).click();
 await expect(dialog.locator('.cp-person-chips')).toContainText('Required approval');
 await dialog.getByRole('button',{name:'Add approval / notify · Whole visit',exact:false}).click();
 await dialog.getByLabel('Add person · Whole visit',{exact:true}).fill('Beta authority');
 await dialog.getByRole('button',{name:/Beta authority.*planning08/}).click();
 await dialog.getByRole('button',{name:'Add person',exact:true}).click();
 await wizardStep(page,4);
 await dialog.getByRole('combobox',{name:'Visitor category',exact:true}).selectOption('CLIENT');
 await dialog.getByLabel('Meeting location (optional)',{exact:true}).fill('Room 2');
 await dialog.getByLabel('Agenda / itinerary (optional)',{exact:true}).fill('Welcome and site tour');
 await wizardStep(page,5);
 await dialog.getByRole('checkbox',{name:'Ground transport / transfers',exact:true}).check();
 await dialog.getByLabel('Visit coordinator',{exact:true}).fill('Synthetic facilities');
 await dialog.getByRole('button',{name:/Synthetic facilities.*planning03/}).click();
 await fit(page);await accessible(page);
 await page.screenshot({path:`output/preparation-invitation-${width}.png`,fullPage:true});
 await wizardStep(page,6);
 await dialog.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Visit preparation',exact:true})).toContainText('Welcome and site tour');
 await expect(page.getByRole('region',{name:'Visit preparation',exact:true})).toContainText('Leadership FYI');
 await page.getByRole('button',{name:'Edit draft',exact:true}).click();
 await expect(page.getByLabel('Meeting location (optional)',{exact:true})).toHaveValue('Room 2');
 await expect(page.locator('.cp-person-chips').filter({hasText:'Leadership FYI'})).toContainText('Required approval');
 await wizardStep(page,6);
 await page.getByLabel('Reason for revision',{exact:true}).fill('Verify edit preservation');
 await page.getByRole('button',{name:'Save revised draft',exact:true}).click();
 await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Submit visit plan',exact:true}).click();
 await expect(page.getByText('Submitted',{exact:true})).toBeVisible();
 await expect(page.locator('.cp-approval').filter({hasText:'Additional approval'})).toContainText('Leadership FYI');
 await fit(page);await accessible(page);await page.screenshot({path:`output/preparation-detail-${width}.png`,fullPage:true});
});

for(const width of [390,1366])test(`admin creates visit groups and host reviews selected recipients at ${width}px`,async({page,context,browser})=>{
 await login(context,4);await page.setViewportSize({width,height:900});await page.goto('/coordination?settings=groups&office=1');
 await page.getByRole('button',{name:'Create visit group',exact:false}).click();
 const name='Noida VIP UI '+randomUUID().slice(0,8);
 await page.getByLabel('Group name',{exact:true}).fill(name);
 await page.getByRole('checkbox',{name:'Show this group for VIP visits only',exact:true}).check();
 await page.getByLabel('Group employee',{exact:true}).fill('Unassigned');
 await page.getByRole('button',{name:/Unassigned employee.*planning05/}).click();
 await page.getByRole('combobox',{name:'Member role',exact:true}).selectOption('APPROVAL');
 await page.getByRole('button',{name:'Add employee to group',exact:true}).click();
 await page.getByLabel('Notification email',{exact:true}).fill('vip-ui@example.invalid');
 await page.getByLabel('Email display name (optional)',{exact:true}).fill('VIP operations list');
 await page.getByRole('button',{name:'Add notification email',exact:true}).click();
 await page.getByLabel('Reason for group change',{exact:true}).fill('VIP reception coordination');
 await page.getByRole('button',{name:'Save visit group',exact:true}).click();
 const card=page.locator('article.cp-group-card').filter({has:page.getByRole('heading',{name,exact:true})});await expect(card).toBeVisible();await expect(card).toContainText('Unassigned employee');await expect(card).toContainText('vip-ui@example.invalid');await accessible(page);await fit(page);
 await page.screenshot({path:`output/visit-groups-admin-${width}.png`,fullPage:true});
 const host=await browser.newContext({viewport:{width,height:900}});try{await login(host,1);const visitor=await host.newPage();await visitor.goto('/coordination');await visitor.getByRole('button',{name:'Invite visitor',exact:true}).click();const dialog=visitor.getByRole('dialog');
 await dialog.getByLabel('Visitor name',{exact:true}).fill('Group selected visitor '+randomUUID().slice(0,8));await wizardStep(visitor,2);await dialog.getByLabel('Purpose',{exact:true}).fill('Leadership coordination');await dialog.getByRole('checkbox',{name:'Synthetic client / Alpha',exact:true}).check();
 await expect(dialog.getByRole('checkbox',{name,exact:true})).toHaveCount(0);await dialog.getByRole('checkbox',{name:/Leadership \/ VIP visit/}).check();await wizardStep(visitor,3);
 const choice=dialog.getByRole('checkbox',{name,exact:false});await expect(choice).toBeVisible();const row=dialog.locator('.cp-group-card').filter({hasText:name});await expect(row).toContainText('Approval required (all)');await expect(row).toContainText('Unassigned employee');await expect(row).toContainText('vip-ui@example.invalid');await choice.check();
 await accessible(visitor);await fit(visitor);await visitor.screenshot({path:`output/visit-groups-host-${width}.png`,fullPage:true});
 await wizardStep(visitor,6);await dialog.getByRole('button',{name:'Save draft',exact:true}).click();await expect(visitor.getByRole('region',{name:'Selected visit groups',exact:true})).toContainText(name);await visitor.getByRole('button',{name:'Submit visit plan',exact:true}).click();await expect(visitor.getByText('Submitted',{exact:true})).toBeVisible();await expect(visitor.locator('.cp-approval').filter({hasText:'Group approval'})).toContainText('Unassigned employee');
 }finally{await host.close();}
});

test('numbered invitation validates steps, preserves values and requires an explicit save after review',async({page,context})=>{
 await login(context,1);let creates=0;page.on('request',request=>{if(request.url().endsWith('/api/coordination/create'))creates++;});await page.goto('/coordination');await page.getByRole('button',{name:'Invite visitor',exact:true}).click();const dialog=page.getByRole('dialog'),progress=dialog.getByRole('navigation',{name:'Invitation progress'});
 await expect(progress.getByRole('button')).toHaveCount(6);await dialog.getByRole('button',{name:'Next',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.locator('[aria-current="step"] span')).toHaveText('1');await dialog.getByLabel('Visitor name',{exact:true}).fill('Step validation rehearsal');await wizardStep(page,2);
 const arrival=dialog.getByLabel('Expected arrival',{exact:true});const value=await arrival.inputValue();await arrival.fill('');await dialog.getByRole('button',{name:'Next',exact:true}).click();await expect(dialog.locator('[aria-current="step"] span')).toHaveText('2');await expect(page.getByText('Unable to open this page',{exact:true})).toHaveCount(0);await arrival.fill(value);await dialog.getByLabel('Purpose',{exact:true}).fill('Preserve steps');await dialog.getByRole('checkbox',{name:'Synthetic client / Alpha',exact:true}).check();await wizardStep(page,6);
 await expect(dialog.getByRole('button',{name:'Save draft',exact:true})).toBeVisible();expect(creates).toBe(0);await expect(dialog.locator('.cp-invitation-review')).toContainText('Step validation rehearsal');await wizardStep(page,1);await expect(dialog.getByLabel('Visitor name',{exact:true})).toHaveValue('Step validation rehearsal');await wizardStep(page,2);await arrival.fill('');await progress.getByRole('button',{name:/^6 Review/}).click();await expect(dialog.locator('[aria-current="step"] span')).toHaveText('2');expect(creates).toBe(0);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
});
