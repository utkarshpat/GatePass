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
export function AccountAreasView({ model }: { model: AdminModel }) {
  return (
    <section
      id="admin-projects"
      aria-label="Accounts and common areas"
      hidden={hidden(model, "admin-projects")}
    >
      {"\n      "}
      <div className="page-head">
        {"\n        "}
        <div className="page-head-copy">
          {"\n          "}
          <h2>{"Accounts & areas"}</h2>
          {"\n          "}
          <p id="projects-summary" className="hint">
            {content(model, "projects-summary")}
          </p>
          {"\n        "}
        </div>
        {"\n        "}
        <div className="page-head-actions">
          {"\n          "}
          <button
            type="button"
            className="primary"
            id="add-project-open"
            hidden={hidden(model, "add-project-open")}
            disabled={disabled(model, "add-project-open", false)}
            onClick={() => action(model, "add-project-open")}
          >
            <span aria-hidden="true">{"+"}</span>
            {" Add"}
          </button>
          {"\n          "}
          <div className="refresh-slot" data-refresh-slot="">
            {model.scope && model.view === "projects" ? (
              <Refresh model={model} />
            ) : null}
          </div>
          {"\n        "}
        </div>
        {"\n      "}
      </div>
      {"\n      "}
      <div
        id="projects-tabs"
        className="chip-row projects-tabs"
        role="group"
        aria-label="Accounts and areas views"
        hidden={hidden(model, "projects-tabs")}
      >
        {"\n        "}
        <button
          type="button"
          className="choice-chip"
          data-project-tab="catalogue"
          disabled={disabled(model, "", false)}
          onClick={() => dataAction(model, "project-tab", "catalogue")}
          aria-pressed={model.roster.projectTab === "catalogue"}
        >
          {"Accounts & areas"}
        </button>
        {"\n        "}
        <button
          type="button"
          className="choice-chip"
          data-project-tab="groups"
          disabled={disabled(model, "", false)}
          onClick={() => dataAction(model, "project-tab", "groups")}
          aria-pressed={model.roster.projectTab === "groups"}
        >
          {"Account groups"}
        </button>
        {"\n      "}
      </div>
      {"\n      "}
      <div
        id="project-catalogue-panel"
        hidden={hidden(model, "project-catalogue-panel")}
      >
        {"\n      "}
        <div className="list-toolbar">
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
            <label className="sr-only" htmlFor="project-search">
              {"Search accounts and areas"}
            </label>
            {"\n          "}
            <input
              id="project-search"
              type="search"
              maxLength={80}
              autoComplete="off"
              placeholder="Search accounts and areas by name or code"
              value={value(model, "project-search")}
              onChange={(event) =>
                change(model, "project-search", event.target.value)
              }
              disabled={disabled(model, "project-search", false)}
            />
            {"\n        "}
          </div>
          {"\n      "}
        </div>
        {"\n      "}
        <p id="common-catalog-status" className="hint" role="status">
          {content(model, "common-catalog-status")}
        </p>
        {"\n      "}
        <div id="projects" className="project-grid">
          {content(model, "projects")}
        </div>
        {"\n      "}
        <button
          type="button"
          className="secondary load-more-btn"
          id="more-projects"
          hidden={hidden(model, "more-projects")}
          disabled={disabled(model, "more-projects", false)}
          onClick={() => action(model, "more-projects")}
        >
          {"Load more accounts and areas"}
        </button>
        {"\n      "}
      </div>
      {"\n      "}
      <section
        id="project-groups-panel"
        aria-label="Account groups"
        hidden={hidden(model, "project-groups-panel")}
      >
        {"\n        "}
        <div className="page-head">
          {"\n          "}
          <div className="page-head-copy">
            <h3>{"Account groups"}</h3>
            <p className="hint">
              {
                "Group accounts by floor or entry. Account changes automatically update linked guards."
              }
            </p>
          </div>
          {"\n          "}
          <div className="page-head-actions">
            <button
              id="create-project-group"
              type="button"
              className="secondary"
              hidden={hidden(model, "create-project-group")}
              disabled={disabled(model, "create-project-group", false)}
              onClick={() => action(model, "create-project-group")}
            >
              {"Create group"}
            </button>
          </div>
          {"\n        "}
        </div>
        {"\n        "}
        <p
          id="project-groups-status"
          className="hint"
          role="status"
          aria-live="polite"
        >
          {content(model, "project-groups-status")}
        </p>
        {"\n        "}
        <div id="project-group-list" className="roster-grid">
          {content(model, "project-group-list")}
        </div>
        {"\n      "}
      </section>
      {"\n    "}
    </section>
  );
}
