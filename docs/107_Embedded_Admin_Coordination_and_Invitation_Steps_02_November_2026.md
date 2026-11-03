> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# Embedded coordination and numbered invitation form

Updated 2 November 2026. This UI correction preserves the existing Admin interface and the current coordination API/workflow.

## Admin structure

**Visit coordination** now renders inside the existing Admin content area. The original logo/header, office selector, profile/logout menu, Console and Reports & log sidebar groups, icons and role-filtered Admin links remain in use. There is no second coordination header or generic sidebar for an Admin user.

The sidebar opens `/admin?view=coordination`; **Visit groups** opens the same interface with `settings=groups` and the selected office. Opening these sections in the current Admin interface preserves its existing header and office context. Backlinks and old `/coordination` URLs resolve into the Admin interface for an authenticated user with Admin access. Staff who only have coordination access retain their focused coordination page.

Visit deep links retain the Admin view parameter and visit hash through reload. Planning settings also retain their route through reload. Switching the Admin office updates the coordination office filter and clears the previously selected visit. Reopening coordination from the sidebar resets its content without replacing the Admin header.

Both the Admin and coordination APIs continue checking their own scopes. Sidebar state and URL parameters do not grant additional permissions.

## Invitation steps

The invitation uses six numbered stages:

1. **Visitor** — visitor name, optional email/company and office.
2. **Visit** — destination sub-projects, arrival/departure, purpose and VIP flag.
3. **Approvals** — current required reviewer/notification names, additional people and named visit groups.
4. **Details** — category/type, meeting location, agenda, device types and special-access requests.
5. **Support** — accommodation, services, coordinator, visit owner, alternate receiver and requirements.
6. **Review** — read-only summary, links to edit the relevant step and the revision reason when editing an existing draft.

Back/Next and completed-step navigation preserve controlled values. Future steps cannot be skipped before validation. Inactive panels are hidden and disabled; final submission explicitly validates all panels. Clearing a date does not crash the page. Requested services still require a selected internal coordinator, and stale recipient/group selections must be resolved before continuing.

Progress and footer actions remain visible while the current step scrolls. Changing steps returns the modal content to its top and announces the current heading. Entering Review does not save or send anything: saving requires a separate explicit action. Draft submission, approvals, notifications, revision/reset, reception, pass and guard behavior remain unchanged.

## Verification

- Phone/laptop browser coverage exercises form creation, values across Back/Next, invalid fields/dates, explicit save after review, extra approvers, groups, preparation, revision, lost-response retry and existing scoped discussion workflows.
- Real authenticated Admin browser checks cover the retained header/profile/office/sidebar, embedded group management, mobile navigation, old links, detail/settings reload and role-revocation behavior. A routing-only case uses synthetic visit content while retaining real Admin authentication/scope.
- Accessibility and horizontal-fit checks run at phone and laptop widths; screenshots of the Admin interface and numbered form were inspected.
- No SQL migration, runtime grant, email integration or new pass/movement operation was introduced by this UI correction. Browser mail checks continue to use a synthetic database and mock Graph provider.

Changes remain local until explicitly committed/pushed.

Acceptance completed: 723 unit cases (722 passed, one platform skip); 17 coordination browser cases (16 in the full run and the updated settings-reload case in a focused run); 12 Admin/shared-navigation browser cases; 174 isolated SQL checks through the coordination harness; typecheck, lint, 219-module architecture checks and seven frontend builds. Phone/laptop screenshots were inspected. Localhost was restarted on port 8443 and a read-only Admin/host smoke check passed. No real invitation was saved or email sent by that smoke check. No commit or push was made.
