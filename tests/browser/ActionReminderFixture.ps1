#Requires -Version 7.0
[CmdletBinding()]param([Parameter(Mandatory)][guid]$RunId,[ValidateSet('Create','Inspect','Cleanup')][string]$Action)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $root 'tools/GatePass.LocalSql.psm1') -Force
$prefix='GP02-'+$RunId.ToString('N').Substring(0,20).ToUpperInvariant()
if($Action -eq 'Create'){$base=(& (Join-Path $PSScriptRoot 'AdminConsoleFixture.ps1') -RunId $RunId -Action Create)|ConvertFrom-Json}
$db=Open-GatePassLocalSql -TrustLocalServerCertificate
try{
 if($Action -eq 'Cleanup'){
  Invoke-GatePassNonQuery $db 'DELETE gp.HostReminderOperations WHERE VisitRequestId IN(SELECT VisitRequestId FROM gp.VisitRequests WHERE PublicReference LIKE @prefix+''-%'');' @{prefix=$prefix}
  & (Join-Path $PSScriptRoot 'AdminConsoleFixture.ps1') -RunId $RunId -Action Cleanup
 }elseif($Action -eq 'Create'){
  Invoke-GatePassScalar $db @'
SET NOCOUNT ON;SET XACT_ABORT ON;
IF DB_NAME()<>'GatePass_DesignTest' THROW 52900,'Test database required.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @guard uniqueidentifier=(SELECT UserId FROM gp.Users WHERE IdentityIssuer='gatepass-phase02-fixture' AND IdentitySubject=@prefix+':GUARD'),
@visit uniqueidentifier=(SELECT VisitRequestId FROM gp.VisitRequests WHERE PublicReference LIKE @prefix+'-%' AND PersonName=N'Synthetic PENDING');
IF @guard IS NULL OR @visit IS NULL THROW 52900,'Owned fixture required.',1;
INSERT gp.StaffProfiles(UserId,StaffCode) VALUES(@guard,@prefix+'-G');
INSERT gp.GuardCredentials(UserId,LoginId,EncodedPasswordHash,MustChangePassword,PasswordChangedAtUtc)
SELECT @guard,LOWER(@prefix)+'-guard@example.invalid',EncodedPasswordHash,0,SYSUTCDATETIME() FROM gp.GuardCredentials WHERE LoginId='admin2@example.com';
UPDATE gp.VisitRequests SET SubmittedAtUtc=DATEADD(minute,-20,SYSUTCDATETIME()) WHERE VisitRequestId=@visit;
INSERT gp.NotificationOutbox(VisitRequestId,RecipientKind,RecipientEmployeeId,TemplateCode,PayloadJson,DedupeHash,Status,CreatedAtUtc,SentAtUtc)
SELECT @visit,'EMPLOYEE',HostEmployeeId,'HOST_APPROVAL_REQUEST',(SELECT @visit visitRequestId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),HASHBYTES('SHA2_256',@prefix+':inline-reminder'),'SENT',DATEADD(minute,-6,SYSUTCDATETIME()),DATEADD(minute,-6,SYSUTCDATETIME()) FROM gp.VisitRequests WHERE VisitRequestId=@visit;
COMMIT;
SELECT(SELECT LOWER(@prefix)+'-guard@example.invalid' guardLogin,@admin adminLogin,@visit visitRequestId,LocationId locationId,CONVERT(varchar(20),ProjectLocationId) projectDutyId,(SELECT CONVERT(varchar(20),CommonAreaId) FROM gp.CommonAreas WHERE AreaName=@prefix+' Common A') commonDutyId FROM gp.VisitRequests WHERE VisitRequestId=@visit FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
'@ @{prefix=$prefix;admin=$base.login}
 }else{
  Invoke-GatePassScalar $db @'
SELECT(SELECT COUNT(*) FROM gp.NotificationOutbox n JOIN gp.VisitRequests v ON v.VisitRequestId=n.VisitRequestId WHERE v.PublicReference LIKE @prefix+'-%') notificationCount,
(SELECT COUNT(*) FROM gp.NotificationOutbox n JOIN gp.VisitRequests v ON v.VisitRequestId=n.VisitRequestId WHERE v.PublicReference LIKE @prefix+'-%' AND(n.RecipientEmployeeId<>v.HostEmployeeId OR n.TemplateCode<>'HOST_APPROVAL_REQUEST')) recipientMismatch,
(SELECT COUNT(*) FROM gp.SecurityAuditEvents e JOIN gp.VisitRequests v ON e.TargetReference=CONVERT(varchar(36),v.VisitRequestId) WHERE v.PublicReference LIKE @prefix+'-%' AND e.ActionCode='APPROVAL_REMINDER') reminderAudits,
(SELECT Status FROM gp.VisitRequests WHERE PublicReference LIKE @prefix+'-%' AND PersonName=N'Synthetic PENDING') visitStatus
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;
'@ @{prefix=$prefix}
 }
}finally{$db.Dispose()}
