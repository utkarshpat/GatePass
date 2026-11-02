import type { SqlProcedurePort } from "../contracts/Sql.ts";
import { MailFailure } from "./MailContracts.ts";
import type {
  MailMessage,
  MailTransport,
  MailRenderer,
  NotificationBatch,
} from "./MailContracts.ts";
import { planningMailJob } from "./PlanningMailContent.ts";
import type { PlanningMailClaim } from "./PlanningMailContent.ts";
import { isUuid } from "../visits/SqlVisitReadRepository.ts";
import { boundedText } from "../planning/Policy.ts";
export { planningMailJob } from "./PlanningMailContent.ts";
export type {
  PlanningMailJob,
  PlanningMailClaim,
} from "./PlanningMailContent.ts";
const failures = [
  "DIRECTORY_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_REJECTED",
  "RENDER_FAILED",
  "INVALID_RECIPIENT",
  "INTERNAL_ERROR",
];
/** Queue orchestration: dependencies are ports, rendering and provider decisions are delegated. */
export class PlanningNotificationWorker implements NotificationBatch {
  readonly #sql: SqlProcedurePort;
  readonly #transport: MailTransport;
  readonly #renderer: MailRenderer;
  constructor(
    sql: SqlProcedurePort,
    transport: MailTransport,
    renderer: MailRenderer,
  ) {
    this.#sql = sql;
    this.#transport = transport;
    this.#renderer = renderer;
  }
  async #rpc(
    name: string,
    parameters: Parameters<SqlProcedurePort["callProcedure"]>[1],
  ) {
    return JSON.parse(await this.#sql.callProcedure(name, parameters));
  }
  render(value: unknown): MailMessage {
    return this.#renderer.render(value);
  }
  async runOnce(planId?: string) {
    if (planId !== undefined && !isUuid(planId))
      throw new MailFailure("INTERNAL_ERROR");
    const claims = await this.#rpc("gp.ClaimPlanningNotifications", {
      BatchSize: { type: "int", value: 5 },
      LeaseSeconds: { type: "int", value: 120 },
      PlanId: { type: "guid", value: planId?.toLowerCase() ?? null },
    });
    if (
      !Array.isArray(claims) ||
      claims.length > 5 ||
      claims.some((c) => !c || !isUuid(c.noticeId) || !isUuid(c.claimToken)) ||
      new Set(claims.map((c) => c.noticeId.toLowerCase())).size !==
        claims.length
    )
      throw new MailFailure("INTERNAL_ERROR");
    const results = [];
    for (const claim of claims) results.push(await this.deliver(claim));
    return results;
  }
  async deliver(claim: PlanningMailClaim) {
    if (!isUuid(claim?.noticeId) || !isUuid(claim?.claimToken))
      throw new MailFailure("INTERNAL_ERROR");
    const noticeId = claim.noticeId.toLowerCase(),
      p = {
        NoticeId: { type: "guid" as const, value: noticeId },
        ClaimToken: {
          type: "guid" as const,
          value: claim.claimToken.toLowerCase(),
        },
      };
    const read = async () => {
      const raw = await this.#rpc("gp.GetPlanningNotification", p);
      if (!isUuid(raw?.noticeId) || raw.noticeId.toLowerCase() !== noticeId)
        throw new MailFailure("RENDER_FAILED");
      return raw.status === "CANCELLED"
        ? { status: "CANCELLED" as const, noticeId }
        : planningMailJob(raw);
    };
    try {
      const job = await read();
      if (job.status === "CANCELLED") return job;
      const message = this.render(job),
        renew = await this.#rpc("gp.RenewPlanningNotificationLease", {
          ...p,
          LeaseSeconds: { type: "int", value: 120 },
        });
      if (renew?.ok !== true) throw new MailFailure("INTERNAL_ERROR");
      const fresh = await read();
      if (fresh.status === "CANCELLED") return fresh;
      if (JSON.stringify(fresh) !== JSON.stringify(job))
        throw new MailFailure("DIRECTORY_UNAVAILABLE");
      const accepted = await this.#transport.send(message);
      if (
        !accepted ||
        (accepted.providerMessageId !== undefined &&
          !boundedText(accepted.providerMessageId, 200))
      )
        throw new MailFailure("INTERNAL_ERROR");
      const receipt = await this.#rpc("gp.CompletePlanningNotification", {
        ...p,
        Outcome: { type: "text", value: "SENT" },
        ErrorCode: { type: "text", value: null },
        ProviderMessageId: {
          type: "text",
          value: accepted.providerMessageId ?? null,
        },
      });
      if (
        !isUuid(receipt?.noticeId) ||
        receipt.noticeId.toLowerCase() !== noticeId ||
        receipt.status !== "SENT"
      )
        throw new MailFailure("INTERNAL_ERROR");
      return { noticeId, status: "SENT" };
    } catch (error) {
      if (Number((error as { number?: number })?.number) === 52003)
        return { noticeId, status: "LEASE_UNAVAILABLE" };
      const code =
        Number((error as { number?: number })?.number) === 52004
          ? "DIRECTORY_UNAVAILABLE"
          : error instanceof MailFailure && failures.includes(error.code)
            ? error.code
            : "INTERNAL_ERROR";
      try {
        const receipt = await this.#rpc("gp.CompletePlanningNotification", {
          ...p,
          Outcome: { type: "text", value: "FAILED" },
          ErrorCode: { type: "text", value: code },
          ProviderMessageId: { type: "text", value: null },
        });
        if (
          !isUuid(receipt?.noticeId) ||
          receipt.noticeId.toLowerCase() !== noticeId ||
          !["PENDING", "DEAD"].includes(receipt.status)
        )
          throw Error();
        return { noticeId, status: receipt.status as string };
      } catch {
        return { noticeId, status: "LEASE_UNAVAILABLE" };
      }
    }
  }
}
