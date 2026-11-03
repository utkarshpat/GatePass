# Account setup and coordination navigation — 2 November 2026

## Where things belong

Accounts & areas retains the existing Admin header, office selector and permissions.

- **Accounts:** account cards, account leads and approved account hosts. Open **Projects & visit hosts** on an account to manage its projects and approved project hosts. Each project keeps independent planning approval.
- **Areas & groups:** common areas and their guard assignments; a separate **Approval & notification groups** tab holds reusable recipient lists. Placing a list here does not grant physical-area access.
- **Approvals & responsibilities:** select an authorized office or project, then configure approvals. Office policies also show three focused sections: Approvals, Support & people, and Visit limits. All existing policy fields and validation remain.
- **Guard account groups:** existing account bundles for guard allocation. These are separate from approval/notification lists and send no invitation email.

Project, group and policy setup no longer has a normal entry point in Visit Coordination. The old catch-all “Planning settings” navigation button is removed. Existing legacy settings URLs remain readable for compatibility.

## Who manages visit groups?

These named, reusable lists specify internal required approvers and people/email addresses to notify. Visit owners see membership and roles before selecting a list; they cannot edit its membership.

The existing server enforces scoped management permission. Platform/India/location administrators can manage office lists within their grant. Account administrators can manage lists for authorized projects. Internal members may approve or receive notification; raw email/distribution-list addresses receive notification only. No policy review is bypassed, and membership creates no login or independent role grant.

## Sidebar folders

Users with only coordination access see **My visits**, **Assigned to me**, and **Participating** as sidebar links, with a mobile navigation drawer. They do not see Admin links.

Admins see these as nested links under **Visit coordination** in the original Admin sidebar. Each link uses the existing protected folder query (MY, ASSIGNED, PARTICIPATING). Folder selection resets list pagination and closes any open visit; the selected folder survives refresh. Office/date/search filters and server authorization remain.

Account setup uses bounded `setup` query values under `/admin?view=projects`. Project setup also remembers the selected account. Office changes remount setup and use only the newly selected authorized office's catalogue. Leaving setup unmounts its requests; private lifecycle clearing remains in place.

## Scope of this change

This is React navigation/presentation reorganization using the existing scoped management and audit APIs. No SQL migration, permission expansion, visitor registration, reception, pass printing, guard entry/exit or real-mail dispatch change is introduced.

Validation: 51 distinct browser cases passed across the focused runs (17 isolated coordination; 34 Admin/navigation/layout/area/group cases), including phone/laptop accessibility, folder requests, policy/host/group persistence, late responses and permission loss. Six navigation/document unit checks, 174 isolated SQL checks, typecheck, lint, 221-module dependency boundaries, seven React bundles and 136 migration hashes passed. The secret scan found no leaks. Mail verification used a mock Graph provider; no real email was sent. Production organizational configuration and corporate email delivery acceptance remain separate work.
