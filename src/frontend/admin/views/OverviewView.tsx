import { hidden } from "../bindings.ts";
import type { AdminModel } from "../model.ts";
import { content } from "../slots.tsx";

/** Presentation only; the existing model owns authorization, operations and lifecycle. */
export function OverviewView({ model }: { model: AdminModel }) {
  return (
    <section
      id="admin-overview"
      aria-label="Operational overview"
      hidden={hidden(model, "admin-overview")}
    >
      {"\n      "}
      <div className="overview-section">
        {"\n        "}
        <div className="section-title-strip">
          {"\n          "}
          <h2>{"Visit summary"}</h2>
          {"\n          "}
          <span id="summary-range-label" className="badge-neutral">
            {content(model, "summary-range-label")}
          </span>
          {"\n        "}
        </div>
        {"\n        "}
        <div id="summary-cards" className="admin-stat-grid">
          {content(model, "summary-cards")}
        </div>
        {"\n      "}
      </div>
      {"\n\n      "}
      <div className="overview-charts">
        {"\n        "}
        <section className="chart-card" aria-labelledby="chart-status-title">
          {"\n          "}
          <h3 id="chart-status-title">{"Approval status"}</h3>
          {"\n          "}
          <div id="chart-status" className="chart-body">
            {content(model, "chart-status")}
          </div>
          {"\n        "}
        </section>
        {"\n        "}
        <section
          className="chart-card chart-card-wide"
          aria-labelledby="chart-trend-title"
        >
          {"\n          "}
          <h3 id="chart-trend-title">{content(model, "chart-trend-title")}</h3>
          {"\n          "}
          <div id="chart-trend" className="chart-body">
            {content(model, "chart-trend")}
          </div>
          {"\n        "}
        </section>
        {"\n      "}
      </div>
      {"\n\n      "}
      <div className="admin-note presence-section">
        {"\n        "}
        <div className="section-title-strip">
          {"\n          "}
          <div className="presence-title">
            {"\n            "}
            <span className="live-pulse-dot" aria-hidden="true"></span>
            {"\n            "}
            <h2>{"Current recorded presence"}</h2>
            {"\n          "}
          </div>
          {"\n          "}
          <span className="badge-live">{"Latest recorded presence"}</span>
          {"\n        "}
        </div>
        {"\n        "}
        <div id="presence-cards" className="admin-stat-grid presence-grid">
          {content(model, "presence-cards")}
        </div>
        {"\n        "}
        <p className="hint">
          {
            "Presence reflects the latest refresh; visit totals reflect the selected dates above."
          }
        </p>
        {"\n      "}
      </div>
      {"\n    "}
    </section>
  );
}
