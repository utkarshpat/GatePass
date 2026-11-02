import { useEffect, useRef } from "react";
import { HostDialog } from "../admin/AccountsView.tsx";
import {
  action,
  change,
  dataAction,
  disabled,
  hidden,
  options,
  scoped,
  value,
} from "../admin/bindings.ts";
import { AdminModel } from "../admin/model.ts";
import { content, Refresh } from "../admin/slots.tsx";
import { shiftDay } from "../admin/types.ts";
import { AccountAreaDialog } from "../admin/views/AccountAreaDialog.tsx";
import { AccountAreasView } from "../admin/views/AccountAreasView.tsx";
import { AccountLeadDialog } from "../admin/views/AccountLeadDialog.tsx";
import { AdminConfirmationDialog } from "../admin/views/AdminConfirmationDialog.tsx";
import { AdminProfileDialog } from "../admin/views/AdminProfileDialog.tsx";
import { AdminVisitDialog } from "../admin/views/AdminVisitDialog.tsx";
import { AuditLogView } from "../admin/views/AuditLogView.tsx";
import { CommonAreaDialog } from "../admin/views/CommonAreaDialog.tsx";
import { GuardAssignmentDialog } from "../admin/views/GuardAssignmentDialog.tsx";
import { GuardAssignmentsView } from "../admin/views/GuardAssignmentsView.tsx";
import { OfficePosterDialog } from "../admin/views/OfficePosterDialog.tsx";
import { OfficesView } from "../admin/views/OfficesView.tsx";
import { OverviewView } from "../admin/views/OverviewView.tsx";
import { ProjectGroupDialog } from "../admin/views/ProjectGroupDialog.tsx";
import { ReportsView } from "../admin/views/ReportsView.tsx";
import { StaffAccessView } from "../admin/views/StaffAccessView.tsx";
import { StaffOnboardingDialog } from "../admin/views/StaffOnboardingDialog.tsx";
import { Select } from "../shared/controls.tsx";
import { useModel } from "../shared/model.ts";
import { Notices } from "../shared/Notices.tsx";
import type { PageProps } from "../types.ts";
export default function AdminPage({ config }: PageProps) {
  const [model] = useModel(() => new AdminModel(config));
  const session = useRef<HTMLDivElement>(null),
    toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (
        !session.current?.contains(event.target as Node) &&
        model.accountOpen
      ) {
        model.accountOpen = false;
        model.publish();
      }
    };
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, [model]);
  return (
    <>
      {"\n"}
      <a className="skip" href="#workspace">
        {"Skip to content"}
      </a>
      {"\n\n"}
      <header className="admin-header">
        {"\n  "}
        <div className="header-brand-group">
          {"\n    "}
          <a
            className="admin-brand"
            href="/admin"
            aria-label="GatePass Administration"
          >
            {"\n      "}
            <img src={config.companyLogo} width="180" alt="Sopra Steria" />
            {"\n    "}
          </a>
          {"\n  "}
        </div>
        {"\n\n  "}
        <div className="admin-header-actions">
          <a className="secondary" href="/?choose=1">
            Switch workspace
          </a>
          {"\n    "}
          <div
            id="office-selector"
            className="office-pill"
            hidden={hidden(model, "office-selector")}
          >
            {"\n      "}
            <svg
              className="office-pill-icon"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            {"\n      "}
            <label className="sr-only" htmlFor="admin-office">
              {"Office"}
            </label>
            {"\n      "}
            <Select
              id="admin-office"
              aria-label="Select office location"
              value={value(model, "admin-office")}
              onValue={(value) => change(model, "admin-office", value)}
              label="Office"
              disabled={disabled(model, "admin-office", false)}
            >
              {options(model, "admin-office")?.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  {option.label}
                </option>
              ))}
            </Select>
            {"\n    "}
          </div>
          {"\n    "}
          <div
            id="office-static"
            className="office-pill office-pill-static"
            hidden={hidden(model, "office-static")}
          >
            {"\n      "}
            <svg
              className="office-pill-icon"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            {"\n      "}
            <span id="office-name">{content(model, "office-name")}</span>
            {"\n    "}
          </div>
          {"\n\n    "}
          <div
            id="staff-session"
            className="admin-account"
            hidden={hidden(model, "staff-session")}
            ref={session}
          >
            {"\n      "}
            <button
              id="account-toggle"
              className="quiet icon-button account-btn"
              type="button"
              aria-label="Account menu"
              aria-haspopup="menu"
              disabled={disabled(model, "account-toggle", false)}
              onClick={() => action(model, "account-toggle")}
              ref={toggle}
              aria-expanded={model.accountOpen}
            >
              {"\n        "}
              <span className="account-avatar-circle" aria-hidden="true">
                {"\n          "}
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <circle cx="12" cy="8" r="4"></circle>
                  <path d="M4 22v-2a8 8 0 0 1 16 0v2"></path>
                </svg>
                {"\n        "}
              </span>
              {"\n      "}
            </button>
            {"\n      "}
            <div
              id="account-menu"
              className="account-dropdown"
              role="menu"
              hidden={hidden(model, "account-menu")}
              onKeyDown={(event) => {
                const buttons = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button",
                  ),
                ];
                if (event.key === "Escape") {
                  model.accountOpen = false;
                  model.publish();
                  toggle.current?.focus();
                }
                if (["ArrowDown", "ArrowUp"].includes(event.key)) {
                  event.preventDefault();
                  buttons[
                    (buttons.indexOf(
                      document.activeElement as HTMLButtonElement,
                    ) +
                      (event.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                      buttons.length
                  ]?.focus();
                }
              }}
            >
              {"\n        "}
              <div className="account-menu-header">
                {"\n          "}
                <span className="account-role-label">{"Signed in as"}</span>
                {"\n          "}
                <strong id="staff-name">{content(model, "staff-name")}</strong>
                {"\n        "}
              </div>
              {"\n        "}
              <div className="account-menu-divider" role="separator"></div>
              {"\n        "}
              <button
                id="admin-profile"
                className="account-menu-item"
                role="menuitem"
                type="button"
                disabled={disabled(model, "admin-profile", false)}
                onClick={() => action(model, "admin-profile")}
              >
                {"\n          "}
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                {"\n          "}
                <span>{"Profile"}</span>
                {"\n        "}
              </button>
              {"\n        "}
              <button
                id="staff-logout"
                className="account-menu-item logout"
                role="menuitem"
                type="button"
                disabled={disabled(model, "staff-logout", false)}
                onClick={() => action(model, "staff-logout")}
              >
                {"\n          "}
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
                {"\n          "}
                <span>{"Sign out"}</span>
                {"\n        "}
              </button>
              {"\n      "}
            </div>
            {"\n    "}
          </div>
          {"\n  "}
        </div>
        {"\n"}
      </header>
      {"\n\n"}
      <div className="admin-layout">
        {"\n  "}
        <nav className="admin-nav" aria-label="Administration">
          {"\n    "}
          <div
            className="admin-nav-group"
            hidden={
              !["overview", "projects", "staff", "assignments", "offices"].some(
                (key) => model.allowed[key as keyof typeof model.allowed],
              )
            }
          >
            {"\n      "}
            <span className="admin-nav-heading">{"Console"}</span>
            {"\n      "}
            <button
              type="button"
              data-admin-view="overview"
              disabled={disabled(model, "", false)}
              onClick={() => dataAction(model, "admin-view", "overview")}
              hidden={!model.allowed["overview" as keyof typeof model.allowed]}
              aria-current={model.view === "overview" ? "page" : "false"}
            >
              {"\n        "}
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"></path>
              </svg>
              {"\n        "}
              <span>{"Overview"}</span>
              {"\n      "}
            </button>
            {"\n      "}
            <button
              type="button"
              data-admin-view="projects"
              disabled={disabled(model, "", false)}
              onClick={() => dataAction(model, "admin-view", "projects")}
              hidden={!model.allowed["projects" as keyof typeof model.allowed]}
              aria-current={model.view === "projects" ? "page" : "false"}
            >
              {"\n        "}
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M3 7h18v14H3zM8 7V3h8v4"></path>
              </svg>
              {"\n        "}
              <span>{"Accounts & areas"}</span>
              {"\n      "}
            </button>
            {"\n      "}
            <button
              type="button"
              data-admin-view="staff"
              disabled={disabled(model, "", false)}
              onClick={() => dataAction(model, "admin-view", "staff")}
              hidden={!model.allowed["staff" as keyof typeof model.allowed]}
              aria-current={model.view === "staff" ? "page" : "false"}
            >
              {"\n        "}
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 8v6M17 11h6"></path>
              </svg>
              {"\n        "}
              <span>{"Users & permissions"}</span>
              {"\n      "}
            </button>
            {"\n      "}
            <button
              type="button"
              data-admin-view="assignments"
              disabled={disabled(model, "", false)}
              onClick={() => dataAction(model, "admin-view", "assignments")}
              hidden={
                !model.allowed["assignments" as keyof typeof model.allowed]
              }
              aria-current={model.view === "assignments" ? "page" : "false"}
            >
              {"\n        "}
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>
              {"\n        "}
              <span>{"Guard assignments"}</span>
              {"\n      "}
            </button>
            {"\n      "}
            <button
              type="button"
              data-admin-view="offices"
              disabled={disabled(model, "", false)}
              onClick={() => dataAction(model, "admin-view", "offices")}
              hidden={!model.allowed["offices" as keyof typeof model.allowed]}
              aria-current={model.view === "offices" ? "page" : "false"}
            >
              {"\n        "}
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M3 21h18M6 21V3h12v18M9 7h6M9 11h6M10 21v-5h4v5"></path>
              </svg>
              {"\n        "}
              <span>{"Offices & QR"}</span>
              {"\n      "}
            </button>
            {"\n    "}
          </div>
          {"\n    "}
          <div
            className="admin-nav-group"
            hidden={
              !["reports", "audit"].some(
                (key) => model.allowed[key as keyof typeof model.allowed],
              )
            }
          >
            {"\n      "}
            <span className="admin-nav-heading">{"Reports & Log"}</span>
            {"\n      "}
            <button
              type="button"
              data-admin-view="reports"
              disabled={disabled(model, "", false)}
              onClick={() => dataAction(model, "admin-view", "reports")}
              hidden={!model.allowed["reports" as keyof typeof model.allowed]}
              aria-current={model.view === "reports" ? "page" : "false"}
            >
              {"\n        "}
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M4 3h16v18H4zM8 8h8M8 12h8M8 16h5"></path>
              </svg>
              {"\n        "}
              <span>{"Visit register"}</span>
              {"\n      "}
            </button>
            {"\n      "}
            <button
              type="button"
              data-admin-view="audit"
              disabled={disabled(model, "", false)}
              onClick={() => dataAction(model, "admin-view", "audit")}
              hidden={!model.allowed["audit" as keyof typeof model.allowed]}
              aria-current={model.view === "audit" ? "page" : "false"}
            >
              {"\n        "}
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M4 3h16v18H4zM8 7h8M8 11h8M8 15h4"></path>
              </svg>
              {"\n        "}
              <span>{"Audit log"}</span>
              {"\n      "}
            </button>
            {"\n    "}
          </div>
          {"\n  "}
        </nav>
        {"\n\n  "}
        <main id="workspace" className="admin-content" tabIndex={-1}>
          {"\n    "}
          <h1 id="admin-title" className="sr-only">
            {content(model, "admin-title")}
          </h1>
          {"\n\n    "}
          <p id="page-status" role="status" aria-live="polite">
            {content(model, "page-status")}
          </p>
          {"\n\n    "}
          <div
            id="console-scope"
            hidden={hidden(model, "console-scope")}
            className={"admin-scope-bar" + (!scoped(model) ? " is-bare" : "")}
          >
            {"\n      "}
            <div
              id="scope-project-wrap"
              className="scope-select-wrap"
              hidden={hidden(model, "scope-project-wrap")}
            >
              {"\n        "}
              <label htmlFor="console-project" className="scope-label">
                {"\n          "}
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M3 7h18v14H3zM8 7V3h8v4"></path>
                </svg>
                {"\n          "}
                <span>{"Account scope"}</span>
                {"\n        "}
              </label>
              {"\n        "}
              <select
                id="console-project"
                value={value(model, "console-project")}
                onChange={(event) =>
                  change(model, "console-project", event.target.value)
                }
                disabled={disabled(model, "console-project", false)}
              >
                {options(model, "console-project")?.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
              {"\n      "}
            </div>
            {"\n      "}
            <p
              id="scope-hint"
              className="hint scope-hint-pill"
              hidden={hidden(model, "scope-hint")}
            >
              {content(model, "scope-hint")}
            </p>
            {"\n      "}
            <div
              id="overview-range"
              className="scope-range"
              role="group"
              aria-label="Visit date range"
              hidden={hidden(model, "overview-range")}
              aria-busy={model.summaryBusy || undefined}
            >
              {"\n        "}
              <div
                className="range-presets"
                role="group"
                aria-label="Quick ranges"
              >
                {"\n          "}
                <button
                  type="button"
                  className="range-chip"
                  data-range-days="1"
                  disabled={disabled(model, "", false)}
                  onClick={() => dataAction(model, "range-days", "1")}
                  aria-pressed={
                    !!model.scope &&
                    model.field("overview-to") === model.scope.currentDate &&
                    model.field("overview-from") ===
                      shiftDay(model.scope.currentDate, 1 - 1)
                  }
                >
                  {"Today"}
                </button>
                {"\n          "}
                <button
                  type="button"
                  className="range-chip"
                  data-range-days="7"
                  disabled={disabled(model, "", false)}
                  onClick={() => dataAction(model, "range-days", "7")}
                  aria-pressed={
                    !!model.scope &&
                    model.field("overview-to") === model.scope.currentDate &&
                    model.field("overview-from") ===
                      shiftDay(model.scope.currentDate, 1 - 7)
                  }
                >
                  {"7 days"}
                </button>
                {"\n          "}
                <button
                  type="button"
                  className="range-chip"
                  data-range-days="30"
                  disabled={disabled(model, "", false)}
                  onClick={() => dataAction(model, "range-days", "30")}
                  aria-pressed={
                    !!model.scope &&
                    model.field("overview-to") === model.scope.currentDate &&
                    model.field("overview-from") ===
                      shiftDay(model.scope.currentDate, 1 - 30)
                  }
                >
                  {"30 days"}
                </button>
                {"\n        "}
              </div>
              {"\n        "}
              <div className="range-inputs">
                {"\n          "}
                <label className="sr-only" htmlFor="overview-from">
                  {"From date"}
                </label>
                {"\n          "}
                <input
                  id="overview-from"
                  type="date"
                  required={true}
                  value={value(model, "overview-from")}
                  onChange={(event) =>
                    change(model, "overview-from", event.target.value)
                  }
                  disabled={disabled(model, "overview-from", false)}
                />
                {"\n          "}
                <span className="range-sep" aria-hidden="true">
                  {"to"}
                </span>
                {"\n          "}
                <label className="sr-only" htmlFor="overview-to">
                  {"To date"}
                </label>
                {"\n          "}
                <input
                  id="overview-to"
                  type="date"
                  required={true}
                  value={value(model, "overview-to")}
                  onChange={(event) =>
                    change(model, "overview-to", event.target.value)
                  }
                  disabled={disabled(model, "overview-to", false)}
                />
                {"\n        "}
              </div>
              {"\n      "}
            </div>
            {"\n      "}
            {!model.scope || scoped(model) ? <Refresh model={model} /> : null}
            {"\n    "}
          </div>
          {"\n\n    "}
          {"\n    "}
          <OverviewView model={model} />
          {"\n\n    "}
          {"\n    "}
          <AccountAreasView model={model} />
          {"\n\n    "}
          {"\n    "}
          <StaffAccessView model={model} />
          {"\n\n    "}
          {"\n    "}
          <GuardAssignmentsView model={model} />
          {"\n\n    "}
          {"\n    "}
          <OfficesView model={model} />
          {"\n\n    "}
          {"\n    "}
          <ReportsView model={model} />
          {"\n\n    "}
          {"\n    "}
          <AuditLogView model={model} />
          {"\n  "}
        </main>
        {"\n"}
      </div>
      {"\n\n"}
      {"\n"}
      <AdminProfileDialog model={model} />
      {"\n\n"}
      {"\n"}
      <AdminConfirmationDialog model={model} />
      {"\n\n"}
      {"\n"}
      <AdminVisitDialog model={model} />
      {"\n\n"}
      {"\n"}
      <AccountLeadDialog model={model} />
      {"\n\n"}
      {"\n"}
      <GuardAssignmentDialog model={model} />
      {"\n\n"}
      <ProjectGroupDialog model={model} />
      {"\n\n"}
      {"\n"}
      <CommonAreaDialog model={model} />
      {"\n\n"}
      {"\n"}
      <OfficePosterDialog model={model} config={config} />
      {"\n\n"}
      <StaffOnboardingDialog model={model} />
      {"\n"}
      <AccountAreaDialog model={model} />
      {"\n"}
      {"\n"}
      <HostDialog model={model} />
      <Notices items={model.notices} dismiss={model.dismiss} />
    </>
  );
}
