# GatePass global CSS — v1 baseline

Scope: shared visual foundation only. No new pages, workflows, profile view or business logic are introduced by this increment. Supplied UI references guide the light, compact appearance. User-facing text follows `13_Product_UX_Standards.md`.

## File ownership

| File | Responsibility |
|---|---|
| `src/app/global.css` | The only source for colours, typography, spacing, sizes, radii, focus, shared controls and status states |
| `src/app/employee-portal.css` | Current employee screen layout and responsive arrangement; consumes global tokens |

The app loads global CSS before its page layout within the same nonce-protected style block. Cascade order is explicit: tokens → reset → base → components → layouts → utilities. Page files must not redefine root tokens, embed their own colour palette, duplicate shared button/input/card styling or append override patches.

## Visual baseline

| Item | Baseline |
|---|---|
| Canvas / surfaces | `#F5F7FA` / white; restrained borders and shadows |
| Text / secondary text | `#192132` / `#5E6B7D` |
| Brand | Crimson `#C90035`; orange `#FF7900` is an accent, not small text on white |
| Primary action | Restrained crimson-to-burnt-orange gradient with white text; one main action per task section |
| Font | Segoe UI with system fallbacks; no network font dependency |
| Type scale | 12px metadata, 14px body/controls, 16px emphasis/mobile editable text, 18px sections, 28px page title (24px mobile) |
| Spacing | 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px |
| Controls | Minimum 44px target height; consistent labels, border, focus and disabled states |
| Corners | 6px small chips, 8px controls, 12px cards |
| Content width | Maximum 1120px; 400px sign-in card; 256px desktop request context |
| Breakpoints | Tablet ≤1100px; compact/mobile ≤760px; minimum layout target 320px |
| Branding | Original company logo in the header; subtle GatePass mark at the bottom |

## Shared components and states

Use `.primary`, `.secondary`, `.quiet`, `.panel`, `.notice`, `.status-pill`, `.avatar`, `.chip`, `.details`, labels, inputs and helper/error styles from global CSS. Existing selectors remain compatible with the app controller.

- Active/approved: green. Pending: amber. Denied/revoked: red. Expired/cancelled/unknown: neutral. Status labels remain visible; colour alone never communicates state.
- Hover styles apply to hover-capable devices. Disabled actions do not acquire hover emphasis; busy contexts use a progress cursor.
- Keyboard focus uses a consistent crimson outline. Controls have a meaningful visible border; native form semantics are preserved.
- Editable mobile text is 16px. Portrait photos preserve aspect ratio. Layouts wrap long names, identifiers and metadata.
- Motion is limited to short colour/border transitions and is omitted when reduced motion is requested. Forced-colour mode retains control boundaries.
- `[hidden]` is the sole intentional `!important` rule, so hidden application states cannot leak through a page layout display rule.

### Right Corner & Overflow Protection Rules
- **Right-Aligned Trailing Content**: Badges, status indicators, timestamps, and right-corner card elements must stay right-aligned (`text-align: right;`).
- **Zero Overflow on Localization**: Never use unconditional `white-space: nowrap;` on status elements or localized bilingual labels where longer script translations (e.g. Tamil, Kannada, German) could spill past card boundaries.
- **Controlled Multi-line Wrapping**: When overflow is possible, enforce graceful wrapping via `white-space: pre-line;` or `white-space: normal; line-height: 1.25; overflow-wrap: anywhere;`.
- **Bounded Flex/Grid Proportions**: Trailing elements in flex rows must define a maximum width constraint (e.g., `max-width: 55%; flex-shrink: 0;`), with leading content having `flex: 1; min-width: 0;` so both sides share available card space without clipping or overlapping.

## Verification

`database/validation/global-css-report.json` records resolved token references, no hardcoded page colours, balanced source delimiters and calculated text/control contrast. Checked text combinations exceed 4.5:1; control border contrast against white is 3.12:1 and focus contrast is 6.81:1. This is source/calculated verification, not browser visual acceptance or a claim that every future component is implemented.

Business changes remain separate: office QR binding, step/photo/review workflow and the remaining agreed role views are pending. Their pages must reuse this baseline when implemented.

Shared select controls progressively enhance native form selects with a themed listbox, selected checkmark, 44px options, bounded scrolling, and placement above/below the trigger according to viewport space. Native values, change/input events, required validation and disabled state remain authoritative. Keyboard navigation supports arrows, Home/End, Enter/Space, Escape, Tab and text search. Four component behavior tests cover selection/events, viewport placement, validation focus and disabled state; these are not browser visual acceptance.
