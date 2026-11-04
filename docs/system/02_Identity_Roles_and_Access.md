# 02. Identity, roles and access

> Maintained source handbook — **4 November 2026 · migrations 001–136**. [Current status and evidence](11_Readiness_Gaps_and_Roadmap.md) · [Terminology](../109_Visit_Owner_and_Host_Terminology_03_November_2026.md). Source review is not production acceptance.

## Identity and scope

`gp.Users` is the application identity. Internal employees resolve through trusted directory records and intended corporate SSO provenance. External security/reception/admin staff can use individual local credentials without an employee number or corporate mailbox. SQL selects the authentication provider; an email-shaped username does not prove SSO. Directory data alone is not authentication.

Corporate Entra SSO/MFA remains production integration work; local employee sign-in is explicitly dummy. Eligible internal admins/Hosts use the employee provider; external admins use governed local credentials. An employee cannot use a staff password as a corporate-authentication bypass.

Staff sign-in resolves an authorized landing section directly. Coordination-only users get three folder sidebar links; Admin users retain their original sidebar with coordination nested below it. Server session, CSRF, current grants and per-operation checks remain authoritative.

| Actor | Authority, when explicitly granted | Limit |
|---|---|---|
| Platform Admin / PLATFORM | Supported application-wide administration | No self-delegation bypass |
| India Admin / INDIA | Delegable location/account/staff grants in India | Cannot create Platform or peer India authority |
| Location Admin / LOCATION | Local account heads and eligible staff/duties | Cannot create account-wide authority from a location-only grant |
| Account Admin / PROJECT or PROJECT_LOCATION | Delegable co-leads and approved-host/configuration changes within the account or exact account-office | No unrelated account/location authority or local-password provisioning |
| Visit owner | Creates and coordinates an eligible invitation, owns draft/revisions | Cannot independently approve their own request or grant destination access |
| Host | Decides an assigned ordinary request or destination project approval | Current eligible internal identity, exact scope, snapshot and deadline required |
| Reception | Granted-office registration/lookup/print/return controls | Printing is not approval or entry |
| Guard | Assigned-duty verification and allowed explicit movement | No admin power from a label or QR scan |
| Coordinator / participant / FYI recipient | Only assigned tasks, permitted discussions or notification | Notification does not grant workspace, decision or entry rights |

One person can be an approved Host and become Visit owner when creating an invitation. In coordination, legacy `hostId`/`hostName` refer to that creator. The optional preparation `visitOwnerId` is only an additional FYI contact; it does not transfer ownership. See the [terminology contract](../109_Visit_Owner_and_Host_Terminology_03_November_2026.md).

## Host and group management

Account-office Host lists are explicit; directory membership alone is insufficient. Project hosts must meet the approved account-office eligibility rules. Office/India/platform admins manage office groups within scope; account admins manage only groups for their authorized projects. Visit owners inspect and select groups but cannot amend them. Raw email/distribution-list members are notification-only; internal assigned members may approve.

Role delegation, credential management and guard allocation are separate capabilities. Guard/Reception can coexist with independent grants; Guard/Admin combinations are rejected by role management. Current role/scope checks also apply to retries and private reads.

## Credentials

Local credentials use salted Argon2id hashes, credential versions, lockout and session fencing. Permitted onboarding issues a one-use, 15-minute setup link; reset revokes applicable credentials/sessions/links. The production password policy is 15–128 characters. The explicitly approved short synthetic test password is development-only and is not a production credential policy.

Example local IDs include `admin1@example.com`, `employee1@example.com`, `reception1@example.com` and the intentionally spelled `gaurd1@example.com`. Latest acceptance used admin1 as Platform Admin. Older seed reports map aliases differently: inspect current authenticated Admin scope rather than inferring authority from an ID number. Startup must not reset accounts/grants. Private credential inventories and hashes are excluded from docs.

## Google station identity — agreed, unimplemented

IT-owned Android station/tablet accounts will map to location and duty scope; rotating guards will not receive the Google password. Reception retains local ID/password. Audit identifies the station, not automatically the person on shift. Google OAuth and account mapping are not implemented. Strict physical-device enforcement requires an additional approved managed-device control; a signed-in Google account alone is insufficient.
