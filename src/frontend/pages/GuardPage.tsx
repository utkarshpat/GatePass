import { useRef, useMemo, useEffect, useLayoutEffect } from "react";
import { useModel } from "../shared/model.ts";
import { createGuardModel } from "../guard/model.ts";
import {
  createReadings,
  ReadingsContext,
  PersonName,
} from "../guard/readings.tsx";
import {
  GuardLanguageProvider,
  Label,
  translator,
} from "../guard/language.tsx";
import { Dialog, Select } from "../shared/controls.tsx";
import { GuardCard, shortPass } from "../guard/Cards.tsx";
import { PassFields } from "../guard/PassFields.tsx";
import { Timeline } from "../shared/Timeline.tsx";
import { Notices } from "../shared/Notices.tsx";
import { ActionCentre } from "../shared/ActionCentre.tsx";
import { ImageViewer } from "../shared/ImageViewer.tsx";
import type { PageProps } from "../types.ts";
export default function GuardPage({ config }: PageProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [model, ui] = useModel(() =>
    createGuardModel(config, () => video.current),
  );
  const readings = useMemo(
    () => createReadings(model.api, () => model.state.language),
    [model],
  );
  useEffect(() => {
    readings.start();
    return () => readings.dispose();
  }, [readings]);
  useEffect(() => readings.refresh(), [readings, ui.language]);
  const i18n = translator(ui.language),
    v = ui.visit,
    expired = !!v && Date.parse(v.validUntilUtc) <= Date.now();
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ui.accountOpen && menu.current?.matches(":popover-open"))
      menu.current.hidePopover();
  }, [ui.accountOpen]);
  return (
    <GuardLanguageProvider mode={ui.language}>
      <ReadingsContext.Provider value={readings}>
        <>
          <a className="skip" href="#workspace">
            {"Skip to content"}
          </a>
          {"\n"}
          <header className="reception-header guard-header">
            <img src={config.companyLogo} width="192" alt="Sopra Steria" />
            <div id="staff-session" hidden={!ui.displayName}>
              <button
                type="button"
                className="quiet guard-account-button"
                id="account-toggle"
                popoverTarget="account-menu"
                data-i18n-label="Account menu"
                aria-haspopup="menu"
                aria-label={i18n.t("Account menu")}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="8" r="4"></circle>
                  <path d="M4 21v-2a8 8 0 0 1 16 0v2"></path>
                </svg>
              </button>
            </div>
          </header>
          {"\n"}
          <div
            id="account-menu"
            className="guard-account-menu"
            popover="auto"
            role="menu"
            aria-label="Account"
            ref={menu}
            onToggle={(event) => model.setAccount(event.newState === "open")}
          >
            <button
              type="button"
              role="menuitem"
              data-open-profile=""
              disabled={!ui.displayName}
              onClick={model.openProfile}
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                aria-hidden="true"
              >
                <circle cx="12" cy="8" r="4"></circle>
                <path d="M4 21v-2a8 8 0 0 1 16 0v2"></path>
              </svg>
              <span data-i18n="profile">{<Label textKey="profile" />}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              id="language-menu"
              aria-controls="language-options"
              onClick={model.toggleLanguage}
              aria-expanded={ui.languageOpen}
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9"></circle>
                <path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18"></path>
              </svg>
              <span data-i18n="language">{<Label textKey="language" />}</span>
            </button>
            <div
              id="language-options"
              className="guard-language-options"
              role="group"
              aria-label="Language"
              hidden={!ui.languageOpen}
            >
              <button
                type="button"
                role="menuitemradio"
                data-language="en"
                aria-checked={ui.language === "en"}
                onClick={() => model.setLanguage("en")}
              >
                {"English only"}
              </button>
              <button
                type="button"
                role="menuitemradio"
                data-language="en-hi"
                aria-checked={ui.language === "en-hi"}
                onClick={() => model.setLanguage("en-hi")}
              >
                {"English + हिन्दी"}
              </button>
              <button
                type="button"
                role="menuitemradio"
                data-language="en-kn"
                aria-checked={ui.language === "en-kn"}
                onClick={() => model.setLanguage("en-kn")}
              >
                {"English + ಕನ್ನಡ"}
              </button>
              <button
                type="button"
                role="menuitemradio"
                data-language="en-ta"
                aria-checked={ui.language === "en-ta"}
                onClick={() => model.setLanguage("en-ta")}
              >
                {"English + தமிழ்"}
              </button>
              <button
                type="button"
                role="menuitemradio"
                data-language="en-mr"
                aria-checked={ui.language === "en-mr"}
                onClick={() => model.setLanguage("en-mr")}
              >
                {"English + मराठी"}
              </button>
            </div>
            <button
              type="button"
              role="menuitem"
              id="staff-logout"
              disabled={ui.busy}
              onClick={() => void model.logout()}
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                aria-hidden="true"
              >
                <path d="M9 4H4v16h5M14 8l4 4-4 4M8 12h10"></path>
              </svg>
              <span data-i18n="logout">{<Label textKey="logout" />}</span>
            </button>
          </div>
          {"\n"}
          <div className="guard-shell">
            <main id="workspace" className="guard-workspace" tabIndex={-1}>
              <div className="guard-page-heading">
                <form
                  id="visitor-search-form"
                  role="search"
                  className="guard-search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    model.submitSearch();
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    aria-hidden="true"
                  >
                    <circle cx="10.5" cy="10.5" r="6.5"></circle>
                    <path d="m16 16 5 5"></path>
                  </svg>
                  <label
                    htmlFor="visitor-search"
                    className="sr-only"
                    data-i18n="Search visitors"
                  >
                    {<Label textKey="Search visitors" />}
                  </label>
                  <input
                    type="search"
                    id="visitor-search"
                    maxLength={100}
                    autoComplete="off"
                    data-i18n-placeholder="Search name, account or pass ID"
                    value={ui.search}
                    onChange={(event) => model.setSearch(event.target.value)}
                    placeholder={
                      i18n.pair("Search name, account or pass ID").en
                    }
                  />
                </form>
                <label
                  className="guard-project-filter"
                  htmlFor="project-filter"
                >
                  <span className="sr-only" data-i18n="Duty">
                    {<Label textKey="Duty" />}
                  </span>
                  <Select
                    id="project-filter"
                    value={
                      ui.duty?.kind === "ALL"
                        ? "ALL"
                        : ui.duty
                          ? ui.duty.kind + ":" + ui.duty.dutyId
                          : ""
                    }
                    onValue={model.selectDuty}
                    label={i18n.t("Duty")}
                    disabled={!ui.duty}
                  >
                    {
                      <>
                        {ui.duties.length ? (
                          <option value="ALL">
                            {i18n.bilingual("All allocations")}
                          </option>
                        ) : null}
                        {ui.duties.map((d) => (
                          <option
                            key={d.kind + ":" + d.dutyId}
                            value={d.kind + ":" + d.dutyId}
                          >
                            {model.allocationLabel(d)}
                          </option>
                        ))}
                      </>
                    }
                  </Select>
                </label>
                <div>
                  <h1
                    className="sr-only"
                    id="view-title"
                    data-i18n="nav.recent"
                  >
                    {<Label textKey="nav.recent" />}
                  </h1>
                  <p id="office-name" className="sr-only">
                    {ui.office?.locationName}
                  </p>
                </div>
                <label
                  id="office-selector"
                  htmlFor="guard-office"
                  hidden={ui.offices.length < 2}
                >
                  <span className="sr-only" data-i18n="office">
                    {<Label textKey="office" />}
                  </span>
                  <Select
                    id="guard-office"
                    value={String(ui.office?.locationId ?? "")}
                    onValue={model.selectOffice}
                    label={i18n.t("Office")}
                  >
                    {
                      <>
                        {ui.offices.map((o) => (
                          <option
                            key={o.locationId}
                            value={String(o.locationId)}
                          >
                            {o.locationName}
                          </option>
                        ))}
                      </>
                    }
                  </Select>
                </label>
              </div>
              <p id="page-status" role="status">
                {i18n.t(ui.pageStatus)}
              </p>
              <section id="guard-dashboard" hidden={!ui.dashboard}>
                {"\n"}
                <section
                  id="view-recent"
                  className="guard-view"
                  aria-labelledby="view-title"
                >
                  <div className="guard-section-toolbar">
                    <div
                      className="guard-queue-tabs"
                      role="tablist"
                      aria-label="Visitors"
                      hidden={
                        ui.duty?.kind === "COMMON" ||
                        (ui.duty?.kind === "ALL" &&
                          !ui.duties.some((d) => d.kind === "PROJECT"))
                      }
                    >
                      <button
                        type="button"
                        role="tab"
                        data-queue="EXPECTED"
                        aria-controls="recent-scans"
                        data-i18n="Expected"
                        aria-selected={ui.queue === "EXPECTED"}
                        tabIndex={ui.queue === "EXPECTED" ? 0 : -1}
                        onClick={() => model.setQueue("EXPECTED")}
                        onKeyDown={(event) => {
                          const tabs = [
                              ...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                                "[data-queue]",
                              ),
                            ],
                            index = tabs.indexOf(event.currentTarget);
                          if (
                            ![
                              "ArrowLeft",
                              "ArrowRight",
                              "Home",
                              "End",
                            ].includes(event.key)
                          )
                            return;
                          event.preventDefault();
                          const next =
                            event.key === "Home"
                              ? tabs[0]
                              : event.key === "End"
                                ? tabs.at(-1)!
                                : tabs[
                                    (index +
                                      (event.key === "ArrowLeft" ? -1 : 1) +
                                      tabs.length) %
                                      tabs.length
                                  ];
                          next.focus();
                          next.click();
                        }}
                      >
                        {<Label textKey="Expected" />}
                      </button>
                      <button
                        type="button"
                        role="tab"
                        data-queue="INSIDE"
                        aria-controls="recent-scans"
                        data-i18n="Inside"
                        aria-selected={ui.queue === "INSIDE"}
                        tabIndex={ui.queue === "INSIDE" ? 0 : -1}
                        onClick={() => model.setQueue("INSIDE")}
                        onKeyDown={(event) => {
                          const tabs = [
                              ...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                                "[data-queue]",
                              ),
                            ],
                            index = tabs.indexOf(event.currentTarget);
                          if (
                            ![
                              "ArrowLeft",
                              "ArrowRight",
                              "Home",
                              "End",
                            ].includes(event.key)
                          )
                            return;
                          event.preventDefault();
                          const next =
                            event.key === "Home"
                              ? tabs[0]
                              : event.key === "End"
                                ? tabs.at(-1)!
                                : tabs[
                                    (index +
                                      (event.key === "ArrowLeft" ? -1 : 1) +
                                      tabs.length) %
                                      tabs.length
                                  ];
                          next.focus();
                          next.click();
                        }}
                      >
                        {<Label textKey="Inside" />}
                      </button>
                    </div>
                    <button
                      type="button"
                      id="refresh-recent"
                      className="quiet guard-refresh"
                      data-i18n-label="Refresh"
                      disabled={ui.loadingRows}
                      onClick={() => void model.recent()}
                      aria-label={i18n.t("Refresh")}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="18"
                        height="18"
                        aria-hidden="true"
                      >
                        <polyline points="23 4 23 10 17 10"></polyline>
                        <polyline points="1 20 1 14 7 14"></polyline>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                      </svg>
                      <span className="refresh-label" data-i18n="Refresh">
                        {<Label textKey="Refresh" />}
                      </span>
                    </button>
                    {
                      <ActionCentre
                        resetKey={
                          ui.contextVersion + ":" + ui.initializeVersion
                        }
                        scope={async () => {
                          if (!model.state.office) return null;
                          const selected = model.state.duty,
                            duty = await model.chooseAllocation(
                              selected?.kind === "ALL"
                                ? model.state.duties
                                : selected
                                  ? [selected]
                                  : [],
                            );
                          return duty
                            ? {
                                body: {
                                  workspace: "GUARD",
                                  ...model.dutyContext(duty),
                                },
                                label:
                                  model.state.office!.locationName +
                                  " \u00B7 " +
                                  model.allocationLabel(duty),
                              }
                            : null;
                        }}
                        openRecord={(row, scope) => {
                          void model.detail(
                            row,
                            model.state.duties.find(
                              (d) =>
                                d.kind === scope.dutyKind &&
                                d.dutyId === scope.dutyId,
                            ),
                          );
                        }}
                      />
                    }
                  </div>
                  <p id="recent-status" role="status" className="sr-only">
                    {ui.recentStatus}
                  </p>
                  <div
                    id="recent-scans"
                    role="tabpanel"
                    aria-busy={ui.loadingRows}
                  >
                    {ui.recentRows.slice(0, ui.renderLimit).map((row) => (
                      <GuardCard
                        key={row.visitRequestId}
                        row={row}
                        model={model}
                        companyLogo={config.companyLogo}
                      />
                    ))}
                  </div>
                  <p
                    id="recent-empty"
                    className="guard-empty"
                    data-i18n="No visitors"
                    hidden={!ui.emptyVisible}
                  >
                    {<Label textKey="No visitors" />}
                  </p>
                  <button
                    id="load-more"
                    className="secondary"
                    type="button"
                    data-i18n="Load more"
                    hidden={
                      ui.queuePaging
                        ? !ui.cursor
                        : ui.renderLimit >= ui.recentRows.length
                    }
                    disabled={ui.loadingRows}
                    onClick={model.loadMore}
                  >
                    {i18n.t("Load more") +
                      " (" +
                      Math.min(ui.renderLimit, ui.recentRows.length) +
                      " / " +
                      (ui.queuePaging ? ui.queueTotal : ui.recentRows.length) +
                      ")"}
                  </button>
                </section>
              </section>
              <button
                className="secondary"
                type="button"
                id="retry-context"
                data-i18n="retry"
                hidden={!ui.retryContext}
                onClick={() =>
                  void (ui.office ? model.loadOffice() : model.initialize())
                }
              >
                {<Label textKey="retry" />}
              </button>
            </main>
          </div>
          {"\n"}
          <button
            type="button"
            id="scan-fab"
            className="guard-scan-fab"
            title="Scan pass"
            data-i18n-label="scan"
            disabled={!ui.duty || ui.liveDenied || ui.busy}
            onClick={() => void model.scan()}
            aria-label={i18n.t("scan")}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"></path>
              <path d="M8 8h2v2H8zM14 8h2v2h-2zM8 14h2v2H8zM14 14h2v2h-2z"></path>
            </svg>
          </button>
          {"\n\n"}
          <Dialog
            id="allocation-dialog"
            className="app-dialog"
            aria-labelledby="allocation-title"
            open={ui.allocationOpen}
            onDismiss={model.closeAllocationChoice}
          >
            <form
              id="allocation-form"
              onSubmit={(event) => {
                event.preventDefault();
                model.confirmAllocation();
              }}
            >
              <div className="dialog-heading">
                <h2 id="allocation-title" data-i18n="Choose allocation">
                  {<Label textKey="Choose allocation" />}
                </h2>
              </div>
              <div className="dialog-body">
                <p
                  className="hint"
                  data-i18n="Choose an allocation to continue."
                >
                  {<Label textKey="Choose an allocation to continue." />}
                </p>
                <div className="field">
                  <label htmlFor="allocation-select" data-i18n="Allocation">
                    {<Label textKey="Allocation" />}
                  </label>
                  <Select
                    id="allocation-select"
                    required={true}
                    value={ui.allocationValue}
                    onValue={model.setAllocation}
                    label={i18n.t("Choose allocation")}
                  >
                    {
                      <>
                        <option value="">{i18n.t("Choose allocation")}</option>
                        {ui.allocationDuties.map((d) => (
                          <option
                            key={d.kind + ":" + d.dutyId}
                            value={d.kind + ":" + d.dutyId}
                          >
                            {model.allocationLabel(d)}
                          </option>
                        ))}
                      </>
                    }
                  </Select>
                </div>
              </div>
              <div className="dialog-actions">
                <button
                  id="allocation-cancel"
                  type="button"
                  className="secondary"
                  data-i18n="Cancel"
                  onClick={model.closeAllocationChoice}
                >
                  {<Label textKey="Cancel" />}
                </button>
                <button type="submit" className="primary" data-i18n="Continue">
                  {<Label textKey="Continue" />}
                </button>
              </div>
            </form>
          </Dialog>
          {"\n"}
          <Dialog
            id="scanner-dialog"
            className="app-dialog guard-scanner-dialog"
            aria-labelledby="scanner-title"
            open={ui.scannerOpen}
            onDismiss={model.closeScanner}
          >
            <div className="dialog-heading">
              <h2 id="scanner-title" data-i18n="scan">
                {<Label textKey="scan" />}
              </h2>
              <button
                type="button"
                className="quiet"
                id="close-scanner"
                data-i18n-label="Close scanner"
                onClick={model.closeScanner}
                aria-label={i18n.t("Close scanner")}
              >
                {"×"}
              </button>
            </div>
            <div className="dialog-body">
              <div className="guard-camera">
                <video
                  id="scan-video"
                  playsInline={true}
                  muted={true}
                  aria-label="QR scanner camera"
                  ref={video}
                  hidden={!ui.stream}
                ></video>
                <div id="camera-placeholder" hidden={!!ui.stream}>
                  <svg
                    viewBox="0 0 24 24"
                    width="22"
                    height="22"
                    aria-hidden="true"
                  >
                    <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"></path>
                    <path d="M8 8h2v2H8zM14 8h2v2h-2zM8 14h2v2H8zM14 14h2v2h-2z"></path>
                  </svg>
                </div>
                <span className="guard-scan-frame" aria-hidden="true"></span>
              </div>
              <p id="camera-status" className="hint" role="status">
                {i18n.t(ui.cameraStatus)}
              </p>
            </div>
          </Dialog>
          {"\n"}
          <Dialog
            id="profile-dialog"
            className="app-dialog guard-profile-dialog"
            aria-labelledby="profile-title"
            open={ui.profileOpen}
            onDismiss={model.closeProfile}
          >
            <div className="dialog-heading">
              <h2 id="profile-title" data-i18n="profile">
                {<Label textKey="profile" />}
              </h2>
              <button
                className="quiet"
                type="button"
                id="close-profile"
                data-i18n-label="Close profile"
                onClick={model.closeProfile}
                aria-label={i18n.t("Close profile")}
              >
                {"×"}
              </button>
            </div>
            <div className="dialog-body">
              <div className="guard-profile-identity">
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="8" r="4"></circle>
                  <path d="M4 21v-2a8 8 0 0 1 16 0v2"></path>
                </svg>
                <h3 id="profile-name">{ui.displayName}</h3>
              </div>
              <dl className="reception-fields">
                <dt data-i18n="role">{<Label textKey="role" />}</dt>
                <dd data-i18n="guard">{<Label textKey="guard" />}</dd>
                <dt data-i18n="office">{<Label textKey="office" />}</dt>
                <dd id="profile-office">
                  {ui.offices.map((v) => v.locationName).join(" \u00B7 ")}
                </dd>
              </dl>
              <h3 data-i18n="Assigned duties">
                {<Label textKey="Assigned duties" />}
              </h3>
              <div
                id="profile-assignments"
                className="guard-profile-assignments"
              >
                {
                  <>
                    {ui.profileAssignments.map((group) => (
                      <div
                        className="guard-profile-location"
                        key={group.office.locationId}
                      >
                        <strong>{group.office.locationName}</strong>
                        {(group.duties.length
                          ? group.duties.map(
                              (d) =>
                                d.name +
                                " \u00B7 " +
                                i18n.t(
                                  d.kind === "COMMON"
                                    ? "Common area"
                                    : "Account",
                                ),
                            )
                          : [i18n.t("No active access assignments.")]
                        ).map((text, index) => (
                          <p key={index}>{text}</p>
                        ))}
                      </div>
                    ))}
                    {ui.profileUnavailable ? (
                      <p>{i18n.t("Assignments unavailable.")}</p>
                    ) : null}
                  </>
                }
              </div>
            </div>
          </Dialog>
          {"\n"}
          <Dialog
            className="app-dialog guard-pass-dialog"
            id="pass-dialog"
            aria-labelledby="pass-title"
            open={ui.passOpen}
            onDismiss={() => model.closePass()}
          >
            <div className="dialog-heading">
              <h2 id="pass-title" data-i18n="pass.details">
                {<Label textKey="pass.details" />}
              </h2>
              <button
                className="quiet"
                type="button"
                id="close-pass"
                data-i18n-label="Close pass"
                disabled={ui.busy}
                onClick={() => model.closePass()}
                aria-label={i18n.t("Close pass")}
              >
                {"×"}
              </button>
            </div>
            <div className="dialog-body">
              <p
                id="pass-status"
                role="status"
                aria-live="polite"
                data-allowed={String(ui.passAllowed)}
              >
                {i18n.t(ui.passStatus)}
              </p>
              <div id="person" className="reception-person" hidden={!v}>
                <img
                  id="person-photo"
                  alt="Pass holder"
                  width="80"
                  height="100"
                  hidden={!ui.photoUrl}
                  src={ui.photoUrl ?? undefined}
                />
                <div>
                  <h3 id="person-name">
                    {v ? <PersonName name={v.personName} /> : null}
                  </h3>
                  <p id="person-reference" className="hint">
                    {v ? (
                      <>
                        {v.hostName ? (
                          <>
                            {i18n.bilingual("Host") + ": "}
                            <PersonName name={v.hostName} />
                            {" \u00B7 "}
                          </>
                        ) : null}
                        {i18n.t("Pass") + " " + shortPass(v.publicPassNumber)}
                      </>
                    ) : null}
                  </p>
                </div>
              </div>
              <dl id="pass-fields" className="reception-fields">
                {v ? <PassFields visit={v} model={model} /> : null}
              </dl>
              <section
                className="pass-timeline-section"
                id="pass-timeline-section"
                aria-label="Movement history"
                hidden={!!v?.verificationOnly}
              >
                <div className="timeline-header">
                  <h3 data-i18n="Movement History">
                    {<Label textKey="Movement History" />}
                  </h3>
                  <span
                    id="timeline-count"
                    className="timeline-badge"
                    hidden={!v?.movements?.length}
                  >
                    {String(v?.movements?.length ?? 0) +
                      (v?.movementsHasMore ? "+" : "")}
                  </span>
                </div>
                <div id="pass-timeline" className="pass-timeline">
                  {
                    <Timeline
                      movements={v?.movements}
                      hasMore={v?.movementsHasMore}
                    />
                  }
                </div>
              </section>
              <p id="reminder-status" role="status">
                {ui.reminderStatus}
              </p>
              <p id="action-status" role="status" aria-live="polite">
                {ui.actionStatus}
              </p>
            </div>
            <div className="dialog-actions">
              <button
                className="secondary"
                type="button"
                id="reconcile-exit"
                data-i18n="Reconcile exit"
                hidden={!v || !ui.passActionsFresh || !v.canReconcileExit}
                disabled={ui.busy}
                onClick={model.openReconcile}
              >
                {<Label textKey="Reconcile exit" />}
              </button>
              <button
                className="secondary"
                type="button"
                id="remind-host"
                hidden={!ui.reminderVisible}
                disabled={ui.reminderBusy}
                onClick={() => void model.remind()}
              >
                {i18n.t("Remind host")}
              </button>
              <button
                className="secondary"
                type="button"
                id="retry-pass"
                data-i18n="pass.refresh"
                hidden={!v}
                disabled={ui.busy}
                onClick={() => void model.refreshPass()}
              >
                {<Label textKey="pass.refresh" />}
              </button>
              <button
                className="secondary"
                type="button"
                id="mark-exit"
                data-i18n="exit"
                hidden={!v || !ui.passActionsFresh || !v.canExit}
                disabled={ui.busy}
                onClick={() => void model.movement("EXIT")}
              >
                {<Label textKey="exit" />}
              </button>
              <button
                className="primary"
                type="button"
                id="mark-entry"
                data-i18n="entry"
                hidden={!v || !ui.passActionsFresh || expired || !v.canEnter}
                disabled={ui.busy}
                onClick={() => void model.movement("ENTRY")}
              >
                {<Label textKey="entry" />}
              </button>
            </div>
          </Dialog>
          {"\n"}
          <Dialog
            id="reconcile-dialog"
            className="app-dialog"
            aria-labelledby="reconcile-title"
            open={ui.reconcileOpen}
            onDismiss={model.closeReconcile}
          >
            <form
              id="reconcile-form"
              onSubmit={(event) => {
                event.preventDefault();
                model.confirmReconcile();
              }}
            >
              <div className="dialog-heading">
                <h2 id="reconcile-title" data-i18n="Reconcile exit">
                  {<Label textKey="Reconcile exit" />}
                </h2>
              </div>
              <div className="dialog-body">
                <label htmlFor="reconcile-reason" data-i18n="Reason">
                  {<Label textKey="Reason" />}
                </label>
                <textarea
                  id="reconcile-reason"
                  maxLength={300}
                  required={true}
                  value={ui.reconcileReason}
                  onChange={(event) => model.setReconcile(event.target.value)}
                ></textarea>
              </div>
              <div className="dialog-actions">
                <button
                  id="cancel-reconcile"
                  type="button"
                  className="secondary"
                  data-i18n="Cancel"
                  onClick={model.closeReconcile}
                >
                  {<Label textKey="Cancel" />}
                </button>
                <button
                  type="submit"
                  className="primary"
                  data-i18n="Confirm exit"
                >
                  {<Label textKey="Confirm exit" />}
                </button>
              </div>
            </form>
          </Dialog>
        </>
        <ImageViewer />
        <Notices items={ui.notices} dismiss={model.dismissNotice} />
      </ReadingsContext.Provider>
    </GuardLanguageProvider>
  );
}
