import { PlanningMailRenderer } from "../src/email/PlanningMailRenderer.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  PlanningNotificationWorker,
  planningMailJob,
} from "../src/email/PlanningNotificationWorker.ts";
import { CombinedNotificationWorker } from "../src/email/CombinedNotificationWorker.ts";
import { GraphMailTransport } from "../src/email/GraphMailTransport.ts";
import { MailFailure } from "../src/email/NotificationEmailWorker.ts";
const notice = randomUUID(),
  plan = randomUUID(),
  claim = { noticeId: notice, claimToken: randomUUID() };
function job(audience = "APPROVAL"): any {
  return {
    status: "READY",
    noticeId: notice,
    planId: plan,
    kind: audience,
    audience,
    eventKind: audience === "DISCUSSION" ? "COMMENT" : "SUBMIT",
    version: 1,
    recipientEmail: "internal@example.invalid",
    canReview: audience !== "FYI",
    details: {
      visitorName: "Synthetic guest",
      locationName: "Noida",
      hostName: "Internal host",
      vip: false,
      startsAtUtc: "2026-11-04T04:30:00.000Z",
      untilUtc: "2026-11-04T10:30:00.000Z",
      targetName: "Assigned scope",
      destinations:
        audience === "APPROVAL"
          ? [{ name: "Alpha", accountName: "Account 1" }]
          : [],
    },
  };
}
function fixture() {
  const calls: { name: string; p: any }[] = [],
    sent: any[] = [];
  let content: any = job(),
    read = 0,
    hook: ((name: string, p: any, read: number) => any) | undefined;
  const sql = {
    async callProcedure(name: string, p: any) {
      calls.push({ name, p });
      if (name === "gp.GetPlanningNotification") read++;
      const override = hook?.(name, p, read);
      if (override !== undefined) return JSON.stringify(override);
      if (name === "gp.ClaimPlanningNotifications")
        return JSON.stringify([claim]);
      if (name === "gp.GetPlanningNotification") return JSON.stringify(content);
      if (name === "gp.RenewPlanningNotificationLease") return '{"ok":true}';
      if (name === "gp.CompletePlanningNotification")
        return JSON.stringify({
          noticeId: notice,
          status: p.Outcome.value === "SENT" ? "SENT" : "PENDING",
        });
      throw Error("Unexpected RPC");
    },
  };
  const worker = new PlanningNotificationWorker(
    sql,
    {
      async send(m) {
        sent.push(m);
        return { providerMessageId: "accepted-id" };
      },
    },
    new PlanningMailRenderer("https://gatepass.example.invalid"),
  );
  return {
    worker,
    calls,
    sent,
    set: (v: any) => {
      content = v;
    },
    hook: (v: NonNullable<typeof hook>) => {
      hook = v;
    },
  };
}
test("planning worker claims, renders, renews and rechecks scope before Graph transport acknowledgement", async () => {
  const f = fixture();
  assert.deepEqual(await f.worker.runOnce(plan), [
    { noticeId: notice, status: "SENT" },
  ]);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(
    f.calls.map((c) => c.name),
    [
      "gp.ClaimPlanningNotifications",
      "gp.GetPlanningNotification",
      "gp.RenewPlanningNotificationLease",
      "gp.GetPlanningNotification",
      "gp.CompletePlanningNotification",
    ],
  );
  assert.equal(f.calls[0].p.PlanId.value, plan);
  assert.equal(f.calls.at(-1)!.p.ProviderMessageId.value, "accepted-id");
  assert.equal(f.sent[0].notificationId, "planning-" + notice);
});
test("draft creation has no send side effect and invalid selected-plan IDs never claim globally", async () => {
  const f = fixture();
  assert.equal(f.sent.length, 0);
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.worker.runOnce("bad"), /INTERNAL_ERROR/u);
  assert.equal(f.calls.length, 0);
});

test("planning dispatch accepts an independent renderer through its narrow port", async () => {
  const f = fixture();
  let renders = 0;
  const worker = new PlanningNotificationWorker(
    {
      async callProcedure(name, p) {
        if (name === "gp.GetPlanningNotification") return JSON.stringify(job());
        if (name === "gp.RenewPlanningNotificationLease") return '{"ok":true}';
        if (name === "gp.CompletePlanningNotification")
          return JSON.stringify({ noticeId: notice, status: p.Outcome.value });
        throw Error("Unexpected RPC");
      },
    },
    {
      async send(message) {
        assert.equal(message.subject, "Independent renderer");
        return {};
      },
    },
    {
      render() {
        renders++;
        return {
          notificationId: "planning-" + notice,
          to: "internal@example.invalid",
          subject: "Independent renderer",
          html: "<p>Scoped content</p>",
        };
      },
    },
  );
  assert.deepEqual(await worker.deliver(claim), {
    noticeId: notice,
    status: "SENT",
  });
  assert.equal(renders, 1);
  assert.equal(f.sent.length, 0);
});
test("authenticated deep links carry no approval token and all HTML text is escaped", () => {
  const f = fixture(),
    j = job();
  j.details.visitorName = '<img src=x onerror="alert(1)">';
  j.details.company = "A & B";
  j.details.targetName = "<script>private</script>";
  const mail = f.worker.render(j);
  assert.match(mail.html, /&lt;img/u);
  assert.match(mail.html, /A &amp; B/u);
  assert.doesNotMatch(mail.html, /<script|<img src=x|onerror="alert/u);
  assert.match(mail.html, new RegExp("/coordination#visit=" + plan, "u"));
  assert.doesNotMatch(mail.html, /token=|approve=|reject=|revoke=/u);
  assert.doesNotMatch(mail.subject, /Synthetic guest/u);
});
test("facilities and FYI emails cannot carry sibling destinations, discussion bodies or private contacts", () => {
  const f = fixture();
  for (const audience of ["ARRANGEMENT", "FYI", "UPDATE"]) {
    const j = job(audience);
    if (audience === "UPDATE") {
      j.kind = "UPDATE";
      j.eventKind = "ARRANGE";
    }
    j.details.destinations = [
      { name: "Private sibling", accountName: "Other client" },
    ];
    assert.throws(() => f.worker.render(j), /RENDER_FAILED/u);
  }
  for (const extra of [
    { personEmail: "private@example.invalid" },
    { purpose: "Private purpose" },
    { messageBody: "Private thread body" },
    { personPhone: "+911234567890" },
  ])
    assert.throws(
      () =>
        f.worker.render({ ...job(), details: { ...job().details, ...extra } }),
      /RENDER_FAILED/u,
    );
  const info = f.worker.render(job("FYI"));
  assert.doesNotMatch(info.html, /href=|Open coordination request/u);
  assert.match(info.html, /No approval is required/u);
});
test("stay details are available only to the assigned arrangement audience", () => {
  const f = fixture(),
    j = job("ARRANGEMENT");
  Object.assign(j.details, {
    checkInDate: "2026-11-04",
    checkOutDate: "2026-11-05",
    stayNotes: "Please arrange a room",
  });
  assert.match(f.worker.render(j).html, /Please arrange a room/u);
  assert.throws(
    () =>
      f.worker.render({ ...j, audience: "FYI", kind: "FYI", canReview: false }),
    /RENDER_FAILED/u,
  );
  j.details.checkOutDate = j.details.checkInDate;
  assert.throws(() => f.worker.render(j), /RENDER_FAILED/u);
});
test("normal updates and cancellation remain information and never render a card or gate action", () => {
  const f = fixture();
  for (const kind of ["UPDATE", "CANCELLED"]) {
    const j = job("UPDATE");
    j.kind = kind;
    j.eventKind = kind === "UPDATE" ? "REVISE" : "CANCEL";
    j.canReview = false;
    const m = f.worker.render(j);
    assert.match(m.subject, kind === "UPDATE" ? /updated/u : /cancelled/u);
    assert.doesNotMatch(
      m.html,
      /Generate pass|Mark entry|QR code|Approve visit/u,
    );
  }
});
test("SQL uppercase identifiers normalize without rewriting recipient or visitor text", () => {
  const j = job();
  j.noticeId = notice.toUpperCase();
  j.planId = plan.toUpperCase();
  j.details.visitorName = plan.toUpperCase();
  const r = planningMailJob(j);
  assert.equal(r.noticeId, notice);
  assert.equal(r.planId, plan);
  assert.equal(r.details.visitorName, plan.toUpperCase());
});
test("malformed or private extra fields, invalid recipients, timestamps and excessive destinations fail closed", () => {
  const f = fixture();
  for (const patch of [
    { recipientEmail: "x\r\nBcc:hidden@example.invalid" },
    { recipientEmail: "bad" },
    { version: 0 },
    { canReview: "true" },
    { noticeId: "bad" },
    { status: "SENT" },
    { unexpected: "private" },
  ])
    assert.throws(() => f.worker.render({ ...job(), ...patch }), MailFailure);
  for (const patch of [
    { startsAtUtc: "2026-02-30T00:00:00.000Z" },
    { untilUtc: job().details.startsAtUtc },
    { visitorName: "\ud800" },
    { destinations: Array(11).fill({ name: "A", accountName: "B" }) },
    { targetName: "x".repeat(121) },
  ])
    assert.throws(
      () =>
        f.worker.render({ ...job(), details: { ...job().details, ...patch } }),
      /RENDER_FAILED/u,
    );
  assert.throws(
    () => f.worker.render({ ...job("FYI"), canReview: true }),
    /RENDER_FAILED/u,
  );
  for (const origin of [
    "http://example.com",
    "https://example.com/path",
    "https://example.com/",
  ])
    assert.throws(
      () =>
        new PlanningNotificationWorker(
          { callProcedure: async () => "" },
          { send: async () => ({}) },
          new PlanningMailRenderer(origin),
        ),
      /INVALID_EMAIL_ORIGIN/u,
    );
});
test("CID branding reuses the existing Graph transport without photo or QR attachment", async () => {
  const worker = new PlanningNotificationWorker(
      { callProcedure: async () => "" },
      { send: async () => ({}) },
      new PlanningMailRenderer(
        "https://gatepass.example.invalid",
        Buffer.from("89504e470d0a1a0a", "hex"),
      ),
    ),
    message = worker.render(job());
  let body: any;
  await new GraphMailTransport(
    "sender@example.invalid",
    async () => "test-token",
    async (_url, options) => {
      body = JSON.parse(options!.body as string);
      return new Response(null, { status: 202 });
    },
  ).send(message);
  assert.equal(body.message.attachments.length, 1);
  assert.equal(body.message.attachments[0].contentId, "gatepass-company-logo");
  assert.equal(body.message.toRecipients[0].emailAddress.address, message.to);
  assert.equal(
    body.message.internetMessageHeaders[0].value,
    "planning-" + notice,
  );
});
test("scope cancellation before rendering or immediately before send suppresses delivery", async () => {
  for (const stage of [1, 2]) {
    const f = fixture();
    f.hook((name, _p, read) =>
      name === "gp.GetPlanningNotification" && read === stage
        ? { noticeId: notice, status: "CANCELLED" }
        : undefined,
    );
    assert.deepEqual(await f.worker.deliver(claim), {
      noticeId: notice,
      status: "CANCELLED",
    });
    assert.equal(f.sent.length, 0);
    assert.equal(
      f.calls.some((c) => c.name === "gp.CompletePlanningNotification"),
      false,
    );
  }
});
test("a changed recipient or scope projection during lease renewal is retried without sending old content", async () => {
  const f = fixture();
  f.hook((name, _p, read) =>
    name === "gp.GetPlanningNotification" && read === 2
      ? { ...job(), recipientEmail: "new@example.invalid" }
      : undefined,
  );
  assert.deepEqual(await f.worker.deliver(claim), {
    noticeId: notice,
    status: "PENDING",
  });
  assert.equal(f.sent.length, 0);
  assert.equal(f.calls.at(-1)!.p.ErrorCode.value, "DIRECTORY_UNAVAILABLE");
});
test("lost leases at read, renewal or completion cannot overwrite a recovered dispatch", async () => {
  for (const stage of [
    "gp.GetPlanningNotification",
    "gp.RenewPlanningNotificationLease",
    "gp.CompletePlanningNotification",
  ]) {
    const f = fixture();
    f.hook((name) => {
      if (name === stage) throw { number: 52003 };
    });
    assert.deepEqual(await f.worker.deliver(claim), {
      noticeId: notice,
      status: "LEASE_UNAVAILABLE",
    });
    assert.equal(
      f.calls.filter(
        (c) =>
          c.name === "gp.CompletePlanningNotification" &&
          c.p.Outcome.value === "FAILED",
      ).length,
      0,
    );
  }
});
test("provider and directory errors store only approved redacted retry codes", async () => {
  for (const [error, code] of [
    [
      Object.assign(new Error("private SQL and email"), { number: 52004 }),
      "DIRECTORY_UNAVAILABLE",
    ],
    [new MailFailure("PROVIDER_TIMEOUT"), "PROVIDER_TIMEOUT"],
    [Error("secret provider body"), "INTERNAL_ERROR"],
  ] as const) {
    const f = fixture();
    f.hook((name) => {
      if (name === "gp.GetPlanningNotification") throw error;
    });
    await f.worker.deliver(claim);
    assert.equal(f.calls.at(-1)!.p.ErrorCode.value, code);
    assert.equal(
      JSON.stringify(f.calls).includes("secret provider body"),
      false,
    );
  }
});
test("malformed claims and mismatched content receipts do not reach the provider", async () => {
  for (const claims of [
    [{ noticeId: "bad", claimToken: claim.claimToken }],
    Array(6).fill(claim),
    [claim, claim],
  ]) {
    const f = fixture();
    f.hook((name) =>
      name === "gp.ClaimPlanningNotifications" ? claims : undefined,
    );
    await assert.rejects(f.worker.runOnce(), /INTERNAL_ERROR/u);
    assert.equal(f.sent.length, 0);
  }
  const f = fixture();
  f.set({ ...job(), noticeId: randomUUID() });
  await f.worker.deliver(claim);
  assert.equal(f.sent.length, 0);
});
test("combined worker preserves separate channels and one broken queue cannot starve the other", async () => {
  const seen: string[] = [];
  const worker = new CombinedNotificationWorker([
    {
      channel: "registration",
      worker: {
        async runOnce() {
          seen.push("registration");
          throw Error("private");
        },
      },
    },
    {
      channel: "planning",
      worker: {
        async runOnce() {
          seen.push("planning");
          return [{ noticeId: notice, status: "SENT" }];
        },
      },
    },
  ]);
  assert.deepEqual(await worker.runOnce(), [
    { channel: "registration", status: "BATCH_UNAVAILABLE" },
    { channel: "planning", result: { noticeId: notice, status: "SENT" } },
  ]);
  assert.deepEqual(seen, ["registration", "planning"]);
  await assert.rejects(
    new CombinedNotificationWorker([
      {
        channel: "x",
        worker: {
          async runOnce() {
            throw Error();
          },
        },
      },
    ]).runOnce(),
    /MAIL_CHANNELS_UNAVAILABLE/u,
  );
  assert.throws(() => new CombinedNotificationWorker([]));
});
