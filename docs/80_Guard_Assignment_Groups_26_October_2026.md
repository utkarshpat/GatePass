> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# Guard Assignment Groups — 26 October 2026

Admin ab ek office ke projects ko named groups mein organize karke guards assign kar sakta hai. Example: **Floor 11 Main → X, B, Y, V**. Existing individual project assignment aur guard movement workflows available hain. Floor/entry sirf admin-defined label hai; authorization actual project aur office ke against hoti hai.

## Behavior

- Guard assignments ke andar **Project Assignments** aur **Assignment Groups** views hain. Office par current `GUARDS_MANAGE` authority rakhne wala admin groups create, rename, edit, assign aur archive kar sakta hai. Project-only administrator ki existing individual project authority preserve hai; use office-wide group administration nahi milti.
- Har group ek office tak limited hai. Same office mein active group names unique hain. Sirf us office ke active/current projects include ho sakte hain. Local projects ke liye existing `_ProjectCurrent` policy use hoti hai.
- Group assignment se uske saare member projects guard ko milte hain. Existing **Until removed / Today / 7 days / 30 days / Pick date** duty periods use hote hain; guard role ko complete interval cover karna hota hai.
- Group edit dialog added/removed projects aur affected linked guards ke names dikhata hai. **Save group and update access** ek atomic, audited mutation hai. Concurrent edit/assignment se revision badal jaye toh stale save HTTP 409 ke saath reject hota hai.
- Membership add/remove linked guards ke project assignments ko usi SQL transaction mein update karta hai. Valid guard sessions group changes se sign out nahi hote: existing per-request SQL duty authorization actual current assignments check karti hai. Guard ka existing duty refresh updated projects dikhata hai; visible idle workspace ka current polling interval 20 seconds hai. Removed access next API request par deny hota hai, UI refresh ka wait authorization ke liye nahi hota.
- Direct + group + multiple groups ke overlapping sources independent hain. Ek group/project/source hatne par doosre source ka access preserve rehta hai. Guard ke effective duty choices existing `DISTINCT` projection se deduplicate hote hain. Admin chips provenance dikhate hain aur project counts distinct guards use karte hain.
- Group-derived project ko individual deallocation endpoint se unlink nahi kiya ja sakta. Group assignment remove karo ya group membership edit karo. Group card se linked guard directly remove kiya ja sakta hai, including jab member project catalogue mein active na ho.
- Archive group ko inactive karta hai aur uske linked sources revoke karta hai. Direct/other-group assignments aur visit/presence history preserve rehti hai. Archive undo/reactivate workflow is change ka part nahi hai.

## Database aur API

Forward migration **110** teen tables add karti hai: `gp.ProjectGroups`, `gp.ProjectGroupMembers`, `gp.ProjectGroupGuardAssignments`. Existing `gp.GuardAssignments` preserve hoti hai; nullable `GroupAssignmentId` source track karta hai. Group members ke effective assignment rows materialize hote hain, isliye existing guard verification, queue, photo, entry/exit aur reconciliation paths current assignment checks continue karte hain.

Mutation authorization shared existing `gp:authorization` transaction gate ke andar check hoti hai. Client-generated actor identity accept nahi hoti; session/CSRF hashes server bind karta hai. Mutations retainable client keys ke saath idempotent hain. Role expiry/revocation existing SQL access checks mein effective rehti hai; ineligible linked guards ko naya project add karke revive nahi kiya ja sakta. Private helper/table access API SQL principal ko grant nahi hua.

| Endpoint | Operation |
|---|---|
| `POST /api/admin/project-groups` | Authorized office ka bounded group catalogue |
| `POST /api/admin/project-group` | `SAVE` create/edit ya `ARCHIVE`; existing group par expected revision required |
| `POST /api/admin/project-group-guard` | `ASSIGN` / `REMOVE`; expected revision aur exact group source required |

Production service composition, typed SQL allowlist, development Node allowlist aur PowerShell bridge allowlist teen public procedures ko explicitly include karte hain. Private `_ProjectGroupGuardEligible` runtime-callable nahi hai. Group limits: **100 active groups/office, 50 projects/group, 50 current linked guards/group**. Reads bounded hain; mutations automatic retry nahi karti hain.

## Verification

- Full unit/coverage: **627 pass, 1 platform skip, 0 failures**; 628 total. Coverage: **97.27% lines / 89.93% branches / 94.03% functions**. New service boundary, provenance projection, route composition, invalid/malformed inputs, bounded members, SQL denials aur no automatic mutation replay test hue.
- Seven live SQL suites pass: project groups, admin console, staff administration, guard duties, guard project context, administration reads aur scoped project creation. Group suite independently idempotency, duplicate names, cross-office members/guards, multi-guard atomic fan-out, same-session duty refresh, source overlap/deduplication, direct assignment after group assignment, archive/removal, stale revisions, expired-role denial, rollback aur execute-only runtime verify karti hai.
- Focused Chromium: **3/3 pass**. 390px/1366px UI, accessibility/overflow, impact preview, stale edit conflict, direct assignment option, removal aur archive; separate real SQL-backed admin browser workflow pass. Migration 111 ke baad project-creation plus grouping ka focused 4-case run final broad run se pehle repeat hua.
- Full Chromium regression run: **317 passed / 1 timeout / zero skips**, 318 total, 14.3 minutes. Grouping ke all three cases aur local-project creation case pass hue. Existing live register/export case ko SQL command timeout (`ReadAdminVisitRegister`, SQL -2) aur missing download mila. Is run ke waqt normal port8443 app bhi same local SQL instance use kar raha tha; directory-refresh warning bhi observe hui. Isliye broad suite ko all-green label nahi diya gaya.
- Typecheck, lint, migration manifest: PASS, **111 sequential hashes**. Migrations 110 aur 111 local `GatePass_DesignTest` par apply hui. Existing applied migrations rewrite nahi hui.

First broad browser run ne local-project individual allocation regression identify ki: migration 086 ki dynamic `_ProjectCurrent` refinement, migration 110 mein older allocation definition se lose hui thi. Applied 110 rewrite nahi hui; forward migration **111** policy restore karti hai. New SQL regression 365-day-old directory timestamp wale locally managed project par group aur direct allocation dono verify karti hai. First broad run fail/interrupt evidence `browser-all-initial.log` mein preserved hai.

Initial verification mein development Node RPC allowlist omission aur old hardcoded procedure-count assertion mile; dono correct karke passing runs liye gaye. Ek focused browser fixture ka uppercase GUID selector normalize hua. Initial failed/aborted logs preserve hain; passing evidence separately named hai. Interrupted invocation ke sirf owned synthetic fixture ko clean kiya gaya.

Group/local-project/staff SQL suites migration 111 ke baad repeat hue; other four SQL suites migration 110 par pass the. Migration 111 individual allocation ka existing local-project freshness behavior restore karti hai.

**Open performance finding:** same export test ke three immediate repeats mein **1 pass / 2 timeouts** hue. Normal app temporarily stop karne ke baad unchanged test/deadlines par **3/3 pass** hue (44.4 seconds total; individual test wall times ~10–13s). Warm cache, order aur other host activity controlled A/B mein isolate nahi hui; normal app ko proven cause nahi maana gaya. Read-only isolated samples mein ~2.3–2.4 seconds CPU / 154k–161k logical reads aur blocker 0 observe hue, lekin sampled command ka exact procedure mapping establish nahi hua. Saved query hash `FEFC71E24EFAC51A` future profiling lead hai. Shared-SQL export stability ab next performance priority hai; timeout increase ya automatic mutation retry add nahi hua. New load/stress certification claim nahi hai.

Artifacts: `output/project-groups/coverage.log`, `targeted.log`, `Test-ProjectGroups.ps1.log`, other five SQL suite logs, `browser-final.log`, `browser-all-concurrent.log`, `browser-all-concurrent.xml`, `export-repeat.log`, `export-isolated-repeat.log`, corresponding XML results, `sql-isolated-wait-samples.json`, `review-390.png`, `review-1366.png`. Unit, browser aur SQL results alag evidence hain; full SQL fresh-schema rebuild ya new load/stress benchmark is feature acceptance mein claim nahi hai. Sustained-load throughput investigation previous report 79 ka pending follow-up hai.

Current feature changes local/uncommitted hain; commit/push nahi hua. Normal app official launcher se restore hui, edited runtime sources se fresh startup verify hua; root200 / protected guard303 smoke pass. Final DB proof: migrations111, owned fixture groups/bindings/derived assignments0, export snapshots0, retained presentation visits26, current individual local-project/source-overlap policy intact. `database-final.json` aur `app-smoke.json` evidence preserve hain.
