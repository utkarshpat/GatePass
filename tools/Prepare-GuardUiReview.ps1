#Requires -Version 7.0
# Test-only: adds scan history for exact capability-owned HTTP test fixtures.
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskReady=Join-Path $taskRoot 'tmp/guard-ui-review-ready.json'
$taskFixture=Get-Content -LiteralPath $taskReady -Raw | ConvertFrom-Json
if($taskFixture.synthetic -ne $true -or $taskFixture.port -ne 18446){throw 'Owned UI-review fixture required.'}
Import-Module (Join-Path $PSScriptRoot 'GatePass.LocalSql.psm1') -Force
$taskDb=Open-GatePassLocalSql -TrustLocalServerCertificate
try{
 $taskSql=@'
SET NOCOUNT ON;SET XACT_ABORT ON;
IF DB_NAME()<>N'GatePass_DesignTest' OR NOT EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DevelopmentDirectoryMarker' AND CONVERT(nvarchar(100),value)=N'SYNTHETIC-DIRECTORY-V1') THROW 53600,'Synthetic test database required.',1;
DECLARE @ownedIntakes table(Id uniqueidentifier,TokenHash varbinary(32));
INSERT @ownedIntakes SELECT intakeId,TRY_CONVERT(varbinary(32),tokenHash,2) FROM OPENJSON(@Intakes) WITH(intakeId uniqueidentifier,tokenHash varchar(64));
IF NOT EXISTS(SELECT 1 FROM @ownedIntakes) OR EXISTS(SELECT 1 FROM @ownedIntakes x LEFT JOIN gp.RegistrationIntakes i ON i.IntakeId=x.Id WHERE i.IntakeId IS NULL OR x.TokenHash IS NULL OR i.TokenHash<>x.TokenHash) THROW 53600,'Fixture ownership mismatch.',1;
DECLARE @actor uniqueidentifier,@now datetime2(3)=SYSUTCDATETIME(),@cutoff datetime2(3);
SELECT @actor=u.UserId FROM gp.Users u JOIN gp.StaffLocalCredentials c ON c.UserId=u.UserId WHERE u.IdentityIssuer=N'urn:gatepass:development-directory' AND u.IdentitySubject=N'guard:GRD001' AND c.LoginId='gaurd1@example.com' AND u.IsActive=1 AND c.IsEnabled=1;
IF @actor IS NULL THROW 53600,'Existing synthetic review guard required.',1;
EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
INSERT gp.PassScanAttempts(ActorUserId,LocationId,AccessPassId,VisitRequestId,OutcomeCode,CorrelationId)
SELECT @actor,v.LocationId,p.AccessPassId,v.VisitRequestId,CASE WHEN v.Status='PENDING' THEN 'PENDING' ELSE 'VALID' END,NEWID()
FROM gp.VisitRequests v JOIN @ownedIntakes i ON i.Id=v.IntakeId JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
WHERE gp._VisitReadAllowed(@actor,'GUARD',v.VisitRequestId,@now,@cutoff)=1 AND NOT EXISTS(SELECT 1 FROM gp.PassScanAttempts a WHERE a.ActorUserId=@actor AND a.VisitRequestId=v.VisitRequestId);
DECLARE @count int=@@ROWCOUNT;COMMIT;SELECT CONVERT(nvarchar(20),@count);
'@
 $taskCount=Invoke-GatePassScalar $taskDb $taskSql @{Intakes=(ConvertTo-Json -InputObject @($taskFixture.intakes) -Compress)}
 Write-Output "Prepared $taskCount owned review scan rows; integration cleanup owns all affected visits."
}finally{$taskDb.Dispose()}
