#Requires -Version 7.0
# Local synthetic database only. Claims only the explicitly selected visit, never the global queue.
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
try {
 if($env:NODE_ENV -notin @('development','test') -or $env:GATEPASS_SSO_MODE -ne 'dummy' -or $env:GATEPASS_DIRECTORY_MODE -ne 'mock'){throw 'Development mode required.'}
 $taskInput=[Console]::In.ReadToEnd()|ConvertFrom-Json
 $taskVisit=[guid]::ParseExact($taskInput.visitRequestId,'D')
 Import-Module (Join-Path $PSScriptRoot 'GatePass.LocalSql.psm1') -Force
 $taskConnection=Open-GatePassLocalSql -TrustLocalServerCertificate
 try {
  if((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DevelopmentDirectoryMarker' AND CONVERT(nvarchar(100),value)=N'SYNTHETIC-DIRECTORY-V1'") -ne 1){throw 'Synthetic database required.'}
  $taskSql=@'
SET NOCOUNT ON; SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 EXEC gp._TakeLock N'gp:outbox:claim';
 DECLARE @now datetime2(3)=SYSUTCDATETIME();
 IF NOT EXISTS(SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId=@visit) THROW 52002,'Unknown selected visit.',1;
 DECLARE @claimed table(NotificationId bigint,ClaimToken uniqueidentifier);
 ;WITH due AS (
  SELECT TOP(5) * FROM gp.NotificationOutbox WITH(UPDLOCK)
  WHERE VisitRequestId=@visit AND AttemptCount<MaxAttempts
   AND ((Status='PENDING' AND NextAttemptAtUtc<=@now) OR (Status='PROCESSING' AND LockedUntilUtc<=@now))
  ORDER BY NotificationId
 )
 UPDATE due SET Status='PROCESSING',AttemptCount=AttemptCount+1,LockedBy=NEWID(),LockedUntilUtc=DATEADD(second,120,@now)
 OUTPUT inserted.NotificationId,inserted.LockedBy INTO @claimed;
 INSERT gp.SecurityAuditEvents(ActionCode,TargetType,TargetReference,ResultCode,MetadataJson)
 SELECT 'NOTIFICATION_CLAIMED','NOTIFICATION',CONVERT(varchar(100),NotificationId),'SUCCESS',N'{"developmentRedirect":true}' FROM @claimed;
 DECLARE @result nvarchar(max)=(SELECT NotificationId notificationId,ClaimToken claimToken FROM @claimed ORDER BY NotificationId FOR JSON PATH);
 COMMIT;
 SELECT COALESCE(@result,N'[]');
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 THROW;
END CATCH;
'@
  [Console]::Out.Write([string](Invoke-GatePassScalar $taskConnection $taskSql @{visit=$taskVisit}))
 }finally{$taskConnection.Dispose()}
}catch{[Console]::Out.Write('{"error":"DEVELOPMENT_MAIL_CLAIM_UNAVAILABLE"}');exit 1}
