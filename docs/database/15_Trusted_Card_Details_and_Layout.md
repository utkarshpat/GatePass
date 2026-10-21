# 15 - Trusted card details and approved layout

Version: 1.8 | Date: 20 October 2026 | Phase 02H

The approved 85.6 x 54 mm card layout is now implemented in the actual internal DB-backed print flow. The HTML preview uses the same PassCardRenderer, avoiding a separate mockup layout. Company branding is compact at top-left, pass type at top-right, and GatePass small at bottom-right. Validity is stacked; photo proportions are preserved inside a 156 x 176 viewBox area.

## Database first

Migration 014 was authored, applied and validated locally before its service contract was consumed. It adds nullable SourceCardDataHash (exactly 32 bytes when present) to PassPrintRenderState and the private _ReadPrintCardDetails helper. Existing pending render jobs are failed for fresh rendering; dispatched history is retained. Runtime grants remain unchanged. The new helper cannot be executed directly by any runtime role.

BeginPassRender returns a private cardDetails object: employeeId, hostEmployeeId, hostName, purpose, assignedProjectCount and assignedProjects (code/name pairs). Callers cannot supply or override these fields. Employee identity and active assignments come from trusted directory cache; visitor host name/ID comes from the trusted employee record, while purpose comes from the submitted individual visit. Digital ID reasons use the existing FORGOT/LOST/OTHER codes with short standard display text.

Active employee memberships and active projects must be fresh. Stale/future active data rejects the render instead of silently producing a partial assignment list. Inactive assignments are excluded. An employee with no active assignments displays that fact. The first three project codes are ordered deterministically, accompanied by the full count when there are more. Long text wraps within bounded columns and may be shortened with an ellipsis. Full details belong in protected application views. Assigned projects describe affiliation and do not grant entry. Digital ID remains location-scoped.

The source digest binds printable host identity, purpose, assignment summary/count and employee ID. It is checked under the existing authorization/visit locks at claim, completion and final dispatch, alongside session, pass, snapshot, status, photo, claim and lease checks. Changed printed fields invalidate the old artifact; a heartbeat refresh with unchanged fields does not. Freshness is independently rechecked. No external storage, key or directory API call runs under SQL locks.

## Cards and authorization

Employee cards show name, employee ID, assigned projects, short purpose/reason, validity, QR, photo and location. Visitor cards show name, host name and employee ID, purpose, validity, QR, photo and location. Approval/status labels and project-access instructions remain absent. A pending visitor card prints immediately; the same opaque QR becomes project-eligible after host approval. Guard verification and exact per-action project authorization enforce entry. Scan alone does not create movement.

## Verified scope

- 55 restricted SQL print/reissue cases passed, including five observed two-connection races and six nested actual Node/SQL/AES/QR journeys.
- 23 printing unit tests and 98 full Node regression tests passed. The print tests independently decode 24 synthetic credentials at three crop sizes plus full-card detection (96 decodes).
- The shared-renderer HTML preview independently passes another eight QR decodes and was rasterized for visual inspection.
- 33 tables, 297 columns, 58 FKs, 14 migration records; 47 procedures and four private functions. Role grants remain API 14, worker 5, guard auth 6, media 1 and renderer 4, with no real runtime members.
- Current catalog, constraints and cleanup evidence is in database/validation. Requested dummy master records persist; workflow rows, temporary actors, test projects and credentials are removed.

Native TypeScript execution is not a compiler/typecheck. Actual printer/browser/device acceptance, public HTTP/UI, production SQL driver/identities, private filesystem/key store and real SSO/directory/mail integration remain pending. QR samples are not issued into SQL. The browser's local-file restriction was respected; SVG raster inspection does not establish browser print acceptance.

## Reproduce and continue

Apply missing migrations in order using Apply-LocalTransactionCore.ps1, with migration 014 as the next version after 013. Run Test-PassPrinting.ps1 against the dedicated local test database, npm run test:printing with the existing approved sharp path, and the full Node tests. The preview builder is tools/build-redesigned-card-preview.ts. No installer or privileged system change is required.

Next database block: individual cancellation/revocation and remaining scoped administration contracts, preserving actionable exits for INSIDE occupants. Then wire the already tested contracts into the reception and guard UI/HTTP boundary. Production rollout remains a separate gate.


Subsequent cancellation/occupancy is implemented in [document 16](16_Individual_Cancellation_and_Occupancy.md). Physical printer testing is deferred to final acceptance and does not block other development.
