import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  PlanningService,
  validatePlanningDefinition,
} from "../src/planning/PlanningService.ts";
import { PlanningError } from "../src/planning/Types.ts";
import { PlanningRoutes } from "../src/development/PlanningRoutes.ts";
import { Readable } from "node:stream";
const session = {
  sessionToken: Buffer.alloc(32, 3).toString("base64url"),
  csrfToken: Buffer.alloc(32, 4).toString("base64url"),
};
test('unknown planning action fails closed before any RPC can be selected', async () => {
  let calls = 0;
  const service = new PlanningService({ async callProcedure() { calls++; return '{}'; } });
  await assert.rejects(service.execute(session, 'unexpected' as any, {}), { code: 'INVALID_INPUT' });
  assert.equal(calls, 0);
});
const actor = randomUUID(),
  plan = randomUUID(),
  project = randomUUID(),
  step = randomUUID();
const draft = {
  locationId: 1,
  subProjectIds: [project],
  visitorName: "Synthetic guest",
  purpose: "Meeting",
  startsAtUtc: "2026-11-04T04:00:00.000Z",
  untilUtc: "2026-11-04T12:00:00.000Z",
  vip: false,
};
const rule = {
  id: step,
  name: "Authority",
  kind: "PROJECT",
  mode: "ALL",
  approverIds: [actor],
};
function fixture() {
  const calls: any[] = [];
  let value: any = { id: plan, revision: 1 };
  let fault: unknown;
  const service = new PlanningService({
    async callProcedure(name, p) {
      calls.push({ name, p });
      if (fault) throw fault;
      return typeof value === "string" ? value : JSON.stringify(value);
    },
  });
  return {
    service,
    calls,
    set(valueNext: any) {
      value = valueNext;
    },
    fail(error: unknown) {
      fault = error;
    },
  };
}
test("planning uses fixed typed procedures and caller identity never comes from input", async () => {
  const f = fixture();
  await f.service.execute(session, "create", {
    clientKey: randomUUID(),
    draft,
  });
  assert.equal(f.calls[0].name, "gp.CreatePlannedVisit");
  assert.equal(f.calls[0].p.SessionHash.value.length, 32);
  assert.deepEqual(JSON.parse(f.calls[0].p.DraftJson.value), draft);
  await assert.rejects(
    f.service.execute(session, "create", {
      clientKey: randomUUID(),
      draft,
      actorId: actor,
    }),
    { code: "INVALID_INPUT" },
  );
  await assert.rejects(
    f.service.execute(session, "change", {
      planId: plan,
      clientKey: randomUUID(),
      revision: 1,
      command: { kind: "SUBMIT", recipients: [actor] },
    }),
    { code: "INVALID_INPUT" },
  );
  assert.equal(f.calls.length, 1);
  await f.service.execute(session, "change", {
    planId: plan,
    clientKey: randomUUID(),
    revision: 1,
    command: { kind: "SUBMIT" },
  });
  assert.equal(f.calls[1].name, "gp.ChangePlannedVisit");
  assert.equal(f.calls[1].p.ExpectedRevision.type, "int");
});
test("read DTOs reject unexpected fields and normalize only identifier values", async () => {
  const f = fixture();
  f.set({
    actorId: actor.toUpperCase(),
    displayName: actor.toUpperCase(),
    locations: [],
    accounts: [],
    projects: [],
    people: [],
    policies: [],
    hosts: [],
  });
  const options = await f.service.execute(session, "options", {});
  assert.equal(options.actorId, actor);
  assert.equal(options.displayName, actor.toUpperCase());
  f.set({ visits: [], hasMore: false });
  await f.service.execute(session, "list", {
    folder: "ASSIGNED",
    offset: 0,
    search: "guest",
    locationId: 1,
    fromUtc: "2026-11-01T00:00:00.000Z",
  });
  assert.equal(f.calls.at(-1).p.Mode.value, "LIST");
  f.set({ threadId: step, messages: [], readers: [], hasMore: false });
  await f.service.execute(session, "thread", { planId: plan, threadId: step });
  f.set({
    id: plan,
    revision: 1,
    visitorName: "Guest",
    state: "DRAFT",
    projects: [],
    approvals: [],
    tasks: [],
    threads: [],
    activity: [],
  });
  await f.service.execute(session, "detail", { planId: plan });
  f.set({ id: plan, revision: 1, secretToken: "do not expose" });
  await assert.rejects(
    f.service.execute(session, "create", { clientKey: randomUUID(), draft }),
    { code: "UNAVAILABLE" },
  );
  for (const value of [null, [], { id: "---", revision: 1 }, "not json"]) {
    f.set(value);
    await assert.rejects(
      f.service.execute(session, "create", { clientKey: randomUUID(), draft }),
      { code: "UNAVAILABLE" },
    );
  }
});
test("management is bounded, explicit, scoped and never accepts authority fields", async () => {
  const f = fixture();
  await f.service.execute(session, "manage", {
    clientKey: randomUUID(),
    action: "PROJECT",
    payload: {
      locationId: 1,
      accountOfficeId: "1",
      name: "Alpha",
      active: true,
      revision: 0,
      reason: "Create",
    },
  });
  await f.service.execute(session, "manage", {
    clientKey: randomUUID(),
    action: "HOST",
    payload: {
      subProjectId: project,
      userId: actor,
      active: true,
      revision: 0,
      reason: "Assign",
    },
  });
  await f.service.execute(session, "manage", {
    clientKey: randomUUID(),
    action: "POLICY",
    payload: {
      subProjectId: project,
      definition: { approvalRules: [rule] },
      revision: 0,
      reason: "Configure",
    },
  });
  assert(f.calls.every((c) => c.name === "gp.ManageVisitPlanning"));
  for (const payload of [
    {
      subProjectId: project,
      locationId: 1,
      userId: actor,
      active: true,
      revision: 0,
      reason: "scope injection",
    },
    {
      locationId: 1,
      userId: actor,
      role: "ADMIN",
      active: true,
      revision: 0,
      reason: "role injection",
    },
    {
      locationId: 1,
      userId: "email@example.com",
      active: true,
      revision: 0,
      reason: "email is not identity",
    },
  ])
    await assert.rejects(
      f.service.execute(session, "manage", {
        clientKey: randomUUID(),
        action: "HOST",
        payload,
      }),
      { code: "INVALID_INPUT" },
    );
  const location = {
    approvalRules: [rule],
    arrangements: [
      {
        id: randomUUID(),
        name: "Stay",
        kind: "STAY",
        ownerIds: [actor],
        mandatoryForEntry: false,
      },
    ],
    receptionIds: [],
    securityIds: [],
    notifyIds: [actor],
    vipNotifyIds: [],
    maximumAdvanceDays: 90,
    maximumVisitDays: 30,
  };
  validatePlanningDefinition(location, true);
  for (const bad of [
    { ...location, maximumVisitDays: 0 },
    { ...location, approvalRules: [] },
    { ...location, notifyIds: [actor, actor] },
    {
      ...location,
      arrangements: [{ ...location.arrangements[0], ownerIds: [] }],
    },
    { ...location, arbitraryRecipients: ["outside@example.com"] },
  ])
    assert.throws(() => validatePlanningDefinition(bad, true), {
      code: "INVALID_INPUT",
    });
});
test("untrusted SQL failures are redacted and expected conflicts remain distinct", async () => {
  const f = fixture();
  for (const [number, code] of [
    [52001, "NOT_AUTHORIZED"],
    [52002, "INVALID_INPUT"],
    [52003, "CONFLICT"],
    [52004, "POLICY_UNAVAILABLE"],
    [547, "INVALID_INPUT"],
    [2601, "CONFLICT"],
    [12345, "UNAVAILABLE"],
  ] as const) {
    f.fail(Object.assign(new Error("private SQL and password"), { number }));
    await assert.rejects(
      f.service.execute(session, "create", { clientKey: randomUUID(), draft }),
      (e) =>
        e instanceof PlanningError &&
        e.code === code &&
        !e.message.includes("private"),
    );
  }
});
test("planning routes verify the session before body parsing and never expose arbitrary procedure routes", async () => {
  let verified = false,
    bodyRead = false;
  const f = fixture(),
    routes = new PlanningRoutes(
      {
        session() {
          return session;
        },
        async verify() {
          return verified;
        },
      },
      f.service,
    );
  assert(routes.handles("/api/coordination/detail"));
  assert(!routes.handles("/api/coordination/sql"));
  const req = () =>
    Object.assign(
      Readable.from([
        Buffer.from(JSON.stringify({ clientKey: randomUUID(), draft })),
      ]),
      {
        url: "/api/coordination/create",
        headers: { "content-type": "application/json" },
      },
    ) as any;
  const denied = req();
  denied[Symbol.asyncIterator] = () => {
    bodyRead = true;
    throw Error("must not read");
  };
  await assert.rejects(routes.handle(denied, {} as any), { status: 401 });
  assert.equal(bodyRead, false);
  verified = true;
  await routes.handle(req(), {} as any);
  f.fail(Object.assign(Error("private"), { number: 52001 }));
  await assert.rejects(routes.handle(req(), {} as any), { status: 403 });
});
