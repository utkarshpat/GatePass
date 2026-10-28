import type { AdminModel } from "./model.ts";
import { human, shiftDay, type View } from "./types.ts";
import { registerColumns } from "./register.ts";
export const scoped = (model: AdminModel) =>
  !!model.scope &&
  ["overview", "staff", "reports", "audit"].includes(model.view);
export function change(model: AdminModel, id: string, value: string) {
  if (model.writing) return;
  if (id === "admin-office") {
    void model.selectOffice(value);
    return;
  }
  if (id === "console-project") {
    void model.selectProject(value);
    return;
  }
  if (id === "project-search") {
    model.accounts.search(value);
    return;
  }
  if (id === "employee-search") {
    model.accounts.searchLeads(value);
    return;
  }
  if (id === "account-host-search") {
    model.accounts.searchHosts(value);
    return;
  }
  if (id === "common-guard-search") {
    model.accounts.searchCommon(value);
    return;
  }
  if (id === "subject-search") {
    model.staff.searchChanged(value);
    return;
  }
  model.fields[id] = id === "new-project-code" ? value.toUpperCase() : value;
  if (id === "staff-role") model.staff.resetCapabilities();
  if (id === "new-staff-role") model.staff.setupCapabilities();
  if (id === "role-state") void model.staff.loadRoles();
  if (id === "guard-search") model.roster.search = value;
  if (
    ["allocation-kind", "allocation-group", "allocation-project"].includes(
      id,
    ) &&
    model.roster.already(model.field("allocation-guard"))
  )
    model.fields["allocation-guard"] = "";
  if (["overview-from", "overview-to"].includes(id)) {
    const from = model.field("overview-from"),
      to = model.field("overview-to"),
      changedFrom = id === "overview-from";
    if (from && to) {
      if (from > to)
        model.fields[changedFrom ? "overview-to" : "overview-from"] = value;
      else if (Date.parse(to) - Date.parse(from) > 30 * 86400000)
        model.fields[changedFrom ? "overview-to" : "overview-from"] = shiftDay(
          value,
          changedFrom ? 30 : -30,
        );
      void model.loadSummary();
    }
  }
  if (
    [
      "quick-status",
      "quick-presence",
      "quick-type",
      "register-sort",
      "register-direction",
      "report-from",
      "report-to",
    ].includes(id)
  )
    void model.register.load();
  model.publish();
}
export function action(model: AdminModel, id: string) {
  if (model.writing) return;
  const a = model.accounts,
    s = model.staff,
    r = model.roster,
    register = model.register;
  switch (id) {
    case "refresh":
      void model.refresh();
      break;
    case "account-toggle":
      model.accountOpen = !model.accountOpen;
      model.publish();
      break;
    case "admin-profile":
      void model.openProfile();
      break;
    case "staff-logout":
      void model.logout();
      break;
    case "add-project-open":
      a.openCreation();
      break;
    case "close-add-project":
      model.close("add-project-dialog");
      break;
    case "more-projects":
      a.more();
      break;
    case "close-leads":
      model.close("lead-dialog");
      break;
    case "more-leads":
      void a.loadLeads(true);
      break;
    case "cancel-remove":
      a.removeLead(null);
      break;
    case "subjects-more":
      void s.search(true);
      break;
    case "roles-more":
      void s.loadRoles(true);
      break;
    case "add-staff-open":
      s.openSetup();
      break;
    case "add-guard-open":
      s.openSetup(true);
      break;
    case "reset-staff-setup":
      s.openSetup(false, true);
      break;
    case "close-add-staff":
      model.close("add-staff-dialog");
      break;
    case "copy-staff-setup":
      void s.copySetup();
      break;
    case "assign-guard-open":
      void r.openAssign();
      break;
    case "create-project-group":
      void r.openGroup();
      break;
    case "common-close":
      model.close("common-dialog");
      break;
    case "common-cancel-remove":
      a.removeCommon(null);
      break;
    case "common-more":
      void a.loadCommon();
      break;
    case "register-add-filter":
      register.addFilter();
      break;
    case "register-reset":
      register.reset();
      break;
    case "register-previous":
      void register.load(false, true);
      break;
    case "reports-more":
      void register.load(true);
      break;
    case "register-export":
      void register.export();
      break;
    case "audit-more":
      void model.records.loadAudit(true);
      break;
    case "qr-print-pdf":
      window.print();
      break;
  }
}
export function submit(model: AdminModel, id: string) {
  if (model.writing) return;
  switch (id) {
    case "lead-form":
      void model.accounts.saveLead();
      break;
    case "remove-form":
      void model.accounts.saveLead(true);
      break;
    case "add-project-form":
      void model.accounts.saveCreation();
      break;
    case "subject-form":
      void model.staff.search();
      break;
    case "staff-grant-form":
      void model.staff.grant();
      break;
    case "admin-confirm-form":
      void model.saveConfirmation();
      break;
    case "add-staff-form":
      void model.staff.submitSetup();
      break;
    case "staff-reset-form":
      void model.staff.submitSetup(true);
      break;
    case "allocation-form":
      void model.roster.allocate();
      break;
    case "project-group-form":
      void model.roster.saveGroup();
      break;
    case "common-assign":
      void model.accounts.saveCommon();
      break;
    case "common-remove":
      void model.accounts.saveCommon(true);
      break;
    case "report-form":
      void model.register.load();
      break;
    case "audit-form":
      void model.records.loadAudit();
      break;
  }
}
export function value(model: AdminModel, id: string) {
  return id === "admin-office"
    ? String(model.office?.locationId ?? "")
    : id === "console-project"
      ? (model.pair?.projectLocationId ?? "")
      : id === "common-area"
        ? (model.accounts.commonArea?.areaId ?? "")
        : id === "new-staff-link"
          ? (model.staff.setupResult?.link ?? "")
          : id === "register-sort"
            ? model.field(id) || "submittedAtUtc"
            : id === "register-direction"
              ? model.field(id) || "DESC"
              : id === "role-state"
                ? model.field(id) || "CURRENT"
                : model.field(id);
}
export function hidden(
  model: AdminModel,
  id: string,
  original = false,
): boolean {
  const a = model.accounts,
    s = model.staff,
    r = model.roster,
    sc = model.scope;
  if (
    id.startsWith("admin-") &&
    [
      "overview",
      "projects",
      "staff",
      "assignments",
      "offices",
      "reports",
      "audit",
    ].includes(id.slice(6))
  )
    return !sc || model.view !== id.slice(6);
  switch (id) {
    case "office-selector":
      return model.offices.length <= 1;
    case "office-static":
      return !model.office || model.offices.length > 1;
    case "staff-session":
      return !model.displayName;
    case "account-menu":
      return !model.accountOpen;
    case "console-scope":
      return !!sc && !scoped(model);
    case "scope-project-wrap":
      return (
        !scoped(model) ||
        a.projects.length + (model.officeWide ? 1 : 0) + (a.cursor ? 1 : 0) <= 1
      );
    case "scope-hint":
      return (
        !scoped(model) ||
        a.projects.length + (model.officeWide ? 1 : 0) + (a.cursor ? 1 : 0) > 1
      );
    case "overview-range":
      return !scoped(model) || model.view !== "overview";
    case "add-project-open":
      return (
        !sc ||
        r.projectTab === "groups" ||
        !(model.office?.canCreateProject || model.office?.canManageCommonAreas)
      );
    case "more-projects":
      return a.matches().length <= a.renderLimit && !a.cursor;
    case "projects-tabs":
    case "create-project-group":
      return !sc?.canManageProjectGroups;
    case "project-groups-panel":
      return !sc?.canManageProjectGroups || r.projectTab !== "groups";
    case "project-catalogue-panel":
      return r.projectTab === "groups";
    case "lead-form":
      return (
        !a.project?.directoryCurrent ||
        !(a.project.canAssignLocation || a.project.canAssignProject) ||
        !!a.removing
      );
    case "remove-form":
      return !a.removing;
    case "more-leads":
      return !a.leadCursor;
    case "selected-employee":
      return !a.selected;
    case "subjects-more":
      return !s.subjectMore;
    case "staff-detail":
      return !s.subject;
    case "staff-grant-form":
      return (
        !s.subject?.active ||
        s.subject.userId === sc?.userId ||
        !sc?.delegations.length
      );
    case "roles-more":
      return !s.rolesMore;
    case "add-staff-open":
      return !sc?.provisionableRoles?.some((role) => role.roleCode !== "GUARD");
    case "add-guard-open":
      return !sc?.provisionableRoles?.some((role) => role.roleCode === "GUARD");
    case "reset-staff-setup":
      return (
        !s.subject?.localAccount ||
        !s.subject.active ||
        s.subject.userId === sc?.userId ||
        !sc?.canResetLocalStaff
      );
    case "add-staff-form":
      return !!s.setupTarget || !!s.setupResult;
    case "staff-reset-form":
      return !s.setupTarget || !!s.setupResult;
    case "new-staff-result":
      return !s.setupResult;
    case "new-guard-project-label":
      return (
        model.field("new-staff-role") !== "GUARD" ||
        !model.pair ||
        !sc?.canAssignGuards
      );
    case "new-project-code-field":
      return model.field("new-workspace-type") !== "project";
    case "assign-guard-open":
      return !sc?.canAssignGuards;
    case "assignment-list":
      return r.view !== "guard";
    case "project-duty-list":
      return r.view !== "project";
    case "allocation-kind-field":
      return !sc?.canManageProjectGroups;
    case "allocation-group-field":
      return model.field("allocation-kind") !== "group";
    case "allocation-project-field":
      return model.field("allocation-kind") === "group";
    case "allocation-until":
      return r.allocationMode !== "custom";
    case "common-view-duties":
      return a.commonTab !== "duties" || !!a.commonRemoving;
    case "common-assign":
      return a.commonTab !== "assign" || !!a.commonRemoving;
    case "common-remove":
      return !a.commonRemoving;
    case "common-more":
      return true;
    case "register-export":
      return !model.register.canExport();
    case "reports-more":
      return (
        !model.register.total ||
        model.register.page * 50 >= model.register.total
      );
    case "audit-all-label":
      return !model.records.allAllowed();
    case "audit-more":
      return !model.records.auditMore;
    case "office-qr":
      return !model.records.qr;
    default:
      return original;
  }
}
export function disabled(model: AdminModel, id: string, original = false) {
  if (model.writing) return true;
  switch (id) {
    case "console-project":
      return model.loading;
    case "refresh":
      return model.refreshing;
    case "add-lead":
      return !model.accounts.selected;
    case "subjects-more":
      return model.staff.subjectBusy;
    case "common-assign-button":
      return !model.accounts.commonSelected;
    case "new-project-code":
      return model.field("new-workspace-type") !== "project";
    case "register-export":
      return (
        !model.register.canExport() ||
        !model.register.total ||
        model.register.loading ||
        !!model.register.exporting
      );
    case "register-apply":
    case "reports-more":
      return model.register.loading;
    case "register-previous":
      return model.register.loading || model.register.page <= 1;
    default:
      return original;
  }
}
export type Option = { value: string; label: string; disabled?: boolean };
export function options(model: AdminModel, id: string): Option[] | null {
  const a = model.accounts,
    r = model.roster;
  switch (id) {
    case "admin-office":
      return model.offices.map((office) => ({
        value: String(office.locationId),
        label: office.locationName,
      }));
    case "console-project": {
      const rows = [...a.projects];
      if (
        model.pair &&
        !rows.some((p) => p.projectLocationId === model.pair!.projectLocationId)
      )
        rows.unshift(model.pair);
      return [
        ...(model.officeWide
          ? [{ value: "", label: "All authorized accounts in office" }]
          : []),
        ...rows.map((p) => ({
          value: p.projectLocationId,
          label: p.projectName + " · " + p.projectCode,
        })),
        ...(a.cursor
          ? [{ value: "__MORE__", label: "Load more accounts…" }]
          : []),
      ];
    }
    case "lead-scope":
      return [
        ...(a.project?.canAssignLocation
          ? [
              {
                value: "PROJECT_LOCATION",
                label: model.office?.locationName + " only",
              },
            ]
          : []),
        ...(a.project?.canAssignProject
          ? [{ value: "PROJECT", label: "All offices in this account" }]
          : []),
      ];
    case "staff-role":
      return (model.scope?.delegations ?? []).map((role, i) => ({
        value: String(i),
        label: human(role.roleCode) + " · " + human(role.scopeType),
      }));
    case "new-staff-role":
      return model.staff.setupRoles.map((role) => ({
        value: role.roleCode,
        label: human(role.roleCode),
      }));
    case "new-workspace-type":
      return [
        ...(model.office?.canCreateProject
          ? [{ value: "project", label: "Account" }]
          : []),
        ...(model.office?.canManageCommonAreas
          ? [{ value: "area", label: "Common area" }]
          : []),
      ];
    case "common-area":
      return a.commonArea
        ? [{ value: a.commonArea.areaId, label: a.commonArea.name }]
        : [];
    case "allocation-project":
      return [
        { value: "", label: "Select account" },
        ...a.known().map((p) => ({
          value: p.projectLocationId,
          label: p.projectName + " · " + p.projectCode,
          disabled: r.deniedProjects.includes(p.projectLocationId),
        })),
      ];
    case "allocation-group":
      return [
        { value: "", label: "Select group" },
        ...r.groups.map((g) => ({ value: g.groupId, label: g.name })),
      ];
    case "allocation-guard":
      return [
        { value: "", label: "Select guard" },
        ...r
          .people()
          .sort(
            (a, b) =>
              a.duties.length - b.duties.length || a.name.localeCompare(b.name),
          )
          .map((p) => ({
            value: p.userId,
            label:
              p.name +
              (r.already(p.userId)
                ? " · already on this account"
                : p.duties.length
                  ? " · on " +
                    p.duties.length +
                    (p.duties.length === 1 ? " duty" : " duties")
                  : r.deniedProjects.length
                    ? " · availability unknown"
                    : " · free"),
            disabled: r.already(p.userId),
          })),
      ];
    case "register-sort":
      return registerColumns.map(([value, label]) => ({ value, label }));
    default:
      return null;
  }
}
export function dataAction(model: AdminModel, key: string, value: string) {
  if (model.writing) return;
  switch (key) {
    case "admin-view":
      void model.show(value as View);
      break;
    case "project-tab":
      void model.roster.showTab(value);
      break;
    case "guard-filter":
      if (value !== "free" || !model.roster.deniedProjects.length)
        model.roster.filter = value;
      break;
    case "roster-view":
      model.roster.view = value;
      break;
    case "until":
      model.roster.setUntil(value);
      break;
    case "reason":
      model.fields["allocation-reason"] = value;
      break;
    case "range-days":
      model.setRange(Number(value));
      break;
    case "report-days":
      model.register.days(Number(value));
      break;
    case "common-tab":
      model.accounts.commonTab = value;
      model.accounts.commonRemoving = null;
      break;
    case "close":
      model.close(value);
      break;
  }
  model.publish();
}
