import {
  action,
  change,
  disabled,
  hidden,
  options,
  submit,
  value,
} from "../bindings.ts";
import type { AdminModel } from "../model.ts";
import { content } from "../slots.tsx";

/** Presentation only; the existing model owns authorization, operations and lifecycle. */
export function StaffAccessView({ model }: { model: AdminModel }) {
  return (
    <section
      id="admin-staff"
      aria-label="Users and permissions"
      hidden={hidden(model, "admin-staff")}
    >
      {"\n      "}
      <div className="admin-section-heading">
        <h2>{"Users & permissions"}</h2>
        <button
          id="add-staff-open"
          type="button"
          className="primary"
          hidden={hidden(model, "add-staff-open")}
          disabled={disabled(model, "add-staff-open", false)}
          onClick={() => action(model, "add-staff-open")}
        >
          {"Add user"}
        </button>
      </div>
      {"\n      "}
      <p className="hint">
        {
          "Manage existing users, roles and permissions within your authorized scope. Create guards from Guard assignments."
        }
      </p>
      {"\n      "}
      <form
        id="subject-form"
        className="admin-filterbar staff-filterbar"
        onSubmit={(event) => {
          event.preventDefault();
          if (event.currentTarget.reportValidity())
            submit(model, "subject-form");
        }}
      >
        {"\n        "}
        <div className="filter-field search-field">
          {"\n          "}
          <label htmlFor="subject-search">
            {"\n            "}
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
            {"\n            "}
            <span>{"Find staff"}</span>
            {"\n          "}
          </label>
          {"\n          "}
          <input
            id="subject-search"
            type="search"
            maxLength={80}
            placeholder="Search staff name (at least 2 characters)"
            required={true}
            minLength={2}
            value={value(model, "subject-search")}
            onChange={(event) =>
              change(model, "subject-search", event.target.value)
            }
            disabled={disabled(model, "subject-search", false)}
          />
          {"\n        "}
        </div>
        {"\n        "}
        <button
          className="secondary"
          type="submit"
          disabled={disabled(model, "", false)}
        >
          {"Search"}
        </button>
        {"\n      "}
      </form>
      {"\n      "}
      <p className="hint">
        {
          "Select an existing employee or staff identity to manage its scoped roles."
        }
      </p>
      {"\n\n      "}
      <div id="subject-results" className="admin-list subject-results-list">
        {content(model, "subject-results")}
      </div>
      {"\n      "}
      <button
        id="subjects-more"
        className="secondary load-more-btn"
        type="button"
        hidden={hidden(model, "subjects-more")}
        disabled={disabled(model, "subjects-more", false)}
        onClick={() => action(model, "subjects-more")}
      >
        {"Load more staff"}
      </button>
      {"\n\n      "}
      <section
        id="staff-detail"
        className="staff-detail-container"
        hidden={hidden(model, "staff-detail")}
      >
        {"\n        "}
        <div className="admin-section-heading">
          {"\n          "}
          <div className="subject-title-wrap">
            {"\n            "}
            <div className="staff-avatar-placeholder" aria-hidden="true">
              {"\n              "}
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
              {"\n            "}
            </div>
            {"\n            "}
            <div>
              {"\n              "}
              <h2 id="subject-name">{content(model, "subject-name")}</h2>
              {"\n              "}
              <span className="subtext-muted">
                {"Staff identity roles & permissions"}
              </span>
              {"\n            "}
            </div>
            {"\n          "}
          </div>
          {"\n          "}
          <div className="role-filter-wrap">
            {"\n            "}
            <label htmlFor="role-state">{"Role history"}</label>
            {"\n            "}
            <select
              id="role-state"
              value={value(model, "role-state")}
              onChange={(event) =>
                change(model, "role-state", event.target.value)
              }
              disabled={disabled(model, "role-state", false)}
            >
              {"\n              "}
              <option value="CURRENT">{"Current active roles"}</option>
              {"\n              "}
              <option value="ALL">{"All roles history"}</option>
              {"\n            "}
            </select>
            {"\n          "}
          </div>
          {"\n        "}
        </div>
        {"\n\n        "}
        <button
          id="reset-staff-setup"
          type="button"
          className="secondary"
          hidden={hidden(model, "reset-staff-setup")}
          disabled={disabled(model, "reset-staff-setup", false)}
          onClick={() => action(model, "reset-staff-setup")}
        >
          {"Reset password / setup"}
        </button>
        {"\n        "}
        <div id="staff-roles" className="admin-list staff-roles-list">
          {content(model, "staff-roles")}
        </div>
        {"\n        "}
        <button
          id="roles-more"
          className="secondary load-more-btn"
          type="button"
          hidden={hidden(model, "roles-more")}
          disabled={disabled(model, "roles-more", false)}
          onClick={() => action(model, "roles-more")}
        >
          {"Load more roles"}
        </button>
        {"\n\n        "}
        <form
          id="staff-grant-form"
          className="admin-panel staff-grant-card"
          hidden={hidden(model, "staff-grant-form")}
          onSubmit={(event) => {
            event.preventDefault();
            if (event.currentTarget.reportValidity())
              submit(model, "staff-grant-form");
          }}
        >
          {"\n          "}
          <div className="panel-header">
            {"\n            "}
            <h3>{"Assign role & scope"}</h3>
            {"\n            "}
            <p className="hint">
              {"Grant scoped permissions to this staff member"}
            </p>
            {"\n          "}
          </div>
          {"\n          "}
          <div className="admin-form-grid">
            {"\n            "}
            <div className="field">
              {"\n              "}
              <label htmlFor="staff-role">{"Role and scope"}</label>
              {"\n              "}
              <select
                id="staff-role"
                required={true}
                value={value(model, "staff-role")}
                onChange={(event) =>
                  change(model, "staff-role", event.target.value)
                }
                disabled={disabled(model, "staff-role", false)}
              >
                {options(model, "staff-role")?.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
              {"\n            "}
            </div>
            {"\n            "}
            <div className="field">
              {"\n              "}
              <label htmlFor="staff-until">{"Valid until (optional)"}</label>
              {"\n              "}
              <input
                id="staff-until"
                type="datetime-local"
                value={value(model, "staff-until")}
                onChange={(event) =>
                  change(model, "staff-until", event.target.value)
                }
                disabled={disabled(model, "staff-until", false)}
              />
              {"\n            "}
            </div>
            {"\n          "}
          </div>
          {"\n          "}
          <fieldset id="staff-capabilities" className="capabilities-fieldset">
            {content(model, "staff-capabilities")}
          </fieldset>
          {"\n          "}
          <div className="field">
            {"\n            "}
            <label htmlFor="staff-reason">
              {"Assignment justification / Reason"}
            </label>
            {"\n            "}
            <input
              id="staff-reason"
              maxLength={300}
              placeholder="e.g. Account Delivery Lead delegation"
              required={true}
              value={value(model, "staff-reason")}
              onChange={(event) =>
                change(model, "staff-reason", event.target.value)
              }
              disabled={disabled(model, "staff-reason", false)}
            />
            {"\n          "}
          </div>
          {"\n          "}
          <div className="panel-actions">
            {"\n            "}
            <button
              className="primary"
              id="staff-grant"
              type="submit"
              disabled={disabled(model, "staff-grant", false)}
            >
              {"Assign role"}
            </button>
            {"\n          "}
          </div>
          {"\n        "}
        </form>
        {"\n      "}
      </section>
      {"\n    "}
    </section>
  );
}
