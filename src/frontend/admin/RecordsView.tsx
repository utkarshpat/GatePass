import { Fragment } from "react";
import type { AdminModel } from "./model.ts";
import { dateTime, human } from "./types.ts";
import { registerCell, registerChoices, registerColumns } from "./register.ts";
import { passValidityLabel } from "../../printing/ValidityDisplay.ts";
import { deviceLabels } from "../reception/types.ts";
import { Row } from "./StaffView.tsx";
const tone: Record<string, string> = {
  APPROVED: "ok",
  ACTIVE: "ok",
  INSIDE: "info",
  PRINTED: "info",
  RETURNED: "info",
  PENDING: "warn",
  DENIED: "bad",
  REVOKED: "bad",
};
export function RegisterHeader({ model }: { model: AdminModel }) {
  return (
    <tr>
      {registerColumns
        .filter(([key]) => model.register.visible.has(key))
        .map(([key, label]) => (
          <th
            key={key}
            scope="col"
            aria-sort={
              model.field("register-sort") === key
                ? model.field("register-direction") === "ASC"
                  ? "ascending"
                  : "descending"
                : "none"
            }
          >
            <button
              type="button"
              className="register-sort-button"
              disabled={model.writing || model.register.loading}
              onClick={() => model.register.sort(key)}
            >
              {label +
                (model.field("register-sort") === key
                  ? model.field("register-direction") === "ASC"
                    ? " ↑"
                    : " ↓"
                  : "")}
            </button>
          </th>
        ))}
    </tr>
  );
}
export function RegisterRows({ model }: { model: AdminModel }) {
  const r = model.register;
  return r.message ? (
    <tr>
      <td className="register-notice" colSpan={r.visible.size}>
        {r.message}
      </td>
    </tr>
  ) : (
    r.rows.map((row) => (
      <tr
        key={row.visitRequestId}
        className="register-row"
        onClick={(event) => {
          if (!(event.target as Element).closest("button"))
            void model.records.viewVisit(row);
        }}
      >
        {registerColumns
          .filter(([key]) => r.visible.has(key))
          .map(([key]) => (
            <td key={key}>
              {key === "personName" ? (
                <button
                  type="button"
                  className="register-name"
                  disabled={model.writing}
                  onClick={() => void model.records.viewVisit(row)}
                >
                  {registerCell(key, row[key])}
                </button>
              ) : ["status", "passStatus", "presence", "printStatus"].includes(
                  key,
                ) && row[key] ? (
                <span
                  className={
                    "cell-pill" +
                    (tone[row[key]!] ? " pill-" + tone[row[key]!] : "")
                  }
                >
                  {registerCell(key, row[key])}
                </span>
              ) : (
                registerCell(key, row[key])
              )}
            </td>
          ))}
      </tr>
    ))
  );
}
export function RegisterColumns({ model }: { model: AdminModel }) {
  return registerColumns.map(([key, label]) => (
    <label key={key}>
      <input
        type="checkbox"
        checked={model.register.visible.has(key)}
        disabled={model.writing}
        onChange={(event) =>
          model.register.toggleColumn(key, event.target.checked)
        }
      />
      {label}
    </label>
  ));
}
export function RegisterFilters({ model }: { model: AdminModel }) {
  return model.register.filters.map((row) => (
    <div key={row.id} className="register-filter">
      <select
        aria-label="Filter field"
        value={row.key}
        disabled={model.writing}
        onChange={(event) => {
          const key = event.target.value;
          model.register.changeFilter(row.id, {
            key,
            value: registerChoices[key]?.[0] ?? "",
          });
        }}
      >
        {registerColumns.map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <div className="register-filter-value">
        {registerChoices[row.key] ? (
          <select
            aria-label="Filter value"
            required
            value={row.value}
            disabled={model.writing}
            onChange={(event) =>
              model.register.changeFilter(row.id, { value: event.target.value })
            }
          >
            {registerChoices[row.key].map((value) => (
              <option key={value} value={value}>
                {human(value)}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label="Filter value"
            required
            maxLength={200}
            placeholder={
              row.key.endsWith("Utc")
                ? "Contains UTC date / time…"
                : "Contains…"
            }
            disabled={model.writing}
            value={row.value}
            onChange={(event) =>
              model.register.changeFilter(row.id, { value: event.target.value })
            }
          />
        )}
      </div>
      <button
        type="button"
        className="quiet"
        disabled={model.writing}
        onClick={() => model.register.removeFilter(row.id)}
      >
        Remove
      </button>
    </div>
  ));
}
const auditClock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }),
  auditDay = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
export function AuditRows({ model }: { model: AdminModel }) {
  let day = "";
  return model.records.shownEvents().map((event, i) => {
    const label = event.occurredAtUtc
        ? auditDay.format(new Date(event.occurredAtUtc))
        : "Unknown date",
      heading = label !== day;
    day = label;
    return (
      <Fragment key={i}>
        {heading && <h3 className="log-day">{label}</h3>}
        <article className="log-line">
          <time dateTime={event.occurredAtUtc} className="log-time">
            {event.occurredAtUtc
              ? auditClock.format(new Date(event.occurredAtUtc))
              : "—"}
          </time>
          <span className="log-level" data-result={event.resultCode}>
            {human(event.resultCode)}
          </span>
          <div className="log-msg">
            <span className="log-action">{human(event.actionCode)}</span>
            {" by "}
            <span className="log-actor">{event.actorDisplayName}</span>
            {" → "}
            <span className="log-target">
              {[human(event.targetType), event.targetDisplayName]
                .filter(Boolean)
                .join(" ")}
            </span>
            {[
              [
                event.actionCode.startsWith("ACCOUNT_HOST_")
                  ? "employee"
                  : "staff",
                event.staffCode,
              ],
              ["role", event.roleCode ? human(event.roleCode) : null],
              ["scope", event.scopeName],
            ]
              .filter(([, value]) => value)
              .map(([key, value]) => (
                <Fragment key={key}>
                  {" "}
                  <span className="log-meta">{key + "=" + value}</span>
                </Fragment>
              ))}
          </div>
          {event.reason && <p className="log-reason">{event.reason}</p>}
        </article>
      </Fragment>
    );
  });
}
export function VisitFields({ model }: { model: AdminModel }) {
  const row = model.records.selected,
    detail = model.records.detail;
  if (!row || !detail) return null;
  const pairs: [string, string | null | undefined][] = [
    ...(detail.companyName
      ? [["Company", detail.companyName] as [string, string]]
      : []),
    ...(detail.deviceTypes?.length
      ? [
          [
            "Devices",
            detail.deviceTypes.map((code) => deviceLabels[code]).join(", "),
          ] as [string, string],
        ]
      : []),
    ["Name", detail.personName],
    ["Status", human(detail.status)],
    ["Office", detail.locationName],
    ["Account", detail.projectName ?? "Digital ID"],
    ["Host", detail.hostName ?? "Not applicable"],
    ["Purpose", detail.reason],
    ["Pass", detail.publicPassNumber],
    ["Valid from", dateTime(detail.validFromUtc)],
    ["Valid until", passValidityLabel(detail.validUntilUtc)],
    ...(
      [
        ["Email", row.personEmail],
        ["Mobile", row.personPhone],
        ["Employee ID", row.employeeId],
        ["Host email", row.hostEmail],
        ["Request reference", row.publicReference],
        ["Type", row.requestType ? human(row.requestType) : null],
      ] as [string, string | null | undefined][]
    ).filter(([, value]) => value),
  ];
  return pairs.map(([key, value]) => (
    <div key={key} className="detail-pair">
      <dt>{key}</dt>
      <dd>{value ?? "Unavailable"}</dd>
    </div>
  ));
}
export function VisitChips({ model }: { model: AdminModel }) {
  const row = model.records.selected,
    detail = model.records.detail;
  if (!row || !detail) return null;
  return [
    ["Approval", detail.status],
    ["Pass", detail.passStatus ?? row.passStatus],
    [
      "Presence",
      typeof detail.isInside === "boolean"
        ? detail.isInside
          ? "INSIDE"
          : "OUTSIDE"
        : "UNKNOWN",
    ],
    ["Printed", row.printStatus],
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => (
      <span key={key} className={"status-chip " + (tone[value!] ?? "")}>
        {key + ": " + human(value)}
      </span>
    ));
}
export function VisitTimeline({ model }: { model: AdminModel }) {
  const row = model.records.selected,
    detail = model.records.detail;
  if (!row || !detail) return null;
  const events: { at?: string; title: string; meta?: string; tone?: string }[] =
    [];
  const add = (
    at: string | undefined | null,
    title: string,
    meta = "",
    color = "",
  ) => {
    if (at) events.push({ at, title, meta, tone: color });
  };
  add(
    row.submittedAtUtc,
    "Request registered",
    [human(row.requestType), row.publicReference].filter(Boolean).join(" · "),
  );
  add(
    detail.validFromUtc,
    "Pass valid from",
    detail.publicPassNumber ? "Pass " + detail.publicPassNumber : "",
  );
  for (const movement of detail.movements ?? [])
    add(
      movement.occurredAtUtc,
      movement.eventType === "ENTRY" ? "Entered premises" : "Left premises",
      [movement.guardName, human(movement.entryMethod)]
        .filter(Boolean)
        .join(" · "),
      movement.eventType === "ENTRY" ? "tl-entry" : "tl-exit",
    );
  add(row.returnedAtUtc, "Pass returned", "", "tl-returned");
  add(detail.validUntilUtc, "Pass valid until");
  events.sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!));
  if (!detail.movements?.length)
    events.push({ title: "No gate movement recorded yet" });
  if (detail.movementsHasMore)
    events.push({ title: "More movements exist than are listed here" });
  return events.map((event, i) => (
    <li
      key={i}
      className={"timeline-item" + (event.tone ? " " + event.tone : "")}
    >
      <span className="timeline-dot" aria-hidden="true" />
      <div className="timeline-body">
        <strong>{event.title}</strong>
        {event.at && (
          <time dateTime={event.at}>
            {event.title === "Pass valid until"
              ? passValidityLabel(event.at)
              : dateTime(event.at)}
          </time>
        )}
        {event.meta && <p>{event.meta}</p>}
      </div>
    </li>
  ));
}
export function OfficeRows({ model }: { model: AdminModel }) {
  return model.offices.map((office) => (
    <Row
      key={office.locationId}
      lines={[office.locationName, office.locationCode]}
    >
      <button
        type="button"
        className="secondary"
        disabled={model.writing}
        onClick={() => void model.records.loadQr(office)}
      >
        Registration QR
      </button>
    </Row>
  ));
}
