import type { PageConfig } from "../../types.ts";
import { Dialog } from "../../shared/controls.tsx";
import { action, dataAction, disabled } from "../bindings.ts";
import type { AdminModel } from "../model.ts";
import { downloadPosterPng } from "../poster.ts";
import { content } from "../slots.tsx";

/** Presentation only; the existing model owns authorization, operations and lifecycle. */
export function OfficePosterDialog({
  model,
  config,
}: {
  model: AdminModel;
  config: PageConfig;
}) {
  return (
    <Dialog
      className="app-dialog qr-dialog"
      id="qr-dialog"
      closedby="any"
      aria-labelledby="qr-modal-title"
      open={!!model.dialogs["qr-dialog"]}
      onDismiss={() => model.close("qr-dialog")}
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
            <rect x="3" y="3" width="7" height="7"></rect>
            <rect x="14" y="3" width="7" height="7"></rect>
            <rect x="14" y="14" width="7" height="7"></rect>
            <rect x="3" y="14" width="7" height="7"></rect>
          </svg>
          {"\n      "}
          <div>
            {"\n        "}
            <h2 id="qr-modal-title">{content(model, "qr-modal-title")}</h2>
            {"\n        "}
            <span className="subtext-muted">
              {"Touchless Digital ID & Visitor Signage"}
            </span>
            {"\n      "}
          </div>
          {"\n    "}
        </div>
        {"\n    "}
        <button
          type="button"
          className="quiet dialog-close-btn"
          data-close="qr-dialog"
          aria-label="Close registration standee"
          disabled={disabled(model, "", false)}
          onClick={() => dataAction(model, "close", "qr-dialog")}
        >
          {"✕"}
        </button>
        {"\n  "}
      </div>
      {"\n  "}
      <div className="dialog-body qr-modal-body">
        {"\n    "}
        {"\n    "}
        <div
          id="qr-poster"
          className="qr-poster-card"
          role="region"
          aria-label="Office registration standee poster"
        >
          {"\n      "}
          <div className="poster-accent-bar"></div>
          {"\n\n      "}
          <div className="poster-brand-center">
            {"\n        "}
            <img
              src={config.companyLogo}
              width="200"
              alt="Sopra Steria"
              className="poster-company-logo"
            />
            {"\n      "}
          </div>
          {"\n\n      "}
          <div className="poster-welcome-styled">
            {"\n        "}
            <span className="poster-welcomes-script">{"welcomes you"}</span>
            {"\n        "}
            <span id="qr-poster-location" className="poster-location-subtle">
              {content(model, "qr-poster-location")}
            </span>
            {"\n        "}
            <span id="qr-title" hidden={true}>
              {content(model, "qr-title")}
            </span>
            {"\n      "}
          </div>
          {"\n\n      "}
          <div className="poster-qr-frame">
            {"\n        "}
            <img
              id="qr-image"
              width="280"
              height="280"
              alt="Office registration QR code"
              className="poster-qr-img"
              src={model.records.qr?.dataUrl}
            />
            {"\n      "}
          </div>
          {"\n\n      "}
          <div className="poster-scan-pill">
            {"\n        "}
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
            {"\n        "}
            <span>{"Scan the above QR to get your Digital Pass"}</span>
            {"\n      "}
          </div>
          {"\n\n      "}
          <div className="poster-footer">
            {"\n        "}
            <div className="poster-url-row">
              {"\n          "}
              <span className="poster-url-label">
                {"Unable to scan? Visit:"}
              </span>
              {"\n          "}
              <span id="qr-link" className="poster-url-value">
                {content(model, "qr-link")}
              </span>
              {"\n        "}
            </div>
            {"\n        "}
            <p className="poster-help-text">
              {"You can ask reception for help"}
            </p>
            {"\n      "}
          </div>
          {"\n    "}
        </div>
        {"\n\n    "}
        {"\n    "}
        <div className="qr-modal-actions">
          {"\n      "}
          <div className="qr-btn-group">
            {"\n        "}
            <button
              id="qr-download-poster"
              type="button"
              className="primary qr-action-btn"
              disabled={disabled(model, "qr-download-poster", false)}
              onClick={() => {
                const qr = model.records.qr;
                if (qr)
                  void downloadPosterPng(
                    qr.office,
                    qr.dataUrl,
                    qr.locationName,
                    qr.url,
                    document.querySelector<HTMLImageElement>(
                      ".poster-company-logo",
                    ),
                    document.querySelector<HTMLImageElement>("#qr-image"),
                    getComputedStyle(
                      document.querySelector(".poster-welcomes-script")!,
                    ).fontFamily,
                  );
              }}
            >
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
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
              {"\n          "}
              <span>{"Download Poster (PNG)"}</span>
              {"\n        "}
            </button>
            {"\n        "}
            <button
              id="qr-print-pdf"
              type="button"
              className="secondary qr-action-btn"
              disabled={disabled(model, "qr-print-pdf", false)}
              onClick={() => action(model, "qr-print-pdf")}
            >
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
                <path d="M6 9V2h12v7"></path>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                <rect x="6" y="14" width="12" height="8"></rect>
              </svg>
              {"\n          "}
              <span>{"Print / Save PDF"}</span>
              {"\n        "}
            </button>
            {"\n      "}
          </div>
          {"\n      "}
          <div className="qr-secondary-row">
            {"\n        "}
            <a
              id="qr-download"
              className="qr-raw-link"
              title="Download raw QR only"
              href={model.records.qr?.dataUrl}
              download={
                model.records.qr
                  ? "GatePass-" +
                    model.records.qr.office.locationCode +
                    "-QR.png"
                  : "office-qr.png"
              }
            >
              {"\n          "}
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              {"\n          "}
              <span>{"Download bare QR code only (PNG)"}</span>
              {"\n        "}
            </a>
            {"\n      "}
          </div>
          {"\n    "}
        </div>
        {"\n  "}
      </div>
      {"\n"}
    </Dialog>
  );
}
