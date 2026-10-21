#Requires -Version 7.0
[CmdletBinding()]
param([string]$Server='localhost\SQLEXPRESS',[switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskConnection=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskDirectory=[IO.File]::ReadAllText((Join-Path $taskRoot 'database/development/directory-fixtures.json'))
$taskStaff=[IO.File]::ReadAllText((Join-Path $taskRoot 'database/development/staff-fixtures.json'))
$taskSeedPath=Join-Path $taskRoot 'database/development/001_seed_dummy_directory.sql'
$taskSql=[IO.File]::ReadAllText($taskSeedPath)
$taskCases=[Collections.Generic.List[object]]::new()
function Assert-Condition($Value,[string]$Message) { if (-not $Value) { throw $Message } }
function Seed-Dummy([string]$Directory=$taskDirectory,[string]$Staff=$taskStaff) {
    return (Invoke-GatePassScalar $taskConnection $taskSql @{Directory=$Directory;Staff=$Staff}) | ConvertFrom-Json
}
function Expect-Rejected([scriptblock]$Action) {
    try { $null=& $Action }
    catch {
        $taskBase=$_.Exception.GetBaseException()
        if ($taskBase -is [System.Data.SqlClient.SqlException] -and $taskBase.Number -eq 52910) { return }
        throw
    }
    throw 'Unsafe seed input was accepted.'
}
function Test-Case([string]$Name,[scriptblock]$Action) {
    try { $null=& $Action; $taskCases.Add(@{Name=$Name;Passed=$true}); Write-Output ('PASS: '+$Name) }
    catch { $taskCases.Add(@{Name=$Name;Passed=$false;Error=$_.Exception.Message}); Write-Output ('FAIL: '+$Name+' -- '+$_.Exception.Message) }
}
function Counts {
    return Invoke-GatePassScalar $taskConnection @'
DECLARE @j nvarchar(max)=(SELECT
(SELECT COUNT(*) FROM gp.Employees e JOIN gp.Users u ON u.UserId=e.UserId WHERE u.IdentityIssuer=N'urn:gatepass:development-directory') employees,
(SELECT COUNT(*) FROM gp.Users WHERE IdentityIssuer=N'urn:gatepass:development-directory') users,
(SELECT COUNT(*) FROM gp.StaffRoleGrants g JOIN gp.Users u ON u.UserId=g.UserId WHERE u.IdentityIssuer=N'urn:gatepass:development-directory') grants,
(SELECT COUNT(*) FROM gp.GuardAssignments a JOIN gp.Users u ON u.UserId=a.GuardUserId WHERE u.IdentityIssuer=N'urn:gatepass:development-directory') assignments,
(SELECT COUNT(*) FROM gp.Projects WHERE ExternalProjectCode LIKE N'DEMO-PRJ-%') projects
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER); SELECT @j;
'@
}
try {
    $taskSeedActor=Invoke-GatePassScalar $taskConnection "SELECT UserId FROM gp.Users WHERE IdentityIssuer=N'urn:gatepass:development-directory' AND IdentitySubject=N'local-seed';"
    Assert-Condition ($taskSeedActor -is [guid]) 'Apply the initial local development seed first.'
    $taskGuardGrant=Invoke-GatePassScalar $taskConnection "SELECT g.RoleGrantId FROM gp.StaffRoleGrants g JOIN gp.Users u ON u.UserId=g.UserId WHERE u.IdentityIssuer=N'urn:gatepass:development-directory' AND u.IdentitySubject=N'guard:GRD004';"
    $taskGuardAssignment=Invoke-GatePassScalar $taskConnection "SELECT TOP(1) a.GuardAssignmentId FROM gp.GuardAssignments a JOIN gp.Users u ON u.UserId=a.GuardUserId WHERE u.IdentityIssuer=N'urn:gatepass:development-directory' AND u.IdentitySubject=N'guard:GRD004' ORDER BY a.GuardAssignmentId;"
    Test-Case 'Repeat seed is idempotent for users grants allocations and project data' {
        $taskBefore=Counts; $taskOne=Seed-Dummy; $taskTwo=Seed-Dummy
        Assert-Condition ($taskBefore -eq (Counts)) 'Repeated seed duplicated data.'
        Assert-Condition ($taskTwo.employees -eq 24 -and $taskTwo.managers -eq 6 -and $taskTwo.guards -eq 12 -and $taskTwo.projects -eq 6 -and $taskTwo.guard_assignments -eq 20) 'Dummy graph totals differ.'
    }
    Test-Case 'Managers come from the same employee population' {
        $taskCount=Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM gp.Employees e JOIN gp.Employees m ON m.EmployeeId=e.ManagerEmployeeId JOIN gp.Users u ON u.UserId=e.UserId WHERE u.IdentityIssuer=N'urn:gatepass:development-directory' AND m.EmployeeId IN('EMP019','EMP020','EMP021','EMP022','EMP023','EMP024');"
        Assert-Condition ($taskCount -eq 22) 'Manager links do not match the requested employee population.'
    }
    Test-Case 'Seed creates no SSO sessions or SQL identities' {
        Assert-Condition ((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentityIssuer=N'urn:gatepass:development-directory';") -eq 0) 'Unexpected development session.'
        Assert-Condition ((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM sys.database_principals WHERE name IN('Employee 1','Guard 1','EMP001','GRD001');") -eq 0) 'Unexpected SQL principal.'
    }
    Test-Case 'Seed does not resurrect a revoked guard role' {
        Invoke-GatePassNonQuery $taskConnection 'UPDATE gp.StaffRoleGrants SET RevokedAtUtc=SYSUTCDATETIME(),RevokedByUserId=@actor WHERE RoleGrantId=@id;' @{actor=$taskSeedActor;id=$taskGuardGrant}
        try {
            $null=Seed-Dummy
            Assert-Condition ((Invoke-GatePassScalar $taskConnection 'SELECT COUNT(*) FROM gp.StaffRoleGrants WHERE RoleGrantId=@id AND RevokedAtUtc IS NOT NULL;' @{id=$taskGuardGrant}) -eq 1) 'Revoked role was reactivated.'
        }
        finally { Invoke-GatePassNonQuery $taskConnection 'UPDATE gp.StaffRoleGrants SET RevokedAtUtc=NULL,RevokedByUserId=NULL WHERE RoleGrantId=@id;' @{id=$taskGuardGrant} }
    }
    Test-Case 'Seed does not recreate a deallocated project allocation' {
        Invoke-GatePassNonQuery $taskConnection 'UPDATE gp.GuardAssignments SET DeallocatedAtUtc=SYSUTCDATETIME(),DeallocatedByUserId=@actor WHERE GuardAssignmentId=@id;' @{actor=$taskSeedActor;id=$taskGuardAssignment}
        try {
            $taskBefore=Counts; $null=Seed-Dummy
            Assert-Condition ($taskBefore -eq (Counts)) 'A replacement allocation was silently created.'
            Assert-Condition ((Invoke-GatePassScalar $taskConnection 'SELECT COUNT(*) FROM gp.GuardAssignments WHERE GuardAssignmentId=@id AND DeallocatedAtUtc IS NOT NULL;' @{id=$taskGuardAssignment}) -eq 1) 'Deallocated assignment was restored.'
        }
        finally { Invoke-GatePassNonQuery $taskConnection 'UPDATE gp.GuardAssignments SET DeallocatedAtUtc=NULL,DeallocatedByUserId=NULL WHERE GuardAssignmentId=@id;' @{id=$taskGuardAssignment} }
    }
    Test-Case 'Seed does not restore a removed guard capability' {
        $taskGrant=Invoke-GatePassScalar $taskConnection "SELECT g.RoleGrantId FROM gp.StaffRoleGrants g JOIN gp.Users u ON u.UserId=g.UserId WHERE u.IdentityIssuer=N'urn:gatepass:development-directory' AND u.IdentitySubject=N'guard:GRD001';"
        Invoke-GatePassNonQuery $taskConnection "DELETE FROM gp.GrantCapabilities WHERE RoleGrantId=@id AND CapabilityCode='TEMP_ID_MOVEMENT';" @{id=$taskGrant}
        try {
            $null=Seed-Dummy
            Assert-Condition ((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM gp.GrantCapabilities WHERE RoleGrantId=@id AND CapabilityCode='TEMP_ID_MOVEMENT';" @{id=$taskGrant}) -eq 0) 'Removed capability was silently restored.'
        }
        finally { Invoke-GatePassNonQuery $taskConnection "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(@id,'TEMP_ID_MOVEMENT');" @{id=$taskGrant} }
    }
    Test-Case 'Seed does not reactivate a disabled application account' {
        $taskUser=Invoke-GatePassScalar $taskConnection "SELECT UserId FROM gp.Users WHERE IdentityIssuer=N'urn:gatepass:development-directory' AND IdentitySubject=N'guard:GRD003';"
        Invoke-GatePassNonQuery $taskConnection 'UPDATE gp.Users SET IsActive=0 WHERE UserId=@id;' @{id=$taskUser}
        try { $null=Seed-Dummy; Assert-Condition ((Invoke-GatePassScalar $taskConnection 'SELECT IsActive FROM gp.Users WHERE UserId=@id;' @{id=$taskUser}) -eq $false) 'Disabled account was reactivated.' }
        finally { Invoke-GatePassNonQuery $taskConnection 'UPDATE gp.Users SET IsActive=1 WHERE UserId=@id;' @{id=$taskUser} }
    }
    Test-Case 'Production marker and non-dummy addresses are rejected' {
        $taskUnsafe=$taskStaff | ConvertFrom-Json; $taskUnsafe.developmentOnly=$false
        Expect-Rejected { Seed-Dummy -Staff ($taskUnsafe | ConvertTo-Json -Depth 8) }
        $taskBad=$taskDirectory | ConvertFrom-Json; $taskBad.employees[0].officialEmail='someone@external.test'
        Expect-Rejected { Seed-Dummy -Directory ($taskBad | ConvertTo-Json -Depth 8) }
    }
    Test-Case 'Guard fixture cannot grant administrative capabilities' {
        $taskUnsafe=$taskStaff | ConvertFrom-Json; $taskUnsafe.guards[0].capabilities+=@('ROLE_GRANTS_MANAGE')
        Expect-Rejected { Seed-Dummy -Staff ($taskUnsafe | ConvertTo-Json -Depth 8) }
    }
    Test-Case 'Existing employee data outside mock ownership cannot be overwritten' {
        $taskUser=[guid]::NewGuid()
        Invoke-GatePassNonQuery $taskConnection @'
INSERT gp.Users(UserId,IdentityIssuer,IdentitySubject,DisplayName) VALUES(@id,N'urn:gatepass:development-collision-test',CONVERT(nvarchar(36),@id),N'Synthetic collision probe');
INSERT gp.Employees(EmployeeId,UserId,FullName,OfficialEmail,IsActive,LastSyncedAtUtc)
VALUES('EMP099',@id,N'Synthetic collision probe',N'collision@example.invalid',1,SYSUTCDATETIME());
'@ @{id=$taskUser}
        try {
            $taskBad=$taskDirectory | ConvertFrom-Json; $taskExtra=$taskDirectory | ConvertFrom-Json; $taskExtra=$taskExtra.employees[0]
            $taskExtra.employeeId='EMP099'; $taskExtra.displayName='Employee 99'; $taskExtra.officialEmail='employee99@example.invalid'; $taskBad.employees+=@($taskExtra)
            Expect-Rejected { Seed-Dummy -Directory ($taskBad | ConvertTo-Json -Depth 8) }
            Assert-Condition ((Invoke-GatePassScalar $taskConnection "SELECT FullName FROM gp.Employees WHERE EmployeeId='EMP099';") -eq 'Synthetic collision probe') 'Outside-owned employee was overwritten.'
        }
        finally { Invoke-GatePassNonQuery $taskConnection "DELETE FROM gp.Employees WHERE EmployeeId='EMP099' AND UserId=@id; DELETE FROM gp.Users WHERE UserId=@id;" @{id=$taskUser} }
    }
}
finally {
    $taskConnection.Dispose()
    $taskReport=[ordered]@{Status=if ($taskCases.Count -eq 10 -and @($taskCases | Where-Object {-not $_.Passed}).Count -eq 0) {'PASS'} else {'FAIL'};
        CheckedAtUtc=[datetime]::UtcNow.ToString('o');Database='GatePass_DesignTest';DevelopmentOnly=$true;
        SeedSha256=(Get-FileHash -LiteralPath $taskSeedPath -Algorithm SHA256).Hash;
        HarnessSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash;CaseCount=$taskCases.Count;Cases=@($taskCases)}
    $taskReport | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskRoot 'database/validation/development-seed-tests.json') -Encoding utf8
}
if ($taskReport.Status -ne 'PASS') { throw 'Development seed tests failed.' }
Write-Output 'All 10 development seed checks passed; default dummy guard state restored after negative checks.'
