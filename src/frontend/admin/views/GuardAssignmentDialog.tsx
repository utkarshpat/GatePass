import { Dialog } from "../../shared/controls.tsx";
import {
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
export function GuardAssignmentDialog({ model }: { model: AdminModel }) {
  return (
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
                onClick={() => dataAction(model, "reason", "Shift assignment")}
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
  );
}
