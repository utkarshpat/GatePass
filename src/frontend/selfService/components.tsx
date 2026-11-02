import { Fragment } from "react";
import { Phone } from "./Phone.tsx";
import type { SelfServiceModel } from "./model.ts";
import { deviceLabels } from "../reception/types.ts";
import { passValidityLabel } from "../../shared/ValidityDisplay.ts";
export function VisitorDetails({ model }: { model: SelfServiceModel }) {
  const p = model.state.people[0];
  const locked =
    (model.state.busy && !model.state.initializing) || !!model.state.jobs;
  return (
    <article className="visitor-card" data-key={p.key}>
      <div className="visitor-details">
        <div className="fields-row">
          <label>
            Name <span className="required">*</span>
            <input
              name="name"
              type="text"
              maxLength={200}
              autoComplete="name"
              required
              value={p.name}
              disabled={locked}
              onChange={(event) =>
                model.setPerson({ name: event.target.value })
              }
            />
          </label>
          <Phone
            country={p.country}
            value={p.phoneRaw}
            disabled={locked}
            onChange={(phoneRaw) => model.setPerson({ phoneRaw })}
            onCountry={(country) => model.setPerson({ country })}
          />
        </div>
        <label>
          Email <span className="optional">(optional)</span>
          <input
            name="email"
            type="email"
            maxLength={320}
            autoComplete="email"
            value={p.email}
            disabled={locked}
            onChange={(event) => model.setPerson({ email: event.target.value })}
          />
        </label>
        <label>
          Company Name <span className="optional">(optional)</span>
          <input
            name="companyName"
            type="text"
            maxLength={200}
            autoComplete="organization"
            value={p.companyName}
            disabled={locked}
            onChange={(event) =>
              model.setPerson({ companyName: event.target.value })
            }
          />
        </label>
        <fieldset className="visitor-devices">
          <legend>
            Carrying devices?{" "}
            <span className="optional">(optional · select all that apply)</span>
          </legend>
          <div className="device-options">
            {Object.entries(deviceLabels).map(([code, label]) => (
              <label key={code}>
                <input
                  type="checkbox"
                  name="deviceTypes"
                  value={code}
                  checked={p.deviceTypes.includes(code)}
                  disabled={locked}
                  onChange={(event) =>
                    model.setPerson({
                      deviceTypes: event.target.checked
                        ? [...p.deviceTypes, code]
                        : p.deviceTypes.filter((v) => v !== code),
                    })
                  }
                />
                {" " + label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </article>
  );
}
export function Stepper({ model }: { model: SelfServiceModel }) {
  const state = model.state;
  return (
    <>
      {model.steps().map((label, index) => (
        <li
          key={label}
          data-state={
            index < state.step
              ? "done"
              : index === state.step
                ? "active"
                : "next"
          }
        >
          <button
            type="button"
            disabled={state.busy || index > state.step || !!state.jobs}
            aria-current={index === state.step ? "step" : undefined}
            onClick={() => model.renderStep(index)}
          >
            <span className="step-number">
              {index < state.step ? "✓" : String(index + 1)}
            </span>
            <span>{label}</span>
          </button>
        </li>
      ))}
    </>
  );
}
export function Extras({ model }: { model: SelfServiceModel }) {
  return (
    <>
      {model.state.extras.map((entry) => (
        <div className="access-row" key={entry.projectLocationId}>
          <div>
            <strong>{entry.projectName}</strong>
            <small>
              {entry.host.displayName + " · " + entry.host.officialEmail}
            </small>
          </div>
          <button
            className="quiet"
            type="button"
            aria-label={"Remove " + entry.projectName}
            disabled={model.state.busy || !!model.state.jobs}
            onClick={() => model.removeExtra(entry.projectLocationId)}
          >
            Remove
          </button>
        </div>
      ))}
    </>
  );
}
export function ReviewPeople({ model }: { model: SelfServiceModel }) {
  const state = model.state;
  return (
    <>
      {state.people.map((p) => (
        <div className="review-person" key={p.key}>
          <img src={p.croppedUrl ?? p.url ?? undefined} alt={p.name} />
          <div>
            <strong>{p.name}</strong>
            <span>
              {state.mode === "employee"
                ? state.employee?.employeeId
                : [p.phone, p.email].filter(Boolean).join(" · ")}
            </span>
            {state.mode === "visitor" && p.companyName ? (
              <span>{"Company: " + p.companyName}</span>
            ) : null}
            {state.mode === "visitor" && p.deviceTypes.length ? (
              <span>
                {"Devices: " +
                  p.deviceTypes.map((code) => deviceLabels[code]).join(", ")}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </>
  );
}
export function ReviewDetails({ model }: { model: SelfServiceModel }) {
  const s = model.state,
    rows: [string, string][] = [["Office", s.options?.locationName ?? ""]];
  if (s.mode === "employee") {
    rows.push([
      "Reason",
      (
        {
          FORGOT: "Forgot my card",
          LOST: "Lost my card",
          OTHER: "Other",
        } as Record<string, string>
      )[s.reason] ?? s.reason,
    ]);
    if (s.reasonDetails.trim()) rows.push(["Details", s.reasonDetails.trim()]);
  } else if (s.host) {
    rows.push(
      ["Host", s.host.displayName + " · " + s.host.officialEmail],
      ["Purpose", model.purpose()],
      [
        "Valid until",
        s.validUntil
          ? new Intl.DateTimeFormat(undefined, {
              dateStyle: "medium",
              timeZone: "Asia/Kolkata",
            }).format(new Date(s.validUntil + "T12:00:00Z"))
          : "",
      ],
    );
  }
  return (
    <>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </>
  );
}
export function Results({ model }: { model: SelfServiceModel }) {
  const done = (model.state.jobs ?? []).filter((job) => job.result);
  if (done.some((job) => !model.resultBindings(job)))
    return (
      <p>
        Participant details could not be matched. Contact reception to retrieve
        your pass.
      </p>
    );
  return (
    <>
      {done.flatMap((job, index) =>
        model.resultBindings(job)!.map(({ person, visit }) => {
          if (["DIGITAL_ID", "EXTERNAL"].includes(job.body.requestType))
            return (
              <div key={index + person.key} className="digital-card-result">
                <div className="digital-card-preview">
                  {job.cardUrl ? (
                    <img
                      src={job.cardUrl}
                      alt={
                        (job.body.requestType === "EXTERNAL"
                          ? "Visitor pass for "
                          : "Digital ID for ") + job.people[0].name
                      }
                      width={1712}
                      height={1080}
                    />
                  ) : (
                    <p className="hint">
                      {job.cardError
                        ? "Card could not be loaded."
                        : "Preparing card…"}
                    </p>
                  )}
                </div>
                {job.cardUrl ? (
                  <div className="digital-card-actions">
                    <a
                      className="primary"
                      href={job.cardUrl}
                      download={job.cardFileName}
                    >
                      Download image
                    </a>
                  </div>
                ) : job.cardError ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => model.retryCard(job)}
                  >
                    Retry card
                  </button>
                ) : null}
              </div>
            );
          const status = job.detail
            ? job.detail.status === "CANCELLED"
              ? "CANCELLED"
              : Date.parse(job.detail.validUntilUtc) <=
                  Date.parse(job.detail.checkedAtUtc)
                ? "EXPIRED"
                : job.detail.passStatus
            : visit.status;
          return (
            <div key={index + person.key} className="result-card">
              <div className="result-card-heading">
                <strong>
                  {model.state.mode === "visitor" ? person.name : job.label}
                </strong>
                <span className="status-pill" data-status={status}>
                  {(visit.reused ? "Existing · " : "") +
                    status.charAt(0) +
                    status.slice(1).toLowerCase()}
                </span>
              </div>
              <div className="result-reference">{visit.publicPassNumber}</div>
              {job.detail ? (
                <div className="meta">
                  {"Valid until " + passValidityLabel(job.detail.validUntilUtc)}
                </div>
              ) : null}
            </div>
          );
        }),
      )}
    </>
  );
}
