> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# P0 group boundaries, stable refresh and export memory — 26 October 2026

**Later final browser evidence:** [Report84](84_Final_Browser_Verification_And_Retained_Presentation_26_October_2026.md) records a fresh **345 pass/0 fail/0 skip** full run and15 retained current-day presentation records. Neeche ke earlier broad-run failures historical triage evidence hain.

Manual admin refresh ka full-console reset replace hua hai. Existing authorized view, navigation, filters, register page, staff selection aur loaded content refresh ke dauraan visible rehte hain. Export ke wide-row sort memory grants bhi reduce hue hain. Guard groups ke critical access, transaction aur concurrency boundaries ke real SQL/HTTP tests add hue hain.

## Refresh finding aur fix

Refresh button `prepareConsole()` call karta tha. Uska `clearConsole()` navigation, lists, stats aur dialogs clear karke scope/catalogue dobara load karta tha; visible structure collapse aur rebuild hota tha. Button ab current view ke authorized refresh path ko await karta hai, busy state dikhata hai aur repeated manual refresh serialize karta hai. Background refresh manual refresh ke dauraan start nahi hota.

Register ka loading placeholder aur wrapping status text retained-page refresh mein replace nahi hote. Audit/staff rows aur paging cursors successful response tak retain rehte hain. Project lead previews previous text dikhate hue fresh reads karte hain; paused queued previews later retry kar sakte hain. Current permission denial protected data clear karta hai. Office change aur actual scope/permission change ka existing reset path retained hai.

Broad browser review ne pending Profile request ka reset dependency bhi catch kiya. Manual refresh ab Profile ki separate generation advance karta hai aur transient profile content close/clear karta hai; late 401/403/503 refreshed console ko redirect/clear nahi karte. Existing regression ka obsolete-request signal global console reset se Profile generation par update hua; current authorization denial ka protected-content clearing assertion retained hai. Common-duty503 regression ab correct retained availability aur Assigned/Free counts assert karta hai.

`admin-refresh-stability.spec.ts` seven views ko 390px aur 1366px par held scope/data responses ke dauraan check karta hai: same visible content, unchanged section bounds, navigation visibility, one scope read, no document reload, no horizontal overflow. Current 403 aur transient 503 recovery separately checked hain.

## Export finding aur fix

Normal app aur browser test server ke shared SQL host par original live export **3/3 failed**. SQL wait samples mein `ReadAdminVisitRegister` ka `RESOURCE_SEMAPHORE` wait approximately 14 seconds observed hua. Host/SQL memory pressure bhi observed thi; is finding ko deadlock nahi kaha gaya.

Actual 1,022-row SQL plan mein full JSON page sorting ne **98,096 KiB requested / 680 KiB used** memory dikhayi; snapshot serialization **49,240 KiB**, display materialization **31,648 KiB** request kar rahi thi. Wide rows aur fixed UTC strings ki `varchar(8000)` expression metadata grants inflate kar rahi thi.

Forward migrations **112–115**, in sequence, narrow ordinal/visit-ID ordering, fixed-size row digests, indexed row lookups, separate device aggregation/office-presence lookup aur exact `varchar(24)` UTC display widths introduce karti hain. JSON output, null handling, literal filters, deterministic tie-breaks, fresh authority checks, snapshot ownership/storage limits aur full-content final validation preserve hain. Local verification mein SQL syntax issue catch hua aur forward correction 113 mein apply hua; app ko complete sequence ke baad restore kiya gaya. Already-applied earlier migration files rewrite nahi hui.

Final actual plan ka largest observed request **3,160 KiB** tha: approximately **96.8% lower peak requested grant** than the earlier 98,096 KiB plan. Ye same fixture shape ka local SQL plan comparison hai; HTTP load-test p95 ya universal throughput claim nahi hai. Global SQL memory settings, command timeouts aur worker limits change nahi hue.

`Test-RegisterOrderingParity.ps1` immutable migration 107 se temporary independent result oracle create karta hai. **56 checks** exact rows/order across all26 columns × ASC/DESC, filtered second pages, full-content fingerprint, snapshot completeness aur final validation compare karte hain. Test-only baseline uses100 synthetic queue rows; normal queue/performance fixture default1000 unchanged hai. Temporary procedure/principal aur invocation-owned data cleanup hote hain.

## Guard group boundaries

**20 real SQL cases pass**: scan→membership/binding/archive revoke→ENTRY denial in the same session; both ENTRY/revoke queue orders; two editors with one expected revision; both edit/deallocation orders with conflict/retry; complete concurrent reader state; injected group/binding audit failure with full rollback and idempotency-key retry; role/session/office/binding substitution denial; revoked-role non-restoration.

Two independent runtime-role SQL connections authorization gate par concurrently waiting observe hue. Revision conflict ko successful deallocation nahi maana gaya: stale mutation explicit retry ke baad verify hui aur final group-derived access absent tha. Fault triggers sirf current owned group ko target karte hain aur `finally` cleanup mein remove hote hain.

`project-group-authority-live.spec.ts` real staff login, HTTP endpoints aur SQL inspection use karta hai: guard/reception/project-only, unauthenticated, expired session, CSRF, forged office/actor payload, foreign office/group, another existing binding, aur already-verified QR ke post-revoke ENTRY denial. Negative writes ke before/after business state aur zero denied movement persistence checked hain.

## Verification status

- Full Node suite: **628 total, 627 pass, 1 platform skip, 0 fail**.
- TypeScript, ESLint aur **115 sequential migration hashes** pass.
- SQL: group boundaries, existing groups, register, employee presence/export aur export snapshot suites pass; independent register parity56 pass. Both new SQL suites CI runner mein registered hain.
- Focused refresh/scope browser checks25 pass; real HTTP boundary tests4 pass. Profile-fencing/refresh regression selection52 pass.
- Latest full Chromium run: **344 pass / 1 audit-pagination assertion fail / 0 skip**, zero automatic retries. Corrected onboarding tests aur export ke three fresh server invocations: **9/9 pass**. Same-server rapid repetition ka separate8/9 result upar recorded hai. Ek single all-green full-suite run claim nahi hai.
- Fresh-server 1,022-row export repeats3/3 pass: snapshot create **710.5–955.9ms** (3 samples), subsequent pages **31.7–190.3ms** (15 samples), final validation **250.5–661.2ms** (3 samples). Normal app8443 running thi. Ye per-request observed ranges hain; p95/load-stress run nahi hai.
- Final cleanup proof: migrations115; owned fixture groups/bindings/derived rows, fault triggers, baseline procedures, temporary principals aur export snapshots **0**; retained presentation visits **26**.
- Fresh-source normal app8443 root200/protected guard303 smoke pass. Mobile/desktop refresh screenshots visually reviewed; bound/overflow assertions pass.

Broad-run triage: first run340 pass/4 fail/1 opt-in skip tha. One test old full-reset/empty-roster expectation use karta tha; three Profile-generation regressions exposed hue. Fix ke baad52 targeted tests pass aur opt-in retained-demo test separately pass hua. Next broad run mein onboarding audit event first50 results se older hua; test now pagination use karke exact owned actor/target event verify karta hai. Isko missing audit event ya business mutation failure classify nahi kiya gaya; before-fix broad result aur after-fix reruns separately preserve hain.

Same-server rapid onboarding/export repeat mein8 pass/1 password-reset setup failure aaya. Existing source budget20 auth/setup calls per60 seconds hai; onboarding multiple login/setup calls consume karta hai. Generic setup400 se exact cause conclusively trace nahi hua, isliye is failure ko sirf rate-limit se proven nahi declare kiya. Fresh-server invocations separately repeat ki gayi; source limits, setup lifetime aur production authentication code unchanged hain. Same-source repeated onboarding failure ka log retained limitation hai.

Current artifact folder `output/group-p0-refresh/23028bca90a740ffa93a2e25e8581997/` hai; `latest.txt` points to it. `browser-all-initial.xml`, `browser-all-final.xml`, `refresh-post-review.xml`, `onboarding-export-same-source.xml`, three `onboarding-export-invocation-*.xml` aur combined `onboarding-export-repeat.xml` results independently preserve karte hain. Baseline failures, SQL waits, before/intermediate/final plans, `export-final-timings.json`, regression logs, source hashes, `database-final.json` aur `app-smoke.json` local artifacts hain.

Machine traceability mein GP-0612,0621,0622,0623,0624,0625 ke exact targeted API+DB outcomes **Pass** recorded hain: **6 Pass / 70 Not Run**. GP-0634/0639/0640 ke new SQL rollback/race proofs linked hain, lekin additional HTTP concurrency/fault composition abhi Not Run hai. Updated mapping counts:26 MAPPED/32 PARTIAL/11 GAP/4 POLICY_ALIGNMENT/3 OUT_OF_SCOPE. Original input catalogue/Excel historical snapshot aur retained presentation data unchanged hain; all76 PASS ka claim nahi hai.

Normal app final source ke saath port8443 par restore hui hai. Is follow-up ka commit/push abhi nahi hua. Fresh-schema isolated CI rebuild aur production host performance acceptance is local verification ka part nahi hain.
