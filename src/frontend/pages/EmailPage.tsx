import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PageProps } from "../types.ts";
import { createEmailModel } from "../emailModel.ts";
import { passValidityLabel } from "../../shared/ValidityDisplay.ts";
const deviceLabels: Record<string, string> = {
  LAPTOP: "Laptop",
  TABLET: "Tablet / iPad",
  PEN_DRIVE: "Pen Drive",
  CAMERA: "Camera",
  OTHER: "Other",
};
export default function EmailPage({ config }: PageProps) {
  const [model] = useState(createEmailModel),
    ui = useSyncExternalStore(model.subscribe, model.getSnapshot),
    revokeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    model.start();
    return () => model.dispose();
  }, [model]);
  useEffect(() => {
    if (ui.focusRevoke) revokeRef.current?.focus();
  }, [ui.focusRevoke]);
  const v = ui.detail,
    expired = !!v && Date.parse(v.validUntilUtc) <= Date.now();
  const fields = v
    ? [
        ["Name", v.personName],
        ["Company", v.companyName],
        [
          "Devices",
          v.deviceTypes?.length
            ? v.deviceTypes.map((code) => deviceLabels[code]).join(", ")
            : null,
        ],
        ["Request", v.publicReference],
        ["Office", v.locationName],
        ["Account", v.projectName],
        ["Host", v.hostName],
        ["Purpose", v.reason],
        ["Valid from", v.validFromUtc],
        ["Valid until", v.validUntilUtc],
      ]
    : [];
  return (
    <>
      <header className="email-header">
        <img width="180" src={config.companyLogo} alt="Sopra Steria" />
      </header>
      <main className="email-main">
        <h1 id="title">{ui.host ? "Visit approval" : "Request status"}</h1>
        <p
          id="message"
          className="email-status"
          role="status"
          aria-live="polite"
        >
          {ui.message}
        </p>
        <button
          id="refresh"
          className="secondary"
          type="button"
          disabled={ui.busy || ui.refreshing}
          onClick={() => void model.refresh()}
        >
          Refresh
        </button>
        <form
          id="login"
          className="email-login"
          hidden={!ui.showLogin}
          onSubmit={(event) => {
            event.preventDefault();
            void model.signIn();
          }}
        >
          <div className="email-field">
            <label htmlFor="email">Sopra Steria email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              maxLength={320}
              required
              value={ui.email}
              onChange={(event) => model.setEmail(event.target.value)}
            />
          </div>
          <div className="email-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              required
              value={ui.password}
              onChange={(event) => model.setPassword(event.target.value)}
            />
          </div>
          <button className="primary" id="sign-in" disabled={ui.busy}>
            Sign in
          </button>
        </form>
        <section
          id="request"
          hidden={!ui.showRequest}
          aria-label="Request details"
        >
          <img
            id="photo"
            className="email-photo"
            alt="Request holder"
            hidden={!ui.photo}
            src={ui.photo ?? undefined}
          />
          <dl id="fields" className="email-fields">
            {fields
              .filter(([, value]) => !!value)
              .map(([label, value]) => (
                <Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>
                    {label === "Valid until"
                      ? passValidityLabel(value!)
                      : label!.startsWith("Valid ")
                        ? new Intl.DateTimeFormat("en-IN", {
                            timeZone: "Asia/Kolkata",
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(value!)) + " IST"
                        : value}
                  </dd>
                </Fragment>
              ))}
          </dl>
          <div
            id="actions"
            className="email-actions"
            hidden={!ui.host || !v?.canDecide || expired}
          >
            <button
              className="primary"
              id="approve"
              type="button"
              disabled={ui.busy}
              onClick={() => void model.decide("APPROVED")}
            >
              Approve
            </button>
            <button
              className="secondary"
              id="reject"
              type="button"
              disabled={ui.busy}
              onClick={() => void model.decide("DENIED")}
            >
              Reject
            </button>
          </div>
          <button
            className="primary"
            id="download"
            type="button"
            hidden={!v || !model.downloadable(v)}
            disabled={ui.imageBusy}
            onClick={() => void model.download()}
          >
            Download pass
          </button>
          <div className="email-actions">
            <button
              ref={revokeRef}
              className="secondary"
              id="revoke"
              type="button"
              hidden={!v || !model.revocable(v)}
              disabled={ui.busy}
              onClick={() => void model.revoke()}
            >
              Didn't request this? Revoke pass
            </button>
          </div>
          <img
            id="card"
            className="email-card"
            alt="Digital pass"
            hidden={!ui.card}
            src={ui.card ?? undefined}
          />
        </section>
      </main>
    </>
  );
}
