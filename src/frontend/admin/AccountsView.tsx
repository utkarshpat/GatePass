import { useEffect, useRef } from "react";
import type { AdminModel } from "./model.ts";
import { dateTime, initials, type Project } from "./types.ts";
import { Dialog } from "../shared/controls.tsx";
function LeadPreview({
  model,
  project,
}: {
  model: AdminModel;
  project: Project;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      model.view !== "projects" ||
      model.roster.projectTab === "groups" ||
      (project.preview !== undefined && !project.previewStale)
    )
      return;
    const target = ref.current;
    if (!target) return;
    if (typeof IntersectionObserver !== "function") {
      model.accounts.preview(project);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((v) => v.isIntersecting)) {
          observer.disconnect();
          model.accounts.preview(project);
        }
      },
      { rootMargin: "150px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [model.view, model.roster.projectTab, project]);
  const p = project.preview,
    extra = (p?.names.length ?? 0) - 2;
  return (
    <div className="project-leads-strip" ref={ref}>
      {!p ? (
        <span>Loading leads…</span>
      ) : p.failed ? (
        <span>Leads unavailable</span>
      ) : !p.names.length ? (
        <span className="status-chip warn">No account lead assigned</span>
      ) : (
        <>
          <span className="avatar-stack">
            {p.names.slice(0, 3).map((name, i) => (
              <span
                key={i}
                className={"mini-avatar avatar-tone-" + (i % 5)}
                title={name}
                aria-hidden="true"
              >
                {initials(name)}
              </span>
            ))}
          </span>
          <span className="lead-names">
            {p.names.slice(0, 2).join(", ") +
              (extra > 0
                ? " +" + extra + (p.more ? "+" : "") + " more"
                : p.more
                  ? " and more"
                  : "")}
          </span>
        </>
      )}
    </div>
  );
}
export function AccountCards({ model }: { model: AdminModel }) {
  const a = model.accounts,
    entries = a.matches().slice(0, a.renderLimit);
  if (!model.scope) return null;
  return entries.length ? (
    entries.map((entry) => {
      if (entry.kind === "area") {
        const area = entry.area,
          names = [
            ...new Set(
              a.areaAssignments
                .filter((d) => d.areaId === area.areaId)
                .map((d) => d.guardName),
            ),
          ];
        return (
          <article
            key={"area-" + area.areaId}
            className="project-row project-card area-card"
            data-area-id={area.areaId}
          >
            <div className="project-card-top">
              <span
                className={
                  "project-avatar avatar-tone-" + (a.areas.indexOf(area) % 5)
                }
                aria-hidden="true"
              >
                {initials(area.name)}
              </span>
              <div className="project-card-copy">
                <span className="workspace-kind">Common area</span>
                <h3>{area.name}</h3>
              </div>
            </div>
            <div className="project-leads-strip">
              <span
                className={names.length ? "lead-names" : "status-chip warn"}
              >
                {names.length
                  ? names.slice(0, 2).join(", ") +
                    (names.length > 2
                      ? " +" + (names.length - 2) + " more"
                      : "")
                  : "No guard assigned"}
              </span>
            </div>
            <div className="project-card-actions">
              <button
                type="button"
                className="secondary"
                disabled={model.writing}
                onClick={() => a.openCommon("duties", area)}
              >
                Assigned guards
              </button>
              <button
                type="button"
                className="primary"
                disabled={model.writing}
                aria-label={"Assign guard to " + area.name}
                onClick={() => a.openCommon("assign", area)}
              >
                Assign guard
              </button>
            </div>
          </article>
        );
      }
      const project = entry.project;
      return (
        <article
          key={project.projectLocationId}
          className="project-row project-card"
        >
          <div className="project-card-top">
            <span
              className={
                "project-avatar avatar-tone-" +
                (a.projects.indexOf(project) % 5)
              }
              aria-hidden="true"
            >
              {initials(project.projectName)}
            </span>
            <div className="project-card-copy">
              <span className="workspace-kind">Account</span>
              <h3>{project.projectName}</h3>
              <p className="project-code">{project.projectCode}</p>
            </div>
            {!project.directoryCurrent && (
              <span className="status-chip warn">
                Directory refresh required
              </span>
            )}
          </div>
          <LeadPreview model={model} project={project} />
          <div className="project-card-actions">
            <button
              type="button"
              className="secondary"
              disabled={model.writing}
              onClick={() => a.openLeads(project)}
            >
              Account leads
            </button>
            {project.canManageHosts && (
              <button
                type="button"
                className="secondary"
                disabled={model.writing}
                onClick={() => a.openHosts(project)}
              >
                Manage hosts
              </button>
            )}
            {project.directoryCurrent &&
              (project.canAssignProject || project.canAssignLocation) && (
                <button
                  type="button"
                  className="primary"
                  disabled={model.writing}
                  aria-label={"Add lead to " + project.projectName}
                  onClick={() => a.openLeads(project)}
                >
                  Add lead
                </button>
              )}
          </div>
        </article>
      );
    })
  ) : (
    <p className="empty-note">
      {model.field("project-search").trim()
        ? "No accounts or common areas match your search."
        : "No accounts or common areas in this office."}
    </p>
  );
}
export function Leads({ model }: { model: AdminModel }) {
  const a = model.accounts;
  return a.leads.map((lead, i) => (
    <div className="lead-row" key={lead.roleGrantId ?? i}>
      <span className={"lead-avatar avatar-tone-" + (i % 5)} aria-hidden="true">
        {initials(lead.displayName)}
      </span>
      <div>
        <strong>{lead.displayName}</strong>
        <p className="hint">
          {[lead.employeeId, lead.email].filter(Boolean).join(" · ")}
        </p>
        <p className="lead-scope">
          {lead.scopeType === "PROJECT"
            ? "All offices in this account"
            : model.office?.locationName + " only"}
        </p>
      </div>
      {lead.canRemove && (
        <button
          type="button"
          className="quiet"
          data-remove="true"
          disabled={model.writing}
          onClick={() => a.removeLead(lead)}
        >
          Remove
        </button>
      )}
    </div>
  ));
}
export function LeadCandidates({ model }: { model: AdminModel }) {
  return model.accounts.candidates.map((user) => (
    <button
      key={user.userId}
      type="button"
      className="employee-result"
      disabled={model.writing}
      onClick={() => model.accounts.chooseLead(user)}
    >
      <span>{user.displayName}</span>
      <span className="hint">{user.employeeId + " · " + user.email}</span>
    </button>
  ));
}
export function CommonAssignments({ model }: { model: AdminModel }) {
  return model.accounts.commonRows.map((duty) => (
    <div key={duty.assignmentId} className="lead-row">
      <div>
        <strong>{duty.guardName}</strong>
        <p className="hint">{duty.areaName}</p>
      </div>
      <button
        type="button"
        className="quiet"
        disabled={model.writing}
        onClick={() => model.accounts.removeCommon(duty)}
      >
        Remove
      </button>
    </div>
  ));
}
export function HostDialog({ model }: { model: AdminModel }) {
  const a = model.accounts;
  return (
    <Dialog
      id="account-host-dialog"
      className="app-dialog lead-dialog"
      aria-labelledby="account-host-title"
      open={!!model.dialogs["account-host-dialog"]}
      onDismiss={() => model.close("account-host-dialog")}
    >
      <div className="dialog-heading">
        <h2 id="account-host-title">Approved hosts</h2>
        <button
          id="account-host-close"
          type="button"
          className="quiet dialog-close-btn"
          aria-label="Close approved hosts"
          disabled={model.writing}
          onClick={() => model.close("account-host-dialog")}
        >
          ×
        </button>
      </div>
      <div className="dialog-body">
        <p id="account-host-scope" className="hint">
          {a.hostProject &&
            a.hostProject.projectName + " · " + model.office?.locationName}
        </p>
        <p>
          Only approved, currently assigned employees appear in host search.
          Approval covers this account at this office.
        </p>
        <p id="account-host-status" role="status">
          {a.hostStatus}
        </p>
        <button
          id="account-host-refresh"
          type="button"
          className="secondary"
          disabled={model.writing}
          onClick={() => void a.loadHosts()}
        >
          Refresh hosts
        </button>
        <div id="account-host-list">
          {a.hosts.map((host) => (
            <div className="lead-row" key={host.employeeId}>
              <div>
                <strong>{host.displayName}</strong>
                <p className="hint">{host.email}</p>
                <p className="hint">
                  {"Updated by " +
                    host.changedBy +
                    " · " +
                    dateTime(host.changedAtUtc)}
                </p>
                {!host.eligible && (
                  <p className="hint">
                    Directory access unavailable — hidden from host search
                  </p>
                )}
              </div>
              <button
                type="button"
                className="secondary"
                disabled={model.writing}
                onClick={() => a.chooseHost(host, "REMOVE")}
              >
                Remove host
              </button>
            </div>
          ))}
        </div>
        <div className="field">
          <label htmlFor="account-host-search">
            Find an account employee to add
          </label>
          <input
            id="account-host-search"
            type="search"
            maxLength={80}
            autoComplete="off"
            placeholder="Search name or email"
            disabled={model.writing}
            value={model.field("account-host-search")}
            onChange={(event) => a.searchHosts(event.target.value)}
          />
        </div>
        <div id="account-host-candidates">
          {a.hostCandidates.map((host) => (
            <button
              key={host.employeeId}
              type="button"
              className="employee-result"
              disabled={model.writing}
              onClick={() => a.chooseHost(host, "ADD")}
            >
              <strong>{host.displayName}</strong>
              <span className="hint">{host.email}</span>
            </button>
          ))}
        </div>
        <form
          id="account-host-form"
          hidden={!a.hostSelection}
          onSubmit={(event) => {
            event.preventDefault();
            if (event.currentTarget.reportValidity()) void a.saveHost();
          }}
        >
          <p id="account-host-selection">
            {a.hostSelection &&
              (a.hostSelection.action === "ADD" ? "Add " : "Remove ") +
                a.hostSelection.displayName +
                " · " +
                a.hostSelection.email}
          </p>
          <div className="field">
            <label htmlFor="account-host-reason">Reason for this change</label>
            <input
              id="account-host-reason"
              maxLength={300}
              required
              disabled={model.writing}
              value={model.field("account-host-reason")}
              onChange={(event) =>
                model.set("account-host-reason", event.target.value)
              }
            />
          </div>
          <button
            id="account-host-save"
            type="submit"
            className="primary"
            disabled={model.writing}
          >
            Confirm change
          </button>
          <button
            id="account-host-cancel"
            type="button"
            className="secondary"
            disabled={model.writing}
            onClick={() => {
              a.hostSelection = null;
              model.attempts.delete("host");
              model.publish();
            }}
          >
            Cancel change
          </button>
        </form>
      </div>
    </Dialog>
  );
}
