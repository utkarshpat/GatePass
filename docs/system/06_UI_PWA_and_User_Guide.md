# 06. UI, PWA and user guide

> Maintained source handbook — **3 November 2026 · migrations 001–136**. [Current status and evidence](11_Readiness_Gaps_and_Roadmap.md) · [Terminology](../109_Visit_Owner_and_Host_Terminology_03_November_2026.md). Source review is not production acceptance.

## Pages and navigation

Seven main page bundles use native React/TypeScript state, models and event handlers. New UI belongs in `src/frontend`; print/offline documents remain HTML. Existing CSS/tokens are shared. Older screenshot packages are historical state examples, not a current route count or proof that every state uses live data.

| Entry | Current use |
|---|---|
| `/` | Staff sign-in and direct authorized landing; no workspace chooser |
| `/office/noida` and other configured office codes | Office-bound visitor/employee self-service |
| `/guard` | Cards, duty filters/search, scanner and authorized actions |
| `/reception` | Operational queues, lookup/history, printing/returns |
| `/admin` | Original Admin header, office selector, profile and scoped sidebar |
| `/coordination` | Coordination-only staff; Admin users resolve into embedded `/admin?view=coordination` |
| `/approval/{id}`, `/request/{id}` | Existing minimal Host review / holder status |
| `/pwa/offline.html` | Public reconnect fallback, no authorized offline workspace |

Coordination-only users see **My visits**, **Assigned to me**, **Participating** directly in the sidebar. Admin users see them nested under Visit coordination, alongside the original modules. Phone navigation uses a drawer; the selected folder survives reload. Visit detail links retain the plan fragment. Ineligible sections are hidden and the server independently authorizes every request.

## Self-service

Visitor registration is individual: optional company/device types, Valid until and office-wide private Host search, purpose, live camera photo, review and downloadable status/card. No public project/account picker or gallery upload. Desktop pairs Host and Valid until; mobile stacks them. All calendar-day labels show final included date 23:59 while stored expiry remains exclusive.

Employee Digital ID and account-access requests remain same-day, with explicit primary/eligible offices and memberships. An employee can reopen current status/pass without an employee workspace. Email review is distinct from pre-planning.

## Guard

Use main-page search, duty filter and Expected/Inside tabs. Scanner is a thumb-accessible FAB. Open/scan a card for current details/movement timeline and explicit Check in/Check out. Verification alone does not enter. Common-area duty has no account movement. Privileged reconciliation is reasoned and audited.

Profile/language/sign-out are in the account menu. Language modes are English or English plus Hindi, Kannada, Tamil or Marathi. These are guard helper modes, not a claim that the whole application is fully translated or native-speaker accepted.

## Reception

Use operational queues, supported person/employee/pass search or QR lookup. Scanner FAB is above Manual registration. History opens its own date-range view. Rows/eye open card, details and movement timeline. Host name/email remain distinct from visitor identity. Profile has no language setting.

Print/reprint uses the browser print coordinator with an audited server job; expired passes are not printable. Browser handoff is not physical printing. Printed/returned controls and pending-return counts are separate from repeated print-job totals. Final return checks that the person is outside relevant accounts and declared devices are accounted for; mistaken return has a reasoned, receipt-bound correction. Reminder actions retain server cooldown/current eligibility.

## Admin setup

- **Accounts:** account leads and approved account hosts; each account card opens **Projects & visit hosts** for its projects and visit-host setup.
- **Areas & groups:** common-area duty cards and a separate **Approval & notification groups** tab. Group placement does not grant physical-area access.
- **Approvals & responsibilities:** authorized office/project scope; office policies have Approvals, Support & people, Visit limits. Mandatory policy rules remain intact.
- **Guard account groups:** separate account bundles for guard allocation; they are not email-recipient lists.
- **Users & permissions / Guard assignments:** scoped onboarding, setup/reset, grants/revocation and guard duty allocation. Password provisioning and role delegation are independently checked.
- **Offices & QR / Visit register / Audit log:** registration standees, scoped SQL filters/sort/Excel and redacted history.

The old catch-all Planning settings button is removed from normal Coordination navigation. Legacy settings URLs remain readable for compatibility. Setup and selected account survive reload; office changes rebind to the new authorized catalogue.

## Invitation guide

The form has six numbered steps: **Visitor → Visit → Approvals → Details → Support → Review**. Back/Next preserves input, invalid fields prevent skipping, and Review requires explicit Save. Saving a draft sends no mail.

The authenticated creator is shown as **Visit owner**. Destination permission reviewers are **Hosts**; their names appear beside required approval routing. Review selected groups' members and APPROVAL/NOTIFY roles. Optional Additional contact (notify) and Alternate receiver are FYI contacts, not replacement Visit owners. Submit separately to start the configured process. Hosts, task owners and authorized participants then use Approvals, Arrangements, Discussion and Activity.

## PWA and devices

The manifest uses the GatePass icon. Service worker caching is limited to a fixed public offline/icon set; authenticated HTML/APIs/photos/cards/reports/POSTs are excluded. All verification/movement requires online authorization. Test actual installation, camera, printer, media/scaling, language readability and managed-device policies before rollout.
