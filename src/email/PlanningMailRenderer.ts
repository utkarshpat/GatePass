import type { MailRenderer, MailMessage } from "./MailContracts.ts";
import { planningMailJob } from "./PlanningMailContent.ts";
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/gu,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const when = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value)) + " IST";
const day = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
  }).format(new Date(value + "T12:00:00+05:30"));
/** Recipient-scoped content to escaped HTML; no provider, SQL or queue access. */
export class PlanningMailRenderer implements MailRenderer {
  #origin: string;
  #logo?: string;
  constructor(origin: string, logo?: Buffer) {
    const u = new URL(origin);
    if (
      u.origin !== origin ||
      (u.protocol !== "https:" &&
        !(
          u.protocol === "http:" &&
          u.hostname === "localhost" &&
          ["test", "development"].includes(process.env.NODE_ENV ?? "")
        ))
    )
      throw Error("INVALID_EMAIL_ORIGIN");
    if (
      logo &&
      (!Buffer.isBuffer(logo) ||
        logo.length > 524288 ||
        !logo.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    )
      throw Error("INVALID_EMAIL_BRAND");
    this.#origin = origin;
    this.#logo = logo?.toString("base64");
  }
  render(value: unknown): MailMessage {
    const job = planningMailJob(value),
      d = job.details,
      reference = "VP-" + job.planId.slice(0, 8).toUpperCase();
    const title =
      job.kind === "CANCELLED"
        ? "Visit coordination cancelled"
        : job.kind === "UPDATE"
          ? "Visit coordination updated"
          : job.audience === "APPROVAL"
            ? "Planning approval requested"
            : job.audience === "ARRANGEMENT"
              ? "Visit arrangements requested"
              : job.audience === "DISCUSSION"
                ? "You were mentioned in a discussion"
                : d.vip
                  ? "Leadership / VIP visit information"
                  : "Planned visit information";
    const intro =
      job.kind === "CANCELLED"
        ? "The earlier visit coordination has been cancelled."
        : job.kind === "UPDATE"
          ? job.eventKind === "REVISE"
            ? "The visit plan has changed. Earlier arrangements may need review."
            : "A planning decision or arrangement has been updated."
          : job.audience === "APPROVAL"
            ? "Please review your assigned approval step. Other destinations have their own approvals."
            : job.audience === "ARRANGEMENT"
              ? "Please review and coordinate your assigned arrangement."
              : job.audience === "DISCUSSION"
                ? "You were mentioned in an authorized discussion. Open the request to read and reply."
                : "For your information. No approval is required.";
    const row = (label: string, content: string) =>
      `<tr><td style="padding:9px 12px;border-bottom:1px solid #e4e7ec;color:#475467;width:32%;vertical-align:top;overflow-wrap:anywhere;word-break:break-word">${escape(label)}</td><td style="padding:9px 12px;border-bottom:1px solid #e4e7ec;color:#182230;vertical-align:top;overflow-wrap:anywhere;word-break:break-word">${escape(content)}</td></tr>`;
    const rows = [
      row("Visitor", d.visitorName),
      ...(d.company ? [row("Company", d.company)] : []),
      row("Office", d.locationName),
      row("Visit owner", d.hostName),
      row("Expected arrival", when(d.startsAtUtc)),
      row("Expected departure", when(d.untilUtc)),
      ...(d.targetName
        ? [
            row(
              job.audience === "DISCUSSION"
                ? "Discussion"
                : job.audience === "ARRANGEMENT"
                  ? "Arrangement"
                  : "Approval step",
              d.targetName,
            ),
          ]
        : []),
      ...d.destinations.map((p) =>
        row("Destination", p.accountName + " / " + p.name),
      ),
      ...(d.checkInDate
        ? [
            row("Stay check-in", day(d.checkInDate)),
            row("Stay check-out", day(d.checkOutDate!)),
          ]
        : []),
      ...(d.stayNotes ? [row("Stay request notes", d.stayNotes)] : []),
    ].join("");
    const href = this.#origin + "/coordination#visit=" + job.planId;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head><body style="margin:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:100%;max-width:620px;background:white;border:1px solid #e4e7ec;border-radius:12px"><tr><td style="padding:24px">${this.#logo ? '<img src="cid:gatepass-company-logo" alt="Sopra Steria" width="190" style="display:block;margin-bottom:24px">' : '<p style="font-weight:bold">Sopra Steria · GatePass</p>'}<p style="font-size:12px;color:#667085">${reference} · Version ${job.version}</p><h1 style="font-size:24px;line-height:1.3;color:#182230">${escape(title)}</h1><p style="font-size:15px;line-height:1.6;color:#475467">${escape(intro)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse;table-layout:fixed">${rows}</table>${job.canReview ? `<p style="margin:28px 0"><a href="${escape(href)}" style="display:inline-block;padding:13px 18px;color:#fff;background:#c90039;border-radius:6px;text-decoration:none;font-weight:bold">Open coordination request</a></p><p style="font-size:12px;line-height:1.6;color:#667085">Sign in to review your assigned coordination request.</p>` : '<p style="font-size:12px;color:#667085">Information only. Contact the visit owner if coordination is needed.</p>'}</td></tr></table></td></tr></table></body></html>`;
    return {
      notificationId: "planning-" + job.noticeId,
      to: job.recipientEmail,
      subject: title + " · GatePass · " + reference,
      html,
      ...(this.#logo ? { inlineLogo: this.#logo } : {}),
    };
  }
}
