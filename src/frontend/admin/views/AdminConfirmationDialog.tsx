import { Dialog } from "../../shared/controls.tsx";
import { change, dataAction, disabled, submit, value } from "../bindings.ts";
import type { AdminModel } from "../model.ts";
import { content } from "../slots.tsx";

/** Presentation only; the existing model owns authorization, operations and lifecycle. */
export function AdminConfirmationDialog({ model }: { model: AdminModel }) {
  return (
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
            <label htmlFor="admin-confirm-reason">{"Reason for change"}</label>
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
  );
}
