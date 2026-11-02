import {
  action,
  change,
  disabled,
  hidden,
  submit,
  value,
} from "../bindings.ts";
import type { AdminModel } from "../model.ts";
import { content } from "../slots.tsx";

/** Presentation only; the existing model owns authorization, operations and lifecycle. */
export function AuditLogView({ model }: { model: AdminModel }) {
  return (
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
          if (event.currentTarget.reportValidity()) submit(model, "audit-form");
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
            onChange={(event) => change(model, "audit-to", event.target.value)}
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
        <label id="audit-all-label" hidden={hidden(model, "audit-all-label")}>
          <input
            id="audit-all"
            type="checkbox"
            checked={!!model.checks["audit-all"]}
            onChange={(event) => model.check("audit-all", event.target.checked)}
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
  );
}
