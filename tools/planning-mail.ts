import {PlanningMailRenderer} from '../src/email/PlanningMailRenderer.ts';
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { LocalDevelopmentApiClient } from "../src/development/LocalDevelopmentApiClient.ts";
import { requireDummySso } from "../src/development/DummyEmployeeSso.ts";
import {
  sandboxRecipient,
  sandboxTransport,
} from "../src/development/DevelopmentMailSandbox.ts";
import { PlanningNotificationWorker } from "../src/email/PlanningNotificationWorker.ts";
import { PrivateDirectory } from "../src/storage/PrivateDirectory.ts";
import { isUuid } from "../src/visits/SqlVisitReadRepository.ts";
import type { EmailSql } from "../src/email/EmailWorkflowService.ts";
let client: LocalDevelopmentApiClient | undefined;
try {
  if (process.env.NODE_ENV === "production") throw Error("DEVELOPMENT_ONLY");
  const args = process.argv.slice(2),
    [plan, flag, to] = args;
  if (
    !isUuid(plan) ||
    (args.length !== 1 && (args.length !== 3 || flag !== "--send-to"))
  )
    throw Error("SELECTED_PLAN_REQUIRED");
  if (flag) sandboxRecipient(to);
  process.env.NODE_ENV = "development";
  process.env.GATEPASS_SSO_MODE = "dummy";
  process.env.GATEPASS_DIRECTORY_MODE = "mock";
  requireDummySso();
  client = new LocalDevelopmentApiClient();
  const selected = plan.toLowerCase(),
    claims = new Map<string, string>();
  const scoped: EmailSql = {
    async callProcedure(name, p) {
      requireDummySso();
      if (
        name === "gp.PreviewPlanningNotifications" ||
        name === "gp.ClaimPlanningNotifications"
      ) {
        if (p.PlanId?.value !== selected) throw Error("SELECTED_PLAN_REQUIRED");
      } else if (
        ![
          "gp.GetPlanningNotification",
          "gp.RenewPlanningNotificationLease",
          "gp.CompletePlanningNotification",
        ].includes(name) ||
        claims.get(String(p.NoticeId?.value)) !== p.ClaimToken?.value
      )
        throw Error("SELECTED_CLAIM_REQUIRED");
      const raw = await client!.callProcedure(name, p),
        result = JSON.parse(raw);
      if (name === "gp.ClaimPlanningNotifications") {
        if (
          !Array.isArray(result) ||
          result.length > 5 ||
          result.some((c) => !isUuid(c.noticeId) || !isUuid(c.claimToken))
        )
          throw Error("INVALID_CLAIMS");
        claims.clear();
        for (const c of result)
          claims.set(c.noticeId.toLowerCase(), c.claimToken.toLowerCase());
      }
      if (
        (name === "gp.GetPlanningNotification" &&
          result.status === "READY" &&
          result.planId?.toLowerCase() !== selected) ||
        (name === "gp.PreviewPlanningNotifications" &&
          result.planId?.toLowerCase() !== selected)
      )
        throw Error("SELECTED_PLAN_MISMATCH");
      return raw;
    },
  };
  const logo = await readFile(
    new URL("../assets/brand/sopra-steria-logo.png", import.meta.url),
  );
  if (flag) {
    const { openPersonalOutlook } =
        await import("../src/email/PersonalOutlookConnection.ts"),
      { GraphMailTransport } =
        await import("../src/email/GraphMailTransport.ts");
    const { connection, config } = await openPersonalOutlook();
    const worker = new PlanningNotificationWorker(
      scoped,
      sandboxTransport(
        new GraphMailTransport(
          config.sender,
          () => connection.acquireToken(),
          fetch,
          "delegated",
        ),
        to,
      ),
      new PlanningMailRenderer("http://localhost:8443",logo),
    );
    const results = await worker.runOnce(selected);
    console.log(
      JSON.stringify({
        mode: "EXPLICIT_TEST_RECIPIENT",
        selectedPlan: selected,
        results,
      }),
    );
  } else {
    const result = JSON.parse(
      await scoped.callProcedure("gp.PreviewPlanningNotifications", {
        PlanId: { type: "guid", value: selected },
      }),
    );
    if (!Array.isArray(result.messages) || result.messages.length > 20)
      throw Error("INVALID_PREVIEW");
    const worker = new PlanningNotificationWorker(
      scoped,
      {
        async send() {
          throw Error("PREVIEW_NEVER_SENDS");
        },
      },
      new PlanningMailRenderer("http://localhost:8443",logo),
    );
    const directory = await PrivateDirectory.create(
        join(homedir(), ".gatepass", "private-v1", "planning-mail-previews"),
        [process.cwd()],
      ),
      prefix = selected + "/" + randomUUID();
    const manifest = [];
    for (const { job } of result.messages) {
      if (job.planId?.toLowerCase() !== selected)
        throw Error("SELECTED_PLAN_MISMATCH");
      const message = worker.render(job),
        key = prefix + "/" + job.noticeId.toLowerCase() + ".html";
      await directory.write(
        key,
        Buffer.from(
          message.html.replace(
            "cid:gatepass-company-logo",
            "data:image/png;base64," + message.inlineLogo,
          ),
        ),
      );
      manifest.push({
        noticeId: job.noticeId,
        recipient: message.to,
        subject: message.subject,
        file: directory.path(key),
      });
    }
    const key = prefix + "/manifest.json";
    await directory.write(
      key,
      Buffer.from(
        JSON.stringify(
          { mode: "PREVIEW_ONLY", planId: selected, messages: manifest },
          null,
          2,
        ),
      ),
    );
    console.log(
      JSON.stringify({
        mode: "PREVIEW_ONLY",
        count: manifest.length,
        manifest: directory.path(key),
      }),
    );
  }
} catch {
  console.error(
    "PLANNING_MAIL_TOOL_UNAVAILABLE: use mail:planning -- <selected-plan-uuid> [--send-to <explicit-test-email>]. Default preview sends nothing. Verify the local synthetic database and, only for --send-to, the Outlook connection.",
  );
  process.exitCode = 1;
} finally {
  await client?.close();
}
