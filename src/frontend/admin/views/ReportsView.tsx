import { shiftDay } from "../types.ts";
import {
  action,
  change,
  dataAction,
  disabled,
  hidden,
  options,
  submit,
  value,
} from "../bindings.ts";
import type { AdminModel } from "../model.ts";
import { content } from "../slots.tsx";

/** Presentation only; the existing model owns authorization, operations and lifecycle. */
export function ReportsView({ model }: { model: AdminModel }) {
  return (
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
              <option value="EMPLOYEE_PROJECT">{"Employee account"}</option>
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
            {"Scoped visit register. Select a name to open visit details."}
          </caption>
          <thead id="register-head">{content(model, "register-head")}</thead>
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
  );
}
