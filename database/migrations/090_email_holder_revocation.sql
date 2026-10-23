/* Confirmed holder revocation. Status links do not confer mutation authority. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='089') THROW 54600,'Migration 089 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='090') THROW 54600,'Migration 090 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.ReadEmailRequest @VisitRequestId uniqueidentifier,@RecipientEmailHash varbinary(8000),@SnapshotHash varbinary(8000) AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;IF @@TRANCOUNT<>0 THROW 54100,'Ambient transaction not accepted.',1;
 IF @VisitRequestId IS NULL OR @RecipientEmailHash IS NULL OR DATALENGTH(@RecipientEmailHash)<>32 OR @SnapshotHash IS NULL OR DATALENGTH(@SnapshotHash)<>32 THROW 54102,'Invalid request.',1;
 DECLARE @now datetime2(3)=SYSUTCDATETIME(),@result nvarchar(max),@lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock @lock,'Shared';
 IF NOT EXISTS(SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId AND RequestType='EXTERNAL' AND PersonEmail IS NOT NULL AND HASHBYTES('SHA2_256',LOWER(PersonEmail))=@RecipientEmailHash AND SnapshotHash=@SnapshotHash AND PersonalDataPurgedAtUtc IS NULL AND @now<DATEADD(day,1,ValidUntilUtc)) THROW 54101,'Request unavailable.',1;
 SET @result=(SELECT v.VisitRequestId visitRequestId,v.PersonName personName,v.CompanyName companyName,JSON_QUERY(v.DeviceTypesJson) deviceTypes,v.PublicReference publicReference,v.Status status,p.Status passStatus,p.AccessPassId accessPassId,
 CONVERT(bit,CASE WHEN v.Status IN('PENDING','APPROVED') AND p.Status IN('PENDING','ACTIVE') AND @now<v.ValidUntilUtc AND NOT EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=v.VisitRequestId) THEN 1 ELSE 0 END) canCancel,
 l.LocationName locationName,pr.ProjectName projectName,h.FullName hostName,v.Reason reason,
 REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc
 FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.Locations l ON l.LocationId=v.LocationId
 JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId JOIN gp.Employees h ON h.EmployeeId=v.HostEmployeeId
 WHERE v.VisitRequestId=@VisitRequestId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.RevokeEmailRequest
 @VisitRequestId uniqueidentifier,@RecipientEmailHash varbinary(8000),@SnapshotHash varbinary(8000),
 @ClientKey uniqueidentifier,@ExpectedPassId uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54100,'Ambient transaction not accepted.',1;
 IF @VisitRequestId IS NULL OR @RecipientEmailHash IS NULL OR DATALENGTH(@RecipientEmailHash)<>32 OR @SnapshotHash IS NULL OR DATALENGTH(@SnapshotHash)<>32 OR @ClientKey IS NULL OR @ExpectedPassId IS NULL THROW 54102,'Invalid request.',1;
 DECLARE @now datetime2(3),@location int,@pair bigint,@state varchar(12),@pass uniqueidentifier,@passState varchar(12),@inside bit,@until datetime2(3),
 @op uniqueidentifier,@cached nvarchar(max),@previous varbinary(32),@operationState varchar(12),@result nvarchar(max),
 @binding varbinary(32)=HASHBYTES('SHA2_256',CONVERT(binary(16),@VisitRequestId)),
 @payload nvarchar(max)=(SELECT @VisitRequestId visitId,@ExpectedPassId expectedPassId,'NOT_REQUESTED_BY_HOLDER' reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 DECLARE @digest varbinary(32)=HASHBYTES('SHA2_256',@payload),@resource nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._TakeLock @resource;
 SET @now=SYSUTCDATETIME();
 -- The API verifies the purpose-separated signed capability; SQL rechecks its frozen individual binding under the visit lock.
 SELECT @location=LocationId,@pair=ProjectLocationId,@state=Status,@until=ValidUntilUtc FROM gp.VisitRequests WITH(UPDLOCK)
 WHERE VisitRequestId=@VisitRequestId AND RequestType='EXTERNAL' AND EmployeeId IS NULL AND PersonEmail IS NOT NULL
 AND HASHBYTES('SHA2_256',LOWER(PersonEmail))=@RecipientEmailHash AND SnapshotHash=@SnapshotHash
 AND PersonalDataPurgedAtUtc IS NULL AND @now<DATEADD(day,1,ValidUntilUtc);
 IF @location IS NULL THROW 54101,'Request unavailable.',1;
 SELECT @pass=AccessPassId,@passState=Status FROM gp.AccessPasses WITH(UPDLOCK) WHERE VisitRequestId=@VisitRequestId AND IsCurrent=1;
 IF @pass IS NULL OR @pass<>@ExpectedPassId THROW 52003,'Current pass changed; refresh the request.',1;
 SELECT @op=OperationId,@cached=ResultJson,@previous=PayloadHash,@operationState=Status FROM gp.IdempotencyRequests
 WHERE ActorBindingHash=@binding AND OperationCode='EMAIL_REVOKE_PASS' AND ClientKey=@ClientKey;
 IF @op IS NOT NULL
 BEGIN
  IF @previous<>@digest OR @operationState<>'COMPLETED' THROW 52003,'Conflicting retry.',1;
  COMMIT;SELECT @cached;RETURN;
 END;
 IF @state NOT IN('PENDING','APPROVED') OR @passState NOT IN('PENDING','ACTIVE') OR @now>=@until OR EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=@VisitRequestId) THROW 52005,'Pass cannot be revoked.',1;
 SELECT @inside=IsInside FROM gp.VisitPresence WITH(UPDLOCK) WHERE VisitRequestId=@VisitRequestId;
 IF @inside IS NULL THROW 52005,'Presence unavailable.',1;
 SET @op=NEWID();
 INSERT gp.IdempotencyRequests(OperationId,ActorBindingHash,OperationCode,ClientKey,PayloadHash,Status,ExpiresAtUtc)
 VALUES(@op,@binding,'EMAIL_REVOKE_PASS',@ClientKey,@digest,'PROCESSING',DATEADD(day,7,@now));
 UPDATE gp.VisitRequests SET Status='CANCELLED',CancelledAtUtc=@now WHERE VisitRequestId=@VisitRequestId;
 UPDATE gp.AccessPasses SET Status='REVOKED',RevokedAtUtc=@now,RevocationReason=N'Not requested by the pass holder (email confirmation)' WHERE VisitRequestId=@VisitRequestId AND Status<>'REVOKED';
 UPDATE gp.PassDeliveryLinks SET RevokedAtUtc=COALESCE(RevokedAtUtc,@now) WHERE VisitRequestId=@VisitRequestId;
 UPDATE r SET ClaimToken=NULL,LeaseUntilUtc=NULL,FailureCode='RENDER_FAILED' FROM gp.PassPrintRenderState r JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId WHERE j.VisitRequestId=@VisitRequestId AND j.Status IN('REQUESTED','RENDERED');
 UPDATE gp.PassPrintJobs SET Status='FAILED',UpdatedAtUtc=@now WHERE VisitRequestId=@VisitRequestId AND Status IN('REQUESTED','RENDERED');
 UPDATE gp.NotificationOutbox SET Status='CANCELLED',LockedBy=NULL,LockedUntilUtc=NULL,LastErrorCode='VISIT_CANCELLED' WHERE VisitRequestId=@VisitRequestId AND Status IN('PENDING','PROCESSING');
 -- Keep presence and all access/approval history: an occupant still needs a recorded exit.
 SET @result=(SELECT @op operationId,@VisitRequestId visitRequestId,@pass accessPassId,'CANCELLED' status,@inside wasInsideAtCancellation FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson)
 VALUES('EMAIL_PASS_REVOKED','VISIT',CONVERT(varchar(36),@VisitRequestId),@location,@pair,'SUCCESS',N'{"reason":"NOT_REQUESTED_BY_HOLDER","actorKind":"EMAIL_HOLDER"}');
 EXEC gp._CompleteOperation @op,@result;
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.RevokeEmailRequest TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('090',N'Confirmed individual email holder pass revocation with preserved history');
COMMIT;
