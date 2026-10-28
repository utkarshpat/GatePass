import type { PageProps } from "../types.ts";
import { InstallButton, ToastNotice } from "../components.tsx";
import { useStaffModel } from "../staffModel.ts";
export default function StaffPage({ config }: PageProps) {
  const ui = useStaffModel();
  return (
    <>
      {"\n"}
      <header className="reception-header entry-header">
        <div className="header-brand">
          <img src={config.companyLogo} width="192" alt="Sopra Steria" />
          <span className="portal-tag">{"Staff Portal"}</span>
        </div>
        <InstallButton className="secondary pwa-btn">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          {"Install App"}
        </InstallButton>
      </header>
      {"\n"}
      <main className="entry-layout">
        <section className="entry-visual" aria-label="Campus Visual">
          <img
            className="entry-office"
            src="/assets/office-background.png"
            alt=""
            fetchPriority="high"
          />
          <div className="visual-scrim"></div>
          <div className="visual-content">
            <div className="visual-badge">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>
              <span>{"Secure Identity & Access"}</span>
            </div>
            <h2>{"Unified GatePass Management"}</h2>
            <p>
              {
                "Operational access for Security, Reception, and Administration."
              }
            </p>
          </div>
        </section>
        <div className="entry-panel">
          <div className="entry-panel-content">
            <p
              id="entry-loading"
              role="status"
              className="loading-state"
              hidden={ui.screen !== "loading"}
            >
              <span className="spinner" aria-hidden="true"></span>
              {"Verifying session…"}
            </p>
            <section
              id="staff-entry"
              className="reception-login"
              hidden={ui.screen !== "login"}
            >
              <h1>{"Staff Sign in"}</h1>
              <form id="entry-form" onSubmit={ui.submit}>
                <div className="field">
                  <label htmlFor="entry-login">{"Email or Staff ID"}</label>
                  <input
                    id="entry-login"
                    type="text"
                    maxLength={320}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck="false"
                    placeholder="name@soprasteria.com"
                    required={true}
                    ref={ui.loginRef}
                    value={ui.login}
                    onChange={(e) => ui.setLogin(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="entry-password">{"Password"}</label>
                  <div className="staff-password-control">
                    <input
                      id="entry-password"
                      type={ui.showPassword ? "text" : "password"}
                      maxLength={512}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      required={true}
                      ref={ui.passwordRef}
                      value={ui.password}
                      onChange={(e) => ui.setPassword(e.target.value)}
                    />
                    <button
                      id="entry-password-toggle"
                      className="quiet"
                      type="button"
                      aria-label={
                        ui.showPassword ? "Hide password" : "Show password"
                      }
                      aria-pressed={ui.showPassword}
                      onClick={() => ui.setShowPassword(!ui.showPassword)}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        aria-hidden="true"
                      >
                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                        <path
                          className="staff-password-slash"
                          d="m3 3 18 18"
                        ></path>
                      </svg>
                    </button>
                  </div>
                </div>
                <button
                  className="primary"
                  id="entry-submit"
                  disabled={ui.busy}
                >
                  {"Sign in"}
                </button>
              </form>
            </section>
            <section
              id="staff-setup"
              className="reception-login"
              hidden={ui.screen !== "setup"}
            >
              <h1>{"Set your password"}</h1>
              <p>
                {"Activate your staff account using this one-time setup link."}
              </p>
              <form id="staff-setup-form" onSubmit={ui.submitSetup}>
                <div className="field">
                  <label htmlFor="setup-password">{"New password"}</label>
                  <input
                    id="setup-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={15}
                    maxLength={128}
                    required={true}
                    aria-describedby="setup-policy"
                    disabled={ui.busy || ui.setupBlocked}
                    value={ui.newPassword}
                    onChange={(e) => ui.setNewPassword(e.target.value)}
                  />
                  <p id="setup-policy" className="hint">
                    {"Use a passphrase of 15–128 characters."}
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="setup-confirm">{"Confirm password"}</label>
                  <input
                    id="setup-confirm"
                    type="password"
                    autoComplete="new-password"
                    minLength={15}
                    maxLength={128}
                    required={true}
                    disabled={ui.busy || ui.setupBlocked}
                    value={ui.confirm}
                    onChange={(e) => ui.setConfirm(e.target.value)}
                  />
                </div>
                <p id="setup-status" role="status">
                  {ui.setupStatus}
                </p>
                <button
                  id="setup-submit"
                  className="primary"
                  type="submit"
                  disabled={ui.busy || ui.setupBlocked}
                >
                  {"Set password"}
                </button>
              </form>
              <button
                id="setup-sign-in"
                type="button"
                className="secondary"
                hidden={!ui.recovery}
                onClick={ui.signInInstead}
              >
                {"Go to sign in"}
              </button>
              <p className="hint">
                {"Link expired? Ask your administrator for a new setup link."}
              </p>
            </section>
            <section
              id="staff-access"
              className="reception-login"
              hidden={ui.screen !== "access"}
            >
              <h1>{"Your Workspaces"}</h1>
              <p id="entry-name" className="user-greeting">
                {ui.context?.displayName}
              </p>
              <div id="entry-workspaces" className="workspaces-grid">
                {ui.context?.workspaces.map((workspace) => (
                  <a
                    key={workspace.code}
                    className="primary"
                    href={ui.destinations[workspace.code]}
                  >
                    {workspace.name}
                  </a>
                ))}
              </div>
              <p
                id="entry-unavailable"
                className="hint"
                hidden={!!ui.context?.workspaces.length}
              >
                {"No active workspace assigned to this account."}
              </p>
              <button
                type="button"
                className="secondary logout-btn"
                id="entry-logout"
                onClick={ui.logout}
              >
                {"Sign out"}
              </button>
            </section>
          </div>
          <footer className="entry-brand">
            <img src={config.gatepassLogo} alt="GatePass" width="72" />
          </footer>
        </div>
      </main>
      {"\n"}
      <ToastNotice message={ui.notice} onDismiss={() => ui.setNotice(null)} />
    </>
  );
}
