import { Dialog } from "../../shared/controls.tsx";
import { dataAction, disabled } from "../bindings.ts";
import type { AdminModel } from "../model.ts";
import { content } from "../slots.tsx";

/** Presentation only; the existing model owns authorization, operations and lifecycle. */
export function AdminProfileDialog({ model }: { model: AdminModel }) {
  return (
    <Dialog
      className="app-dialog"
      id="admin-profile-dialog"
      aria-labelledby="admin-profile-title"
      open={!!model.dialogs["admin-profile-dialog"]}
      onDismiss={() => model.close("admin-profile-dialog")}
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
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          {"\n      "}
          <h2 id="admin-profile-title">{"Admin Profile"}</h2>
          {"\n    "}
        </div>
        {"\n    "}
        <button
          type="button"
          className="quiet dialog-close-btn"
          data-close="admin-profile-dialog"
          aria-label="Close profile"
          disabled={disabled(model, "", false)}
          onClick={() => dataAction(model, "close", "admin-profile-dialog")}
        >
          {"✕"}
        </button>
        {"\n  "}
      </div>
      {"\n  "}
      <div className="dialog-body" id="profile-content">
        {content(model, "profile-content")}
      </div>
      {"\n"}
    </Dialog>
  );
}
