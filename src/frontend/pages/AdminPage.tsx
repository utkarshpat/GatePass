import { useRef, useEffect } from "react";
import { useModel } from "../shared/model.ts";
import { AdminModel } from "../admin/model.ts";
import {
  action,
  change,
  submit,
  value,
  hidden,
  disabled,
  options,
  scoped,
  dataAction,
} from "../admin/bindings.ts";
import { content, Refresh } from "../admin/slots.tsx";
import { HostDialog } from "../admin/AccountsView.tsx";
import { Dialog, Select } from "../shared/controls.tsx";
import { Notices } from "../shared/Notices.tsx";
import { downloadPosterPng } from "../admin/poster.ts";
import { shiftDay } from "../admin/types.ts";
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
          <section
            id="admin-overview"
            aria-label="Operational overview"
            hidden={hidden(model, "admin-overview")}
          >
            {"\n      "}
            <div className="overview-section">
              {"\n        "}
              <div className="section-title-strip">
                {"\n          "}
                <h2>{"Visit summary"}</h2>
                {"\n          "}
                <span id="summary-range-label" className="badge-neutral">
                  {content(model, "summary-range-label")}
                </span>
                {"\n        "}
              </div>
              {"\n        "}
              <div id="summary-cards" className="admin-stat-grid">
                {content(model, "summary-cards")}
              </div>
              {"\n      "}
            </div>
            {"\n\n      "}
            <div className="overview-charts">
              {"\n        "}
              <section
                className="chart-card"
                aria-labelledby="chart-status-title"
              >
                {"\n          "}
                <h3 id="chart-status-title">{"Approval status"}</h3>
                {"\n          "}
                <div id="chart-status" className="chart-body">
                  {content(model, "chart-status")}
                </div>
                {"\n        "}
              </section>
              {"\n        "}
              <section
                className="chart-card chart-card-wide"
                aria-labelledby="chart-trend-title"
              >
                {"\n          "}
                <h3 id="chart-trend-title">
                  {content(model, "chart-trend-title")}
                </h3>
                {"\n          "}
                <div id="chart-trend" className="chart-body">
                  {content(model, "chart-trend")}
                </div>
                {"\n        "}
              </section>
              {"\n      "}
            </div>
            {"\n\n      "}
            <div className="admin-note presence-section">
              {"\n        "}
              <div className="section-title-strip">
                {"\n          "}
                <div className="presence-title">
                  {"\n            "}
                  <span className="live-pulse-dot" aria-hidden="true"></span>
                  {"\n            "}
                  <h2>{"Current recorded presence"}</h2>
                  {"\n          "}
                </div>
                {"\n          "}
                <span className="badge-live">{"Latest recorded presence"}</span>
                {"\n        "}
              </div>
              {"\n        "}
              <div
                id="presence-cards"
                className="admin-stat-grid presence-grid"
              >
                {content(model, "presence-cards")}
              </div>
              {"\n        "}
              <p className="hint">
                {
                  "Presence reflects the latest refresh; visit totals reflect the selected dates above."
                }
              </p>
              {"\n      "}
            </div>
            {"\n    "}
          </section>
          {"\n\n    "}
          {"\n    "}
          <section
            id="admin-projects"
            aria-label="Accounts and common areas"
            hidden={hidden(model, "admin-projects")}
          >
            {"\n      "}
            <div className="page-head">
              {"\n        "}
              <div className="page-head-copy">
                {"\n          "}
                <h2>{"Accounts & areas"}</h2>
                {"\n          "}
                <p id="projects-summary" className="hint">
                  {content(model, "projects-summary")}
                </p>
                {"\n        "}
              </div>
              {"\n        "}
              <div className="page-head-actions">
                {"\n          "}
                <button
                  type="button"
                  className="primary"
                  id="add-project-open"
                  hidden={hidden(model, "add-project-open")}
                  disabled={disabled(model, "add-project-open", false)}
                  onClick={() => action(model, "add-project-open")}
                >
                  <span aria-hidden="true">{"+"}</span>
                  {" Add"}
                </button>
                {"\n          "}
                <div className="refresh-slot" data-refresh-slot="">
                  {model.scope && model.view === "projects" ? (
                    <Refresh model={model} />
                  ) : null}
                </div>
                {"\n        "}
              </div>
              {"\n      "}
            </div>
            {"\n      "}
            <div
              id="projects-tabs"
              className="chip-row projects-tabs"
              role="group"
              aria-label="Accounts and areas views"
              hidden={hidden(model, "projects-tabs")}
            >
              {"\n        "}
              <button
                type="button"
                className="choice-chip"
                data-project-tab="catalogue"
                disabled={disabled(model, "", false)}
                onClick={() => dataAction(model, "project-tab", "catalogue")}
                aria-pressed={model.roster.projectTab === "catalogue"}
              >
                {"Accounts & areas"}
              </button>
              {"\n        "}
              <button
                type="button"
                className="choice-chip"
                data-project-tab="groups"
                disabled={disabled(model, "", false)}
                onClick={() => dataAction(model, "project-tab", "groups")}
                aria-pressed={model.roster.projectTab === "groups"}
              >
                {"Account groups"}
              </button>
              {"\n      "}
            </div>
            {"\n      "}
            <div
              id="project-catalogue-panel"
              hidden={hidden(model, "project-catalogue-panel")}
            >
              {"\n      "}
              <div className="list-toolbar">
                {"\n        "}
                <div className="search-box">
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
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  {"\n          "}
                  <label className="sr-only" htmlFor="project-search">
                    {"Search accounts and areas"}
                  </label>
                  {"\n          "}
                  <input
                    id="project-search"
                    type="search"
                    maxLength={80}
                    autoComplete="off"
                    placeholder="Search accounts and areas by name or code"
                    value={value(model, "project-search")}
                    onChange={(event) =>
                      change(model, "project-search", event.target.value)
                    }
                    disabled={disabled(model, "project-search", false)}
                  />
                  {"\n        "}
                </div>
                {"\n      "}
              </div>
              {"\n      "}
              <p id="common-catalog-status" className="hint" role="status">
                {content(model, "common-catalog-status")}
              </p>
              {"\n      "}
              <div id="projects" className="project-grid">
                {content(model, "projects")}
              </div>
              {"\n      "}
              <button
                type="button"
                className="secondary load-more-btn"
                id="more-projects"
                hidden={hidden(model, "more-projects")}
                disabled={disabled(model, "more-projects", false)}
                onClick={() => action(model, "more-projects")}
              >
                {"Load more accounts and areas"}
              </button>
              {"\n      "}
            </div>
            {"\n      "}
            <section
              id="project-groups-panel"
              aria-label="Account groups"
              hidden={hidden(model, "project-groups-panel")}
            >
              {"\n        "}
              <div className="page-head">
                {"\n          "}
                <div className="page-head-copy">
                  <h3>{"Account groups"}</h3>
                  <p className="hint">
                    {
                      "Group accounts by floor or entry. Account changes automatically update linked guards."
                    }
                  </p>
                </div>
                {"\n          "}
                <div className="page-head-actions">
                  <button
                    id="create-project-group"
                    type="button"
                    className="secondary"
                    hidden={hidden(model, "create-project-group")}
                    disabled={disabled(model, "create-project-group", false)}
                    onClick={() => action(model, "create-project-group")}
                  >
                    {"Create group"}
                  </button>
                </div>
                {"\n        "}
              </div>
              {"\n        "}
              <p
                id="project-groups-status"
                className="hint"
                role="status"
                aria-live="polite"
              >
                {content(model, "project-groups-status")}
              </p>
              {"\n        "}
              <div id="project-group-list" className="roster-grid">
                {content(model, "project-group-list")}
              </div>
              {"\n      "}
            </section>
            {"\n    "}
          </section>
          {"\n\n    "}
          {"\n    "}
          <section
            id="admin-staff"
            aria-label="Users and permissions"
            hidden={hidden(model, "admin-staff")}
          >
            {"\n      "}
            <div className="admin-section-heading">
              <h2>{"Users & permissions"}</h2>
              <button
                id="add-staff-open"
                type="button"
                className="primary"
                hidden={hidden(model, "add-staff-open")}
                disabled={disabled(model, "add-staff-open", false)}
                onClick={() => action(model, "add-staff-open")}
              >
                {"Add user"}
              </button>
            </div>
            {"\n      "}
            <p className="hint">
              {
                "Manage existing users, roles and permissions within your authorized scope. Create guards from Guard assignments."
              }
            </p>
            {"\n      "}
            <form
              id="subject-form"
              className="admin-filterbar staff-filterbar"
              onSubmit={(event) => {
                event.preventDefault();
                if (event.currentTarget.reportValidity())
                  submit(model, "subject-form");
              }}
            >
              {"\n        "}
              <div className="filter-field search-field">
                {"\n          "}
                <label htmlFor="subject-search">
                  {"\n            "}
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  {"\n            "}
                  <span>{"Find staff"}</span>
                  {"\n          "}
                </label>
                {"\n          "}
                <input
                  id="subject-search"
                  type="search"
                  maxLength={80}
                  placeholder="Search staff name (at least 2 characters)"
                  required={true}
                  minLength={2}
                  value={value(model, "subject-search")}
                  onChange={(event) =>
                    change(model, "subject-search", event.target.value)
                  }
                  disabled={disabled(model, "subject-search", false)}
                />
                {"\n        "}
              </div>
              {"\n        "}
              <button
                className="secondary"
                type="submit"
                disabled={disabled(model, "", false)}
              >
                {"Search"}
              </button>
              {"\n      "}
            </form>
            {"\n      "}
            <p className="hint">
              {
                "Select an existing employee or staff identity to manage its scoped roles."
              }
            </p>
            {"\n\n      "}
            <div
              id="subject-results"
              className="admin-list subject-results-list"
            >
              {content(model, "subject-results")}
            </div>
            {"\n      "}
            <button
              id="subjects-more"
              className="secondary load-more-btn"
              type="button"
              hidden={hidden(model, "subjects-more")}
              disabled={disabled(model, "subjects-more", false)}
              onClick={() => action(model, "subjects-more")}
            >
              {"Load more staff"}
            </button>
            {"\n\n      "}
            <section
              id="staff-detail"
              className="staff-detail-container"
              hidden={hidden(model, "staff-detail")}
            >
              {"\n        "}
              <div className="admin-section-heading">
                {"\n          "}
                <div className="subject-title-wrap">
                  {"\n            "}
                  <div className="staff-avatar-placeholder" aria-hidden="true">
                    {"\n              "}
                    <svg
                      viewBox="0 0 24 24"
                      width="20"
                      height="20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    {"\n            "}
                  </div>
                  {"\n            "}
                  <div>
                    {"\n              "}
                    <h2 id="subject-name">{content(model, "subject-name")}</h2>
                    {"\n              "}
                    <span className="subtext-muted">
                      {"Staff identity roles & permissions"}
                    </span>
                    {"\n            "}
                  </div>
                  {"\n          "}
                </div>
                {"\n          "}
                <div className="role-filter-wrap">
                  {"\n            "}
                  <label htmlFor="role-state">{"Role history"}</label>
                  {"\n            "}
                  <select
                    id="role-state"
                    value={value(model, "role-state")}
                    onChange={(event) =>
                      change(model, "role-state", event.target.value)
                    }
                    disabled={disabled(model, "role-state", false)}
                  >
                    {"\n              "}
                    <option value="CURRENT">{"Current active roles"}</option>
                    {"\n              "}
                    <option value="ALL">{"All roles history"}</option>
                    {"\n            "}
                  </select>
                  {"\n          "}
                </div>
                {"\n        "}
              </div>
              {"\n\n        "}
              <button
                id="reset-staff-setup"
                type="button"
                className="secondary"
                hidden={hidden(model, "reset-staff-setup")}
                disabled={disabled(model, "reset-staff-setup", false)}
                onClick={() => action(model, "reset-staff-setup")}
              >
                {"Reset password / setup"}
              </button>
              {"\n        "}
              <div id="staff-roles" className="admin-list staff-roles-list">
                {content(model, "staff-roles")}
              </div>
              {"\n        "}
              <button
                id="roles-more"
                className="secondary load-more-btn"
                type="button"
                hidden={hidden(model, "roles-more")}
                disabled={disabled(model, "roles-more", false)}
                onClick={() => action(model, "roles-more")}
              >
                {"Load more roles"}
              </button>
              {"\n\n        "}
              <form
                id="staff-grant-form"
                className="admin-panel staff-grant-card"
                hidden={hidden(model, "staff-grant-form")}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (event.currentTarget.reportValidity())
                    submit(model, "staff-grant-form");
                }}
              >
                {"\n          "}
                <div className="panel-header">
                  {"\n            "}
                  <h3>{"Assign role & scope"}</h3>
                  {"\n            "}
                  <p className="hint">
                    {"Grant scoped permissions to this staff member"}
                  </p>
                  {"\n          "}
                </div>
                {"\n          "}
                <div className="admin-form-grid">
                  {"\n            "}
                  <div className="field">
                    {"\n              "}
                    <label htmlFor="staff-role">{"Role and scope"}</label>
                    {"\n              "}
                    <select
                      id="staff-role"
                      required={true}
                      value={value(model, "staff-role")}
                      onChange={(event) =>
                        change(model, "staff-role", event.target.value)
                      }
                      disabled={disabled(model, "staff-role", false)}
                    >
                      {options(model, "staff-role")?.map((option) => (
                        <option
                          key={option.value}
                          value={option.value}
                          disabled={option.disabled}
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {"\n            "}
                  </div>
                  {"\n            "}
                  <div className="field">
                    {"\n              "}
                    <label htmlFor="staff-until">
                      {"Valid until (optional)"}
                    </label>
                    {"\n              "}
                    <input
                      id="staff-until"
                      type="datetime-local"
                      value={value(model, "staff-until")}
                      onChange={(event) =>
                        change(model, "staff-until", event.target.value)
                      }
                      disabled={disabled(model, "staff-until", false)}
                    />
                    {"\n            "}
                  </div>
                  {"\n          "}
                </div>
                {"\n          "}
                <fieldset
                  id="staff-capabilities"
                  className="capabilities-fieldset"
                >
                  {content(model, "staff-capabilities")}
                </fieldset>
                {"\n          "}
                <div className="field">
                  {"\n            "}
                  <label htmlFor="staff-reason">
                    {"Assignment justification / Reason"}
                  </label>
                  {"\n            "}
                  <input
                    id="staff-reason"
                    maxLength={300}
                    placeholder="e.g. Account Delivery Lead delegation"
                    required={true}
                    value={value(model, "staff-reason")}
                    onChange={(event) =>
                      change(model, "staff-reason", event.target.value)
                    }
                    disabled={disabled(model, "staff-reason", false)}
                  />
                  {"\n          "}
                </div>
                {"\n          "}
                <div className="panel-actions">
                  {"\n            "}
                  <button
                    className="primary"
                    id="staff-grant"
                    type="submit"
                    disabled={disabled(model, "staff-grant", false)}
                  >
                    {"Assign role"}
                  </button>
                  {"\n          "}
                </div>
                {"\n        "}
              </form>
              {"\n      "}
            </section>
            {"\n    "}
          </section>
          {"\n\n    "}
          {"\n    "}
          <section
            id="admin-assignments"
            aria-label="Guard account assignments"
            hidden={hidden(model, "admin-assignments")}
          >
            {"\n      "}
            <div className="page-head">
              {"\n        "}
              <div className="page-head-copy">
                {"\n          "}
                <h2>{"Guard assignments"}</h2>
                {"\n          "}
                <p className="hint">
                  {"Who is posted where, and which guards are free to assign."}
                </p>
                {"\n        "}
              </div>
              {"\n        "}
              <div className="page-head-actions">
                {"\n          "}
                <button
                  id="add-guard-open"
                  type="button"
                  className="secondary"
                  hidden={hidden(model, "add-guard-open")}
                  disabled={disabled(model, "add-guard-open", false)}
                  onClick={() => action(model, "add-guard-open")}
                >
                  {"Add guard"}
                </button>
                {"\n          "}
                <button
                  id="assign-guard-open"
                  type="button"
                  className="primary"
                  hidden={hidden(model, "assign-guard-open")}
                  disabled={disabled(model, "assign-guard-open", false)}
                  onClick={() => action(model, "assign-guard-open")}
                >
                  {"\n            "}
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    aria-hidden="true"
                  >
                    <path d="M12 5v14M5 12h14"></path>
                  </svg>
                  {"\n            "}
                  <span>{"Assign guard"}</span>
                  {"\n          "}
                </button>
                {"\n          "}
                <div className="refresh-slot" data-refresh-slot="">
                  {model.scope && model.view === "assignments" ? (
                    <Refresh model={model} />
                  ) : null}
                </div>
                {"\n        "}
              </div>
              {"\n      "}
            </div>
            {"\n\n      "}
            <div id="project-assignments-panel">
              {"\n      "}
              <div id="guard-stats" className="admin-stat-grid guard-stats">
                {content(model, "guard-stats")}
              </div>
              {"\n\n      "}
              <div className="list-toolbar roster-toolbar">
                {"\n        "}
                <div
                  className="range-presets"
                  role="group"
                  aria-label="Guard status"
                >
                  {"\n          "}
                  <button
                    type="button"
                    className="range-chip"
                    data-guard-filter="all"
                    disabled={disabled(model, "", false)}
                    onClick={() => dataAction(model, "guard-filter", "all")}
                    aria-pressed={model.roster.filter === "all"}
                  >
                    {"All"}
                  </button>
                  {"\n          "}
                  <button
                    type="button"
                    className="range-chip"
                    data-guard-filter="assigned"
                    disabled={disabled(model, "", false)}
                    onClick={() =>
                      dataAction(model, "guard-filter", "assigned")
                    }
                    aria-pressed={model.roster.filter === "assigned"}
                  >
                    {"Assigned"}
                  </button>
                  {"\n          "}
                  <button
                    type="button"
                    className="range-chip"
                    data-guard-filter="free"
                    disabled={
                      model.writing || model.roster.deniedProjects.length > 0
                    }
                    onClick={() => dataAction(model, "guard-filter", "free")}
                    aria-pressed={model.roster.filter === "free"}
                  >
                    {"Free"}
                  </button>
                  {"\n        "}
                </div>
                {"\n        "}
                <div className="search-box">
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
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  {"\n          "}
                  <label className="sr-only" htmlFor="guard-search">
                    {"Search guards or accounts"}
                  </label>
                  {"\n          "}
                  <input
                    id="guard-search"
                    type="search"
                    maxLength={80}
                    autoComplete="off"
                    placeholder="Search guard or account"
                    value={value(model, "guard-search")}
                    onChange={(event) =>
                      change(model, "guard-search", event.target.value)
                    }
                    disabled={disabled(model, "guard-search", false)}
                  />
                  {"\n        "}
                </div>
                {"\n        "}
                <div
                  className="range-presets"
                  role="group"
                  aria-label="Group duties by"
                >
                  {"\n          "}
                  <button
                    type="button"
                    className="range-chip"
                    data-roster-view="guard"
                    disabled={disabled(model, "", false)}
                    onClick={() => dataAction(model, "roster-view", "guard")}
                    aria-pressed={model.roster.view === "guard"}
                  >
                    {"By guard"}
                  </button>
                  {"\n          "}
                  <button
                    type="button"
                    className="range-chip"
                    data-roster-view="project"
                    disabled={disabled(model, "", false)}
                    onClick={() => dataAction(model, "roster-view", "project")}
                    aria-pressed={model.roster.view === "project"}
                  >
                    {"By account"}
                  </button>
                  {"\n        "}
                </div>
                {"\n      "}
              </div>
              {"\n      "}
              <p
                id="roster-status"
                className="filter-status-text"
                role="status"
                aria-live="polite"
              >
                {content(model, "roster-status")}
              </p>
              {"\n\n      "}
              <div
                id="assignment-list"
                className="roster-list"
                hidden={hidden(model, "assignment-list")}
              >
                {content(model, "assignment-list")}
              </div>
              {"\n      "}
              <div
                id="project-duty-list"
                className="roster-grid"
                hidden={hidden(model, "project-duty-list")}
              >
                {content(model, "project-duty-list")}
              </div>
              {"\n      "}
            </div>
            {"\n    "}
          </section>
          {"\n\n    "}
          {"\n    "}
          <section
            id="admin-offices"
            aria-label="Offices and QR codes"
            hidden={hidden(model, "admin-offices")}
          >
            {"\n      "}
            <div className="page-head">
              {"\n        "}
              <div className="page-head-copy">
                {"\n          "}
                <h2>{"Offices & QR"}</h2>
                {"\n          "}
                <p className="hint">
                  {"Registration QR codes and welcome posters for each office."}
                </p>
                {"\n        "}
              </div>
              {"\n        "}
              <div className="page-head-actions">
                <div className="refresh-slot" data-refresh-slot="">
                  {model.scope && model.view === "offices" ? (
                    <Refresh model={model} />
                  ) : null}
                </div>
              </div>
              {"\n      "}
            </div>
            {"\n      "}
            <div className="offices-container">
              {"\n        "}
              <div id="office-list" className="admin-list office-cards-grid">
                {content(model, "office-list")}
              </div>
              {"\n        "}
              <div id="office-qr" hidden={hidden(model, "office-qr")}></div>
              {"\n      "}
            </div>
            {"\n    "}
          </section>
          {"\n\n    "}
          {"\n    "}
          <section
            id="admin-reports"
            aria-label="Visit register"
            hidden={hidden(model, "admin-reports")}
          >
            {"\n      "}
            <div className="page-head">
              {"\n        "}
              <div className="page-head-copy">
                {"\n          "}
                <h2>{"Visit register"}</h2>
                {"\n          "}
                <p className="hint">
                  {
                    "Search visits in the selected office and account scope, up to 31 days at a time. Select any row to see its full history."
                  }
                </p>
                {"\n        "}
              </div>
              {"\n        "}
              <div className="page-head-actions">
                {"\n          "}
                <button
                  type="button"
                  id="register-export"
                  className="secondary"
                  hidden={hidden(model, "register-export")}
                  disabled={disabled(model, "register-export", true)}
                  onClick={() => action(model, "register-export")}
                >
                  {"\n            "}
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  {"\n            "}
                  <span>{"Export Excel"}</span>
                  {"\n          "}
                </button>
                {"\n        "}
              </div>
              {"\n      "}
            </div>
            {"\n      "}
            <form
              id="report-form"
              className="register-filter-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (event.currentTarget.reportValidity())
                  submit(model, "report-form");
              }}
            >
              {"\n        "}
              <div className="register-dates">
                {"\n          "}
                <div
                  className="range-presets"
                  role="group"
                  aria-label="Quick date ranges"
                >
                  {"\n            "}
                  <button
                    type="button"
                    className="range-chip"
                    data-report-days="1"
                    disabled={disabled(model, "", false)}
                    onClick={() => dataAction(model, "report-days", "1")}
                    aria-pressed={
                      !!model.scope &&
                      model.field("report-to") === model.scope.currentDate &&
                      model.field("report-from") ===
                        shiftDay(model.scope.currentDate, 1 - 1)
                    }
                  >
                    {"Today"}
                  </button>
                  {"\n            "}
                  <button
                    type="button"
                    className="range-chip"
                    data-report-days="7"
                    disabled={disabled(model, "", false)}
                    onClick={() => dataAction(model, "report-days", "7")}
                    aria-pressed={
                      !!model.scope &&
                      model.field("report-to") === model.scope.currentDate &&
                      model.field("report-from") ===
                        shiftDay(model.scope.currentDate, 1 - 7)
                    }
                  >
                    {"7 days"}
                  </button>
                  {"\n            "}
                  <button
                    type="button"
                    className="range-chip"
                    data-report-days="30"
                    disabled={disabled(model, "", false)}
                    onClick={() => dataAction(model, "report-days", "30")}
                    aria-pressed={
                      !!model.scope &&
                      model.field("report-to") === model.scope.currentDate &&
                      model.field("report-from") ===
                        shiftDay(model.scope.currentDate, 1 - 30)
                    }
                  >
                    {"30 days"}
                  </button>
                  {"\n          "}
                </div>
                {"\n          "}
                <label>
                  {"From date"}
                  <input
                    id="report-from"
                    type="date"
                    required={true}
                    value={value(model, "report-from")}
                    onChange={(event) =>
                      change(model, "report-from", event.target.value)
                    }
                    disabled={disabled(model, "report-from", false)}
                  />
                </label>
                {"\n          "}
                <label>
                  {"To date"}
                  <input
                    id="report-to"
                    type="date"
                    required={true}
                    value={value(model, "report-to")}
                    onChange={(event) =>
                      change(model, "report-to", event.target.value)
                    }
                    disabled={disabled(model, "report-to", false)}
                  />
                </label>
                {"\n          "}
                <label>
                  {"Sort by"}
                  <select
                    id="register-sort"
                    value={value(model, "register-sort")}
                    onChange={(event) =>
                      change(model, "register-sort", event.target.value)
                    }
                    disabled={disabled(model, "register-sort", false)}
                  >
                    {options(model, "register-sort")?.map((option) => (
                      <option
                        key={option.value}
                        value={option.value}
                        disabled={option.disabled}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {"\n          "}
                <label>
                  {"Order"}
                  <select
                    id="register-direction"
                    value={value(model, "register-direction")}
                    onChange={(event) =>
                      change(model, "register-direction", event.target.value)
                    }
                    disabled={disabled(model, "register-direction", false)}
                  >
                    <option value="DESC">{"Descending"}</option>
                    <option value="ASC">{"Ascending"}</option>
                  </select>
                </label>
                {"\n        "}
              </div>
              {"\n        "}
              <div className="register-toolbar">
                {"\n          "}
                <label>
                  {"Request reference"}
                  <input
                    id="report-reference"
                    maxLength={200}
                    placeholder="Contains reference…"
                    value={value(model, "report-reference")}
                    onChange={(event) =>
                      change(model, "report-reference", event.target.value)
                    }
                    disabled={disabled(model, "report-reference", false)}
                  />
                </label>
                {"\n          "}
                <label>
                  {"Visitor name"}
                  <input
                    id="quick-name"
                    maxLength={200}
                    placeholder="Contains name…"
                    value={value(model, "quick-name")}
                    onChange={(event) =>
                      change(model, "quick-name", event.target.value)
                    }
                    disabled={disabled(model, "quick-name", false)}
                  />
                </label>
                {"\n          "}
                <label>
                  {"Approval"}
                  <select
                    id="quick-status"
                    value={value(model, "quick-status")}
                    onChange={(event) =>
                      change(model, "quick-status", event.target.value)
                    }
                    disabled={disabled(model, "quick-status", false)}
                  >
                    <option value="">{"Any"}</option>
                    <option value="PENDING">{"Pending"}</option>
                    <option value="APPROVED">{"Approved"}</option>
                    <option value="DENIED">{"Denied"}</option>
                    <option value="CANCELLED">{"Cancelled"}</option>
                  </select>
                </label>
                {"\n          "}
                <label>
                  {"Presence"}
                  <select
                    id="quick-presence"
                    value={value(model, "quick-presence")}
                    onChange={(event) =>
                      change(model, "quick-presence", event.target.value)
                    }
                    disabled={disabled(model, "quick-presence", false)}
                  >
                    <option value="">{"Any"}</option>
                    <option value="INSIDE">{"Inside"}</option>
                    <option value="OUTSIDE">{"Outside"}</option>
                  </select>
                </label>
                {"\n          "}
                <label>
                  {"Visit type"}
                  <select
                    id="quick-type"
                    value={value(model, "quick-type")}
                    onChange={(event) =>
                      change(model, "quick-type", event.target.value)
                    }
                    disabled={disabled(model, "quick-type", false)}
                  >
                    <option value="">{"Any"}</option>
                    <option value="EXTERNAL">{"External"}</option>
                    <option value="EMPLOYEE_PROJECT">
                      {"Employee account"}
                    </option>
                    <option value="DIGITAL_ID">{"Digital ID"}</option>
                  </select>
                </label>
                {"\n        "}
              </div>
              {"\n        "}
              <div id="register-filters" className="register-filters">
                {content(model, "register-filters")}
              </div>
              {"\n        "}
              <div className="register-actions">
                {"\n          "}
                <button
                  type="submit"
                  className="primary"
                  id="register-apply"
                  disabled={disabled(model, "register-apply", false)}
                >
                  {"Apply filters"}
                </button>
                {"\n          "}
                <button
                  type="button"
                  id="register-add-filter"
                  className="secondary"
                  disabled={disabled(model, "register-add-filter", false)}
                  onClick={() => action(model, "register-add-filter")}
                >
                  {"Add field filter"}
                </button>
                {"\n          "}
                <button
                  type="button"
                  id="register-reset"
                  className="quiet"
                  disabled={disabled(model, "register-reset", false)}
                  onClick={() => action(model, "register-reset")}
                >
                  {"Reset filters"}
                </button>
                {"\n          "}
                <details className="register-columns">
                  <summary>{"Columns"}</summary>
                  <div id="register-columns">
                    {content(model, "register-columns")}
                  </div>
                </details>
                {"\n        "}
              </div>
              {"\n      "}
            </form>
            {"\n      "}
            <p
              id="report-status"
              className="filter-status-text"
              role="status"
              aria-live="polite"
            >
              {content(model, "report-status")}
            </p>
            {"\n      "}
            <div
              className="register-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Visit register table, scroll for more columns"
            >
              {"\n        "}
              <table className="register-table">
                <caption className="sr-only">
                  {
                    "Scoped visit register. Select a name to open visit details."
                  }
                </caption>
                <thead id="register-head">
                  {content(model, "register-head")}
                </thead>
                <tbody id="report-list">{content(model, "report-list")}</tbody>
              </table>
              {"\n      "}
            </div>
            {"\n      "}
            <div className="register-pagination">
              <button
                id="register-previous"
                className="secondary"
                type="button"
                disabled={disabled(model, "register-previous", true)}
                onClick={() => action(model, "register-previous")}
              >
                {"Previous page"}
              </button>
              <span id="register-page">{content(model, "register-page")}</span>
              <button
                id="reports-more"
                className="secondary"
                type="button"
                hidden={hidden(model, "reports-more")}
                disabled={disabled(model, "reports-more", false)}
                onClick={() => action(model, "reports-more")}
              >
                {"Next page"}
              </button>
            </div>
            {"\n    "}
          </section>
          {"\n\n    "}
          {"\n    "}
          <section
            id="admin-audit"
            aria-label="Security audit log"
            hidden={hidden(model, "admin-audit")}
          >
            {"\n      "}
            <div className="page-head">
              {"\n        "}
              <div className="page-head-copy">
                {"\n          "}
                <h2>{"Audit log"}</h2>
                {"\n          "}
                <p className="hint">
                  {
                    "Append-only record of access and administration changes. Times are shown in IST."
                  }
                </p>
                {"\n        "}
              </div>
              {"\n      "}
            </div>
            {"\n      "}
            <form
              id="audit-form"
              className="admin-filterbar audit-filterbar"
              onSubmit={(event) => {
                event.preventDefault();
                if (event.currentTarget.reportValidity())
                  submit(model, "audit-form");
              }}
            >
              {"\n        "}
              <div className="filter-field">
                {"\n          "}
                <label htmlFor="audit-from">{"From date"}</label>
                {"\n          "}
                <input
                  id="audit-from"
                  type="date"
                  required={true}
                  value={value(model, "audit-from")}
                  onChange={(event) =>
                    change(model, "audit-from", event.target.value)
                  }
                  disabled={disabled(model, "audit-from", false)}
                />
                {"\n        "}
              </div>
              {"\n        "}
              <div className="filter-field">
                {"\n          "}
                <label htmlFor="audit-to">{"To date"}</label>
                {"\n          "}
                <input
                  id="audit-to"
                  type="date"
                  required={true}
                  value={value(model, "audit-to")}
                  onChange={(event) =>
                    change(model, "audit-to", event.target.value)
                  }
                  disabled={disabled(model, "audit-to", false)}
                />
                {"\n        "}
              </div>
              {"\n        "}
              <div className="filter-field">
                {"\n          "}
                <label htmlFor="audit-result">{"Result"}</label>
                {"\n          "}
                <select
                  id="audit-result"
                  value={value(model, "audit-result")}
                  onChange={(event) =>
                    change(model, "audit-result", event.target.value)
                  }
                  disabled={disabled(model, "audit-result", false)}
                >
                  <option value="">{"All results"}</option>
                  <option value="SUCCESS">{"Success"}</option>
                  <option value="DENIED">{"Denied"}</option>
                  <option value="ERROR">{"Error"}</option>
                </select>
                {"\n        "}
              </div>
              {"\n        "}
              <div className="filter-field search-field">
                {"\n          "}
                <label htmlFor="audit-search">{"Search loaded events"}</label>
                {"\n          "}
                <input
                  id="audit-search"
                  type="search"
                  maxLength={80}
                  autoComplete="off"
                  placeholder="Actor, action, target or reason"
                  value={value(model, "audit-search")}
                  onChange={(event) =>
                    change(model, "audit-search", event.target.value)
                  }
                  disabled={disabled(model, "audit-search", false)}
                />
                {"\n        "}
              </div>
              {"\n        "}
              <label
                id="audit-all-label"
                hidden={hidden(model, "audit-all-label")}
              >
                <input
                  id="audit-all"
                  type="checkbox"
                  checked={!!model.checks["audit-all"]}
                  onChange={(event) =>
                    model.check("audit-all", event.target.checked)
                  }
                  disabled={disabled(model, "audit-all", false)}
                />
                {" All authorized scopes"}
              </label>
              <button
                type="submit"
                className="secondary"
                disabled={disabled(model, "", false)}
              >
                {"Filter log"}
              </button>
              {"\n      "}
            </form>
            {"\n      "}
            <p id="audit-status" className="filter-status-text" role="status">
              {content(model, "audit-status")}
            </p>
            {"\n      "}
            <div id="audit-list" className="log-view">
              {content(model, "audit-list")}
            </div>
            {"\n      "}
            <button
              id="audit-more"
              className="secondary load-more-btn"
              type="button"
              hidden={hidden(model, "audit-more")}
              disabled={disabled(model, "audit-more", false)}
              onClick={() => action(model, "audit-more")}
            >
              {"Load more events"}
            </button>
            {"\n    "}
          </section>
          {"\n  "}
        </main>
        {"\n"}
      </div>
      {"\n\n"}
      {"\n"}
      <Dialog
        className="app-dialog"
        id="admin-profile-dialog"
        aria-labelledby="admin-profile-title"
        open={!!model.dialogs["admin-profile-dialog"]}
        onDismiss={() => model.close("admin-profile-dialog")}
      >
        {"\n  "}
        <div className="dialog-heading">
          {"\n    "}
          <div className="dialog-title-group">
            {"\n      "}
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            {"\n      "}
            <h2 id="admin-profile-title">{"Admin Profile"}</h2>
            {"\n    "}
          </div>
          {"\n    "}
          <button
            type="button"
            className="quiet dialog-close-btn"
            data-close="admin-profile-dialog"
            aria-label="Close profile"
            disabled={disabled(model, "", false)}
            onClick={() => dataAction(model, "close", "admin-profile-dialog")}
          >
            {"✕"}
          </button>
          {"\n  "}
        </div>
        {"\n  "}
        <div className="dialog-body" id="profile-content">
          {content(model, "profile-content")}
        </div>
        {"\n"}
      </Dialog>
      {"\n\n"}
      {"\n"}
      <Dialog
        className="app-dialog"
        id="admin-confirm-dialog"
        aria-labelledby="admin-confirm-title"
        open={!!model.dialogs["admin-confirm-dialog"]}
        onDismiss={() => model.close("admin-confirm-dialog")}
      >
        {"\n  "}
        <div className="dialog-heading">
          {"\n    "}
          <div className="dialog-title-group">
            {"\n      "}
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            {"\n      "}
            <h2 id="admin-confirm-title">
              {content(model, "admin-confirm-title")}
            </h2>
            {"\n    "}
          </div>
          {"\n    "}
          <button
            type="button"
            className="quiet dialog-close-btn"
            data-close="admin-confirm-dialog"
            aria-label="Close confirmation"
            disabled={disabled(model, "", false)}
            onClick={() => dataAction(model, "close", "admin-confirm-dialog")}
          >
            {"✕"}
          </button>
          {"\n  "}
        </div>
        {"\n  "}
        <form
          id="admin-confirm-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (event.currentTarget.reportValidity())
              submit(model, "admin-confirm-form");
          }}
        >
          {"\n    "}
          <div className="dialog-body">
            {"\n      "}
            <p id="admin-confirm-copy" className="confirm-copy-text">
              {content(model, "admin-confirm-copy")}
            </p>
            {"\n      "}
            <div className="field">
              {"\n        "}
              <label htmlFor="admin-confirm-reason">
                {"Reason for change"}
              </label>
              {"\n        "}
              <input
                id="admin-confirm-reason"
                placeholder="e.g. Authorized staff departure / role revoke"
                required={true}
                maxLength={300}
                value={value(model, "admin-confirm-reason")}
                onChange={(event) =>
                  change(model, "admin-confirm-reason", event.target.value)
                }
                disabled={disabled(model, "admin-confirm-reason", false)}
              />
              {"\n      "}
            </div>
            {"\n      "}
            <p
              id="admin-confirm-status"
              className="filter-status-text"
              role="status"
            >
              {content(model, "admin-confirm-status")}
            </p>
            {"\n    "}
          </div>
          {"\n    "}
          <div className="dialog-actions">
            {"\n      "}
            <button
              type="button"
              className="secondary"
              data-close="admin-confirm-dialog"
              disabled={disabled(model, "", false)}
              onClick={() => dataAction(model, "close", "admin-confirm-dialog")}
            >
              {"Cancel"}
            </button>
            {"\n      "}
            <button
              type="submit"
              id="admin-confirm-submit"
              className="primary danger-btn"
              disabled={disabled(model, "admin-confirm-submit", false)}
            >
              {"Confirm change"}
            </button>
            {"\n    "}
          </div>
          {"\n  "}
        </form>
        {"\n"}
      </Dialog>
      {"\n\n"}
      {"\n"}
      <Dialog
        className="app-dialog visit-dialog"
        id="admin-visit-dialog"
        aria-labelledby="admin-visit-title"
        open={!!model.dialogs["admin-visit-dialog"]}
        onDismiss={() => model.close("admin-visit-dialog")}
      >
        {"\n  "}
        <div className="dialog-heading">
          {"\n    "}
          <div className="dialog-title-group">
            {"\n      "}
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            {"\n      "}
            <div>
              {"\n        "}
              <h2 id="admin-visit-title">
                {content(model, "admin-visit-title")}
              </h2>
              {"\n        "}
              <span className="subtext-muted">
                {"Recorded movement and visit data"}
              </span>
              {"\n      "}
            </div>
            {"\n    "}
          </div>
          {"\n    "}
          <button
            type="button"
            className="quiet dialog-close-btn"
            data-close="admin-visit-dialog"
            aria-label="Close visit"
            disabled={disabled(model, "", false)}
            onClick={() => dataAction(model, "close", "admin-visit-dialog")}
          >
            {"✕"}
          </button>
          {"\n  "}
        </div>
        {"\n  "}
        <div className="dialog-body">
          {"\n    "}
          <p
            id="admin-visit-status"
            className="filter-status-text"
            role="status"
          >
            {content(model, "admin-visit-status")}
          </p>
          {"\n    "}
          <div id="admin-visit-chips" className="visit-chips">
            {content(model, "admin-visit-chips")}
          </div>
          {"\n    "}
          <div className="visit-detail-card">
            {"\n      "}
            <dl id="admin-visit-fields" className="admin-detail-grid">
              {content(model, "admin-visit-fields")}
            </dl>
            {"\n    "}
          </div>
          {"\n    "}
          <div className="timeline-container">
            {"\n      "}
            <h3 className="timeline-heading">{"Visit timeline"}</h3>
            {"\n      "}
            <ol id="admin-visit-timeline" className="timeline-list">
              {content(model, "admin-visit-timeline")}
            </ol>
            {"\n    "}
          </div>
          {"\n  "}
        </div>
        {"\n"}
      </Dialog>
      {"\n\n"}
      {"\n"}
      <Dialog
        className="app-dialog lead-dialog"
        id="lead-dialog"
        aria-labelledby="lead-title"
        open={!!model.dialogs["lead-dialog"]}
        onDismiss={() => model.close("lead-dialog")}
      >
        {"\n  "}
        <div className="dialog-heading">
          {"\n    "}
          <div className="dialog-title-group">
            {"\n      "}
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            {"\n      "}
            <div>
              {"\n        "}
              <h2 id="lead-title">{"Account Leads"}</h2>
              {"\n        "}
              <p id="lead-project" className="hint">
                {content(model, "lead-project")}
              </p>
              {"\n      "}
            </div>
            {"\n    "}
          </div>
          {"\n    "}
          <button
            type="button"
            id="close-leads"
            className="quiet dialog-close-btn"
            aria-label="Close account leads"
            disabled={disabled(model, "close-leads", false)}
            onClick={() => action(model, "close-leads")}
          >
            {"✕"}
          </button>
          {"\n  "}
        </div>
        {"\n  "}
        <div className="dialog-body">
          {"\n    "}
          <h3 className="dialog-section-title">{"Current leads"}</h3>
          {"\n    "}
          <p id="lead-status" role="status" aria-live="polite">
            {content(model, "lead-status")}
          </p>
          {"\n    "}
          <div id="lead-list" className="lead-list-container">
            {content(model, "lead-list")}
          </div>
          {"\n    "}
          <button
            type="button"
            className="secondary load-more-btn"
            id="more-leads"
            hidden={hidden(model, "more-leads")}
            disabled={disabled(model, "more-leads", false)}
            onClick={() => action(model, "more-leads")}
          >
            {"Load more leads"}
          </button>
          {"\n\n    "}
          <form
            id="lead-form"
            className="dialog-subform"
            hidden={hidden(model, "lead-form")}
            onSubmit={(event) => {
              event.preventDefault();
              if (event.currentTarget.reportValidity())
                submit(model, "lead-form");
            }}
          >
            {"\n      "}
            <h3>{"Assign New Account Lead"}</h3>
            {"\n      "}
            <div className="field">
              {"\n        "}
              <label htmlFor="employee-search">{"Search Employee"}</label>
              {"\n        "}
              <input
                id="employee-search"
                type="search"
                maxLength={80}
                autoComplete="off"
                placeholder="Search name, email or employee ID"
                value={value(model, "employee-search")}
                onChange={(event) =>
                  change(model, "employee-search", event.target.value)
                }
                disabled={disabled(model, "employee-search", false)}
              />
              {"\n        "}
              <p
                id="search-status"
                className="hint"
                role="status"
                aria-live="polite"
              >
                {content(model, "search-status")}
              </p>
              {"\n        "}
              <div
                id="employee-results"
                className="employee-results"
                role="group"
                aria-label="Matching employees"
              >
                {content(model, "employee-results")}
              </div>
              {"\n        "}
              <div
                id="selected-employee"
                hidden={hidden(model, "selected-employee")}
              >
                {content(model, "selected-employee")}
              </div>
              {"\n      "}
            </div>
            {"\n      "}
            <div className="field">
              {"\n        "}
              <label htmlFor="lead-scope">{"Access Scope"}</label>
              {"\n        "}
              <Select
                id="lead-scope"
                value={value(model, "lead-scope")}
                onValue={(value) => change(model, "lead-scope", value)}
                label="Scope"
                disabled={disabled(model, "lead-scope", false)}
              >
                {options(model, "lead-scope")?.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    {option.label}
                  </option>
                ))}
              </Select>
              {"\n      "}
            </div>
            {"\n      "}
            <div className="field">
              {"\n        "}
              <label htmlFor="grant-reason">{"Assignment Reason"}</label>
              {"\n        "}
              <input
                id="grant-reason"
                maxLength={300}
                placeholder="e.g. Account Delivery Lead delegation"
                required={true}
                value={value(model, "grant-reason")}
                onChange={(event) =>
                  change(model, "grant-reason", event.target.value)
                }
                disabled={disabled(model, "grant-reason", false)}
              />
              {"\n      "}
            </div>
            {"\n      "}
            <div className="dialog-actions">
              {"\n        "}
              <button
                type="submit"
                className="primary"
                id="add-lead"
                disabled={disabled(model, "add-lead", true)}
              >
                {"Assign Lead"}
              </button>
              {"\n      "}
            </div>
            {"\n    "}
          </form>
          {"\n\n    "}
          <form
            id="remove-form"
            className="dialog-subform danger-zone"
            hidden={hidden(model, "remove-form")}
            onSubmit={(event) => {
              event.preventDefault();
              if (event.currentTarget.reportValidity())
                submit(model, "remove-form");
            }}
          >
            {"\n      "}
            <h3 id="remove-title">{content(model, "remove-title")}</h3>
            {"\n      "}
            <div className="field">
              {"\n        "}
              <label htmlFor="remove-reason">{"Revocation Reason"}</label>
              {"\n        "}
              <input
                id="remove-reason"
                maxLength={300}
                placeholder="e.g. Account transition / roll-off"
                required={true}
                value={value(model, "remove-reason")}
                onChange={(event) =>
                  change(model, "remove-reason", event.target.value)
                }
                disabled={disabled(model, "remove-reason", false)}
              />
              {"\n      "}
            </div>
            {"\n      "}
            <div className="dialog-actions">
              {"\n        "}
              <button
                type="button"
                className="secondary"
                id="cancel-remove"
                disabled={disabled(model, "cancel-remove", false)}
                onClick={() => action(model, "cancel-remove")}
              >
                {"Cancel"}
              </button>
              {"\n        "}
              <button
                type="submit"
                className="primary danger-btn"
                id="remove-lead"
                disabled={disabled(model, "remove-lead", false)}
              >
                {"Confirm Removal"}
              </button>
              {"\n      "}
            </div>
            {"\n    "}
          </form>
          {"\n  "}
        </div>
        {"\n"}
      </Dialog>
      {"\n\n"}
      {"\n"}
      <Dialog
        className="app-dialog assign-dialog"
        id="assign-dialog"
        aria-labelledby="assign-title"
        open={!!model.dialogs["assign-dialog"]}
        onDismiss={() => model.close("assign-dialog")}
      >
        {"\n  "}
        <div className="dialog-heading">
          {"\n    "}
          <div className="dialog-title-group">
            {"\n      "}
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
            {"\n      "}
            <div>
              {"\n        "}
              <h2 id="assign-title">{"Assign guard"}</h2>
              {"\n        "}
              <span className="subtext-muted">
                {"Post a guard to a account gate"}
              </span>
              {"\n      "}
            </div>
            {"\n    "}
          </div>
          {"\n    "}
          <button
            type="button"
            data-close="assign-dialog"
            className="quiet dialog-close-btn"
            aria-label="Close guard assignment"
            disabled={disabled(model, "", false)}
            onClick={() => dataAction(model, "close", "assign-dialog")}
          >
            {"✕"}
          </button>
          {"\n  "}
        </div>
        {"\n  "}
        <form
          id="allocation-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (event.currentTarget.reportValidity())
              submit(model, "allocation-form");
          }}
        >
          {"\n    "}
          <div className="dialog-body">
            {"\n      "}
            <div
              id="allocation-kind-field"
              className="field"
              hidden={hidden(model, "allocation-kind-field")}
            >
              {"\n        "}
              <label htmlFor="allocation-kind">{"Assign using"}</label>
              {"\n        "}
              <select
                id="allocation-kind"
                value={value(model, "allocation-kind")}
                onChange={(event) =>
                  change(model, "allocation-kind", event.target.value)
                }
                disabled={disabled(model, "allocation-kind", false)}
              >
                <option value="project">{"Individual account"}</option>
                <option value="group">{"Account group"}</option>
              </select>
              {"\n      "}
            </div>
            {"\n      "}
            <div
              id="allocation-group-field"
              className="field"
              hidden={hidden(model, "allocation-group-field")}
            >
              {"\n        "}
              <label htmlFor="allocation-group">{"Account group"}</label>
              {"\n        "}
              <select
                id="allocation-group"
                value={value(model, "allocation-group")}
                onChange={(event) =>
                  change(model, "allocation-group", event.target.value)
                }
                disabled={disabled(model, "allocation-group", false)}
                required={model.field("allocation-kind") === "group"}
              >
                {options(model, "allocation-group")?.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
              {"\n        "}
              <p id="allocation-group-preview" className="hint">
                {content(model, "allocation-group-preview")}
              </p>
              {"\n      "}
            </div>
            {"\n      "}
            <div
              id="allocation-project-field"
              className="field"
              hidden={hidden(model, "allocation-project-field")}
            >
              {"\n        "}
              <label htmlFor="allocation-project">{"Account"}</label>
              {"\n        "}
              <select
                id="allocation-project"
                value={value(model, "allocation-project")}
                onChange={(event) =>
                  change(model, "allocation-project", event.target.value)
                }
                disabled={disabled(model, "allocation-project", false)}
                required={model.field("allocation-kind") !== "group"}
              >
                {options(model, "allocation-project")?.map((option) => (
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
            <div className="field">
              {"\n        "}
              <label htmlFor="allocation-guard">{"Guard"}</label>
              {"\n        "}
              <select
                id="allocation-guard"
                required={true}
                value={value(model, "allocation-guard")}
                onChange={(event) =>
                  change(model, "allocation-guard", event.target.value)
                }
                disabled={disabled(model, "allocation-guard", false)}
              >
                {options(model, "allocation-guard")?.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
              {"\n        "}
              <p id="allocation-hint" className="hint">
                {content(model, "allocation-hint")}
              </p>
              {"\n      "}
            </div>
            {"\n      "}
            <div className="field">
              {"\n        "}
              <span className="field-caption" id="allocation-period-label">
                {"Duty period"}
              </span>
              {"\n        "}
              <div
                className="chip-row"
                role="group"
                aria-labelledby="allocation-period-label"
              >
                {"\n          "}
                <button
                  type="button"
                  className="choice-chip"
                  data-until="none"
                  disabled={disabled(model, "", false)}
                  onClick={() => dataAction(model, "until", "none")}
                  aria-pressed={model.roster.allocationMode === "none"}
                >
                  {"Until removed"}
                </button>
                {"\n          "}
                <button
                  type="button"
                  className="choice-chip"
                  data-until="today"
                  disabled={disabled(model, "", false)}
                  onClick={() => dataAction(model, "until", "today")}
                  aria-pressed={model.roster.allocationMode === "today"}
                >
                  {"Today only"}
                </button>
                {"\n          "}
                <button
                  type="button"
                  className="choice-chip"
                  data-until="7"
                  disabled={disabled(model, "", false)}
                  onClick={() => dataAction(model, "until", "7")}
                  aria-pressed={model.roster.allocationMode === "7"}
                >
                  {"7 days"}
                </button>
                {"\n          "}
                <button
                  type="button"
                  className="choice-chip"
                  data-until="30"
                  disabled={disabled(model, "", false)}
                  onClick={() => dataAction(model, "until", "30")}
                  aria-pressed={model.roster.allocationMode === "30"}
                >
                  {"30 days"}
                </button>
                {"\n          "}
                <button
                  type="button"
                  className="choice-chip"
                  data-until="custom"
                  disabled={disabled(model, "", false)}
                  onClick={() => dataAction(model, "until", "custom")}
                  aria-pressed={model.roster.allocationMode === "custom"}
                >
                  {"Pick date"}
                </button>
                {"\n        "}
              </div>
              {"\n        "}
              <label className="sr-only" htmlFor="allocation-until">
                {"Valid until"}
              </label>
              {"\n        "}
              <input
                id="allocation-until"
                type="datetime-local"
                aria-describedby="allocation-timezone"
                hidden={hidden(model, "allocation-until")}
                value={value(model, "allocation-until")}
                onChange={(event) =>
                  change(model, "allocation-until", event.target.value)
                }
                disabled={disabled(model, "allocation-until", false)}
              />
              {"\n        "}
              <p id="allocation-timezone" className="hint">
                {"Duty dates and times use India Standard Time (IST)."}
              </p>
              {"\n      "}
            </div>
            {"\n      "}
            <div className="field">
              {"\n        "}
              <label htmlFor="allocation-reason">{"Reason"}</label>
              {"\n        "}
              <input
                id="allocation-reason"
                maxLength={300}
                placeholder="e.g. Shift assignment / gate cover"
                required={true}
                value={value(model, "allocation-reason")}
                onChange={(event) =>
                  change(model, "allocation-reason", event.target.value)
                }
                disabled={disabled(model, "allocation-reason", false)}
              />
              {"\n        "}
              <div
                className="chip-row"
                role="group"
                aria-label="Suggested reasons"
              >
                {"\n          "}
                <button
                  type="button"
                  className="choice-chip"
                  data-reason="Shift assignment"
                  disabled={disabled(model, "", false)}
                  onClick={() =>
                    dataAction(model, "reason", "Shift assignment")
                  }
                >
                  {"Shift assignment"}
                </button>
                {"\n          "}
                <button
                  type="button"
                  className="choice-chip"
                  data-reason="Gate cover"
                  disabled={disabled(model, "", false)}
                  onClick={() => dataAction(model, "reason", "Gate cover")}
                >
                  {"Gate cover"}
                </button>
                {"\n          "}
                <button
                  type="button"
                  className="choice-chip"
                  data-reason="Temporary cover"
                  disabled={disabled(model, "", false)}
                  onClick={() => dataAction(model, "reason", "Temporary cover")}
                >
                  {"Temporary cover"}
                </button>
                {"\n        "}
              </div>
              {"\n      "}
            </div>
            {"\n    "}
          </div>
          {"\n    "}
          <div className="dialog-actions dialog-actions-padded">
            {"\n      "}
            <button
              type="button"
              className="secondary"
              data-close="assign-dialog"
              disabled={disabled(model, "", false)}
              onClick={() => dataAction(model, "close", "assign-dialog")}
            >
              {"Cancel"}
            </button>
            {"\n      "}
            <button
              id="allocate-button"
              className="primary"
              type="submit"
              disabled={disabled(model, "allocate-button", false)}
            >
              {"Assign guard"}
            </button>
            {"\n    "}
          </div>
          {"\n  "}
        </form>
        {"\n"}
      </Dialog>
      {"\n\n"}
      <Dialog
        id="project-group-dialog"
        className="app-dialog"
        aria-labelledby="project-group-title"
        open={!!model.dialogs["project-group-dialog"]}
        onDismiss={() => model.close("project-group-dialog")}
      >
        {"\n  "}
        <div className="dialog-heading">
          <h2 id="project-group-title">
            {content(model, "project-group-title")}
          </h2>
          <button
            type="button"
            className="quiet dialog-close-btn"
            data-close="project-group-dialog"
            aria-label="Close account group"
            disabled={disabled(model, "", false)}
            onClick={() => dataAction(model, "close", "project-group-dialog")}
          >
            {"✕"}
          </button>
        </div>
        {"\n  "}
        <form
          id="project-group-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (event.currentTarget.reportValidity())
              submit(model, "project-group-form");
          }}
        >
          {"\n    "}
          <div className="dialog-body">
            {"\n      "}
            <div className="field">
              <label htmlFor="project-group-name">{"Group name"}</label>
              <input
                id="project-group-name"
                required={true}
                maxLength={100}
                placeholder="e.g. Floor 11 — Main Entry"
                value={value(model, "project-group-name")}
                onChange={(event) =>
                  change(model, "project-group-name", event.target.value)
                }
                disabled={disabled(model, "project-group-name", false)}
              />
            </div>
            {"\n      "}
            <fieldset>
              <legend>{"Accounts in this office"}</legend>
              <p className="hint">
                {
                  "Select 1–50 accounts. Existing individual assignments remain available."
                }
              </p>
              <div id="project-group-members" className="group-project-options">
                {content(model, "project-group-members")}
              </div>
            </fieldset>
            {"\n      "}
            <p id="project-group-impact" className="hint" role="status">
              {content(model, "project-group-impact")}
            </p>
            {"\n      "}
            <div className="field">
              <label htmlFor="project-group-reason">{"Reason"}</label>
              <input
                id="project-group-reason"
                required={true}
                maxLength={300}
                placeholder="e.g. Floor entry coverage"
                value={value(model, "project-group-reason")}
                onChange={(event) =>
                  change(model, "project-group-reason", event.target.value)
                }
                disabled={disabled(model, "project-group-reason", false)}
              />
            </div>
            {"\n    "}
          </div>
          {"\n    "}
          <div className="dialog-actions dialog-actions-padded">
            <button
              type="button"
              className="secondary"
              data-close="project-group-dialog"
              disabled={disabled(model, "", false)}
              onClick={() => dataAction(model, "close", "project-group-dialog")}
            >
              {"Cancel"}
            </button>
            <button
              id="project-group-save"
              type="submit"
              className="primary"
              disabled={disabled(model, "project-group-save", false)}
            >
              {content(model, "project-group-save")}
            </button>
          </div>
          {"\n  "}
        </form>
        {"\n"}
      </Dialog>
      {"\n\n"}
      {"\n"}
      <Dialog
        className="app-dialog common-dialog"
        id="common-dialog"
        aria-labelledby="common-title"
        open={!!model.dialogs["common-dialog"]}
        onDismiss={() => model.close("common-dialog")}
      >
        {"\n  "}
        <div className="dialog-heading">
          {"\n    "}
          <div className="dialog-title-group">
            {"\n      "}
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M3 21h18M6 21V3h12v18M9 7h6M9 11h6M10 21v-5h4v5"></path>
            </svg>
            {"\n      "}
            <div>
              {"\n        "}
              <h2 id="common-title">{content(model, "common-title")}</h2>
              {"\n        "}
              <span className="subtext-muted">
                {"Manage guards assigned to this common area"}
              </span>
              {"\n      "}
            </div>
            {"\n    "}
          </div>
          {"\n    "}
          <button
            id="common-close"
            type="button"
            className="quiet dialog-close-btn"
            aria-label="Close common areas"
            disabled={disabled(model, "common-close", false)}
            onClick={() => action(model, "common-close")}
          >
            {"✕"}
          </button>
          {"\n  "}
        </div>
        {"\n  "}
        <div className="dialog-body">
          {"\n    "}
          <p id="common-status" role="status">
            {content(model, "common-status")}
          </p>
          {"\n\n    "}
          {"\n    "}
          <div
            className="dialog-segmented-nav"
            role="tablist"
            aria-label="Common Area Views"
          >
            {"\n      "}
            <button
              type="button"
              data-common-tab="duties"
              role="tab"
              disabled={disabled(model, "", false)}
              onClick={() => dataAction(model, "common-tab", "duties")}
              aria-selected={model.accounts.commonTab === "duties"}
              className={
                "dialog-tab-btn" +
                (model.accounts.commonTab === "duties" ? " active" : "")
              }
            >
              {"Assigned Guards"}
            </button>
            {"\n      "}
            <button
              type="button"
              data-common-tab="assign"
              role="tab"
              disabled={disabled(model, "", false)}
              onClick={() => dataAction(model, "common-tab", "assign")}
              aria-selected={model.accounts.commonTab === "assign"}
              className={
                "dialog-tab-btn" +
                (model.accounts.commonTab === "assign" ? " active" : "")
              }
            >
              {"Assign guard"}
            </button>
            {"\n    "}
          </div>
          {"\n\n    "}
          {"\n    "}
          <div
            id="common-view-duties"
            className="common-tab-content"
            hidden={hidden(model, "common-view-duties")}
          >
            {"\n      "}
            <div id="common-assignments" className="common-assignments-list">
              {content(model, "common-assignments")}
            </div>
            {"\n      "}
            <button
              id="common-more"
              type="button"
              className="secondary load-more-btn"
              hidden={hidden(model, "common-more")}
              disabled={disabled(model, "common-more", false)}
              onClick={() => action(model, "common-more")}
            >
              {"Load more"}
            </button>
            {"\n    "}
          </div>
          {"\n\n    "}
          {"\n    "}
          <form
            id="common-assign"
            className="common-tab-content"
            hidden={hidden(model, "common-assign")}
            onSubmit={(event) => {
              event.preventDefault();
              if (event.currentTarget.reportValidity())
                submit(model, "common-assign");
            }}
          >
            {"\n      "}
            <h3>{"Assign guard to common area"}</h3>
            {"\n      "}
            <div className="field">
              {"\n        "}
              <label htmlFor="common-area">{"Common area"}</label>
              {"\n        "}
              <select
                id="common-area"
                required={true}
                value={value(model, "common-area")}
                onChange={(event) =>
                  change(model, "common-area", event.target.value)
                }
                disabled={disabled(model, "common-area", false)}
              >
                {options(model, "common-area")?.map((option) => (
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
            <div className="field">
              {"\n        "}
              <label htmlFor="common-guard-search">{"Search guard"}</label>
              {"\n        "}
              <input
                id="common-guard-search"
                type="search"
                autoComplete="off"
                maxLength={80}
                placeholder="Type guard name..."
                value={value(model, "common-guard-search")}
                onChange={(event) =>
                  change(model, "common-guard-search", event.target.value)
                }
                disabled={disabled(model, "common-guard-search", false)}
              />
              {"\n        "}
              <div
                id="common-guard-results"
                role="group"
                aria-label="Matching guards"
              >
                {content(model, "common-guard-results")}
              </div>
              {"\n        "}
              <p id="common-selected" className="hint">
                {content(model, "common-selected")}
              </p>
              {"\n      "}
            </div>
            {"\n      "}
            <div className="field">
              {"\n        "}
              <label htmlFor="common-assign-reason">{"Reason"}</label>
              {"\n        "}
              <input
                id="common-assign-reason"
                maxLength={300}
                placeholder="e.g. Reception patrol or gate duty"
                required={true}
                value={value(model, "common-assign-reason")}
                onChange={(event) =>
                  change(model, "common-assign-reason", event.target.value)
                }
                disabled={disabled(model, "common-assign-reason", false)}
              />
              {"\n      "}
            </div>
            {"\n      "}
            <div className="dialog-actions">
              {"\n        "}
              <button
                id="common-assign-button"
                type="submit"
                className="primary"
                disabled={disabled(model, "common-assign-button", true)}
              >
                {"Assign guard"}
              </button>
              {"\n      "}
            </div>
            {"\n    "}
          </form>
          {"\n\n    "}
          {"\n    "}
          <form
            id="common-remove"
            className="danger-zone"
            hidden={hidden(model, "common-remove")}
            onSubmit={(event) => {
              event.preventDefault();
              if (event.currentTarget.reportValidity())
                submit(model, "common-remove");
            }}
          >
            {"\n      "}
            <h3 id="common-remove-title">
              {content(model, "common-remove-title")}
            </h3>
            {"\n      "}
            <div className="field">
              {"\n        "}
              <label htmlFor="common-remove-reason">{"Reason"}</label>
              {"\n        "}
              <input
                id="common-remove-reason"
                maxLength={300}
                placeholder="e.g. Duty reassignment"
                required={true}
                value={value(model, "common-remove-reason")}
                onChange={(event) =>
                  change(model, "common-remove-reason", event.target.value)
                }
                disabled={disabled(model, "common-remove-reason", false)}
              />
              {"\n      "}
            </div>
            {"\n      "}
            <div className="dialog-actions">
              {"\n        "}
              <button
                id="common-cancel-remove"
                type="button"
                className="secondary"
                disabled={disabled(model, "common-cancel-remove", false)}
                onClick={() => action(model, "common-cancel-remove")}
              >
                {"Cancel"}
              </button>
              {"\n        "}
              <button
                type="submit"
                className="primary danger-btn"
                disabled={disabled(model, "", false)}
              >
                {"Remove duty"}
              </button>
              {"\n      "}
            </div>
            {"\n    "}
          </form>
          {"\n  "}
        </div>
        {"\n"}
      </Dialog>
      {"\n\n"}
      {"\n"}
      <Dialog
        className="app-dialog qr-dialog"
        id="qr-dialog"
        closedby="any"
        aria-labelledby="qr-modal-title"
        open={!!model.dialogs["qr-dialog"]}
        onDismiss={() => model.close("qr-dialog")}
      >
        {"\n  "}
        <div className="dialog-heading">
          {"\n    "}
          <div className="dialog-title-group">
            {"\n      "}
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="7" height="7"></rect>
              <rect x="14" y="3" width="7" height="7"></rect>
              <rect x="14" y="14" width="7" height="7"></rect>
              <rect x="3" y="14" width="7" height="7"></rect>
            </svg>
            {"\n      "}
            <div>
              {"\n        "}
              <h2 id="qr-modal-title">{content(model, "qr-modal-title")}</h2>
              {"\n        "}
              <span className="subtext-muted">
                {"Touchless Digital ID & Visitor Signage"}
              </span>
              {"\n      "}
            </div>
            {"\n    "}
          </div>
          {"\n    "}
          <button
            type="button"
            className="quiet dialog-close-btn"
            data-close="qr-dialog"
            aria-label="Close registration standee"
            disabled={disabled(model, "", false)}
            onClick={() => dataAction(model, "close", "qr-dialog")}
          >
            {"✕"}
          </button>
          {"\n  "}
        </div>
        {"\n  "}
        <div className="dialog-body qr-modal-body">
          {"\n    "}
          {"\n    "}
          <div
            id="qr-poster"
            className="qr-poster-card"
            role="region"
            aria-label="Office registration standee poster"
          >
            {"\n      "}
            <div className="poster-accent-bar"></div>
            {"\n\n      "}
            <div className="poster-brand-center">
              {"\n        "}
              <img
                src={config.companyLogo}
                width="200"
                alt="Sopra Steria"
                className="poster-company-logo"
              />
              {"\n      "}
            </div>
            {"\n\n      "}
            <div className="poster-welcome-styled">
              {"\n        "}
              <span className="poster-welcomes-script">{"welcomes you"}</span>
              {"\n        "}
              <span id="qr-poster-location" className="poster-location-subtle">
                {content(model, "qr-poster-location")}
              </span>
              {"\n        "}
              <span id="qr-title" hidden={true}>
                {content(model, "qr-title")}
              </span>
              {"\n      "}
            </div>
            {"\n\n      "}
            <div className="poster-qr-frame">
              {"\n        "}
              <img
                id="qr-image"
                width="280"
                height="280"
                alt="Office registration QR code"
                className="poster-qr-img"
                src={model.records.qr?.dataUrl}
              />
              {"\n      "}
            </div>
            {"\n\n      "}
            <div className="poster-scan-pill">
              {"\n        "}
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                <circle cx="12" cy="13" r="4"></circle>
              </svg>
              {"\n        "}
              <span>{"Scan the above QR to get your Digital Pass"}</span>
              {"\n      "}
            </div>
            {"\n\n      "}
            <div className="poster-footer">
              {"\n        "}
              <div className="poster-url-row">
                {"\n          "}
                <span className="poster-url-label">
                  {"Unable to scan? Visit:"}
                </span>
                {"\n          "}
                <span id="qr-link" className="poster-url-value">
                  {content(model, "qr-link")}
                </span>
                {"\n        "}
              </div>
              {"\n        "}
              <p className="poster-help-text">
                {"You can ask reception for help"}
              </p>
              {"\n      "}
            </div>
            {"\n    "}
          </div>
          {"\n\n    "}
          {"\n    "}
          <div className="qr-modal-actions">
            {"\n      "}
            <div className="qr-btn-group">
              {"\n        "}
              <button
                id="qr-download-poster"
                type="button"
                className="primary qr-action-btn"
                disabled={disabled(model, "qr-download-poster", false)}
                onClick={() => {
                  const qr = model.records.qr;
                  if (qr)
                    void downloadPosterPng(
                      qr.office,
                      qr.dataUrl,
                      qr.locationName,
                      qr.url,
                      document.querySelector<HTMLImageElement>(
                        ".poster-company-logo",
                      ),
                      document.querySelector<HTMLImageElement>("#qr-image"),
                      getComputedStyle(
                        document.querySelector(".poster-welcomes-script")!,
                      ).fontFamily,
                    );
                }}
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
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                {"\n          "}
                <span>{"Download Poster (PNG)"}</span>
                {"\n        "}
              </button>
              {"\n        "}
              <button
                id="qr-print-pdf"
                type="button"
                className="secondary qr-action-btn"
                disabled={disabled(model, "qr-print-pdf", false)}
                onClick={() => action(model, "qr-print-pdf")}
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
                  <path d="M6 9V2h12v7"></path>
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                  <rect x="6" y="14" width="12" height="8"></rect>
                </svg>
                {"\n          "}
                <span>{"Print / Save PDF"}</span>
                {"\n        "}
              </button>
              {"\n      "}
            </div>
            {"\n      "}
            <div className="qr-secondary-row">
              {"\n        "}
              <a
                id="qr-download"
                className="qr-raw-link"
                title="Download raw QR only"
                href={model.records.qr?.dataUrl}
                download={
                  model.records.qr
                    ? "GatePass-" +
                      model.records.qr.office.locationCode +
                      "-QR.png"
                    : "office-qr.png"
                }
              >
                {"\n          "}
                <svg
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                {"\n          "}
                <span>{"Download bare QR code only (PNG)"}</span>
                {"\n        "}
              </a>
              {"\n      "}
            </div>
            {"\n    "}
          </div>
          {"\n  "}
        </div>
        {"\n"}
      </Dialog>
      {"\n\n"}
      <Dialog
        id="add-staff-dialog"
        className="app-dialog"
        aria-labelledby="add-staff-title"
        open={!!model.dialogs["add-staff-dialog"]}
        onDismiss={() => model.close("add-staff-dialog")}
      >
        <div className="dialog-heading">
          <h2 id="add-staff-title">{content(model, "add-staff-title")}</h2>
          <button
            id="close-add-staff"
            className="quiet dialog-close-btn"
            type="button"
            aria-label="Close account creation"
            disabled={disabled(model, "close-add-staff", false)}
            onClick={() => action(model, "close-add-staff")}
          >
            {"×"}
          </button>
        </div>
        <div className="dialog-body">
          <form
            id="add-staff-form"
            hidden={hidden(model, "add-staff-form")}
            onSubmit={(event) => {
              event.preventDefault();
              if (event.currentTarget.reportValidity())
                submit(model, "add-staff-form");
            }}
          >
            <p id="new-staff-help" className="hint">
              {content(model, "new-staff-help")}
            </p>
            <div className="admin-form-grid">
              <div className="field">
                <label htmlFor="new-staff-name">{"Full name"}</label>
                <input
                  id="new-staff-name"
                  maxLength={200}
                  required={true}
                  autoComplete="off"
                  value={value(model, "new-staff-name")}
                  onChange={(event) =>
                    change(model, "new-staff-name", event.target.value)
                  }
                  disabled={disabled(model, "new-staff-name", false)}
                />
              </div>
              <div className="field">
                <label htmlFor="new-staff-login">{"Login / Staff ID"}</label>
                <input
                  id="new-staff-login"
                  minLength={3}
                  maxLength={64}
                  required={true}
                  autoComplete="off"
                  autoCapitalize="none"
                  placeholder="sec-noi-001"
                  value={value(model, "new-staff-login")}
                  onChange={(event) =>
                    change(model, "new-staff-login", event.target.value)
                  }
                  disabled={disabled(model, "new-staff-login", false)}
                />
              </div>
              <div className="field">
                <label htmlFor="new-staff-role">{"Role"}</label>
                <select
                  id="new-staff-role"
                  required={true}
                  value={value(model, "new-staff-role")}
                  onChange={(event) =>
                    change(model, "new-staff-role", event.target.value)
                  }
                  disabled={disabled(model, "new-staff-role", false)}
                >
                  {options(model, "new-staff-role")?.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p id="new-staff-scope" className="hint">
              {content(model, "new-staff-scope")}
            </p>
            <fieldset
              id="new-staff-capabilities"
              className="capabilities-fieldset"
            >
              {content(model, "new-staff-capabilities")}
            </fieldset>
            <label
              id="new-guard-project-label"
              hidden={hidden(model, "new-guard-project-label")}
            >
              <input
                id="new-guard-project"
                type="checkbox"
                checked={!!model.checks["new-guard-project"]}
                onChange={(event) =>
                  model.check("new-guard-project", event.target.checked)
                }
                disabled={disabled(model, "new-guard-project", false)}
              />
              {" Assign to the selected account now"}
            </label>
            <div className="field">
              <label htmlFor="new-staff-reason">
                {"Reason for adding this account"}
              </label>
              <input
                id="new-staff-reason"
                maxLength={300}
                required={true}
                value={value(model, "new-staff-reason")}
                onChange={(event) =>
                  change(model, "new-staff-reason", event.target.value)
                }
                disabled={disabled(model, "new-staff-reason", false)}
              />
            </div>
            <button
              id="new-staff-submit"
              type="submit"
              className="primary"
              disabled={disabled(model, "new-staff-submit", false)}
            >
              {"Create account"}
            </button>
          </form>
          <form
            id="staff-reset-form"
            hidden={hidden(model, "staff-reset-form")}
            onSubmit={(event) => {
              event.preventDefault();
              if (event.currentTarget.reportValidity())
                submit(model, "staff-reset-form");
            }}
          >
            <p id="reset-staff-copy">{content(model, "reset-staff-copy")}</p>
            <div className="field">
              <label htmlFor="staff-reset-reason">
                {"Reason for password reset"}
              </label>
              <input
                id="staff-reset-reason"
                maxLength={300}
                required={true}
                value={value(model, "staff-reset-reason")}
                onChange={(event) =>
                  change(model, "staff-reset-reason", event.target.value)
                }
                disabled={disabled(model, "staff-reset-reason", false)}
              />
            </div>
            <button
              id="staff-reset-submit"
              type="submit"
              className="primary"
              disabled={disabled(model, "staff-reset-submit", false)}
            >
              {"Generate new setup link"}
            </button>
          </form>
          <p id="new-staff-status" role="status">
            {content(model, "new-staff-status")}
          </p>
          <section
            id="new-staff-result"
            hidden={hidden(model, "new-staff-result")}
          >
            <h3>{"Account ready for password setup"}</h3>
            <p id="new-staff-summary">{content(model, "new-staff-summary")}</p>
            <p id="new-staff-expiry" className="hint">
              {content(model, "new-staff-expiry")}
            </p>
            <label htmlFor="new-staff-link">
              {"One-time password setup link"}
            </label>
            <input
              id="new-staff-link"
              readOnly={true}
              autoComplete="off"
              value={value(model, "new-staff-link")}
              onChange={(event) =>
                change(model, "new-staff-link", event.target.value)
              }
              disabled={disabled(model, "new-staff-link", false)}
            />
            <button
              id="copy-staff-setup"
              className="secondary"
              type="button"
              disabled={disabled(model, "copy-staff-setup", false)}
              onClick={() => action(model, "copy-staff-setup")}
            >
              {"Copy setup link"}
            </button>
            <p className="hint">
              {
                "Share this link directly with the staff member. It can be used once, within 15 minutes. They choose their own password; no email is sent automatically."
              }
            </p>
          </section>
        </div>
      </Dialog>
      {"\n"}
      <Dialog
        id="add-project-dialog"
        className="app-dialog"
        aria-labelledby="add-project-title"
        open={!!model.dialogs["add-project-dialog"]}
        onDismiss={() => model.close("add-project-dialog")}
      >
        {"\n  "}
        <div className="dialog-heading">
          <h2 id="add-project-title">{"Add account or common area"}</h2>
          <button
            id="close-add-project"
            className="quiet dialog-close-btn"
            type="button"
            aria-label="Close creation"
            disabled={disabled(model, "close-add-project", false)}
            onClick={() => action(model, "close-add-project")}
          >
            {"×"}
          </button>
        </div>
        {"\n  "}
        <div className="dialog-body">
          <form
            id="add-project-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (event.currentTarget.reportValidity())
                submit(model, "add-project-form");
            }}
          >
            {"\n    "}
            <p id="new-project-office" className="hint">
              {content(model, "new-project-office")}
            </p>
            {"\n    "}
            <div className="field">
              <label htmlFor="new-workspace-type">{"Type"}</label>
              <select
                id="new-workspace-type"
                required={true}
                value={value(model, "new-workspace-type")}
                onChange={(event) =>
                  change(model, "new-workspace-type", event.target.value)
                }
                disabled={disabled(model, "new-workspace-type", false)}
              >
                {options(model, "new-workspace-type")?.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {"\n    "}
            <div className="field">
              <label htmlFor="new-project-name">
                {model.field("new-workspace-type") === "project"
                  ? "Account name"
                  : "Area name"}
              </label>
              <input
                id="new-project-name"
                required={true}
                autoComplete="off"
                value={value(model, "new-project-name")}
                onChange={(event) =>
                  change(model, "new-project-name", event.target.value)
                }
                disabled={disabled(model, "new-project-name", false)}
                maxLength={
                  model.field("new-workspace-type") === "project" ? 200 : 100
                }
                placeholder={
                  model.field("new-workspace-type") === "project"
                    ? "Digital Workplace Transformation"
                    : "Main reception lobby"
                }
              />
            </div>
            {"\n    "}
            <div
              id="new-project-code-field"
              className="field"
              hidden={hidden(model, "new-project-code-field")}
            >
              <label htmlFor="new-project-code">{"Account code"}</label>
              <input
                id="new-project-code"
                minLength={3}
                maxLength={64}
                pattern="[A-Z0-9][A-Z0-9._\\-]{2,63}"
                autoComplete="off"
                autoCapitalize="characters"
                aria-describedby="new-project-code-help"
                placeholder="DWT-NOI"
                value={value(model, "new-project-code")}
                onChange={(event) =>
                  change(model, "new-project-code", event.target.value)
                }
                disabled={disabled(model, "new-project-code", false)}
                required={model.field("new-workspace-type") === "project"}
              />
              <p id="new-project-code-help" className="hint">
                {
                  "Use a unique code with uppercase letters, numbers, dots, hyphens or underscores."
                }
              </p>
            </div>
            {"\n    "}
            <div className="field">
              <label htmlFor="new-project-reason">
                {model.field("new-workspace-type") === "project"
                  ? "Reason for adding this account"
                  : "Reason for adding this area"}
              </label>
              <input
                id="new-project-reason"
                maxLength={300}
                required={true}
                autoComplete="off"
                value={value(model, "new-project-reason")}
                onChange={(event) =>
                  change(model, "new-project-reason", event.target.value)
                }
                disabled={disabled(model, "new-project-reason", false)}
              />
            </div>
            {"\n    "}
            <p id="new-project-help" className="hint">
              {content(model, "new-project-help")}
            </p>
            {"\n    "}
            <p id="new-project-status" role="status">
              {content(model, "new-project-status")}
            </p>
            {"\n    "}
            <button
              id="new-project-submit"
              type="submit"
              className="primary"
              disabled={disabled(model, "new-project-submit", false)}
            >
              {content(model, "new-project-submit")}
            </button>
            {"\n  "}
          </form>
        </div>
        {"\n"}
      </Dialog>
      {"\n"}
      {"\n"}
      <HostDialog model={model} />
      <Notices items={model.notices} dismiss={model.dismiss} />
    </>
  );
}
