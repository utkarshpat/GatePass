import {
  action,
  change,
  dataAction,
  disabled,
  hidden,
  value,
} from "../bindings.ts";
import type { AdminModel } from "../model.ts";
import { content, Refresh } from "../slots.tsx";

/** Presentation only; the existing model owns authorization, operations and lifecycle. */
export function GuardAssignmentsView({ model }: { model: AdminModel }) {
  return (
    <section
      id="admin-assignments"
      aria-label="Guard account assignments"
      hidden={hidden(model, "admin-assignments")}
    >
      {"\n      "}
      <div className="page-head">
        {"\n        "}
        <div className="page-head-copy">
          {"\n          "}
          <h2>{"Guard assignments"}</h2>
          {"\n          "}
          <p className="hint">
            {"Who is posted where, and which guards are free to assign."}
          </p>
          {"\n        "}
        </div>
        {"\n        "}
        <div className="page-head-actions">
          {"\n          "}
          <button
            id="add-guard-open"
            type="button"
            className="secondary"
            hidden={hidden(model, "add-guard-open")}
            disabled={disabled(model, "add-guard-open", false)}
            onClick={() => action(model, "add-guard-open")}
          >
            {"Add guard"}
          </button>
          {"\n          "}
          <button
            id="assign-guard-open"
            type="button"
            className="primary"
            hidden={hidden(model, "assign-guard-open")}
            disabled={disabled(model, "assign-guard-open", false)}
            onClick={() => action(model, "assign-guard-open")}
          >
            {"\n            "}
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14"></path>
            </svg>
            {"\n            "}
            <span>{"Assign guard"}</span>
            {"\n          "}
          </button>
          {"\n          "}
          <div className="refresh-slot" data-refresh-slot="">
            {model.scope && model.view === "assignments" ? (
              <Refresh model={model} />
            ) : null}
          </div>
          {"\n        "}
        </div>
        {"\n      "}
      </div>
      {"\n\n      "}
      <div id="project-assignments-panel">
        {"\n      "}
        <div id="guard-stats" className="admin-stat-grid guard-stats">
          {content(model, "guard-stats")}
        </div>
        {"\n\n      "}
        <div className="list-toolbar roster-toolbar">
          {"\n        "}
          <div className="range-presets" role="group" aria-label="Guard status">
            {"\n          "}
            <button
              type="button"
              className="range-chip"
              data-guard-filter="all"
              disabled={disabled(model, "", false)}
              onClick={() => dataAction(model, "guard-filter", "all")}
              aria-pressed={model.roster.filter === "all"}
            >
              {"All"}
            </button>
            {"\n          "}
            <button
              type="button"
              className="range-chip"
              data-guard-filter="assigned"
              disabled={disabled(model, "", false)}
              onClick={() => dataAction(model, "guard-filter", "assigned")}
              aria-pressed={model.roster.filter === "assigned"}
            >
              {"Assigned"}
            </button>
            {"\n          "}
            <button
              type="button"
              className="range-chip"
              data-guard-filter="free"
              disabled={model.writing || model.roster.deniedProjects.length > 0}
              onClick={() => dataAction(model, "guard-filter", "free")}
              aria-pressed={model.roster.filter === "free"}
            >
              {"Free"}
            </button>
            {"\n        "}
          </div>
          {"\n        "}
          <div className="search-box">
            {"\n          "}
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            {"\n          "}
            <label className="sr-only" htmlFor="guard-search">
              {"Search guards or accounts"}
            </label>
            {"\n          "}
            <input
              id="guard-search"
              type="search"
              maxLength={80}
              autoComplete="off"
              placeholder="Search guard or account"
              value={value(model, "guard-search")}
              onChange={(event) =>
                change(model, "guard-search", event.target.value)
              }
              disabled={disabled(model, "guard-search", false)}
            />
            {"\n        "}
          </div>
          {"\n        "}
          <div
            className="range-presets"
            role="group"
            aria-label="Group duties by"
          >
            {"\n          "}
            <button
              type="button"
              className="range-chip"
              data-roster-view="guard"
              disabled={disabled(model, "", false)}
              onClick={() => dataAction(model, "roster-view", "guard")}
              aria-pressed={model.roster.view === "guard"}
            >
              {"By guard"}
            </button>
            {"\n          "}
            <button
              type="button"
              className="range-chip"
              data-roster-view="project"
              disabled={disabled(model, "", false)}
              onClick={() => dataAction(model, "roster-view", "project")}
              aria-pressed={model.roster.view === "project"}
            >
              {"By account"}
            </button>
            {"\n        "}
          </div>
          {"\n      "}
        </div>
        {"\n      "}
        <p
          id="roster-status"
          className="filter-status-text"
          role="status"
          aria-live="polite"
        >
          {content(model, "roster-status")}
        </p>
        {"\n\n      "}
        <div
          id="assignment-list"
          className="roster-list"
          hidden={hidden(model, "assignment-list")}
        >
          {content(model, "assignment-list")}
        </div>
        {"\n      "}
        <div
          id="project-duty-list"
          className="roster-grid"
          hidden={hidden(model, "project-duty-list")}
        >
          {content(model, "project-duty-list")}
        </div>
        {"\n      "}
      </div>
      {"\n    "}
    </section>
  );
}
