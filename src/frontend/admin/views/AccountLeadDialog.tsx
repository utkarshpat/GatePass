import { Dialog, Select } from "../../shared/controls.tsx";
import {
  action,
  change,
  disabled,
  hidden,
  options,
  submit,
  value,
} from "../bindings.ts";
import type { AdminModel } from "../model.ts";
import { content } from "../slots.tsx";

/** Presentation only; the existing model owns authorization, operations and lifecycle. */
export function AccountLeadDialog({ model }: { model: AdminModel }) {
  return (
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
  );
}
