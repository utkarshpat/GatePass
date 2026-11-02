import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { HostReminderService } from "../src/email/HostReminderService.ts";
import { createLoopbackHttpHandler } from "../src/development/LoopbackHttpHandler.ts";
import { Readable } from "node:stream";
const session = {
  sessionToken: randomBytes(32).toString("base64url"),
  csrfToken: randomBytes(32).toString("base64url"),
};
const visitRequestId = randomUUID();
const result = {
  outcome: "QUEUED",
  mailStatus: "QUEUED",
  eligible: true,
  lastQueuedAtUtc: "2026-10-22T07:00:00.000Z",
  nextReminderAtUtc: "2026-10-22T07:05:00.000Z",
};

test("reminder domain errors retain the existing HTTP status and redact SQL details", async () => {
  const before = {
    NODE_ENV: process.env.NODE_ENV,
    GATEPASS_SSO_MODE: process.env.GATEPASS_SSO_MODE,
    GATEPASS_DIRECTORY_MODE: process.env.GATEPASS_DIRECTORY_MODE,
  };
  Object.assign(process.env, {
    NODE_ENV: "test",
    GATEPASS_SSO_MODE: "dummy",
    GATEPASS_DIRECTORY_MODE: "mock",
  });
  try {
    for (const [number, status] of [
      [52001, 403],
      [53501, 403],
      [52002, 400],
      [52003, 409],
      [52004, 409],
      [99999, 503],
    ]) {
      const service = new HostReminderService({
        async callProcedure() {
          throw Object.assign(Error("private SQL data"), { number });
        },
      });
      const handler = createLoopbackHttpHandler("http://localhost:18448", {
        handles: () => true,
        handle: () => service.run(session, { visitRequestId }, "RECEPTION"),
      });
      const request = Object.assign(Readable.from([]), {
        method: "POST",
        url: "/api/reception/remind-host",
        socket: { remoteAddress: "127.0.0.1" },
        headers: { host: "localhost:18448", origin: "http://localhost:18448" },
      });
      let output = "";
      const response = {
        statusCode: 0,
        headersSent: false,
        setHeader() {},
        end(value: string) {
          output = value;
        },
      };
      await handler(request as any, response as any);
      assert.equal(response.statusCode, status);
      assert(!output.includes("private SQL data"));
      assert(!output.includes(String(number)));
    }
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
test("reminder binds the signed-in identity, view and immutable request; strips private output", async () => {
  const service = new HostReminderService({
    async callProcedure(name, p) {
      assert.equal(name, "gp.RemindVisitHost");
      assert.equal(p.View.value, "RECEPTION");
      assert.equal((p.SessionHash.value as Buffer).length, 32);
      assert.equal(p.VisitRequestId.value, visitRequestId);
      return JSON.stringify({ ...result, recipientEmail: "private" });
    },
  });
  assert.deepEqual(
    await service.run(
      session,
      { visitRequestId, clientKey: randomUUID() },
      "RECEPTION",
    ),
    result,
  );
});
test("guard reminders require a project duty and cannot accept an email or impersonated host", async () => {
  let count = 0;
  const service = new HostReminderService({
    async callProcedure() {
      count++;
      return JSON.stringify(result);
    },
  });
  for (const d of [
    { visitRequestId },
    { visitRequestId, locationId: 1, dutyKind: "COMMON", dutyId: "1" },
    {
      visitRequestId,
      locationId: 1,
      dutyKind: "PROJECT",
      dutyId: "1",
      email: "other@example.com",
    },
  ])
    await assert.rejects(service.run(session, d, "GUARD"));
  assert.equal(count, 0);
  assert.deepEqual(
    await service.run(
      session,
      { visitRequestId, locationId: 1, dutyKind: "PROJECT", dutyId: "1" },
      "GUARD",
    ),
    result,
  );
});
test("reminder state conflicts, denial and malformed output fail closed", async () => {
  for (const [number, code] of [
    [52001, "NOT_AUTHORIZED"],
    [53501, "NOT_AUTHORIZED"],
    [52003, "CONFLICT"],
    [52004, "CONFLICT"],
    [52002, "INVALID_INPUT"],
    [99999, "UNAVAILABLE"],
  ]) {
    const service = new HostReminderService({
      async callProcedure() {
        throw { number };
      },
    });
    await assert.rejects(
      service.run(session, { visitRequestId }, "RECEPTION"),
      { code },
    );
  }
  const service = new HostReminderService({
    async callProcedure() {
      return JSON.stringify({ ...result, mailStatus: "DELIVERED" });
    },
  });
  await assert.rejects(service.run(session, { visitRequestId }, "RECEPTION"), {
    code: "UNAVAILABLE",
  });
});
