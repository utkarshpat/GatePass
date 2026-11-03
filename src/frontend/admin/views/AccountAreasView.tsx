import { useEffect, useState, type ReactNode } from "react";
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
import { AccountCards } from "../AccountsView.tsx";

type Setup = "projects" | "hosts" | "policies" | "groups";
/** Keeps all catalogue setup in the existing scoped Admin shell. */
export function AccountAreasView({
  model,
  renderSetup,
}: {
  model: AdminModel;
  renderSetup?: (section: Setup, accountId?: string) => ReactNode;
}) {
  const query = new URLSearchParams(location.search);
  const requested = query.get("setup") ?? "accounts";
  const [tab, setTab] = useState(
      ["projects", "areas", "groups", "policies", "legacy"].includes(requested)
        ? requested === "groups"
          ? "areas"
          : requested
        : "accounts",
    ),
    [areaTab, setAreaTab] = useState(
      requested === "groups" ? "groups" : "areas",
    ),
    [accountId, setAccountId] = useState<string>(query.get("account") ?? "");
  const setup =
    tab === "projects"
      ? "projects"
      : tab === "policies"
        ? "policies"
        : tab === "areas" && areaTab === "groups"
          ? "groups"
          : null;
  const canManage = !!model.scope?.canManageRoles;
  useEffect(() => {
    if (
      tab === "legacy" &&
      model.scope?.canManageProjectGroups &&
      model.roster.projectTab !== "groups"
    )
      dataAction(model, "project-tab", "groups");
  }, [tab, model, model.scope]);
  const select = (next: string) => {
    setTab(next);
    const url = new URL(location.href);
    url.searchParams.set("view", "projects");
    url.searchParams.set("setup", next);
    url.hash = "";
    history.replaceState(null, "", url.pathname + url.search);
    dataAction(
      model,
      "project-tab",
      next === "legacy" ? "groups" : "catalogue",
    );
  };
  return (
    <section
      id="admin-projects"
      aria-label="Accounts and common areas"
      hidden={hidden(model, "admin-projects")}
    >
      <div className="page-head">
        <div className="page-head-copy">
          <h2>Accounts & areas</h2>
          <p id="projects-summary" className="hint">
            {content(model, "projects-summary")}
          </p>
        </div>
        <div className="page-head-actions">
          <button
            type="button"
            className="primary"
            id="add-project-open"
            hidden={hidden(model, "add-project-open")}
            disabled={disabled(model, "add-project-open", false)}
            onClick={() => action(model, "add-project-open")}
          >
            <span aria-hidden="true">+</span> Add
          </button>
          {model.scope && model.view === "projects" && (
            <Refresh model={model} />
          )}
        </div>
      </div>
      <div
        id="projects-tabs"
        className="chip-row projects-tabs"
        role="group"
        aria-label="Accounts and areas views"
      >
        {[
          ["accounts", "Accounts"],
          ["areas", "Areas & groups"],
          ...(canManage ? [["policies", "Approvals & responsibilities"]] : []),
          ...(model.scope?.canManageProjectGroups
            ? [["legacy", "Guard account groups"]]
            : []),
        ].map(([key, label]) => (
          <button
            type="button"
            className="choice-chip"
            key={key}
            data-project-tab={key === "legacy" ? "groups" : key === "accounts" ? "catalogue" : undefined}
            aria-pressed={
              tab === key || (key === "accounts" && tab === "projects")
            }
            disabled={model.writing}
            onClick={() => select(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "areas" && (
        <div className="chip-row" role="group" aria-label="Area setup">
          <button
            type="button"
            className="choice-chip"
            aria-pressed={areaTab === "areas"}
            onClick={() => {
              setAreaTab("areas");
              const url = new URL(location.href);
              url.searchParams.set("setup", "areas");
              history.replaceState(null, "", url.pathname + url.search);
            }}
          >
            Common areas
          </button>
          {canManage && (
            <button
              type="button"
              className="choice-chip"
              aria-pressed={areaTab === "groups"}
              onClick={() => {
                setAreaTab("groups");
                const url = new URL(location.href);
                url.searchParams.set("setup", "groups");
                history.replaceState(null, "", url.pathname + url.search);
              }}
            >
              Approval & notification groups
            </button>
          )}
        </div>
      )}
      {tab === "projects" && (
        <div className="page-head">
          <button
            type="button"
            className="secondary"
            onClick={() => select("accounts")}
          >
            ← All accounts
          </button>
          <p className="hint">
            Account → Projects → Approved visit hosts. Account hosts are managed
            on the account card.
          </p>
        </div>
      )}
      {setup && canManage && renderSetup && (
        <div
          className="admin-embedded-coordination"
          key={
            (model.office?.locationId ?? 0) +
            ":" +
            setup +
            ":" +
            (accountId ?? "")
          }
        >
          {renderSetup(setup, accountId)}
        </div>
      )}
      <div id="project-catalogue-panel" hidden={!!setup || tab === "legacy"}>
        <div className="list-toolbar">
          <div className="search-box">
            <label className="sr-only" htmlFor="project-search">
              Search accounts and areas
            </label>
            <input
              id="project-search"
              type="search"
              maxLength={80}
              autoComplete="off"
              placeholder={
                tab === "areas"
                  ? "Search areas"
                  : "Search accounts by name or code"
              }
              value={value(model, "project-search")}
              onChange={(event) =>
                change(model, "project-search", event.target.value)
              }
              disabled={disabled(model, "project-search", false)}
            />
          </div>
        </div>
        <p id="common-catalog-status" className="hint" role="status">
          {content(model, "common-catalog-status")}
        </p>
        <div id="projects" className="project-grid">
          <AccountCards
            model={model}
            kind={tab === "areas" ? "area" : "project"}
            onProjects={
              canManage
                ? (id) => {
                    setAccountId(id);
                    select("projects");
                    const url = new URL(location.href);
                    url.searchParams.set("account", id);
                    history.replaceState(null, "", url.pathname + url.search);
                  }
                : undefined
            }
          />
        </div>
        <button
          type="button"
          className="secondary load-more-btn"
          id="more-projects"
          hidden={hidden(model, "more-projects")}
          disabled={disabled(model, "more-projects", false)}
          onClick={() => action(model, "more-projects")}
        >
          Load more
        </button>
      </div>
      <section
        id="project-groups-panel"
        aria-label="Guard account groups"
        hidden={tab !== "legacy" || !model.scope?.canManageProjectGroups}
      >
        <div className="page-head">
          <div className="page-head-copy">
            <h3>Guard account groups</h3>
            <p className="hint">
              Group accounts by floor or entry for guard assignments. These
              groups do not send visit emails.
            </p>
          </div>
          <button
            id="create-project-group"
            type="button"
            className="secondary"
            hidden={hidden(model, "create-project-group")}
            disabled={disabled(model, "create-project-group", false)}
            onClick={() => action(model, "create-project-group")}
          >
            Create group
          </button>
        </div>
        <p
          id="project-groups-status"
          className="hint"
          role="status"
          aria-live="polite"
        >
          {content(model, "project-groups-status")}
        </p>
        <div id="project-group-list" className="roster-grid">
          {content(model, "project-group-list")}
        </div>
      </section>
    </section>
  );
}
