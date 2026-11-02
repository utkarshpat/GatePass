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
export function StaffOnboardingDialog({ model }: { model: AdminModel }) {
  return (
    <Dialog
      id="add-staff-dialog"
      className="app-dialog"
      aria-labelledby="add-staff-title"
      open={!!model.dialogs["add-staff-dialog"]}
      onDismiss={() => model.close("add-staff-dialog")}
    >
      <div className="dialog-heading">
        <h2 id="add-staff-title">{content(model, "add-staff-title")}</h2>
        <button
          id="close-add-staff"
          className="quiet dialog-close-btn"
          type="button"
          aria-label="Close account creation"
          disabled={disabled(model, "close-add-staff", false)}
          onClick={() => action(model, "close-add-staff")}
        >
          {"×"}
        </button>
      </div>
      <div className="dialog-body">
        <form
          id="add-staff-form"
          hidden={hidden(model, "add-staff-form")}
          onSubmit={(event) => {
            event.preventDefault();
            if (event.currentTarget.reportValidity())
              submit(model, "add-staff-form");
          }}
        >
          <p id="new-staff-help" className="hint">
            {content(model, "new-staff-help")}
          </p>
          <div className="admin-form-grid">
            <div className="field">
              <label htmlFor="new-staff-name">{"Full name"}</label>
              <input
                id="new-staff-name"
                maxLength={200}
                required={true}
                autoComplete="off"
                value={value(model, "new-staff-name")}
                onChange={(event) =>
                  change(model, "new-staff-name", event.target.value)
                }
                disabled={disabled(model, "new-staff-name", false)}
              />
            </div>
            <div className="field">
              <label htmlFor="new-staff-login">{"Login / Staff ID"}</label>
              <input
                id="new-staff-login"
                minLength={3}
                maxLength={64}
                required={true}
                autoComplete="off"
                autoCapitalize="none"
                placeholder="sec-noi-001"
                value={value(model, "new-staff-login")}
                onChange={(event) =>
                  change(model, "new-staff-login", event.target.value)
                }
                disabled={disabled(model, "new-staff-login", false)}
              />
            </div>
            <div className="field">
              <label htmlFor="new-staff-role">{"Role"}</label>
              <select
                id="new-staff-role"
                required={true}
                value={value(model, "new-staff-role")}
                onChange={(event) =>
                  change(model, "new-staff-role", event.target.value)
                }
                disabled={disabled(model, "new-staff-role", false)}
              >
                {options(model, "new-staff-role")?.map((option) => (
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
          </div>
          <p id="new-staff-scope" className="hint">
            {content(model, "new-staff-scope")}
          </p>
          <fieldset
            id="new-staff-capabilities"
            className="capabilities-fieldset"
          >
            {content(model, "new-staff-capabilities")}
          </fieldset>
          <label
            id="new-guard-project-label"
            hidden={hidden(model, "new-guard-project-label")}
          >
            <input
              id="new-guard-project"
              type="checkbox"
              checked={!!model.checks["new-guard-project"]}
              onChange={(event) =>
                model.check("new-guard-project", event.target.checked)
              }
              disabled={disabled(model, "new-guard-project", false)}
            />
            {" Assign to the selected account now"}
          </label>
          <div className="field">
            <label htmlFor="new-staff-reason">
              {"Reason for adding this account"}
            </label>
            <input
              id="new-staff-reason"
              maxLength={300}
              required={true}
              value={value(model, "new-staff-reason")}
              onChange={(event) =>
                change(model, "new-staff-reason", event.target.value)
              }
              disabled={disabled(model, "new-staff-reason", false)}
            />
          </div>
          <button
            id="new-staff-submit"
            type="submit"
            className="primary"
            disabled={disabled(model, "new-staff-submit", false)}
          >
            {"Create account"}
          </button>
        </form>
        <form
          id="staff-reset-form"
          hidden={hidden(model, "staff-reset-form")}
          onSubmit={(event) => {
            event.preventDefault();
            if (event.currentTarget.reportValidity())
              submit(model, "staff-reset-form");
          }}
        >
          <p id="reset-staff-copy">{content(model, "reset-staff-copy")}</p>
          <div className="field">
            <label htmlFor="staff-reset-reason">
              {"Reason for password reset"}
            </label>
            <input
              id="staff-reset-reason"
              maxLength={300}
              required={true}
              value={value(model, "staff-reset-reason")}
              onChange={(event) =>
                change(model, "staff-reset-reason", event.target.value)
              }
              disabled={disabled(model, "staff-reset-reason", false)}
            />
          </div>
          <button
            id="staff-reset-submit"
            type="submit"
            className="primary"
            disabled={disabled(model, "staff-reset-submit", false)}
          >
            {"Generate new setup link"}
          </button>
        </form>
        <p id="new-staff-status" role="status">
          {content(model, "new-staff-status")}
        </p>
        <section
          id="new-staff-result"
          hidden={hidden(model, "new-staff-result")}
        >
          <h3>{"Account ready for password setup"}</h3>
          <p id="new-staff-summary">{content(model, "new-staff-summary")}</p>
          <p id="new-staff-expiry" className="hint">
            {content(model, "new-staff-expiry")}
          </p>
          <label htmlFor="new-staff-link">
            {"One-time password setup link"}
          </label>
          <input
            id="new-staff-link"
            readOnly={true}
            autoComplete="off"
            value={value(model, "new-staff-link")}
            onChange={(event) =>
              change(model, "new-staff-link", event.target.value)
            }
            disabled={disabled(model, "new-staff-link", false)}
          />
          <button
            id="copy-staff-setup"
            className="secondary"
            type="button"
            disabled={disabled(model, "copy-staff-setup", false)}
            onClick={() => action(model, "copy-staff-setup")}
          >
            {"Copy setup link"}
          </button>
          <p className="hint">
            {
              "Share this link directly with the staff member. It can be used once, within 15 minutes. They choose their own password; no email is sent automatically."
            }
          </p>
        </section>
      </div>
    </Dialog>
  );
}
