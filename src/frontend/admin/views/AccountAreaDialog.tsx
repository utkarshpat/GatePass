import { Dialog } from "../../shared/controls.tsx";
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
export function AccountAreaDialog({ model }: { model: AdminModel }) {
  return (
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
  );
}
