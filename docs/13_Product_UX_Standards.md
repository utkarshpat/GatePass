# GatePass product UX standards

User direction: a real production application with a clean, modern interface. Only the deferred SSO integration uses a temporary identity adapter; connected business flows must use actual backend services and database authorization. Do not present placeholders, fabricated activity or inactive actions as working features.

## Content

- One concise page title. Do not repeat the role/workspace name as a breadcrumb, navigation heading and page heading.
- Use labels such as Digital ID, New Digital ID and Profile. Omit paragraphs explaining that a profile contains profile details, that a form is a request form, or that linked details are linked.
- Visible copy must identify a task, data, status, constraint or recovery action. Put help beside the field only when needed. Keep photo size/type limits and actionable errors.
- No marketing slogans, repeated company text, generic workplace taglines or success paragraphs that repeat an already visible status.
- Company logo is prominent in the header. GatePass remains a small subtle product mark at the bottom; do not repeat combined company/product footers on every view.
- Clearly label the temporary sign-in adapter without describing development implementation throughout the product.

## Interaction and layout

- Consistent typography, spacing, compact cards and controls, and restrained red/orange brand accents. Maintain keyboard focus, contrast and responsive layouts.
- Actions belong near the information they affect. Present loading, empty, saved, expired, denied and retry states in context.
- Preserve exact idempotent submissions after uncertain outcomes. Do not claim success until the server confirms it, or discard a committed result because a later detail read failed.
- Follow the planned role-specific screen map. Expose connected functions only; reusable components and visual consistency apply across visitor, employee, host, reception, guard and admin views.
- Office selection is to be replaced by server-validated context from the office registration QR. This is a separately pending functional change, not a client-side default or arbitrary URL parameter.
- Visual references guide layout/style. Existing approval, individual visit, neutral landscape card and online authorization rules take precedence over conflicting reference-image content.
- Right-corner card items (e.g. status badges, timestamps, state tags) must remain right-aligned (`text-align: right`). Wherever dynamic content or translations pose an overflow risk, enforce wrapping (`white-space: pre-line`, `overflow-wrap: anywhere`) and bounded width (`max-width: 55%`), never allowing text to clip past container boundaries.

Current content cleanup applies to the connected employee frontend. Office QR binding, the proposed step/photo/review flow, remaining role screens and visual acceptance remain separate pending work.

The user clarified that a standalone read-only employee Profile screen is unnecessary. Keep employee identity, manager and assigned projects in a compact request summary; do not add a separate profile navigation item. Add pages only when an agreed workflow requires an independent task or action.

The shared visual baseline is defined in `14_Global_Design_System.md` and `src/app/global.css`. Finalize and reuse that foundation before adding the next role screen; page CSS owns layout, not a competing theme.

Office entry update: the employee/visitor landing and step/photo/review forms are now connected; office context comes from the server-bound entry link, with no office dropdown. The Noida photo is shared across locations by explicit user request. See `database/25_Office_Entry_and_Registration_UI.md` for implemented scope and evidence.
