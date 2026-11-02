import { Fragment } from "react";
import type { ReceptionModel } from "./model.ts";
import {
  effective,
  kind,
  dateTime,
  projectText,
  deviceLabels,
  type ReceptionVisit as Visit,
} from "./types.ts";
import { passValidityLabel } from "../../shared/ValidityDisplay.ts";
export function Badge({ value }: { value: string }) {
  if (!value) return null;
  return (
    <span className={"status " + value.toLowerCase()}>
      {value.charAt(0) + value.slice(1).toLowerCase()}
    </span>
  );
}
export function Eye() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
export const initials = (name: string) =>
  (name || "V")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((v) => v[0])
    .join("")
    .toUpperCase();
export function CardStatus({
  row,
  model,
}: {
  row: Visit;
  model: ReceptionModel;
}) {
  const ui = model.state;
  if (!ui.location?.canPrint || (!row.returnedAtUtc && !row.printCount))
    return (
      <span
        className={
          "status " +
          (row.returnedAtUtc
            ? "returned"
            : row.printCount
              ? "printed"
              : "unprinted")
        }
      >
        {row.returnedAtUtc
          ? "Returned"
          : row.printCount
            ? "Printed"
            : "Not printed"}
      </span>
    );
  return (
    <select
      className="card-status-select"
      aria-label={"Card status for " + row.personName}
      value="CURRENT"
      disabled={ui.returnBusy || ui.printBusy || !!row.isInside}
      title={
        row.isInside
          ? "Record every account exit before returning the pass"
          : "Change printed pass return status"
      }
      onChange={(event) => {
        if (event.target.value === "RETURN") void model.returnPass(row);
        else if (event.target.value === "CORRECT") model.openCorrection(row);
        event.currentTarget.value = "CURRENT";
      }}
    >
      <option value="CURRENT">
        {row.returnedAtUtc ? "Returned" : "Printed"}
      </option>
      <option value={row.returnedAtUtc ? "CORRECT" : "RETURN"}>
        {row.returnedAtUtc ? "Correct mistaken return…" : "Mark returned…"}
      </option>
    </select>
  );
}
export function RegistrationRows({ model }: { model: ReceptionModel }) {
  const rows = model.matchingRows().slice(0, model.state.renderLimit);
  return (
    <>
      {rows.map((row) => {
        const ref = row.employeeId ?? row.publicReference ?? "—",
          displayRef =
            ref.startsWith("V-") && ref.length > 14
              ? "V-" + ref.slice(2, 10).toUpperCase()
              : ref;
        return (
          <tr
            key={row.visitRequestId}
            className="registration-row"
            tabIndex={0}
            aria-label={"View pass for " + row.personName}
            onClick={(event) => {
              if (!(event.target as Element).closest("button,a,input,select"))
                void model.openVisit(row);
            }}
            onKeyDown={(event) => {
              if (
                event.target === event.currentTarget &&
                ["Enter", " "].includes(event.key)
              ) {
                event.preventDefault();
                void model.openVisit(row);
              }
            }}
          >
            <td className="cell-identity">
              <div className="identity-cell">
                <div className="avatar">{initials(row.personName)}</div>
                <div className="person-copy">
                  <button
                    className="visit-person name"
                    type="button"
                    onClick={() => void model.openVisit(row)}
                  >
                    {row.personName}
                  </button>
                  <div className="sub" title={ref}>
                    {displayRef +
                      " · " +
                      kind(row) +
                      " · " +
                      new Intl.DateTimeFormat("en-IN", {
                        timeZone: "Asia/Kolkata",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(
                        new Date(row.submittedAtUtc ?? row.validFromUtc),
                      )}
                  </div>
                </div>
              </div>
            </td>
            <td className="cell-project">
              <div className="cell-primary">{projectText(row)}</div>
              <div className="cell-secondary">{kind(row)}</div>
            </td>
            <td className="cell-host host-col">
              <div className="cell-primary">
                {row.requestType === "DIGITAL_ID"
                  ? "Not applicable"
                  : (row.hostName ?? "Host unavailable")}
              </div>
              <div className="cell-secondary">
                {row.requestType === "DIGITAL_ID" ? "" : (row.hostEmail ?? "")}
              </div>
            </td>
            <td className="cell-status">
              <Badge value={effective(row)} />
              {row.isInside ? (
                <span className="status inside">Inside</span>
              ) : null}
            </td>
            <td className="cell-card">
              <CardStatus row={row} model={model} />
            </td>
            <td className="cell-actions actions">
              <button
                className="btn outline icon-action"
                type="button"
                aria-label={"View pass for " + row.personName}
                title="View pass"
                onClick={() => void model.openVisit(row)}
              >
                <Eye />
              </button>
              <button
                className="btn primary"
                type="button"
                hidden={!model.canPrint(row)}
                disabled={model.state.printBusy || model.state.returnBusy}
                onClick={() => void model.browserPrint(row)}
              >
                {row.printCount ? "Reprint" : "Print"}
              </button>
            </td>
          </tr>
        );
      })}
    </>
  );
}
export function ReadOnlyCard({ detail }: { detail: Visit }) {
  return (
    <article className="readonly-pass" aria-label="Read-only pass summary">
      {[
        detail.personName,
        kind(detail) + " · " + effective(detail),
        detail.publicPassNumber,
        detail.locationName,
        projectText(detail),
      ].map((v, index) => (
        <p key={index}>{v}</p>
      ))}
      <small>Details only · no entry credential</small>
    </article>
  );
}
export function DetailFields({ detail, row }: { detail: Visit; row: Visit }) {
  const fields: [string, React.ReactNode][] = [
    ["Pass ID", detail.publicPassNumber],
    ["Office", detail.locationName],
    [
      detail.requestType === "DIGITAL_ID" ? "Assigned accounts" : "Account",
      projectText(detail),
    ],
    ...(detail.requestType !== "DIGITAL_ID"
      ? [
          [
            "Host",
            <Fragment key="host">
              {detail.hostName ?? "Unavailable"}
              <span className="host-email">
                {detail.hostEmail ?? "Email unavailable"}
              </span>
            </Fragment>,
          ] as [string, React.ReactNode],
        ]
      : []),
    ...(detail.companyName
      ? [["Company", detail.companyName] as [string, React.ReactNode]]
      : []),
    ...(detail.deviceTypes?.length
      ? [
          [
            "Declared devices",
            detail.deviceTypes.map((v) => deviceLabels[v]).join(", "),
          ] as [string, React.ReactNode],
        ]
      : []),
    ["Purpose", detail.reason],
    ["Valid from", dateTime(detail.validFromUtc)],
    ["Valid until", passValidityLabel(detail.validUntilUtc)],
    ["Print count", String(row.printCount)],
    [
      "Card status",
      row.returnedAtUtc
        ? "Returned " + dateTime(row.returnedAtUtc)
        : row.printCount
          ? "Printed — awaiting return"
          : "Not printed",
    ],
  ];
  return (
    <>
      {fields.map(([label, value]) => (
        <div className="info" key={label}>
          <dt className="label">{label}</dt>
          <dd
            className="value"
            id={
              label === "Print count"
                ? "detail-print-count"
                : label === "Card status"
                  ? "detail-card-status"
                  : undefined
            }
          >
            {value}
          </dd>
        </div>
      ))}
    </>
  );
}
export function HistoryRows({
  rows,
  model,
}: {
  rows: Visit[];
  model: ReceptionModel;
}) {
  return (
    <>
      {rows.map((row, index) => (
        <button
          key={row.visitRequestId + ":" + index}
          type="button"
          className="history-row"
          aria-label={"View pass for " + row.personName}
          onClick={() => void model.openVisit(row)}
        >
          <span className="history-avatar">{initials(row.personName)}</span>
          <span className="history-copy">
            <strong>{row.personName}</strong>
            <span>
              {projectText(row) +
                " · " +
                dateTime(row.submittedAtUtc ?? row.validFromUtc)}
            </span>
            <span className="history-reference" title={row.publicPassNumber}>
              {row.employeeId ?? row.publicReference}
            </span>
          </span>
          <Badge value={effective(row)} />
          <span className="history-eye">
            <Eye />
          </span>
        </button>
      ))}
    </>
  );
}
