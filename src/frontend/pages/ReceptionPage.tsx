import { useState, useRef, useEffect } from "react";
import { useModel } from "../shared/model.ts";
import { createReceptionModel } from "../reception/model.ts";
import {
  Badge,
  CardStatus,
  RegistrationRows,
  HistoryRows,
  ReadOnlyCard,
  DetailFields,
  Eye,
} from "../reception/components.tsx";
import {
  effective,
  kind,
  deviceLabels,
  type ReceptionVisit,
} from "../reception/types.ts";
import { Dialog, Select } from "../shared/controls.tsx";
import { ReceptionTimeline } from "../reception/Timeline.tsx";
import { QrScanner } from "../shared/QrScanner.tsx";
import { Notices } from "../shared/Notices.tsx";
import { ImageViewer } from "../shared/ImageViewer.tsx";
import { ActionCentre } from "../shared/ActionCentre.tsx";
import type { PageProps } from "../types.ts";
export default function ReceptionPage({ config }: PageProps) {
  const [model, ui] = useModel(createReceptionModel),
    [scanner, setScanner] = useState(false),
    manualFrame = useRef<HTMLIFrameElement>(null),
    session = useRef<HTMLDivElement>(null),
    toggle = useRef<HTMLButtonElement>(null);
  const v = ui.detail,
    row = ui.selected,
    c = model.counts(),
    matching = model.matchingRows(),
    complete = ui.listComplete && !ui.listFailed,
    counter = (n: number) =>
      complete || ui.rows.length ? String(n) : ui.listFailed ? "—" : "…",
    dateBase = ui.context
      ? Date.parse(ui.context.currentDate + "T12:00:00Z")
      : Date.now(),
    minDate = new Date(dateBase - 30 * 86400000).toISOString().slice(0, 10),
    maxDate = new Date(dateBase + 90 * 86400000).toISOString().slice(0, 10);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
        if (
          event.origin !== location.origin ||
          event.source !== manualFrame.current?.contentWindow
        )
          return;
        if (event.data?.type === "gatepass-manual-close") model.closeManual();
        if (event.data?.type === "gatepass-manual-submitted")
          void model.loadVisits();
      },
      outside = (event: MouseEvent) => {
        if (!session.current?.contains(event.target as Node))
          model.closeAccount();
      };
    window.addEventListener("message", receive);
    document.addEventListener("click", outside);
    return () => {
      window.removeEventListener("message", receive);
      document.removeEventListener("click", outside);
    };
  }, [model]);
  useEffect(() => {
    if (!ui.dashboard || ui.accessDenied || ui.visitOpen) setScanner(false);
  }, [ui.dashboard, ui.accessDenied, ui.visitOpen]);
  return (
    <>
      {"\n"}
      <a className="skip" href="#workspace">
        {"Skip to content"}
      </a>
      {"\n\n"}
      <header className="reception-header">
        {"\n  "}
        <div className="shell">
          {"\n    "}
          <div className="identity">
            {"\n      "}
            <img
              className="brand-img"
              src={config.companyLogo}
              alt="Sopra Steria"
            />
            {"\n\n    "}
          </div>
          {"\n    "}
          <div className="top-right">
            {"\n      "}
            <div
              className="office-badge"
              id="office-badge"
              title="Current Office"
            >
              {"\n        "}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <path d="M12 21s7-4.6 7-10a7 7 0 0 0-14 0c0 5.4 7 10 7 10Z"></path>
                <circle cx="12" cy="11" r="2.5"></circle>
              </svg>
              {"\n        "}
              <span id="office-name">{ui.location?.locationName ?? ""}</span>
              {"\n      "}
            </div>
            {"\n      "}
            <div
              id="office-selector"
              className="office-select-wrap"
              hidden={(ui.context?.locations.length ?? 0) < 2}
            >
              {"\n        "}
              <label className="sr-only" htmlFor="reception-location">
                {"Office"}
              </label>
              {"\n        "}
              <Select
                id="reception-location"
                className="select-office"
                value={String(ui.location?.locationId ?? "")}
                onValue={model.selectOffice}
                label={"Office"}
                disabled={ui.printBusy || ui.returnBusy}
              >
                {ui.context?.locations.map((office) => (
                  <option
                    key={office.locationId}
                    value={String(office.locationId)}
                  >
                    {office.locationName}
                  </option>
                ))}
              </Select>
              {"\n      "}
            </div>
            {"\n      "}
            <div
              id="staff-session"
              className="staff-user-menu"
              hidden={!ui.context}
              ref={session}
            >
              {"\n        "}
              <button
                id="account-toggle"
                className="account-toggle"
                type="button"
                aria-label="Account menu"
                aria-haspopup="menu"
                ref={toggle}
                aria-expanded={ui.accountOpen}
                onClick={model.toggleAccount}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="8" r="4"></circle>
                  <path d="M4 22v-2a8 8 0 0 1 16 0v2"></path>
                </svg>
              </button>
              {"\n        "}
              <div
                id="account-menu"
                className="account-menu"
                role="menu"
                hidden={!ui.accountOpen}
                onKeyDown={(event) => {
                  const buttons = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      "button",
                    ),
                  ];
                  if (event.key === "Escape") {
                    model.closeAccount();
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
                    ].focus();
                  }
                }}
              >
                <strong id="staff-name">{ui.context?.displayName ?? ""}</strong>
                <button
                  id="open-profile"
                  role="menuitem"
                  type="button"
                  onClick={() => void model.openProfile()}
                >
                  {"Profile"}
                </button>
                <button
                  id="staff-logout"
                  role="menuitem"
                  type="button"
                  onClick={() => void model.logout()}
                >
                  {"Sign out"}
                </button>
              </div>
              {"\n      "}
            </div>
            {"\n    "}
          </div>
          {"\n  "}
        </div>
        {"\n"}
      </header>
      {"\n\n"}
      <main id="workspace" className="reception-workspace shell" tabIndex={-1}>
        {"\n  "}
        <p
          id="staff-loading"
          role="status"
          className="loading-state"
          hidden={!!ui.context}
        >
          {ui.loadingMessage}
        </p>
        {"\n\n  "}
        <section id="reception-dashboard" hidden={!ui.dashboard}>
          {"\n    "}
          <div className="heading">
            {"\n      "}
            <div>
              {"\n        "}
              <h1>{"Reception"}</h1>
              {"\n        "}
              <span
                className="today-label"
                id="todayLabel"
                hidden={true}
              ></span>
              {"\n      "}
            </div>
            {"\n      "}
            <div className="reception-lookup">
              {"\n        "}
              <form
                id="lookup-form"
                className="reception-lookup-form"
                role="search"
                aria-label="Find a visit across dates"
                onSubmit={(event) => {
                  event.preventDefault();
                  model.submitLookup();
                }}
              >
                {"\n          "}
                <label className="sr-only" htmlFor="lookup-search">
                  {"Find pass, name, mobile or employee ID across dates"}
                </label>
                {"\n          "}
                <input
                  id="lookup-search"
                  type="search"
                  maxLength={100}
                  autoComplete="off"
                  placeholder="Find pass, name, mobile or employee ID"
                  value={ui.lookupSearch}
                  onChange={(event) => model.setLookup(event.target.value)}
                />
                {"\n\n\n        "}
              </form>
              {"\n        "}
              <div
                id="lookup-panel"
                className="reception-lookup-panel"
                hidden={!ui.lookupOpen}
              >
                <p id="lookup-status" role="status">
                  {ui.lookupStatus}
                </p>
                <div id="lookup-results">
                  {ui.lookupRows.map((row) => (
                    <button
                      key={row.visitRequestId}
                      type="button"
                      className="lookup-match"
                      onClick={() =>
                        void model.openVisit({ ...row, printCount: 0 })
                      }
                    >
                      <strong>{row.personName}</strong>
                      <span>
                        {row.publicPassNumber +
                          " \u00B7 " +
                          new Intl.DateTimeFormat("en-IN", {
                            timeZone: "Asia/Kolkata",
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(
                            new Date(row.submittedAtUtc ?? row.validFromUtc),
                          ) +
                          " \u00B7 " +
                          kind(row)}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  id="lookup-more"
                  type="button"
                  className="btn outline"
                  hidden={!ui.lookupCursor}
                  disabled={ui.lookupBusy}
                  onClick={() => void model.lookupVisits(false, true)}
                >
                  {"More matches"}
                </button>
                <button
                  id="lookup-clear"
                  type="button"
                  className="btn outline"
                  onClick={model.clearLookup}
                >
                  {"Close results"}
                </button>
              </div>
              {"\n      "}
            </div>
            {"\n      "}
            <div className="reception-date-controls">
              {"\n        "}
              <div className="reception-date">
                {"\n          "}
                <input
                  id="reception-date"
                  type="hidden"
                  value={ui.visitDate}
                  min={minDate}
                  max={maxDate}
                  onChange={(event) => model.setVisitDate(event.target.value)}
                />
                <button
                  id="today"
                  type="button"
                  hidden={true}
                  disabled={ui.calendarBusy}
                  onClick={() => void model.refreshCalendar(true)}
                >
                  {"Today"}
                </button>
                <button
                  id="open-history"
                  className="btn outline"
                  type="button"
                  onClick={model.openHistory}
                >
                  {"History"}
                </button>
                {"\n          "}
                <button
                  id="refresh"
                  className="btn outline icon-action"
                  type="button"
                  aria-label="Refresh visits"
                  title="Refresh visits"
                  disabled={ui.listBusy}
                  onClick={() => void model.loadVisits()}
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
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <polyline points="1 20 1 14 7 14"></polyline>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                  </svg>
                  {"\n          "}
                </button>
                <ActionCentre
                  resetKey={
                    ui.initializeVersion + ":" + ui.location?.locationId
                  }
                  scope={async () =>
                    model.state.context &&
                    model.state.location &&
                    !model.state.accessDenied
                      ? {
                          body: {
                            workspace: "RECEPTION",
                            locationId: model.state.location.locationId,
                            dutyKind: "OFFICE",
                            dutyId: "0",
                          },
                          label: model.state.location.locationName,
                        }
                      : null
                  }
                  openRecord={(row) => {
                    void model.openRecord(row);
                  }}
                />
                {"\n        "}
              </div>
              {"\n      "}
            </div>
            {"\n    "}
          </div>
          {"\n\n    "}
          {"\n    "}
          <section className="kpis" aria-label="Registration KPIs">
            {"\n      "}
            <div
              id="kpi-total"
              role="button"
              tabIndex={0}
              title="Click to view all registrations"
              onClick={() => model.kpi("total")}
              onKeyDown={(event) => {
                if (["Enter", " "].includes(event.key)) {
                  event.preventDefault();
                  model.kpi("total");
                }
              }}
              className={
                "kpi" +
                (!ui.insideOnly &&
                !ui.pendingReturns &&
                ui.status === "ALL" &&
                ui.printFilter === "ALL"
                  ? " active-kpi"
                  : "")
              }
            >
              {"\n        "}
              <div>
                {"\n          "}
                <div className="kpi-value" id="stat-total">
                  {counter(c.total)}
                </div>
                {"\n          "}
                <div className="kpi-label">{"Registered"}</div>
                {"\n        "}
              </div>
              {"\n        "}
              <div className="kpi-icon kpi-total" aria-hidden="true">
                {"\n          "}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                >
                  <circle cx="9" cy="8" r="3"></circle>
                  <path d="M3 20v-2c0-3 3-5 6-5s6 2 6 5v2M17 11a3 3 0 0 0 0-6M17 14c3 0 4 2 4 4v2"></path>
                </svg>
                {"\n        "}
              </div>
              {"\n      "}
            </div>
            {"\n      "}
            <div
              id="kpi-pending"
              role="button"
              tabIndex={0}
              title="Click to filter Pending Approvals"
              onClick={() => model.kpi("pending")}
              onKeyDown={(event) => {
                if (["Enter", " "].includes(event.key)) {
                  event.preventDefault();
                  model.kpi("pending");
                }
              }}
              className={
                "kpi" +
                (!ui.insideOnly && !ui.pendingReturns && ui.status === "PENDING"
                  ? " active-kpi"
                  : "")
              }
            >
              {"\n        "}
              <div>
                {"\n          "}
                <div className="kpi-value" id="stat-pending">
                  {counter(c.pending)}
                </div>
                {"\n          "}
                <div className="kpi-label">{"Approval pending"}</div>
                {"\n        "}
              </div>
              {"\n        "}
              <div className="kpi-icon kpi-pending" aria-hidden="true">
                {"\n          "}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                >
                  <circle cx="12" cy="12" r="9"></circle>
                  <path d="M12 7v6l4 2"></path>
                </svg>
                {"\n        "}
              </div>
              {"\n      "}
            </div>
            {"\n      "}
            <div
              id="kpi-inside"
              role="button"
              tabIndex={0}
              title="Click to filter Inside accounts"
              onClick={() => model.kpi("inside")}
              onKeyDown={(event) => {
                if (["Enter", " "].includes(event.key)) {
                  event.preventDefault();
                  model.kpi("inside");
                }
              }}
              className={"kpi" + (ui.insideOnly ? " active-kpi" : "")}
            >
              {"\n        "}
              <div>
                {"\n          "}
                <div className="kpi-value" id="stat-inside">
                  {counter(c.inside)}
                </div>
                {"\n          "}
                <div className="kpi-label">{"Inside (matching)"}</div>
                {"\n        "}
              </div>
              {"\n        "}
              <div className="kpi-icon kpi-inside" aria-hidden="true">
                {"\n          "}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                >
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                  <polyline points="9 22 9 12 15 12 15 22"></polyline>
                </svg>
                {"\n        "}
              </div>
              {"\n      "}
            </div>
            {"\n      "}
            <div
              id="kpi-returns"
              role="button"
              tabIndex={0}
              title="Show all unreturned printed passes for this office"
              onClick={() => model.kpi("returns")}
              onKeyDown={(event) => {
                if (["Enter", " "].includes(event.key)) {
                  event.preventDefault();
                  model.kpi("returns");
                }
              }}
              className={"kpi" + (ui.pendingReturns ? " active-kpi" : "")}
            >
              {"\n        "}
              <div>
                {"\n          "}
                <div className="kpi-value" id="stat-returns">
                  {counter(c.returns)}
                </div>
                {"\n          "}
                <div className="kpi-label">{"Pending return"}</div>
                {"\n        "}
              </div>
              {"\n        "}
              <div className="kpi-icon kpi-approved" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <circle cx="12" cy="12" r="9"></circle>
                  <path d="m7 12 3 3 7-7"></path>
                </svg>
              </div>
              {"\n      "}
            </div>
            {"\n    "}
          </section>
          {"\n\n    "}
          {"\n    "}
          <section className="toolbar" aria-label="Registration filters">
            {"\n      "}
            <div className="search">
              {"\n        "}
              <svg
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="1.8"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="6.7"></circle>
                <path d="m16 16 4.5 4.5"></path>
              </svg>
              {"\n        "}
              <label className="sr-only" htmlFor="visit-search">
                {"Search name, employee ID or pass ID"}
              </label>
              {"\n        "}
              <input
                id="visit-search"
                type="search"
                maxLength={100}
                placeholder="Search name, employee ID or pass ID"
                autoComplete="off"
                value={ui.search}
                onChange={(event) => model.setSearch(event.target.value)}
              />
              {"\n      "}
            </div>
            {"\n      "}
            <label className="sr-only" htmlFor="approvalFilter">
              {"Approval filter"}
            </label>
            {"\n      "}
            <select
              className="select"
              id="approvalFilter"
              aria-label="Approval filter"
              value={ui.status}
              onChange={(event) =>
                model.setFilter("status", event.target.value)
              }
            >
              {"\n        "}
              <option value="ALL">{"All approvals"}</option>
              {"\n        "}
              <option value="APPROVED">{"Approved"}</option>
              {"\n        "}
              <option value="PENDING">{"Pending"}</option>
              {"\n        "}
              <option value="DENIED">{"Denied"}</option>
              {"\n        "}
              <option value="CANCELLED">{"Cancelled"}</option>
              {"\n      "}
            </select>
            {"\n      "}
            <label className="sr-only" htmlFor="printFilter">
              {"Print filter"}
            </label>
            {"\n      "}
            <select
              className="select"
              id="printFilter"
              aria-label="Print filter"
              value={ui.printFilter}
              onChange={(event) =>
                model.setFilter("printFilter", event.target.value)
              }
            >
              {"\n        "}
              <option value="ALL">{"All print status"}</option>
              {"\n        "}
              <option value="UNPRINTED">{"Not printed"}</option>
              {"\n        "}
              <option value="PRINTED">{"Printed"}</option>
              <option value="PENDING_RETURN">{"Pending return"}</option>
              <option value="RETURNED">{"Returned"}</option>
              {"\n      "}
            </select>
            {"\n      "}
            <label className="sr-only" htmlFor="typeFilter">
              {"Type filter"}
            </label>
            {"\n      "}
            <select
              className="select"
              id="typeFilter"
              aria-label="Type filter"
              value={ui.typeFilter}
              onChange={(event) =>
                model.setFilter("typeFilter", event.target.value)
              }
            >
              {"\n        "}
              <option value="ALL">{"All types"}</option>
              {"\n        "}
              <option value="EMPLOYEE">{"Employee"}</option>
              {"\n        "}
              <option value="VISITOR">{"Visitor"}</option>
              {"\n      "}
            </select>
            {"\n      "}
            <button
              className="reset"
              id="clearFilters"
              type="button"
              onClick={model.clearFilters}
            >
              {"Clear"}
            </button>
            {"\n      "}
            <div
              className="status-filters sr-only"
              role="group"
              aria-label="Filter visits by status"
              hidden={true}
            >
              {"\n        "}
              <button type="button" data-status="ALL" aria-pressed="true">
                {"All"}
              </button>
              {"\n        "}
              <button type="button" data-status="PENDING" aria-pressed="false">
                {"Pending"}
              </button>
              {"\n        "}
              <button type="button" data-status="APPROVED" aria-pressed="false">
                {"Approved"}
              </button>
              {"\n        "}
              <button type="button" data-status="DENIED" aria-pressed="false">
                {"Denied"}
              </button>
              {"\n        "}
              <button
                type="button"
                data-status="CANCELLED"
                aria-pressed="false"
              >
                {"Cancelled"}
              </button>
              {"\n      "}
            </div>
            {"\n    "}
          </section>
          {"\n\n    "}
          {"\n    "}
          <div className="section-heading">
            {"\n      "}
            <strong>{"Registrations"}</strong>
            {"\n      "}
            <div className="list-meta">
              {"\n        "}
              <span className="live-dot" aria-hidden="true"></span>
              {"\n        "}
              <span id="list-status" role="status" aria-live="polite">
                {ui.accessDenied
                  ? "Access to this office is unavailable. Refresh your session."
                  : ui.listFailed
                    ? "Could not update visits. Showing the previous list. Use Refresh to retry."
                    : ui.listBusy
                      ? "Updating visits\u2026"
                      : (Math.min(ui.renderLimit, matching.length) < c.total
                          ? Math.min(ui.renderLimit, matching.length) +
                            " / " +
                            c.total
                          : c.total) + " matching visits"}
              </span>
              {"\n      "}
            </div>
            {"\n    "}
          </div>
          {"\n\n    "}
          <div
            className="visits-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Visits Table"
          >
            {"\n      "}
            <table className="visits-table">
              {"\n        "}
              <thead>
                {"\n          "}
                <tr className="table-header-row">
                  {"\n            "}
                  <th scope="col" className="th-identity">
                    {"Person / Request"}
                  </th>
                  {"\n            "}
                  <th scope="col" className="th-project">
                    {"Account"}
                  </th>
                  {"\n            "}
                  <th scope="col" className="th-host host-col">
                    {"Host / Reference"}
                  </th>
                  {"\n            "}
                  <th scope="col" className="th-approval">
                    {"Approval"}
                  </th>
                  {"\n            "}
                  <th scope="col" className="th-card">
                    {"Card Status"}
                  </th>
                  {"\n            "}
                  <th scope="col" className="th-actions">
                    {"Actions"}
                  </th>
                  {"\n          "}
                </tr>
                {"\n        "}
              </thead>
              {"\n        "}
              <tbody id="visit-rows" aria-busy={!ui.context || ui.listBusy}>
                {<RegistrationRows model={model} />}
              </tbody>
              {"\n      "}
            </table>
            {"\n    "}
          </div>
          {"\n\n    "}
          <div
            id="empty-visits"
            className="empty"
            hidden={!complete || matching.length > 0}
          >
            {"\n      No registrations found.\n    "}
          </div>
          {"\n\n    "}
          <div className="list-actions">
            {"\n      "}
            <button
              className="btn outline"
              id="load-more"
              type="button"
              hidden={
                ui.context?.queuePaging ? !ui.cursor : ui.renderLimit >= c.total
              }
              disabled={ui.listBusy}
              onClick={model.loadMore}
            >
              {"Load more"}
            </button>
            {"\n    "}
          </div>
          {"\n  "}
        </section>
        {"\n"}
      </main>
      {"\n\n"}
      <button
        id="lookup-scan"
        className="fab reception-scan-fab"
        aria-haspopup="dialog"
        aria-controls="lookup-scanner"
        type="button"
        aria-label="Scan pass QR"
        title="Scan pass QR"
        onClick={() => setScanner(true)}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"></path>
          <path d="M8 8h3v3H8zm5 0h3v3h-3zm-5 5h3v3H8zm5 0h3v3h-3z"></path>
        </svg>
      </button>
      {"\n\n"}
      {"\n"}
      <button
        className="fab"
        id="assistedFab"
        type="button"
        aria-haspopup="dialog"
        onClick={model.openManual}
        aria-expanded={ui.manualOpen}
      >
        {"\n  "}
        <svg
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2.2"
          fill="none"
          aria-hidden="true"
        >
          <path d="M12 4v16M4 12h16"></path>
        </svg>
        {"\n  Manual registration\n"}
      </button>
      {"\n\n"}
      {"\n"}
      <Dialog
        id="visit-dialog"
        className="modal app-dialog reception-detail"
        aria-labelledby="detail-name"
        open={ui.visitOpen}
        onDismiss={model.closeVisit}
      >
        {"\n  "}
        <div className="modal-header dialog-heading">
          {"\n    "}
          <div>
            {"\n      "}
            <h2 id="detail-name">
              {v?.personName ?? row?.personName ?? "Visit details"}
            </h2>
            {"\n      "}
            <small id="detail-kind" className="detail-kind-tag">
              {row ? kind(row) : ""}
            </small>
            {"\n    "}
          </div>
          {"\n    "}
          <div className="modal-header-actions">
            {"\n      "}
            <div id="detail-badge">
              {row ? <Badge value={effective(v ?? row)} /> : null}
            </div>
            {"\n      "}
            <button
              id="close-visit"
              type="button"
              className="close"
              aria-label="Close visit details"
              onClick={model.closeVisit}
            >
              {"×"}
            </button>
            {"\n    "}
          </div>
          {"\n  "}
        </div>
        {"\n  "}
        <div
          className="modal-body dialog-body"
          tabIndex={0}
          role="region"
          aria-label="Visit information and card preview"
        >
          {"\n    "}
          <div id="detail-status" role="status">
            {ui.detailStatus}
          </div>
          {"\n    "}
          <div id="card-status" className="card-status-message" role="status">
            {ui.cardStatus}
          </div>
          {"\n    "}
          <div id="reception-card" className="reception-card" hidden={!v}>
            {v ? (
              ui.cardUrl ? (
                <img
                  src={ui.cardUrl}
                  alt={"Pass for " + v.personName}
                  width={1712}
                  height={1080}
                />
              ) : (
                <ReadOnlyCard detail={v} />
              )
            ) : null}
          </div>
          {"\n    "}
          <div
            className="reception-person"
            id="reception-person-wrap"
            hidden={!ui.photoUrl}
          >
            <img
              id="detail-photo"
              width="80"
              height="100"
              alt="Person photo"
              src={ui.photoUrl ?? undefined}
              hidden={!ui.photoUrl}
            />
          </div>
          {"\n    "}
          <h3>{"Details"}</h3>
          <dl id="detail-fields" className="info-grid">
            {v && row ? <DetailFields detail={v} row={row} /> : null}
          </dl>
          {"\n    "}
          <section aria-labelledby="timeline-heading">
            <h3 id="timeline-heading">{"Entry / exit timeline"}</h3>
            <div id="detail-timeline">
              {
                <ReceptionTimeline
                  movements={v?.movements}
                  hasMore={v?.movementsHasMore}
                />
              }
            </div>
          </section>
          {"\n  "}
        </div>
        {"\n  "}
        <div className="row-actions dialog-actions">
          {"\n    "}
          <button
            id="retry-detail"
            className="btn outline"
            type="button"
            hidden={!ui.retryDetail}
            onClick={() => {
              if (row) void model.openVisit(row);
            }}
          >
            {"Retry"}
          </button>
          {"\n    "}
          <div id="detail-card-control">
            {row ? <CardStatus row={row} model={model} /> : null}
          </div>
          <button
            id="remind-host"
            className="btn outline"
            type="button"
            hidden={!ui.reminderVisible}
            disabled={ui.reminderBusy}
            onClick={() => void model.remind()}
          >
            {"Remind host"}
          </button>
          <span id="reminder-status" role="status">
            {ui.reminderStatus}
          </span>
          {"\n    "}
          <button
            id="detail-print"
            className="btn primary btn-print"
            type="button"
            hidden={!v || !ui.cardUrl || !model.canPrint(v)}
            disabled={ui.printBusy || ui.returnBusy}
            onClick={() => void model.browserPrint()}
          >
            {row?.printCount ? "Reprint pass" : "Print pass"}
          </button>
          {"\n  "}
        </div>
        {"\n"}
      </Dialog>
      {"\n\n"}
      <Dialog
        id="assisted-dialog"
        className="modal app-dialog manual-dialog"
        aria-labelledby="assisted-title"
        open={ui.manualOpen}
        onDismiss={model.closeManual}
      >
        {"\n "}
        <div className="modal-header">
          <h2 id="assisted-title">{"Manual registration"}</h2>
          <button
            id="close-assisted"
            className="close"
            type="button"
            aria-label="Close manual registration"
            onClick={model.closeManual}
          >
            {"×"}
          </button>
        </div>
        {"\n "}
        <div id="manual-content" className="manual-content">
          {ui.manualOpen && ui.location ? (
            <iframe
              ref={manualFrame}
              title="Manual visitor registration"
              allow="camera"
              src={
                "/reception/register/" + ui.location.locationCode.toLowerCase()
              }
            />
          ) : null}
        </div>
        {"\n"}
      </Dialog>
      {"\n"}
      <Dialog
        id="profile-dialog"
        className="modal app-dialog"
        aria-labelledby="profile-title"
        open={ui.profileOpen}
        onDismiss={model.closeProfile}
      >
        <div className="modal-header">
          <h2 id="profile-title">{"Profile"}</h2>
          <button
            id="close-profile"
            className="close"
            type="button"
            aria-label="Close profile"
            onClick={model.closeProfile}
          >
            {"×"}
          </button>
        </div>
        <div className="modal-body">
          <dl id="profile-fields" className="info-grid">
            {ui.profileContext ? (
              <>
                <dt>Name</dt>
                <dd>{ui.profileContext.displayName}</dd>
                <dt>Role</dt>
                <dd>Reception</dd>
              </>
            ) : null}
          </dl>
          <h3>{"Assigned offices"}</h3>
          <div id="profile-offices">
            {ui.profileContext?.locations.map((office) => (
              <p key={office.locationId}>
                {office.locationName +
                  " \u00B7 " +
                  (office.canPrint ? "View and print" : "View only")}
              </p>
            ))}
          </div>
        </div>
      </Dialog>
      {"\n"}
      <Dialog
        id="history-dialog"
        className="modal app-dialog history-dialog"
        aria-labelledby="history-title"
        open={ui.historyOpen}
        onDismiss={model.closeHistory}
      >
        <div className="modal-header">
          <h2 id="history-title">{"Registration history"}</h2>
          <button
            id="close-history"
            className="close"
            type="button"
            aria-label="Close history"
            onClick={model.closeHistory}
          >
            {"×"}
          </button>
        </div>
        <div className="modal-body">
          <div className="history-range">
            <label>
              {"From"}
              <input
                id="history-date"
                type="date"
                value={ui.historyFrom}
                min={minDate}
                max={maxDate}
                onChange={(event) =>
                  model.setHistory("historyFrom", event.target.value)
                }
              />
            </label>
            <label>
              {"To"}
              <input
                id="history-end"
                type="date"
                value={ui.historyEnd}
                min={minDate}
                max={maxDate}
                onChange={(event) =>
                  model.setHistory("historyEnd", event.target.value)
                }
              />
            </label>
            <button
              id="refresh-history"
              className="btn outline"
              type="button"
              onClick={() => void model.loadHistory()}
            >
              {"Refresh history"}
            </button>
          </div>
          <p id="history-status" role="status">
            {ui.historyStatus}
          </p>
          <div id="history-rows">
            {<HistoryRows rows={ui.historyRows} model={model} />}
          </div>
        </div>
      </Dialog>
      {"\n"}
      <Dialog
        id="devices-return-dialog"
        className="modal app-dialog"
        aria-labelledby="devices-return-title"
        open={!!ui.returnTarget}
        onDismiss={model.closeReturn}
      >
        <form
          id="devices-return-form"
          onSubmit={(event) => {
            event.preventDefault();
            model.confirmReturn();
          }}
        >
          <div className="modal-header">
            <h2 id="devices-return-title">{"Confirm final pass return"}</h2>
            <button
              id="cancel-devices-return"
              type="button"
              className="close"
              aria-label="Cancel device verification"
              onClick={model.closeReturn}
              disabled={ui.returnBusy}
            >
              {"×"}
            </button>
          </div>
          <div className="modal-body">
            <p id="devices-return-person">{ui.returnTarget?.row.personName}</p>
            <p id="return-explanation">
              {ui.returnTarget?.row.deviceTypes?.length
                ? "Confirm every declared device is leaving with the visitor. The printed pass will be marked returned and its QR will be revoked."
                : "Confirm you have collected the printed pass at final building exit. Its QR will be revoked. A mistaken return can be corrected with a reason."}
            </p>
            <div id="devices-return-list">
              {ui.returnTarget?.row.deviceTypes?.map((code) => (
                <label key={code} style={{ display: "block" }}>
                  <input
                    type="checkbox"
                    required
                    checked={ui.verifiedDevices.includes(code)}
                    onChange={(event) =>
                      model.checkDevice(code, event.target.checked)
                    }
                  />
                  {" " + deviceLabels[code]}
                </label>
              ))}
            </div>
            <p id="devices-return-status" role="status">
              {ui.returnStatus}
            </p>
          </div>
          <div className="modal-footer">
            <button
              type="submit"
              className="btn primary"
              id="confirm-devices-return"
              disabled={ui.returnBusy}
            >
              {ui.returnTarget?.row.deviceTypes?.length
                ? "Verify devices & mark returned"
                : "Confirm returned"}
            </button>
          </div>
        </form>
      </Dialog>
      {"\n"}
      <QrScanner
        open={scanner}
        onClose={() => setScanner(false)}
        onCredential={(credential) =>
          void model.lookupVisits(true, false, credential)
        }
        url={config.qrDecoderUrl}
      />
      {"\n"}
      <Dialog
        id="correct-return-dialog"
        className="modal app-dialog"
        aria-labelledby="correct-return-title"
        open={!!ui.correction}
        onDismiss={model.closeCorrection}
      >
        <form
          id="correct-return-form"
          onSubmit={(event) => {
            event.preventDefault();
            void model.correctReturn();
          }}
        >
          <div className="modal-header">
            <h2 id="correct-return-title">{"Correct mistaken return"}</h2>
            <button
              id="correct-return-close"
              className="close"
              type="button"
              aria-label="Cancel return correction"
              onClick={model.closeCorrection}
              disabled={ui.returnBusy}
            >
              {"×"}
            </button>
          </div>
          <div className="modal-body">
            <p id="correct-return-person">
              {ui.correction
                ? ui.correction.row.personName +
                  " \u00B7 " +
                  ui.correction.row.publicPassNumber
                : ""}
            </p>
            <p>
              {
                "Use only if the pass was marked returned by mistake. The original return and this correction will remain in the audit trail. A replacement request or changed pass can block correction."
              }
            </p>
            <label htmlFor="correct-return-reason">
              {"Reason for correction"}
            </label>
            <textarea
              id="correct-return-reason"
              required={true}
              minLength={5}
              maxLength={300}
              value={ui.correctionReason}
              onChange={(event) =>
                model.setCorrectionReason(event.target.value)
              }
            ></textarea>
            <p id="correct-return-status" role="status">
              {ui.correctionStatus}
            </p>
          </div>
          <div className="modal-footer">
            <button
              id="correct-return-submit"
              className="btn primary"
              type="submit"
              disabled={ui.returnBusy}
            >
              {"Correct return"}
            </button>
          </div>
        </form>
      </Dialog>
      {"\n"}
      {"\n"}
      <ImageViewer />
      <Notices items={ui.notices} dismiss={model.dismissNotice} />
    </>
  );
}
