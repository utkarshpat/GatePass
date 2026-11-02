import { hidden } from "../bindings.ts";
import type { AdminModel } from "../model.ts";
import { content, Refresh } from "../slots.tsx";

/** Presentation only; the existing model owns authorization, operations and lifecycle. */
export function OfficesView({ model }: { model: AdminModel }) {
  return (
    <section
      id="admin-offices"
      aria-label="Offices and QR codes"
      hidden={hidden(model, "admin-offices")}
    >
      {"\n      "}
      <div className="page-head">
        {"\n        "}
        <div className="page-head-copy">
          {"\n          "}
          <h2>{"Offices & QR"}</h2>
          {"\n          "}
          <p className="hint">
            {"Registration QR codes and welcome posters for each office."}
          </p>
          {"\n        "}
        </div>
        {"\n        "}
        <div className="page-head-actions">
          <div className="refresh-slot" data-refresh-slot="">
            {model.scope && model.view === "offices" ? (
              <Refresh model={model} />
            ) : null}
          </div>
        </div>
        {"\n      "}
      </div>
      {"\n      "}
      <div className="offices-container">
        {"\n        "}
        <div id="office-list" className="admin-list office-cards-grid">
          {content(model, "office-list")}
        </div>
        {"\n        "}
        <div id="office-qr" hidden={hidden(model, "office-qr")}></div>
        {"\n      "}
      </div>
      {"\n    "}
    </section>
  );
}
