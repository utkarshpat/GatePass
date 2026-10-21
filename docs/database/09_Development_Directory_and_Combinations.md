# 09 - Development directory and combination coverage

Date: 20 October 2026. Synthetic master data is persisted in local `GatePass_DesignTest`. This is not a working login or registration application.

## Data available

| Data | Current fixture |
|---|---|
| Employees | Employee 1-24, EMP001-EMP024; Employee 15 inactive |
| Managers | Employee 19-24 from the same population; 22 direct links and two roots |
| Guards | Guard 1-12, GRD001-GRD012; three per location |
| Locations | Noida, Bengaluru, Chennai, Pune |
| Projects | Project 1-6, DEMO-PRJ-001 through DEMO-PRJ-006 |
| Project availability | 14 project/location pairs |
| Guard allocations | 20; shared projects and multiple projects per guard |

Managers also report to other managers. EMP018 belongs to all six projects. EMP015 retains directory memberships but cannot be selected as an active host. Employee addresses use reserved `example.invalid`; no email is sent.

| Project | Available locations |
|---|---|
| 1 | All four |
| 2 | Noida, Bengaluru, Pune |
| 3 | Noida, Chennai |
| 4 | Bengaluru |
| 5 | Chennai, Pune |
| 6 | Noida, Pune |

| Guard | Location | Projects | Additional capabilities |
|---|---|---|---|
| 1 | Noida | 1, 2 | TEMP_ID movement, reconcile exit |
| 2 | Bengaluru | 2 | — |
| 3 | Chennai | 1 | — |
| 4 | Pune | 1, 2 | — |
| 5 | Noida | 1, 3 | — |
| 6 | Noida | 6 | — |
| 7 | Bengaluru | 1, 4 | TEMP_ID movement, reconcile exit |
| 8 | Bengaluru | 2, 4 | — |
| 9 | Chennai | 1, 3 | TEMP_ID movement |
| 10 | Chennai | 5 | Reconcile exit |
| 11 | Pune | 2, 5 | — |
| 12 | Pune | 5, 6 | TEMP_ID movement, reconcile exit |

All guards have VISITS_READ and PROJECT_MOVEMENT in their own location; project movement also requires the specific active allocation. These are app permissions, not directory API entitlements. Login grants no extra scope.

## Replaceable API boundary

`src/integrations/directory/DirectoryGateway.ts` provides employee lookup, manager lookup, project memberships and eligible hosts. `MockDirectorySource` reads fixtures only in explicitly selected development/test mode. `ApiDirectorySource` accepts real fetch-and-map handlers when the user integrates the corporate API. API failure never falls back to mock data.

DTOs follow applied SQL column limits; they do not generate DDL. Snapshot validation checks references, duplicates and manager cycles. Individual employee lookup rejects substituted identity and does not fetch a manager; manager resolution failure must not block employee lookup/TEMP_ID issuance. Unknown upstream fields are dropped. Guard grants and allocations stay application-owned in SQL.

Employees/hosts use corporate SSO. **Guards use individual ID/password without SSO.** Synthetic issuer/subject strings identify fixture ownership, not authentication. No passwords, SQL logins or authenticated sessions are seeded. Migrations 006/007 and the internal verifier now implement guard authentication; browser login/permanent enrollment are pending. See [the implemented contract and limits](10_Guard_Login_Contract.md).

## Reproduce locally

Run in PowerShell 7 from the workspace root:

```powershell
./database/setup/Seed-LocalDirectory.ps1 -TrustLocalServerCertificate
./database/tests/Test-DevelopmentSeed.ps1 -TrustLocalServerCertificate
./database/tests/Test-DevelopmentCombinations.ps1 -TrustLocalServerCertificate
npm run test:directory
```

The data-only seed is restricted to the dedicated local database, synthetic identifiers and reserved email addresses. Refresh reuses records and bumps authorization versions. Removed employee memberships remain as inactive cache rows; current active pairs match the fixture. It does not reactivate disabled users, revoked roles, removed capabilities or deallocated assignments, or overwrite identities outside its ownership. No admin/reception privileges or business visits are created.

Freshness is currently a provisional 300-second development policy. Reseed immediately before the matrix test to refresh timestamps. This is not a production sync mechanism.

## Verified coverage

| Matrix | Checks | Expected eligible/allowed |
|---|---:|---:|
| 12 guards × 6 projects × 4 locations | 288 | 20 |
| 12 guards × 4 locations, TEMP_ID capability | 48 | 4 |
| 12 guards × 4 locations, reconcile capability | 48 | 4 |
| 24 employees × 6 projects × 4 locations, SQL host eligibility | 576 | 108 |
| Same host matrix through directory gateway | 576 | 108 |
| 24 manager mappings, SQL and gateway separately | 48 | 22 links and two roots in each |
| **Total** | **1,584** | **All expected outcomes matched** |

Evidence: `database/validation/development-combination-report.json` and row-by-row `development-combinations.csv`. Actual DB capability/allocation state and gateway lookups are compared independently with fixtures. This enumerates the current population, not all possible workflow states. Host eligibility does not authorize approval of another host's request. Session/CSRF/current visit state and races are covered separately by 40 transaction cases.

Directory adapter tests: 18 passed with Node native TypeScript execution, not a compiler/typecheck result. Seed tests: 10 passed, including preservation of revoked/disabled state. No provider calls or real identities were used.

## View in SSMS

Select `GatePass_DesignTest`, refresh Object Explorer and expand Tables. These read-only queries show employees/managers and guard allocations:

```sql
SELECT e.EmployeeId, e.FullName, e.IsActive,
       m.EmployeeId AS ManagerId, m.FullName AS ManagerName
FROM gp.Employees e
LEFT JOIN gp.Employees m ON m.EmployeeId=e.ManagerEmployeeId
ORDER BY e.EmployeeId;

SELECT u.DisplayName AS GuardName, l.LocationName, p.ProjectName,
       a.DeallocatedAtUtc
FROM gp.GuardAssignments a
JOIN gp.Users u ON u.UserId=a.GuardUserId
JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=a.ProjectLocationId
JOIN gp.Locations l ON l.LocationId=pl.LocationId
JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
ORDER BY l.LocationName, u.DisplayName, p.ProjectName;
```

These queries use the development administrator connection. The runtime retains execute-only permissions and cannot run arbitrary table queries.
