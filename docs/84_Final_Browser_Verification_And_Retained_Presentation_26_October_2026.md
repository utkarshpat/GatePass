> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# Final browser verification aur retained presentation — 26 October 2026

**Fresh full Chromium suite: 345 passed, 0 failed, 0 skipped, 16.5 minutes.** Single worker, zero automatic retries; retained presentation test enabled tha. Normal app `http://localhost:8443` running rahi. Real SQL journeys, responsive/accessibility checks aur controlled failure/security fixtures full suite ka part hain; har negative/fault scenario ko retained business record mein convert nahi kiya gaya.

Additional actual browser rehearsal ne **12 fictional visitors + 3 bound employee Digital IDs** aaj ke liye create/verify kiye. Ye demo records, photos, approvals, print jobs, returns aur movement history **retained hain**. Existing **2,111 visits ke IDs aur baseline fields unchanged** verify hue; final **2,126 visits** hain. Koi existing visit delete ya overwrite nahi hua. Suite cleanup sirf invocation-owned temporary regression fixtures tak restricted tha.

## Presentation ka quick path

Same role ko separate browser/private window mein kholna convenient hai. Existing local fixture password `Sopra@123` hai; ye local dummy environment hai.

| Surface | Login / path | Kya dikhana hai |
|---|---|---|
| Visitor registration | `/office/noida` | Individual/group form, host, purpose/devices, camera, review; aaj ke retained examples neeche hain. |
| Employee Digital ID | Employee entry; `employee1@example.com`, `employee2@example.com`, `employee4@example.com` | Bound identity, photograph, generated/downloaded card; teeno actual downloaded QR codes guard API se verify hue. |
| Assigned host | `employee19@example.com`, `/approval/<request ID>` | Pending requests approve/reject karne ka explicit action. Sneha, Nishant aur Nikhil pending rakhe hain. IDs local retained manifest mein hain. |
| Guard | `gaurd1@example.com`, `/guard` | Existing login spelling yahi hai. **Project 1** select karke Expected/Inside, lookup, details, entry/exit aur timeline. |
| Reception | `reception1@example.com`, `/reception` | Pass lookup, photo/card, print/reprint handoff, device checklist, returned status, current-day history. |
| Noida admin | `admin2@example.com`, `/admin` | All seven modules, register sort/filter/export, live group management/assignment, permissions, office QR aur audit. |

Admin Visit register mein **Noida → Project 1**, From/To **26 October 2026**, phir Apply. Ye related demo visitors ko temporary test projects se alag existing UI scope mein dikhata hai; database separate nahi hua. Digital IDs office identity hain: unko dekhne ke liye project scope clear karke Type **Digital ID** filter use karo. Purana populated historical register **23 October** par ab bhi available hai.

## Aaj ke retained records

| Record | Final verified state | History / card |
|---|---|---|
| Aditi Saxena — Cedarbridge Consulting | Approved, outside | Entry + exit; printed and returned, device checklist complete |
| Karan Bhatia — Vertex Digital Solutions | Approved, inside | Entry retained |
| Sneha Kulkarni — Orion Business Services | Pending, outside | Host decision ke liye available |
| Ritika Malhotra — Meridian Systems | Approved, outside | Entry + exit retained |
| Arjun Sethi — BluePeak Technologies | Approved, outside | Printed; **awaiting return** |
| Nishant Rao — Orion Analytics | Pending, outside | Host decision ke liye available |
| Pooja Mehra — Meridian Systems | Declined, outside | Rejection retained; no entry |
| Isha Kapoor — BluePeak Technologies | Approved, outside | Entry + exit; printed and returned |
| Varun Shah — Orion Analytics | Approved, inside | Entry retained |
| Simran Nair — Meridian Systems | Approved, outside | Unprinted; no movement yet |
| Dev Khanna — BluePeak Technologies | Declined, outside | Rejection retained; no entry |
| Nikhil Menon — Orion Analytics | Pending, outside | Host decision ke liye available |
| Employee 1 — Digital ID | Approved, inside | Actual card download, QR verification and employee presence/history |
| Employee 2 — Digital ID | Approved, outside | Actual card download, QR verification, entry + exit |
| Employee 4 — Digital ID | Approved, outside | Actual card download and QR verification; no entry yet |

Visitor names/companies fictional hain aur contact addresses `example.invalid` hain. Existing employee directory identities ke bound names preserve hue. Camera inputs synthetic live frames hain; photographs real people ke headshots hone ka claim nahi hai. Automation ne external mail sender ya physical printer start nahi kiya; browser print handoff/job state actual application se verify hua.

**Floor 11 Main Entry** group retained hai: **Project 1 + Project 2**, linked guard **Rakesh Kumar**. Group Projects & areas mein manage hota hai; Guard assignments se assignment hua. Membership remove/add preview aur linked-guard update verify karke final two-project membership restore ki gayi. Guard binding aur original individual duties retained hain.

## Verified application coverage

- Public entry ke all four offices; employee/visitor entry choices. Full suite mein registration, groups/manual intake, photos, validation/recovery aur cross-scope cases.
- Real assigned-host approval/rejection/pending states; employee Digital ID creation/download, real QR decode/verification and recorded movement.
- Guard Expected/Inside, visitor entry/exit, employee presence, lookup/history, allocation boundaries, scanner/language/profile and follow-ups.
- Reception dashboard, lookup, print/reprint, device-confirmed return, history, correction boundaries and independent-session queue updates.
- Admin Overview; Projects & areas/groups; Users & permissions; Guard assignments; Offices & QR; Visit register; Audit log. Actual retained group/guard change and all modules browser rehearsal passed.
- Register name sort, current-day filters, stable refresh, actual Excel download; full suite ka independent 1,000-row snapshot/export and consistency validation passed.
- Auth/session/CSRF/IDOR, stale response/permission revocation, responsive/Axe checks, SSE/live refresh aur controlled failures full345-test run mein pass hue.

Action Centre **Approval overdue** ka current rule request15 minutes se pending hona hai, jabki actual approval deadline separate hai. Aaj ki pending requests ki deadline **27 October 2026, 00:00 IST** hai. Historical expired-inside record preserve hua; demo ke liye purane passes silently renew nahi hue.

## Evidence aur practical details

Run folder `output/presentation-final-26-oct/latest.txt` mein recorded hai. `browser-all.log/xml`, `visits-before.json`, `visits-after.json`, `preservation-proof.json`, `demo-records-final.json`, `admin-rehearsal.json`, retained screenshots aur filtered current-day Excel local artifacts hain. Manifest `output/presentation-final-26-oct/retained-today.json` resumed work ko duplicate submissions ke bina track karta hai. Digital ID PNGs mein live QR credentials hain; unko Git/public links mein include nahi kiya gaya.

Rehearsal ke initial attempts bhi preserve hain: temporary test projects ki pagination ne office-wide first-page assumptions invalidate ki; presentation scope Project1 par set hua. Initial office-wide export download timeout hua; exact cause us attempt mein conclusively capture nahi hua. Retained-name filter ke baad actual download passed. Ek registration503 ke baad committed visit lookup se no duplicate confirm hua, aur later actual submission passed. Guard Digital ID verification actual selected duty ke saath pass hui; runner ka hardcoded duty ID remove hua. Application source ko is final run ke dauraan change nahi kiya gaya.

Latest source fix/report83 ka earlier broad344/1 result historical hai; **ye new345/345 full run usse supersede karti hai**. Rapid same-server auth repetition ki prior intermittent setup limitation ko specific rate-limit root cause se proven nahi declare kiya gaya. Is turn mein new load/stress benchmark ya production acceptance claim nahi hai. Normal app8443 running hai; presentation data retained hai. New source changes ka commit/push is turn mein nahi hua.
