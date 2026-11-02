import { Dialog } from "../../shared/controls.tsx";
import { dataAction, disabled } from "../bindings.ts";
import type { AdminModel } from "../model.ts";
import { content } from "../slots.tsx";

/** Presentation only; the existing model owns authorization, operations and lifecycle. */
export function AdminVisitDialog({ model }: { model: AdminModel }) {
  return (
    <Dialog
      className="app-dialog visit-dialog"
      id="admin-visit-dialog"
      aria-labelledby="admin-visit-title"
      open={!!model.dialogs["admin-visit-dialog"]}
      onDismiss={() => model.close("admin-visit-dialog")}
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
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
          {"\n      "}
          <div>
            {"\n        "}
            <h2 id="admin-visit-title">
              {content(model, "admin-visit-title")}
            </h2>
            {"\n        "}
            <span className="subtext-muted">
              {"Recorded movement and visit data"}
            </span>
            {"\n      "}
          </div>
          {"\n    "}
        </div>
        {"\n    "}
        <button
          type="button"
          className="quiet dialog-close-btn"
          data-close="admin-visit-dialog"
          aria-label="Close visit"
          disabled={disabled(model, "", false)}
          onClick={() => dataAction(model, "close", "admin-visit-dialog")}
        >
          {"✕"}
        </button>
        {"\n  "}
      </div>
      {"\n  "}
      <div className="dialog-body">
        {"\n    "}
        <p id="admin-visit-status" className="filter-status-text" role="status">
          {content(model, "admin-visit-status")}
        </p>
        {"\n    "}
        <div id="admin-visit-chips" className="visit-chips">
          {content(model, "admin-visit-chips")}
        </div>
        {"\n    "}
        <div className="visit-detail-card">
          {"\n      "}
          <dl id="admin-visit-fields" className="admin-detail-grid">
            {content(model, "admin-visit-fields")}
          </dl>
          {"\n    "}
        </div>
        {"\n    "}
        <div className="timeline-container">
          {"\n      "}
          <h3 className="timeline-heading">{"Visit timeline"}</h3>
          {"\n      "}
          <ol id="admin-visit-timeline" className="timeline-list">
            {content(model, "admin-visit-timeline")}
          </ol>
          {"\n    "}
        </div>
        {"\n  "}
      </div>
      {"\n"}
    </Dialog>
  );
}
