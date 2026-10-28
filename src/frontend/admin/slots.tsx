import type { AdminModel } from "./model.ts";
import { human, titles } from "./types.ts";
import {
  AccountCards,
  CommonAssignments,
  LeadCandidates,
  Leads,
} from "./AccountsView.tsx";
import { Capabilities, Profile, Roles, Subjects } from "./StaffView.tsx";
import {
  GroupMembers,
  Groups,
  GuardStats,
  ProjectRoster,
  RosterRows,
} from "./RosterView.tsx";
import {
  AuditRows,
  OfficeRows,
  RegisterColumns,
  RegisterFilters,
  RegisterHeader,
  RegisterRows,
  VisitChips,
  VisitFields,
  VisitTimeline,
} from "./RecordsView.tsx";
import {
  PresenceCards,
  rangeLabel,
  StatusChart,
  SummaryCards,
  TrendChart,
} from "./Overview.tsx";
import { ActionCentre } from "../shared/ActionCentre.tsx";
import { action } from "./bindings.ts";
export function Refresh({ model }: { model: AdminModel }) {
  return (
    <>
      <button
        id="refresh"
        type="button"
        className="secondary icon-button scope-bar-refresh"
        aria-label="Refresh admin view"
        title="Refresh console"
        disabled={model.refreshing || model.writing}
        aria-busy={model.refreshing || undefined}
        onClick={() => action(model, "refresh")}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" />
        </svg>
      </button>
      {model.scope?.canReport && (
        <ActionCentre
          resetKey={String(model.version)}
          scope={async () =>
            model.scope && model.office
              ? {
                  body: {
                    workspace: "ADMIN",
                    locationId: model.office.locationId,
                    dutyKind: "OFFICE",
                    dutyId: "0",
                  },
                  label: model.office.locationName + " · Authorized accounts",
                }
              : null
          }
          openRecord={(row) => void model.records.viewVisit(row)}
        />
      )}
    </>
  );
}
export function content(model: AdminModel, id: string) {
  const a = model.accounts,
    s = model.staff,
    r = model.roster,
    sc = model.scope;
  switch (id) {
    case "office-name":
      return model.office?.locationName ?? "";
    case "staff-name":
      return model.displayName;
    case "admin-title":
      return titles[model.view];
    case "page-status":
      return model.status;
    case "scope-hint":
      return model.pair
        ? model.pair.projectName + " · " + model.office?.locationName
        : "Authorized office scope";
    case "summary-range-label":
      return rangeLabel(
        model.field("overview-from"),
        model.field("overview-to"),
      );
    case "summary-cards":
      return <SummaryCards model={model} />;
    case "chart-status":
      return <StatusChart model={model} />;
    case "chart-trend":
      return <TrendChart model={model} />;
    case "chart-trend-title":
      return (model.summary?.days.length ?? 0) > 1
        ? "Daily registrations"
        : "Status comparison";
    case "presence-cards":
      return <PresenceCards model={model} />;
    case "projects-summary":
      return (
        a.projects.length +
        (a.projects.length === 1 ? " account" : " accounts") +
        " · " +
        a.areas.length +
        (a.areas.length === 1 ? " common area" : " common areas") +
        (a.matches().length > a.renderLimit
          ? " · Showing " + a.renderLimit + " / " + a.matches().length
          : "")
      );
    case "common-catalog-status":
      return a.areaStatus;
    case "projects":
      return <AccountCards model={model} />;
    case "lead-project":
      return a.project
        ? a.project.projectName + " · " + model.office?.locationName
        : "";
    case "lead-status":
      return a.leadStatus;
    case "lead-list":
      return sc ? <Leads model={model} /> : null;
    case "search-status":
      return a.searchStatus;
    case "employee-results":
      return sc ? <LeadCandidates model={model} /> : null;
    case "selected-employee":
      return a.selected ? (
        <>
          <strong>{a.selected.displayName}</strong>
          <p className="hint">
            {a.selected.employeeId + " · " + a.selected.email}
          </p>
        </>
      ) : null;
    case "remove-title":
      return "Remove " + a.removing?.displayName + "?";
    case "subject-results":
      return sc ? <Subjects model={model} /> : null;
    case "subject-name":
      return s.subject?.displayName ?? "";
    case "staff-roles":
      return sc ? <Roles model={model} /> : null;
    case "staff-capabilities":
      return <Capabilities model={model} />;
    case "profile-content":
      return <Profile model={model} />;
    case "admin-confirm-title":
      return model.confirm?.title ?? "Confirm change";
    case "admin-confirm-copy":
      return "This change takes effect immediately and is recorded in the audit log.";
    case "admin-confirm-status":
      return model.confirmStatus;
    case "guard-stats":
      return sc ? <GuardStats model={model} /> : null;
    case "assignment-list":
      return sc ? <RosterRows model={model} /> : null;
    case "project-duty-list":
      return sc ? <ProjectRoster model={model} /> : null;
    case "roster-status": {
      if (r.status) return r.status;
      if (!sc) return "";
      const prefix = r.deniedProjects.length
        ? "Some account duties are unavailable. Availability counts are incomplete. "
        : "";
      return (
        prefix +
        (r.view === "guard"
          ? "Showing " +
            r.shownPeople().length +
            " of " +
            r.people().length +
            " guards"
          : "Showing " +
            r
              .projects()
              .filter((p) =>
                r.keep(
                  r.duties.some(
                    (d) => d.projectLocationId === p.projectLocationId,
                  ),
                ),
              ).length +
            " of " +
            r.projects().length +
            ' accounts · "Assigned" has guards, "Free" still needs one')
      );
    }
    case "project-group-list":
      return sc ? <Groups model={model} /> : null;
    case "project-groups-status":
      return r.groupStatus;
    case "project-group-title":
      return r.groupEditing ? "Edit account group" : "Create account group";
    case "project-group-save":
      return r.groupEditing ? "Save group and update access" : "Create group";
    case "project-group-members":
      return <GroupMembers model={model} />;
    case "project-group-impact":
      return r.impact();
    case "allocation-group-preview":
      return r.group()
        ? "Accounts: " +
            r
              .group()!
              .projects.map((p) => p.projectName)
              .join(", ") +
            ". Future group changes update this guard automatically."
        : "";
    case "allocation-hint": {
      const people = r.people(),
        free = people.filter((p) => !p.duties.length).length;
      return r.deniedProjects.length
        ? "Some account duties are unavailable; availability is unknown."
        : people.length
          ? free +
            " free · " +
            (people.length - free) +
            " already on duty (they can still take another account)"
          : "No guards found for this office.";
    }
    case "common-title":
      return a.commonArea
        ? a.commonArea.name + " · " + model.office?.locationName
        : "Common area";
    case "common-status":
      return a.commonStatus;
    case "common-assignments":
      return sc ? <CommonAssignments model={model} /> : null;
    case "common-guard-results":
      return a.commonGuards.map((guard) => (
        <button
          type="button"
          className="quiet"
          key={guard.userId}
          data-guard-user-id={guard.userId.toLowerCase()}
          disabled={model.writing}
          onClick={() => a.chooseCommon(guard)}
        >
          {guard.displayName}
        </button>
      ));
    case "common-selected":
      return a.commonSelected?.displayName ?? "";
    case "common-remove-title":
      return (
        "Remove " +
        a.commonRemoving?.guardName +
        " from " +
        a.commonRemoving?.areaName +
        "?"
      );
    case "new-project-office":
      return (
        "Location: " +
        model.office?.locationName +
        " · Your authorized office scope"
      );
    case "new-project-submit":
      return model.field("new-workspace-type") === "project"
        ? "Create account"
        : "Create area";
    case "new-project-help":
      return model.field("new-workspace-type") === "project"
        ? "Assign account leads after creation. Employees need verified account and office assignments to host visits."
        : "Assign guards to this common area after creation.";
    case "new-project-status":
      return a.createStatus;
    case "add-staff-title":
      return s.setupTarget
        ? "Reset password setup"
        : s.setupGuard
          ? "Add guard"
          : "Add user";
    case "new-staff-help":
      return s.setupGuard
        ? "Create a guard account for your authorized office. You can assign account duty here or from Guard assignments."
        : "Create a reception or administrator account from the roles available to you. Corporate employees use their existing SSO identity under Find staff.";
    case "new-staff-scope": {
      const role = model.field("new-staff-role");
      return (
        "Scope: " +
        (role === "PLATFORM_ADMIN"
          ? "Platform"
          : role === "INDIA_ADMIN"
            ? "India"
            : model.office?.locationName)
      );
    }
    case "new-staff-capabilities":
      return <Capabilities model={model} setup />;
    case "reset-staff-copy":
      return s.setupTarget
        ? "Generate a new one-time setup link for " +
            s.setupTarget.displayName +
            ". Existing password, sessions and unused setup links will be revoked."
        : "";
    case "new-staff-summary":
      return s.setupResult?.summary ?? "";
    case "new-staff-expiry":
      return s.setupResult?.expiry ?? "";
    case "new-staff-status":
      return s.setupStatus;
    case "register-head":
      return <RegisterHeader model={model} />;
    case "report-list":
      return sc ? <RegisterRows model={model} /> : null;
    case "register-columns":
      return <RegisterColumns model={model} />;
    case "register-filters":
      return <RegisterFilters model={model} />;
    case "register-page":
      return sc && model.register.filter
        ? "Page " +
            model.register.page +
            " of " +
            Math.max(1, Math.ceil(model.register.total / 50))
        : "";
    case "report-status":
      return model.register.status;
    case "audit-list":
      return sc ? <AuditRows model={model} /> : null;
    case "audit-status": {
      const shown = model.records.shownEvents().length,
        all = model.records.events.length;
      return (
        model.records.auditStatus ||
        (shown === all
          ? all + " events loaded"
          : shown + " of " + all + " loaded events match") +
          (model.records.auditMore ? " · more available" : "")
      );
    }
    case "admin-visit-title":
      return model.records.selected?.personName ?? "Visit details";
    case "admin-visit-status":
      return model.records.detailStatus;
    case "admin-visit-chips":
      return <VisitChips model={model} />;
    case "admin-visit-fields":
      return <VisitFields model={model} />;
    case "admin-visit-timeline":
      return <VisitTimeline model={model} />;
    case "office-list":
      return sc ? <OfficeRows model={model} /> : null;
    case "qr-modal-title":
      return model.records.qr
        ? model.records.qr.locationName + " - Registration Standee"
        : "Registration Standee";
    case "qr-title":
    case "qr-poster-location":
      return model.records.qr?.locationName ?? "";
    case "qr-link":
      return model.records.qr?.url ?? "";
    default:
      return undefined;
  }
}
