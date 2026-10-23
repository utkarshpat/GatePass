# Visit register loading, sorting and shared scrollbars

The register uses the selected authorized office/project and date range. Presentation visitors are retained in **Noida**, especially **Project 1**. A different office or an empty newly created project can correctly have no visits; the UI now names the active scope and explains how to change an empty selection.

## Register changes

- Common-area catalogue reads are lazy-loaded on Projects & areas, so opening the register does not wait for unrelated guard/area data.

- The table renders its headers and an explicit loading row during a read, then either visits or a scoped empty/error message.
- **Registered at** is visible by default, matching the initial descending sort. The result status names the office/project and active sort/direction.
- Changing sorting, direction or dates starts the latest read even while a previous read is pending. Header sorting also remains usable while loading. Earlier responses cannot replace newer results.
- A failed read disables export and clears stale matching totals. **Apply filters** retries the current request. Authorization denial continues to clear protected data and navigation.
- Existing name/reference filters, field filters, pagination, row history and Excel export continue to use the scoped register API. No data or SQL authorization boundary changes.

Browser regression `admin-register-loading.spec.ts` holds the initial read, changes the sort, releases the older response and confirms the newer ascending name result remains. It also checks error/retry feedback and date changes. Existing register coverage verifies combined filters, sorting, scope, pagination, visit history, accessibility and live SQL reads.

## Shared scrollbars

`src/app/global.css` applies a slim crimson scrollbar to page, table, sidebar and dialog containers using shared brand/surface tokens. Chromium/WebKit use an 8px track and rounded thumb; Firefox uses its thin native scrollbar. Hover uses the darker brand colour. High-contrast forced-colour mode keeps system colours. Mobile admin navigation no longer hides its horizontal scrollbar.

Visual checks cover the unified project/area cards and the register table at mobile and desktop widths. Existing accessibility/overflow checks continue to run against the affected screens.

Verified on 23 October 2026 against the retained local dataset: Noida / Project 1 lists all 10 presentation visits, Name ascending starts with Aarav Sharma, actual Excel export downloads, and Meera Iyer’s history shows Entered premises. The computed table scrollbar is 8px with the crimson brand thumb. The read-only presentation browser test is opt-in with GATEPASS_RETAIN_DEMO=true.
