import { useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useModel } from "../shared/model.ts";
import { createSelfServiceModel } from "../selfService/model.ts";
import {
  VisitorDetails,
  Stepper,
  Extras,
  ReviewPeople,
  ReviewDetails,
  Results,
} from "../selfService/components.tsx";
import { usePhotoGestures } from "../selfService/gestures.ts";
import { Dialog, Select } from "../shared/controls.tsx";
import { Notices } from "../shared/Notices.tsx";
import type { PageProps } from "../types.ts";
import { InstallButton } from "../components.tsx";
export default function SelfServicePage({ config }: PageProps) {
  const video = useRef<HTMLVideoElement>(null),
    preview = useRef<HTMLImageElement>(null),
    frame = useRef<HTMLSpanElement>(null),
    stage = useRef<HTMLDivElement>(null),
    [dialogTarget, setDialogTarget] = useState<HTMLDivElement | null>(null);
  const [model, ui] = useModel(() =>
    createSelfServiceModel(config, {
      video: () => video.current,
      preview: () => preview.current,
      frame: () => frame.current,
    }),
  );
  const gestures = usePhotoGestures(model, stage),
    entry = ui.people[ui.photoIndex],
    frozen = ui.busy || !!ui.jobs,
    photoStep = model.photoStep(),
    labels = model.steps();
  useEffect(() => {
    if (ui.focus)
      document.getElementById(ui.focus)?.focus({ preventScroll: true });
  }, [ui.focus, ui.step, ui.accessEditor, ui.view]);
  const validateCurrent = () => {
    const root = document.getElementById(
      ui.step === 0 ? "details-step" : "visit-step",
    );
    if (root)
      for (const input of root.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement
      >("input,textarea"))
        if (
          !input.closest("[hidden]") &&
          !input.disabled &&
          !input.reportValidity()
        )
          return false;
    return true;
  };
  return (
    <>
      {"\n  "}
      <a className="skip" href="#main-content">
        {"Skip to content"}
      </a>
      {"\n  "}
      <header className="masthead" hidden={config.manualReception}>
        {"\n    "}
        <div className="header-brand">
          {"\n      "}
          <img
            className="company"
            width="192"
            src={config.companyLogo}
            alt="Sopra Steria"
          />
          {"\n    "}
        </div>
        {"\n    "}
        <div className="header-actions">
          {"\n      "}
          <span className="office-label">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            {config.officeName}
          </span>
          {"\n    "}
        </div>
        {"\n  "}
      </header>
      {"\n  "}
      <main id="main-content" className="portal-shell" tabIndex={-1}>
        {"\n    "}
        <aside className="office-visual" aria-label="Office campus">
          {"\n      "}
          <img
            className="office-photo"
            src="/assets/office-background.png"
            alt="Sopra Steria Noida campus"
            width="723"
            height="960"
          />
          {"\n    "}
        </aside>
        {"\n    "}
        <div className="portal-content">
          {"\n\n      "}
          <section
            id="landing"
            className="landing"
            aria-labelledby="welcome-title"
            hidden={ui.view !== "landing"}
          >
            {"\n        "}
            <div className="landing-card">
              {"\n          "}
              <div className="landing-badge">
                <span className="badge-dot"></span>
                <span>{"Sopra Steria Identity & Access"}</span>
              </div>
              {"\n          "}
              <h1 id="welcome-title">{"GatePass Portal"}</h1>
              {"\n          "}
              <div className="entry-choices">
                {"\n            "}
                <button
                  id="employee-choice"
                  className="entry-choice"
                  type="button"
                  hidden={config.manualReception}
                  disabled={ui.busy}
                  onClick={() => void model.employeeChoice()}
                >
                  {"\n              "}
                  <span className="choice-icon" aria-hidden="true">
                    {"\n                "}
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                      <circle cx="8" cy="10" r="2.5"></circle>
                      <path d="M4.5 16.5c0-1.8 1.6-2.5 3.5-2.5s3.5.7 3.5 2.5"></path>
                      <line x1="13.5" y1="9" x2="19.5" y2="9"></line>
                      <line x1="13.5" y1="13" x2="19.5" y2="13"></line>
                    </svg>
                    {"\n              "}
                  </span>
                  {"\n              "}
                  <span className="choice-text">
                    {"\n                "}
                    <strong>{"SSI Employee"}</strong>
                    {"\n                "}
                    <small>{"Digital ID & Account Access"}</small>
                    {"\n              "}
                  </span>
                  {"\n              "}
                  <span className="choice-arrow" aria-hidden="true">
                    {"→"}
                  </span>
                  {"\n            "}
                </button>
                {"\n            "}
                <button
                  id="visitor-choice"
                  className="entry-choice"
                  type="button"
                  disabled={ui.busy}
                  onClick={() => void model.beginFlow("visitor")}
                >
                  {"\n              "}
                  <span className="choice-icon" aria-hidden="true">
                    {"\n                "}
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                      <circle cx="9" cy="7" r="4"></circle>
                      <line x1="19" y1="8" x2="19" y2="14"></line>
                      <line x1="22" y1="11" x2="16" y2="11"></line>
                    </svg>
                    {"\n              "}
                  </span>
                  {"\n              "}
                  <span className="choice-text">
                    {"\n                "}
                    <strong>{"Visitor Check-in"}</strong>
                    {"\n                "}
                    <small>{"Guest Pass & Host Approval"}</small>
                    {"\n              "}
                  </span>
                  {"\n              "}
                  <span className="choice-arrow" aria-hidden="true">
                    {"→"}
                  </span>
                  {"\n            "}
                </button>
                {"\n          "}
              </div>
              {"\n        "}
            </div>
            {"\n      "}
          </section>
          {"\n\n      "}
          <section
            id="sign-in-screen"
            aria-labelledby="sign-in-title"
            hidden={ui.view !== "sign-in-screen"}
          >
            {"\n        "}
            <button
              className="quiet back-link"
              id="sign-in-back"
              type="button"
              disabled={ui.busy}
              onClick={model.signInBack}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              {"Back"}
            </button>
            {"\n        "}
            <div className="auth-card">
              {"\n          "}
              <h1 id="sign-in-title">{"Employee Sign In"}</h1>
              {"\n          "}
              <form
                id="login"
                className="sign-in-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (event.currentTarget.reportValidity()) void model.signIn();
                }}
              >
                {"\n            "}
                <div className="field">
                  {"\n              "}
                  <label htmlFor="employee-email">{"Sopra Steria Email"}</label>
                  {"\n              "}
                  <input
                    id="employee-email"
                    type="email"
                    autoComplete="username"
                    maxLength={320}
                    placeholder="name@soprasteria.com"
                    required={true}
                    value={ui.email}
                    onChange={(event) =>
                      model.setField("email", event.target.value)
                    }
                    disabled={ui.busy}
                  />
                  {"\n            "}
                </div>
                {"\n            "}
                <div className="field">
                  {"\n              "}
                  <label htmlFor="employee-password">{"Password"}</label>
                  {"\n              "}
                  <div className="password-control">
                    {"\n                "}
                    <input
                      id="employee-password"
                      autoComplete="current-password"
                      maxLength={128}
                      placeholder="••••••••"
                      required={true}
                      type={ui.showPassword ? "text" : "password"}
                      value={ui.password}
                      onChange={(event) =>
                        model.setField("password", event.target.value)
                      }
                      disabled={ui.busy}
                    />
                    {"\n                "}
                    <button
                      className="quiet"
                      id="toggle-password"
                      type="button"
                      aria-controls="employee-password"
                      onClick={model.togglePassword}
                      aria-pressed={ui.showPassword}
                      aria-label={
                        ui.showPassword ? "Hide password" : "Show password"
                      }
                    >
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                        <path
                          className="password-eye-slash"
                          d="m3 3 18 18"
                        ></path>
                      </svg>
                    </button>
                    {"\n              "}
                  </div>
                  {"\n            "}
                </div>
                {"\n            "}
                <button
                  className="primary"
                  id="sign-in"
                  disabled={ui.busy || !ui.email.trim() || !ui.password}
                >
                  {ui.busy ? "Signing in\u2026" : "Sign in"}
                </button>
                {"\n          "}
              </form>
              {"\n        "}
            </div>
            {"\n      "}
          </section>
          {"\n\n      "}
          <section
            id="flow"
            aria-labelledby="flow-title"
            hidden={ui.view !== "flow"}
            aria-busy={ui.busy && !ui.initializing}
          >
            {"\n        "}
            <div className="flow-heading">
              <h1 id="flow-title" tabIndex={-1}>
                {ui.mode === "employee" ? "Digital ID" : "Visitor registration"}
              </h1>
              <button
                className="quiet close-btn"
                id="close-flow"
                type="button"
                aria-label="Back to home"
                disabled={frozen}
                onClick={() => void model.leaveFlow()}
              >
                {"✕"}
              </button>
            </div>
            {"\n        "}
            <ol
              className="stepper"
              id="stepper"
              aria-label="Registration progress"
            >
              {<Stepper model={model} />}
            </ol>
            {"\n        "}
            <form
              id="registration"
              noValidate={true}
              onSubmit={(event) => {
                event.preventDefault();
                void model.submitJobs();
              }}
            >
              {"\n          "}
              <section
                id="details-step"
                className="step-content"
                aria-label="Details"
                hidden={ui.step !== 0}
              >
                {"\n            "}
                <div
                  id="employee-summary"
                  className="employee-summary"
                  hidden={ui.mode !== "employee"}
                >
                  {"\n              "}
                  <div className="employee-identity">
                    <span className="avatar" id="employee-avatar">
                      {ui.employee?.displayName
                        .split(/s+/u)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((v) => v[0])
                        .join("")
                        .toUpperCase()}
                    </span>
                    <div>
                      <strong id="employee-name">
                        {ui.employee?.displayName}
                      </strong>
                      <div id="employee-id" className="meta">
                        {ui.employee
                          ? ui.employee.employeeId +
                            " \u00B7 " +
                            ui.employee.officialEmail
                          : ""}
                      </div>
                      <div
                        id="employee-office"
                        className="meta employee-office"
                        hidden={!ui.employee?.primaryOffice}
                      >
                        {
                          <>
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              aria-hidden="true"
                            >
                              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                              <circle cx="12" cy="10" r="3" />
                            </svg>
                            <span>
                              {"Primary Office: " + ui.employee?.primaryOffice}
                            </span>
                          </>
                        }
                      </div>
                    </div>
                  </div>
                  {"\n              "}
                  <div className="employee-summary-projects">
                    {"\n                "}
                    <div id="employee-projects" className="chips">
                      {ui.options?.projects.filter((p) => p.assigned).length
                        ? ui.options.projects
                            .filter((p) => p.assigned)
                            .map((p) => (
                              <span className="chip" key={p.projectLocationId}>
                                {p.projectName +
                                  " \u00B7 " +
                                  ui.options!.locationName}
                              </span>
                            ))
                        : ui.options?.digitalIdEligible === false
                          ? "Access to this office requires host approval."
                          : ui.employee?.projects.length
                            ? ui.employee.projects.map((p) => (
                                <span
                                  className="chip"
                                  key={p.projectLocationId}
                                >
                                  {p.projectName}
                                </span>
                              ))
                            : "No assigned accounts"}
                    </div>
                    {"\n                "}
                    <div className="employee-summary-actions">
                      {"\n                  "}
                      <button
                        className="quiet add-access"
                        id="toggle-access"
                        type="button"
                        aria-haspopup="dialog"
                        aria-controls="project-access-dialog"
                        hidden={
                          ui.mode === "employee" &&
                          (ui.options?.projects.length ?? 0) <= 1
                        }
                        disabled={frozen}
                        aria-expanded={ui.accessEditor}
                        onClick={model.editAccess}
                      >
                        {ui.options?.digitalIdEligible
                          ? "+ Request access to another account"
                          : "+ Request account access"}
                      </button>
                      {"\n                "}
                    </div>
                    {"\n              "}
                  </div>
                  {"\n              "}
                  <div id="extra-projects" className="selected-access">
                    {<Extras model={model} />}
                  </div>
                  {"\n            "}
                </div>
                {"\n            "}
                <div id="employee-fields" hidden={ui.mode !== "employee"}>
                  {"\n              "}
                  <div className="field">
                    <label htmlFor="reason">
                      {"Reason "}
                      <span className="required">{"*"}</span>
                    </label>
                    <Select
                      id="reason"
                      required={true}
                      value={ui.reason}
                      onValue={(value) => model.setField("reason", value)}
                      label={"Reason"}
                      disabled={frozen && !ui.initializing}
                    >
                      <option value="">{"Select reason"}</option>
                      <option value="FORGOT">{"Forgot my card"}</option>
                      <option value="LOST">{"Lost my card"}</option>
                      <option value="OTHER">{"Other"}</option>
                    </Select>
                  </div>
                  {"\n              "}
                  <div className="field">
                    <label htmlFor="reason-details">
                      {"Details "}
                      <span className="optional" id="reason-optional">
                        {ui.reason === "OTHER" ? "" : "(optional)"}
                      </span>
                    </label>
                    <textarea
                      id="reason-details"
                      rows={2}
                      maxLength={1000}
                      value={ui.reasonDetails}
                      required={ui.reason === "OTHER"}
                      disabled={frozen && !ui.initializing}
                      onChange={(event) =>
                        model.setField("reasonDetails", event.target.value)
                      }
                    ></textarea>
                  </div>
                  {"\n            "}
                </div>
                {"\n            "}
                <div id="visitor-fields" hidden={ui.mode !== "visitor"}>
                  <div id="visitors">{<VisitorDetails model={model} />}</div>
                </div>
                {"\n          "}
              </section>
              {"\n\n          "}
              {ui.accessEditor && dialogTarget ? (
                createPortal(
                  <section
                    id="visit-step"
                    className="step-content"
                    aria-label="Visit details"
                    hidden={
                      !ui.accessEditor &&
                      (ui.mode === "employee" || ui.step !== 1)
                    }
                  >
                    {"\n            "}
                    <div className="fields-row">
                      {"\n              "}
                      <div
                        className="field"
                        id="visitor-project-field"
                        hidden={ui.mode === "visitor"}
                      >
                        <label htmlFor="project">
                          {"Account "}
                          <span className="required">{"*"}</span>
                        </label>
                        <Select
                          id="project"
                          value={ui.projectId}
                          onValue={model.selectProject}
                          label={"Account"}
                          disabled={frozen}
                          required={ui.mode === "employee"}
                        >
                          {
                            <>
                              <option value="">Select account</option>
                              {ui.options?.projects
                                .filter(
                                  (p) =>
                                    !ui.extras.some(
                                      (x) =>
                                        x.projectLocationId ===
                                        p.projectLocationId,
                                    ),
                                )
                                .map((p) => (
                                  <option
                                    key={p.projectLocationId}
                                    value={p.projectLocationId}
                                  >
                                    {p.projectName}
                                  </option>
                                ))}
                            </>
                          }
                        </Select>
                      </div>
                      {"\n              "}
                      <div
                        className="field"
                        id="visitor-date-field"
                        hidden={ui.mode === "employee"}
                      >
                        <label htmlFor="visit-date">
                          {"Valid until "}
                          <span className="required">{"*"}</span>
                        </label>
                        <input
                          id="visit-date"
                          type="date"
                          required={true}
                          value={ui.validUntil}
                          min={ui.options?.currentDate}
                          max={ui.options?.maxVisitDate}
                          disabled={frozen}
                          onChange={(event) =>
                            model.setField("validUntil", event.target.value)
                          }
                        />
                      </div>
                      {"\n            "}
                    </div>
                    {"\n            "}
                    <div className="field host-picker">
                      <label htmlFor="host-search">
                        {"Host "}
                        <span className="required">{"*"}</span>
                      </label>
                      <input
                        id="host-search"
                        type="search"
                        maxLength={100}
                        required={true}
                        placeholder="Search name or email"
                        autoComplete="off"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-controls="host-results"
                        value={ui.hostQuery}
                        disabled={
                          frozen || (ui.mode === "employee" && !ui.projectId)
                        }
                        onChange={(event) =>
                          model.setHostQuery(event.target.value)
                        }
                        aria-expanded={ui.hostsOpen}
                      />
                      <div
                        id="host-results"
                        className="host-results"
                        role="listbox"
                        aria-label="Hosts"
                        hidden={!ui.hostsOpen}
                      >
                        {ui.hosts.map((host, index) => (
                          <button
                            key={host.employeeId}
                            type="button"
                            id={"host-option-" + index}
                            role="option"
                            aria-selected="false"
                            onClick={() => model.selectHost(host)}
                          >
                            <strong>{host.displayName}</strong>
                            <span>{host.officialEmail}</span>
                          </button>
                        ))}
                      </div>
                      <p id="host-feedback" className="hint" role="status">
                        {ui.hostFeedback}
                      </p>
                    </div>
                    {"\n            "}
                    <div className="field">
                      <label htmlFor="purpose">
                        {"Purpose "}
                        <span className="required">{"*"}</span>
                      </label>
                      <Select
                        id="purpose"
                        required={true}
                        value={ui.purpose}
                        onValue={(value) => model.setField("purpose", value)}
                        label={"Purpose"}
                        disabled={frozen}
                      >
                        <option value="">{"Select purpose"}</option>
                        <option>{"Business meeting"}</option>
                        <option>{"Account discussion"}</option>
                        <option>{"Interview"}</option>
                        <option>{"Delivery"}</option>
                        <option>{"Contractor"}</option>
                        <option>{"Support staff"}</option>
                        <option>{"Other"}</option>
                      </Select>
                    </div>
                    {"\n            "}
                    <div className="field">
                      <label htmlFor="purpose-details">
                        {"Details "}
                        <span className="optional" id="purpose-optional">
                          {ui.purpose === "Other" ? "" : "(optional)"}
                        </span>
                      </label>
                      <textarea
                        id="purpose-details"
                        rows={2}
                        maxLength={1000}
                        value={ui.purposeDetails}
                        required={ui.purpose === "Other"}
                        disabled={frozen}
                        onChange={(event) =>
                          model.setField("purposeDetails", event.target.value)
                        }
                      ></textarea>
                    </div>
                    {"\n          "}
                  </section>,
                  dialogTarget,
                )
              ) : (
                <section
                  id="visit-step"
                  className="step-content"
                  aria-label="Visit details"
                  hidden={
                    !ui.accessEditor &&
                    (ui.mode === "employee" || ui.step !== 1)
                  }
                >
                  {"\n            "}
                  <div className="fields-row">
                    {"\n              "}
                    <div
                      className="field"
                      id="visitor-project-field"
                      hidden={ui.mode === "visitor"}
                    >
                      <label htmlFor="project">
                        {"Account "}
                        <span className="required">{"*"}</span>
                      </label>
                      <Select
                        id="project"
                        value={ui.projectId}
                        onValue={model.selectProject}
                        label={"Account"}
                        disabled={frozen}
                        required={ui.mode === "employee"}
                      >
                        {
                          <>
                            <option value="">Select account</option>
                            {ui.options?.projects
                              .filter(
                                (p) =>
                                  !ui.extras.some(
                                    (x) =>
                                      x.projectLocationId ===
                                      p.projectLocationId,
                                  ),
                              )
                              .map((p) => (
                                <option
                                  key={p.projectLocationId}
                                  value={p.projectLocationId}
                                >
                                  {p.projectName}
                                </option>
                              ))}
                          </>
                        }
                      </Select>
                    </div>
                    {"\n              "}
                    <div
                      className="field"
                      id="visitor-date-field"
                      hidden={ui.mode === "employee"}
                    >
                      <label htmlFor="visit-date">
                        {"Valid until "}
                        <span className="required">{"*"}</span>
                      </label>
                      <input
                        id="visit-date"
                        type="date"
                        required={true}
                        value={ui.validUntil}
                        min={ui.options?.currentDate}
                        max={ui.options?.maxVisitDate}
                        disabled={frozen}
                        onChange={(event) =>
                          model.setField("validUntil", event.target.value)
                        }
                      />
                    </div>
                    {"\n            "}
                  </div>
                  {"\n            "}
                  <div className="field host-picker">
                    <label htmlFor="host-search">
                      {"Host "}
                      <span className="required">{"*"}</span>
                    </label>
                    <input
                      id="host-search"
                      type="search"
                      maxLength={100}
                      required={true}
                      placeholder="Search name or email"
                      autoComplete="off"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-controls="host-results"
                      value={ui.hostQuery}
                      disabled={
                        frozen || (ui.mode === "employee" && !ui.projectId)
                      }
                      onChange={(event) =>
                        model.setHostQuery(event.target.value)
                      }
                      aria-expanded={ui.hostsOpen}
                    />
                    <div
                      id="host-results"
                      className="host-results"
                      role="listbox"
                      aria-label="Hosts"
                      hidden={!ui.hostsOpen}
                    >
                      {ui.hosts.map((host, index) => (
                        <button
                          key={host.employeeId}
                          type="button"
                          id={"host-option-" + index}
                          role="option"
                          aria-selected="false"
                          onClick={() => model.selectHost(host)}
                        >
                          <strong>{host.displayName}</strong>
                          <span>{host.officialEmail}</span>
                        </button>
                      ))}
                    </div>
                    <p id="host-feedback" className="hint" role="status">
                      {ui.hostFeedback}
                    </p>
                  </div>
                  {"\n            "}
                  <div className="field">
                    <label htmlFor="purpose">
                      {"Purpose "}
                      <span className="required">{"*"}</span>
                    </label>
                    <Select
                      id="purpose"
                      required={true}
                      value={ui.purpose}
                      onValue={(value) => model.setField("purpose", value)}
                      label={"Purpose"}
                      disabled={frozen}
                    >
                      <option value="">{"Select purpose"}</option>
                      <option>{"Business meeting"}</option>
                      <option>{"Account discussion"}</option>
                      <option>{"Interview"}</option>
                      <option>{"Delivery"}</option>
                      <option>{"Contractor"}</option>
                      <option>{"Support staff"}</option>
                      <option>{"Other"}</option>
                    </Select>
                  </div>
                  {"\n            "}
                  <div className="field">
                    <label htmlFor="purpose-details">
                      {"Details "}
                      <span className="optional" id="purpose-optional">
                        {ui.purpose === "Other" ? "" : "(optional)"}
                      </span>
                    </label>
                    <textarea
                      id="purpose-details"
                      rows={2}
                      maxLength={1000}
                      value={ui.purposeDetails}
                      required={ui.purpose === "Other"}
                      disabled={frozen}
                      onChange={(event) =>
                        model.setField("purposeDetails", event.target.value)
                      }
                    ></textarea>
                  </div>
                  {"\n          "}
                </section>
              )}
              {"\n\n          "}
              <Dialog
                id="project-access-dialog"
                className="app-dialog"
                aria-labelledby="project-access-title"
                open={ui.accessEditor}
                onDismiss={() => model.closeAccessDialog()}
              >
                {"\n            "}
                <div className="dialog-heading">
                  <h2 id="project-access-title">{"Add account access"}</h2>
                  <button
                    className="quiet"
                    id="close-project-dialog"
                    type="button"
                    aria-label="Close account access"
                    onClick={() => model.closeAccessDialog()}
                  >
                    {"✕"}
                  </button>
                </div>
                {"\n            "}
                <div
                  id="project-dialog-fields"
                  className="dialog-body"
                  ref={setDialogTarget}
                ></div>
                {"\n            "}
                <div className="dialog-actions">
                  <button
                    className="secondary"
                    id="cancel-project-dialog"
                    type="button"
                    onClick={() => model.closeAccessDialog()}
                  >
                    {"Cancel"}
                  </button>
                  <button
                    className="primary"
                    id="add-project-access"
                    type="button"
                    onClick={model.addExtra}
                    disabled={frozen}
                    hidden={false}
                  >
                    {"Add account"}
                  </button>
                </div>
                {"\n          "}
              </Dialog>
              {"\n\n          "}
              <section
                id="photo-step"
                className="step-content"
                aria-label="Photo"
                hidden={ui.step !== photoStep}
              >
                {"\n            "}
                <div className="photo-heading">
                  <h2 id="photo-title">
                    {ui.mode === "employee"
                      ? "Your photo"
                      : entry.name || "Visitor 1"}
                  </h2>
                  <span className="meta" id="photo-position">
                    {""}
                  </span>
                </div>
                {"\n            "}
                <div className="capture-layout">
                  {"\n              "}
                  <div
                    className="capture-stage"
                    id="capture-stage"
                    ref={stage}
                    onPointerDown={gestures.onPointerDown}
                    onPointerMove={gestures.onPointerMove}
                    onPointerUp={gestures.onPointerUp}
                    onPointerCancel={gestures.onPointerCancel}
                  >
                    <svg
                      id="photo-placeholder"
                      width="64"
                      height="64"
                      viewBox="0 0 48 48"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      aria-hidden="true"
                      style={{
                        display: entry?.url || ui.stream ? "none" : undefined,
                      }}
                    >
                      <circle cx="24" cy="16" r="8"></circle>
                      <path d="M9 42v-4a15 15 0 0 1 30 0v4"></path>
                    </svg>
                    <video
                      id="camera-video"
                      autoPlay={true}
                      muted={true}
                      playsInline={true}
                      ref={video}
                      hidden={!ui.stream}
                    ></video>
                    <img
                      id="photo-preview"
                      alt="Selected face photo"
                      draggable="false"
                      ref={preview}
                      src={entry?.url ?? undefined}
                      hidden={!entry?.url || !!ui.stream}
                      onLoad={model.applyPhotoTransform}
                    />
                    <span
                      className="capture-corners"
                      aria-hidden="true"
                      ref={frame}
                    ></span>
                    <div
                      className="photo-zoom-controls"
                      id="photo-zoom-controls"
                      hidden={!entry?.url || !!ui.stream}
                    >
                      <button
                        type="button"
                        className="zoom-btn"
                        id="zoom-out"
                        aria-label="Zoom out"
                        title="Zoom out"
                        onClick={() =>
                          model.setZoom(
                            Math.round(((entry.zoom ?? 1) - 0.15) * 100) / 100,
                          )
                        }
                        disabled={frozen}
                      >
                        {"−"}
                      </button>
                      <input
                        type="range"
                        id="zoom-slider"
                        min="1"
                        max="3"
                        step="0.05"
                        defaultValue="1"
                        aria-label="Photo zoom"
                        value={String(entry?.zoom ?? 1)}
                        onChange={(event) =>
                          model.setZoom(Number(event.target.value))
                        }
                        disabled={frozen}
                      />
                      <button
                        type="button"
                        className="zoom-btn"
                        id="zoom-in"
                        aria-label="Zoom in"
                        title="Zoom in"
                        onClick={() =>
                          model.setZoom(
                            Math.round(((entry.zoom ?? 1) + 0.15) * 100) / 100,
                          )
                        }
                        disabled={frozen}
                      >
                        {"+"}
                      </button>
                      <button
                        type="button"
                        className="zoom-btn"
                        id="zoom-flip"
                        aria-label="Flip photo"
                        title="Flip photo"
                        onClick={model.flip}
                        disabled={frozen}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M8 7 3 12l5 5"></path>
                          <path d="m16 7 5 5-5 5"></path>
                          <path d="M3 12h18"></path>
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="zoom-btn zoom-reset"
                        id="zoom-reset"
                        aria-label="Reset position"
                        title="Reset"
                        onClick={model.resetPhoto}
                        disabled={frozen}
                      >
                        {"↺"}
                      </button>
                    </div>
                  </div>
                  {"\n            "}
                </div>
                {"\n            "}
                <div className="capture-actions">
                  <button
                    className="secondary"
                    id="open-camera"
                    type="button"
                    hidden={!!entry?.url || !!ui.stream}
                    disabled={frozen || ui.cameraOpening}
                    onClick={() => void model.openCamera()}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                      <circle cx="12" cy="13" r="4"></circle>
                    </svg>
                    {"Open camera"}
                  </button>
                  <button
                    className="primary"
                    id="capture-photo"
                    type="button"
                    hidden={!ui.stream}
                    disabled={frozen}
                    onClick={() => void model.capture()}
                  >
                    {"Capture photo"}
                  </button>
                  <button
                    className="secondary"
                    id="retake-photo"
                    type="button"
                    hidden={!entry?.url || !!ui.stream}
                    disabled={frozen}
                    onClick={model.retake}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                      <circle cx="12" cy="13" r="4"></circle>
                    </svg>
                    {"Retake"}
                  </button>
                </div>
                {"\n            "}
                <div className="photo-foot">
                  <p className="hint">{"JPG, PNG or WebP · Max 5 MB"}</p>
                  <div id="photo-people" className="photo-people">
                    {null}
                  </div>
                </div>
                {"\n          "}
              </section>
              {"\n\n          "}
              <section
                id="review-step"
                className="step-content"
                aria-label="Review"
                hidden={ui.step !== labels.length - 1}
              >
                {"\n            "}
                <div className="review-heading">
                  <h2>{"Review Details"}</h2>
                  <button
                    className="quiet"
                    id="edit-details"
                    type="button"
                    onClick={() => model.renderStep(0)}
                    disabled={frozen}
                  >
                    {"Edit"}
                  </button>
                </div>
                <div id="review-people" className="review-people">
                  {<ReviewPeople model={model} />}
                </div>
                <dl id="review-details" className="review-details">
                  {<ReviewDetails model={model} />}
                </dl>
                {"\n            "}
                <div
                  id="review-access"
                  className="review-access"
                  hidden={!ui.extras.length}
                >
                  {
                    <>
                      <h2>Additional account access</h2>
                      {ui.extras.map((extra) => (
                        <div key={extra.projectLocationId}>
                          <dt>{extra.projectName}</dt>
                          <dd>
                            {extra.host.displayName +
                              " \u00B7 " +
                              extra.host.officialEmail}
                          </dd>
                        </div>
                      ))}
                    </>
                  }
                </div>
                {"\n          "}
              </section>
              {"\n          "}
              <div className="flow-actions">
                <button
                  className="secondary"
                  id="previous-step"
                  type="button"
                  hidden={false}
                  disabled={ui.busy || !!ui.jobs}
                  onClick={model.previous}
                >
                  {"Back"}
                </button>
                <button
                  className="primary"
                  id="next-step"
                  type="button"
                  hidden={ui.step === labels.length - 1}
                  disabled={ui.busy}
                  aria-busy={ui.busy}
                  onClick={() => {
                    if (ui.step >= photoStep || validateCurrent())
                      void model.next();
                  }}
                >
                  {ui.step === photoStep ? "Review" : "Continue"}
                </button>
                <button
                  className="primary"
                  id="submit"
                  type="submit"
                  hidden={ui.step !== labels.length - 1}
                  disabled={ui.busy}
                >
                  {ui.busy
                    ? "Submitting\u2026"
                    : ui.jobs
                      ? "Retry same request"
                      : "Submit"}
                </button>
              </div>
              {"\n        "}
            </form>
            {"\n      "}
          </section>
          {"\n\n      "}
          <section
            id="success"
            aria-labelledby="success-title"
            hidden={ui.view !== "success"}
          >
            {"\n        "}
            <div className="success-heading">
              <div className="success-icon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="28"
                  height="28"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
              <h1 id="success-title" tabIndex={-1}>
                {(ui.jobs ?? [])
                  .filter((job) => job.result)
                  .some((job) => !model.resultBindings(job))
                  ? "Request saved"
                  : ui.mode === "employee" &&
                      ui.jobs?.some(
                        (job) => job.body.requestType === "DIGITAL_ID",
                      )
                    ? "Digital ID created"
                    : "Visit submitted"}
              </h1>
            </div>
            {"\n        "}
            <div id="submission-results" className="submission-results">
              {<Results model={model} />}
            </div>
            {"\n        "}
            <div className="success-actions">
              <button
                className="primary success-home-btn"
                id="success-home"
                type="button"
                disabled={ui.busy}
                onClick={() => void model.leaveFlow()}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                  <polyline points="9 22 9 12 15 12 15 22"></polyline>
                </svg>
                {"Done"}
              </button>
              <button
                className="secondary"
                id="retry-pending"
                type="button"
                hidden={(ui.jobs ?? []).every((job) => !!job.result)}
                disabled={ui.busy}
                onClick={() => void model.submitJobs()}
              >
                {"Retry remaining request"}
              </button>
            </div>
            {"\n      "}
          </section>
          {"\n    "}
        </div>
        {"\n  "}
      </main>
      {"\n  "}
      {null}
      {"\n  "}
      {"\n"}
      <Notices items={ui.notices} dismiss={model.dismissNotice} />
    </>
  );
}
