# Employee application UX

The application frontend now lives under `src/app`, separately from the temporary sign-in adapter. The HTML, styles and browser controller are separate source files. The local runner composes them using the existing nonce-based CSP; no external fonts, analytics, component CDN or third-party scripts are loaded.

Run `npm.cmd run dev` (`dev:sso` remains a compatible alias). The application opens at `http://localhost:8443`. Corporate SSO remains the explicitly deferred integration. The development sign-in adapter supplies an employee identity; the connected registration, private photos, encrypted QR credentials, permissions and receipt reads use existing application services and actual SQL.

The employee surface has a company-branded header, separate sign-in screen, employee workspace navigation, Digital ID workflow and profile view. Development authentication is explained only at sign-in. Employee and manager details come from the session; project assignments are read-only. The navigation exposes the connected employee functions, with no fabricated operational totals or non-working role menus.

The Digital ID form groups office/reason and photo into two sections. It provides a bounded photo preview, explicit file guidance, loading states, keyboard focus, optional/required reason detail and recovery from errors. Unknown submission outcomes retain the original idempotency payload and freeze editable fields. A successful save is preserved if the later receipt read fails. Receipt status comes from current SQL pass state, including revocation/cancellation. Sign-out and expired-session handling clear the employee view and selected photo.

Layouts adapt to desktop, tablet and mobile widths. Supplied Sopra Steria branding remains prominent, and GatePass stays subtle in the footer. The UI uses a light neutral surface with the supplied crimson/orange brand family, restrained borders and compact form spacing.

Eleven actual HTTP/SQL sign-in checks pass against the served application, including its nonce-protected JavaScript syntax and security boundaries. Source checks verify unique element IDs, form label targets and browser-controller element references. No browser visual acceptance is claimed from these checks. Existing Digital ID SQL/idempotency behavior is unchanged by this frontend increment.

The employee form and saved receipt are connected. Authorized Digital ID card display, reception, host approvals, visitor/project request screens, guard movement and administration screens still need to be connected to their implemented backend contracts. Corporate SSO/directory/mail integration and deployment gates retain their existing sequencing. Physical printer testing remains at final acceptance.
