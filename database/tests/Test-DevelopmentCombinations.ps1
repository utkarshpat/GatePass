#Requires -Version 7.0
[CmdletBinding()]
param([string]$Server='localhost\SQLEXPRESS',[switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:NODE_ENV -eq 'production') { throw 'Development matrix cannot run in production mode.' }
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskDirectory=Get-Content -LiteralPath (Join-Path $taskRoot 'database/development/directory-fixtures.json') -Raw | ConvertFrom-Json
$taskStaff=Get-Content -LiteralPath (Join-Path $taskRoot 'database/development/staff-fixtures.json') -Raw | ConvertFrom-Json
$taskOldEnvironment=$env:NODE_ENV; $taskOldMode=$env:GATEPASS_DIRECTORY_MODE
try {
    $env:NODE_ENV='development'; $env:GATEPASS_DIRECTORY_MODE='mock'
    $taskGatewayText=& node (Join-Path $taskRoot 'tools/preview-directory-combinations.ts')
    if ($LASTEXITCODE -ne 0) { throw 'Directory gateway matrix read failed.' }
    $taskGateway=($taskGatewayText -join '') | ConvertFrom-Json
}
finally {
    [Environment]::SetEnvironmentVariable('NODE_ENV',$taskOldEnvironment,'Process')
    [Environment]::SetEnvironmentVariable('GATEPASS_DIRECTORY_MODE',$taskOldMode,'Process')
}
$taskConnection=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
try {
    # Administrative inspection of private predicates, never an API permission grant.
    # Existing procedure tests separately exercise session/visit/state/race authorization.
    $taskActual=(Invoke-GatePassScalar $taskConnection @'
SET XACT_ABORT ON; SET NOCOUNT ON;
IF DB_NAME()<>N'GatePass_DesignTest' THROW 52911,'Dedicated development database required.',1;
BEGIN TRANSACTION;
EXEC gp._TakeLock @Resource=N'gp:authorization',@Mode='Shared';
DECLARE @now datetime2(3)=SYSUTCDATETIME(),@cutoff datetime2(3);
EXEC gp._DirectoryCutoff @Now=@now,@Cutoff=@cutoff OUTPUT;
DECLARE @result nvarchar(max)=(SELECT
JSON_QUERY((SELECT RIGHT(u.IdentitySubject,6) guard,p.ExternalProjectCode project,l.LocationCode location,
 CONVERT(bit,CASE WHEN u.IsActive=1 AND p.IsActive=1 AND l.IsActive=1 AND pl.IsActive=1
 AND gp._HasCapability(u.UserId,'PROJECT_MOVEMENT',l.LocationId,pl.ProjectLocationId,1,@now)=1
 AND EXISTS(SELECT 1 FROM gp.GuardAssignments a WHERE a.GuardUserId=u.UserId AND a.ProjectLocationId=pl.ProjectLocationId
 AND a.DeallocatedAtUtc IS NULL AND a.ValidFromUtc<=@now AND (a.ValidUntilUtc IS NULL OR @now<a.ValidUntilUtc)) THEN 1 ELSE 0 END) allowed
 FROM gp.Users u CROSS JOIN gp.Projects p CROSS JOIN gp.Locations l
 LEFT JOIN gp.ProjectLocations pl ON pl.ProjectId=p.ProjectId AND pl.LocationId=l.LocationId
 WHERE u.IdentityIssuer=N'urn:gatepass:development-directory' AND u.IdentitySubject LIKE N'guard:GRD%'
 AND p.ExternalProjectCode LIKE N'DEMO-PRJ-%' ORDER BY u.IdentitySubject,p.ExternalProjectCode,l.LocationCode FOR JSON PATH)) guards,
JSON_QUERY((SELECT RIGHT(u.IdentitySubject,6) guard,l.LocationCode location,c.capability,
 CONVERT(bit,CASE WHEN u.IsActive=1 AND l.IsActive=1 AND gp._HasCapability(u.UserId,c.capability,l.LocationId,NULL,1,@now)=1 THEN 1 ELSE 0 END) allowed
 FROM gp.Users u CROSS JOIN gp.Locations l CROSS JOIN (VALUES('TEMP_ID_MOVEMENT'),('RECONCILE_EXIT')) c(capability)
 WHERE u.IdentityIssuer=N'urn:gatepass:development-directory' AND u.IdentitySubject LIKE N'guard:GRD%'
 ORDER BY u.IdentitySubject,l.LocationCode,c.capability FOR JSON PATH)) capabilities,
JSON_QUERY((SELECT e.EmployeeId employee,p.ExternalProjectCode project,l.LocationCode location,
 CONVERT(bit,CASE WHEN e.IsActive=1 AND u.IsActive=1 AND e.LastSyncedAtUtc BETWEEN @cutoff AND @now
 AND p.IsActive=1 AND p.LastSyncedAtUtc BETWEEN @cutoff AND @now AND l.IsActive=1 AND pl.IsActive=1
 AND m.IsActive=1 AND m.VerifiedAtUtc BETWEEN @cutoff AND @now THEN 1 ELSE 0 END) allowed
 FROM gp.Employees e JOIN gp.Users u ON u.UserId=e.UserId CROSS JOIN gp.Projects p CROSS JOIN gp.Locations l
 LEFT JOIN gp.ProjectLocations pl ON pl.ProjectId=p.ProjectId AND pl.LocationId=l.LocationId
 LEFT JOIN gp.EmployeeProjectMemberships m ON m.EmployeeId=e.EmployeeId AND m.ProjectId=p.ProjectId
 WHERE u.IdentityIssuer=N'urn:gatepass:development-directory' AND p.ExternalProjectCode LIKE N'DEMO-PRJ-%'
 ORDER BY e.EmployeeId,p.ExternalProjectCode,l.LocationCode FOR JSON PATH)) hosts,
JSON_QUERY((SELECT e.EmployeeId employee,e.ManagerEmployeeId manager FROM gp.Employees e JOIN gp.Users u ON u.UserId=e.UserId
 WHERE u.IdentityIssuer=N'urn:gatepass:development-directory' ORDER BY e.EmployeeId FOR JSON PATH,INCLUDE_NULL_VALUES)) managers
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
COMMIT; SELECT @result;
'@) | ConvertFrom-Json
}
finally { $taskConnection.Dispose() }
$taskRows=[Collections.Generic.List[object]]::new()
function Record-Check([string]$Kind,[string]$Subject,[string]$Project,[string]$Location,$Expected,$Actual) {
    $taskRows.Add([pscustomobject]@{Kind=$Kind;Subject=$Subject;Project=$Project;Location=$Location;
        Expected=$Expected;Actual=$Actual;Passed=($Expected -ceq $Actual)})
}
$taskLocations=@('NOIDA','BENGALURU','CHENNAI','PUNE')
foreach ($taskGuard in $taskStaff.guards) {
    foreach ($taskProject in $taskDirectory.projects) {
        foreach ($taskLocation in $taskLocations) {
            $taskExpected=$taskGuard.locationCode -eq $taskLocation -and $taskGuard.projectCodes -contains $taskProject.projectCode -and $taskProject.locationCodes -contains $taskLocation
            $taskMatches=@($taskActual.guards | Where-Object { $_.guard -eq $taskGuard.guardId -and $_.project -eq $taskProject.projectCode -and $_.location -eq $taskLocation })
            if ($taskMatches.Count -ne 1) { throw 'Guard matrix has missing/duplicate rows.' }
            Record-Check 'PROJECT_MOVEMENT' $taskGuard.guardId $taskProject.projectCode $taskLocation $taskExpected ([bool]$taskMatches[0].allowed)
        }
    }
    foreach ($taskLocation in $taskLocations) {
        foreach ($taskCapability in @('TEMP_ID_MOVEMENT','RECONCILE_EXIT')) {
            $taskExpected=$taskGuard.locationCode -eq $taskLocation -and $taskGuard.capabilities -contains $taskCapability
            $taskMatches=@($taskActual.capabilities | Where-Object { $_.guard -eq $taskGuard.guardId -and $_.location -eq $taskLocation -and $_.capability -eq $taskCapability })
            if ($taskMatches.Count -ne 1) { throw 'Capability matrix has missing/duplicate rows.' }
            Record-Check $taskCapability $taskGuard.guardId '' $taskLocation $taskExpected ([bool]$taskMatches[0].allowed)
        }
    }
}
foreach ($taskEmployee in $taskDirectory.employees) {
    foreach ($taskProject in $taskDirectory.projects) {
        foreach ($taskLocation in $taskLocations) {
            $taskExpected=$taskEmployee.isActive -and $taskEmployee.projectCodes -contains $taskProject.projectCode -and $taskProject.locationCodes -contains $taskLocation
            $taskMatches=@($taskActual.hosts | Where-Object { $_.employee -eq $taskEmployee.employeeId -and $_.project -eq $taskProject.projectCode -and $_.location -eq $taskLocation })
            if ($taskMatches.Count -ne 1) { throw 'Host matrix has missing/duplicate rows.' }
            Record-Check 'HOST_ELIGIBILITY_SQL' $taskEmployee.employeeId $taskProject.projectCode $taskLocation $taskExpected ([bool]$taskMatches[0].allowed)
            $taskCandidates=@($taskGateway.hosts | Where-Object {$_.project -eq $taskProject.projectCode -and $_.location -eq $taskLocation})
            if ($taskCandidates.Count -ne 1) { throw 'Gateway host matrix has missing/duplicate sets.' }
            Record-Check 'HOST_ELIGIBILITY_GATEWAY' $taskEmployee.employeeId $taskProject.projectCode $taskLocation $taskExpected ($taskCandidates[0].employees -contains $taskEmployee.employeeId)
        }
    }
    $taskManager=@($taskActual.managers | Where-Object {$_.employee -eq $taskEmployee.employeeId})
    $taskGatewayManager=@($taskGateway.managers | Where-Object {$_.employee -eq $taskEmployee.employeeId})
    if ($taskManager.Count -ne 1 -or $taskGatewayManager.Count -ne 1) { throw 'Manager matrix has missing/duplicate rows.' }
    Record-Check 'MANAGER_SQL' $taskEmployee.employeeId '' '' ([string]$taskEmployee.managerEmployeeId) ([string]$taskManager[0].manager)
    Record-Check 'MANAGER_GATEWAY' $taskEmployee.employeeId '' '' ([string]$taskEmployee.managerEmployeeId) ([string]$taskGatewayManager[0].manager)
}
if ($taskActual.guards.Count -ne 288 -or $taskActual.capabilities.Count -ne 96 -or $taskActual.hosts.Count -ne 576 -or $taskActual.managers.Count -ne 24) { throw 'Unexpected fixture Cartesian product size.' }
$taskFailed=@($taskRows | Where-Object {-not $_.Passed})
$taskSummary=@($taskRows | Group-Object Kind | ForEach-Object {
    [ordered]@{Kind=$_.Name;Checks=$_.Count;Passed=@($_.Group | Where-Object Passed).Count;
        Allowed=if ($_.Name -like '*MANAGER*') {$null} else {@($_.Group | Where-Object {$_.Expected -eq $true}).Count}}
})
$taskReport=[ordered]@{Status=if ($taskFailed.Count -eq 0) {'PASS'} else {'FAIL'};CheckedAtUtc=[datetime]::UtcNow.ToString('o');
    Database='GatePass_DesignTest';DevelopmentOnly=$true;Checks=$taskRows.Count;Failed=$taskFailed.Count;Summary=$taskSummary;
    Scope='Full Cartesian products of the current synthetic employees/guards/projects/locations plus direct manager mappings; SQL scope predicates and directory gateway compared independently with JSON fixtures.';
    Limits='Administrative scope inspection, not a simulation of all workflow states or authenticated approval/movement. Host eligibility is not assigned-host approval authority. Real SSO/API/mail not exercised.';
    HarnessSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash;
    FixtureSha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot 'database/development/directory-fixtures.json') -Algorithm SHA256).Hash;
    StaffSha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot 'database/development/staff-fixtures.json') -Algorithm SHA256).Hash;
    GatewaySha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot 'src/integrations/directory/DirectoryGateway.ts') -Algorithm SHA256).Hash;Failures=$taskFailed}
$taskReport | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $taskRoot 'database/validation/development-combination-report.json') -Encoding utf8
$taskRows | Export-Csv -LiteralPath (Join-Path $taskRoot 'database/validation/development-combinations.csv') -NoTypeInformation -Encoding utf8
$taskSummary | Format-Table
if ($taskFailed.Count) { throw "$($taskFailed.Count) development combinations failed; refresh dummy directory if freshness expired and inspect the evidence." }
Write-Output "PASS: $($taskRows.Count) development combination checks."
