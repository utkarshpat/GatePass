# Employee office authorization review

Employee 1 is explicitly assigned to **Noida / Project 1**. A project operating in Bengaluru does not imply that its Noida members are assigned there.

Directory contract now requires `locationCodes` and explicit `projectLocations` pairs for each employee. `projectCodes` remains affiliation only. Never infer the Cartesian product of project offices and employee affiliations. Empty or missing trusted office entitlements cannot auto-issue a Digital ID. The real directory adapter must provide these relationships before integration.

Forward migrations 048–052 add office and exact project-location caches, freshness/active checks, and bounded SQL query plans. No production entitlement backfill is performed. The local seed supplies explicit synthetic mappings; repeat sync deactivates removed mappings. A multi-office fixture exists only through explicit entries. The API location is explicitly synchronized as the primary office; it is never inferred from row order or the QR.

- Digital ID: current office entitlement required at issuance, retry/reuse and card printing/replacement. After 053–060, common duties verify identity without movement; project entry additionally requires exact employee project-office entitlement.
- Host: current employee, office, project affiliation and exact project-location assignment required for search, submission, approval and queued approval notification.
- Hosted employee access: another office or project requires an eligible local host's independent approval. The employee does not gain a permanent membership from that approval.
- Entry rechecks current Digital ID office entitlement; exit remains possible after revocation. Guard grants and allocations remain independently enforced.
- UI uses server-returned office eligibility and exact assigned project flags. Another-office flow requests project access and does not create a Digital ID alongside it.
- Cards show assignments for their issued office. Display data does not grant access.

Validation evidence is in `database/validation/registration-report.json`, `transaction-core-report.json` and `public-registration-integration-report.json`, plus the current unit/browser reports. These are local development checks; corporate SSO and physical printer integration remain separate work. No Git push is part of this change.

Current duty and project-presence behavior is specified in [34_Guard_Duties_and_Project_Presence.md](34_Guard_Duties_and_Project_Presence.md).
