import { useContext, useEffect, useRef, useState } from "react";
import type { GuardModel } from "./model.ts";
import type { Visit } from "./types.ts";
import { GuardLanguage } from "./language.tsx";
import { PersonName } from "./readings.tsx";
import { passValidityLabel } from "../../printing/ValidityDisplay.ts";
export const shortPass = (value?: string) =>
  value?.replace(/^GP-/iu, "").slice(0, 6).toUpperCase() ?? "";
export function projectDescription(v: Visit, model: GuardModel) {
  const state = model.state;
  let value = "";
  if (state.duty?.kind === "PROJECT" && v.projectName) value = v.projectName;
  else if (v.requestType !== "DIGITAL_ID") value = v.projectName ?? "";
  else if (v.employeeProjects?.available) {
    const p = v.employeeProjects;
    value =
      p.items.map((x) => x.name).join(" · ") +
      (p.total > p.items.length
        ? " · " + model.t("{count} more", { count: p.total - p.items.length })
        : "");
  }
  return (
    value ||
    (v.requestType === "DIGITAL_ID"
      ? v.employeeProjects?.available
        ? model.t("No assigned accounts")
        : model.t("Assignments unavailable.")
      : model.t("Account unavailable"))
  );
}
export function GuardCard({
  row,
  model,
  companyLogo,
}: {
  row: Visit;
  model: GuardModel;
  companyLogo: string;
}) {
  const i18n = useContext(GuardLanguage),
    avatar = useRef<HTMLDivElement>(null),
    [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    setPhoto(null);
    if (!row.photoAvailable || !avatar.current) return;
    let active = true,
      started = false;
    const load = () => {
      if (started) return;
      started = true;
      void model.thumbnail(row).then((url) => {
        if (active) setPhoto(url);
      });
    };
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            (entries) => {
              if (entries.some((e) => e.isIntersecting)) {
                observer?.disconnect();
                load();
              }
            },
            { rootMargin: "100px" },
          )
        : null;
    if (observer) observer.observe(avatar.current);
    else load();
    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [
    model,
    row.visitRequestId,
    row.photoVersion,
    model.state.contextVersion,
    model.state.recentVersion,
  ]);
  const status =
      row.passStatus === "REVOKED"
        ? "REVOKED"
        : row.status === "CANCELLED"
          ? "CANCELLED"
          : row.status === "DENIED"
            ? "DENIED"
            : Date.parse(row.validUntilUtc) <= Date.now()
              ? "EXPIRED"
              : row.isInside
                ? "INSIDE"
                : row.status === "PENDING"
                  ? "PENDING"
                  : "APPROVED",
    pass = i18n.t("Pass") + " " + shortPass(row.publicPassNumber),
    project = projectDescription(row, model);
  return (
    <button
      type="button"
      className="guard-id-card"
      data-status={status}
      aria-label={
        row.personName + " · " + pass + " · " + i18n.t("Pass details")
      }
      onClick={() => void model.detail(row)}
    >
      <div className="guard-card-heading">
        <img src={companyLogo} width="192" alt="Sopra Steria" />
        <span>
          {i18n.t(
            row.requestType === "DIGITAL_ID"
              ? "Digital ID"
              : row.requestType === "EMPLOYEE_PROJECT"
                ? "Account access"
                : "Visitor pass",
          )}
        </span>
      </div>
      <div className="guard-card-person">
        <div
          ref={avatar}
          className="guard-card-avatar"
          data-photo-id={row.photoAvailable ? row.visitRequestId : undefined}
        >
          {row.personName
            .trim()
            .split(/\s+/u)
            .slice(0, 2)
            .map((n) => n[0])
            .join("")}
          {photo ? <img src={photo} alt="" /> : null}
        </div>
        <div>
          <PersonName name={row.personName} as="strong" />
          {row.hostName ? (
            <p className="guard-card-host">
              {i18n.bilingual("Host") + ": "}
              <PersonName name={row.hostName} className="guard-host-name" />
            </p>
          ) : null}
          <p className="guard-card-projects" title={project}>
            {i18n.bilingual("nav.projects") + ": " + project}
          </p>
          <p className="guard-card-pass-id" title={row.publicPassNumber}>
            {pass}
          </p>
        </div>
      </div>
      <div className="guard-card-footer">
        <span>
          {i18n.t("Valid until") + " " + passValidityLabel(row.validUntilUtc)}
        </span>
        <span className="guard-card-state">
          {i18n.t(
            (
              {
                INSIDE: "Inside",
                PENDING: "Approval pending",
                APPROVED: "Approved",
                REVOKED: "Pass revoked",
                CANCELLED: "Visit cancelled",
                DENIED: "Access denied",
                EXPIRED: "Pass expired",
              } as Record<string, string>
            )[status],
          )}
        </span>
      </div>
    </button>
  );
}
