import { Dialog } from "../../shared/controls.tsx";
import { change, dataAction, disabled, submit, value } from "../bindings.ts";
import type { AdminModel } from "../model.ts";
import { content } from "../slots.tsx";

/** Presentation only; the existing model owns authorization, operations and lifecycle. */
export function ProjectGroupDialog({ model }: { model: AdminModel }) {
  return (
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
  );
}
