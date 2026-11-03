> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# Project group management location — 26 October 2026

Group create/edit/archive ab **Projects & areas → Project groups** mein hai. **Guard assignments → Assign guard → Project group** se existing group ko guard assign hota hai; group duty chip se assignment remove hota hai. Individual project assignment ka existing flow available hai.

Project group cards projects, linked guards aur counts dikhate hain. Management cards par Edit/Archive actions hain; guard assignment ka entry point Guard assignments hai. Membership edit ka affected-project/guard preview aur save ke baad dynamic access update ka existing contract preserve hai. Backend procedures, permissions aur database schema is relocation mein change nahi hue.

Group tab apna bounded group read karta hai; guard roster aur per-project duty fan-out load nahi karta. Loading, failure aur Refresh retry visible hain. Office/view/request checks late responses ko current office ya group list overwrite karne se rokte hain. Pending editor metadata read ke baad navigation change ho toh dialog open nahi hota. Current 403 protected controls/dialogs clear karta hai; previous office ke late 401/403 current session ko redirect/clear nahi karte. Project-only admin ko group management controls available nahi hain.

## Verification

- Full Node suite: **628 total, 627 pass, 1 platform skip, 0 fail**.
- TypeScript, ESLint aur **111 sequential migration hashes** pass.
- Affected tracked UI files ka CRLF-aware whitespace check pass. Whole dirty worktree ka default whitespace check pre-existing CRLF lines ko flag karta hai; unrelated files normalize nahi kiye gaye.
- Relevant browser suite: **42 pass, 0 fail**, single worker, zero retries; real SQL group lifecycle included.
- Mobile 390px/desktop 1366px placement aur edit-dialog screenshots visually reviewed; overflow/WCAG automated checks pass.
- Official `npm.cmd run dev` launcher se normal app **port 8443** par fresh UI sources ke baad start hui; root **200**, protected guard **303** smoke pass.
- Final database read: migrations **111**, synthetic fixture groups/bindings/derived assignments **0**, export snapshots **0**, retained presentation visits **26**.

Fresh browser coverage mein mobile 390px/desktop 1366px create→assign→membership edit→remove→archive, WCAG/overflow checks, real SQL persistence/source preservation, group-read failure/retry, office-switch late 200/401/403, project-only admin aur delayed hidden-roster response boundaries included hain.

Is change ke liye full application browser suite ya load/stress benchmark rerun nahi hua. Report 80/81 ka previous export SQL timeout aur broader performance follow-up is scoped UI verification se resolve declare nahi hota. Catalogue ke 76 row statuses **Not Run** hain; native automated assertions aur catalogue execution alag evidence hain.

Artifacts: `output/project-group-location/da733c371da54a4bb2618b2750935dda/` mein `source-hashes.json`, `unit-final.log`, `browser-final.log`, `browser-final.xml`, `typecheck-final.log`, `lint-final.log`, `database-final.json` aur `app-smoke.json`. `output/project-group-location/placement-{390,1366}.png` aur `group-management-{390,1366}.png` synthetic UI screenshots hain. `latest.txt` current run folder point karta hai. Purane failed runs preserve hain: initial hidden-office-selector/hidden-heading test assertions correct hue; final source ka 42-test rerun pass hai. Changes local hain; commit/push nahi hua.

Machine traceability mein 10 browser references ka current source hash, line anchors aur passing JUnit proof refresh hua; historical proof `priorEvidence` mein hai. Mapping counts aur catalogue row statuses unchanged hain; Excel mapping original snapshot hai.
