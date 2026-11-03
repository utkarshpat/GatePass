> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# Staff navigation — 2 November 2026

Staff sign-in now opens an authorized section directly. The workspace chooser is retired, including old `/?choose=1` links. An authorized Coordination email deep link still takes precedence and retains its visit reference. When several sections are available, the default is Administration, then Reception, Guard or Coordination; this default never grants access.

The existing Admin sidebar and its scoped controls remain in place. **Visit coordination is an additional item alongside the existing menu; there is no separate Administration group or workspace-switch page.** Coordination presents permitted Admin destinations directly, with fixed `/admin?view=...` links. On arrival the Admin model rechecks its actual selected office/account permissions before selecting the requested view; unavailable views fall back to the existing allowed view. Guard/Reception sections appear only when assigned.

Single-section users do not get a redundant application sidebar or selector. Multiple-section users get desktop sidebar navigation and a phone/tablet menu drawer with keyboard focus, Escape dismissal and current-section indication. Normal public registration, manual registration frames and minimal email approval/status pages do not gain a staff sidebar.

Navigation reads the authenticated staff context, validates known section codes, ignores caller-supplied paths, rejects duplicate entries and uses fixed destination URLs. Admin destination visibility derives from current Admin grant capabilities; the original Admin page retains its more specific scope checks. No name/scope/navigation state is persisted in local storage. Page hide, restored pages and window focus invalidate/recheck navigation; failed or revoked context clears links. Menu visibility is not authorization: the existing server/SQL checks remain authoritative.

## Verification

- **714 unit/contract cases: 713 passed, one platform skip, zero failures.** Four dedicated navigation cases cover direct landing, malformed/duplicate responses, fixed URLs and capability-filtered Admin links.
- **31/31 selected browser cases passed**: real staff sign-in, old choose URLs, flat Admin navigation, deep section links, revoked context, phone/laptop drawers, accessibility, scope visibility, existing Admin controls, React lifecycle, guard/reception/public/employee/email workflows and hostile-text rendering. Composite guard/reception navigation projections are explicitly stubbed while their operational page authentication/SQL flow stays real.
- Typecheck, ESLint, 207-module architecture checks and all seven frontend bundles passed. Phone/laptop screenshots were inspected under ignored `output/staff-navigation/`.
- No SQL migration, permission grant, mail dispatch, pass issuance or operational movement rule changed. Local development was restarted on port 8443 to load the current bundles; existing sessions may need to sign in again.

Evidence: ignored `tmp/sidebar-final-unit.log`, `tmp/sidebar-final-browser.log`, `tmp/sidebar-final-typecheck.log`, `tmp/sidebar-final-lint.log`, `tmp/sidebar-final-architecture.log`, `tmp/sidebar-final-build.log` and `tmp/sidebar-local-server.log`. No commit or push is included in this UI update.
