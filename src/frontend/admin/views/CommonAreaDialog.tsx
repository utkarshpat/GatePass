import { Dialog } from "../../shared/controls.tsx";
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
export function CommonAreaDialog({ model }: { model: AdminModel }) {
  return (
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
  );
}
