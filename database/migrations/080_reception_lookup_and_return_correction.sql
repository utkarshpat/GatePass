/* Reception lookup and audited mistaken-return correction. No new guard capabilities. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='079') THROW 54600,'Migration 079 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='080') THROW 54600,'Migration 080 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
CREATE TABLE gp.PassReturnCorrections(CorrectionId bigint IDENTITY PRIMARY KEY,VisitRequestId uniqueidentifier NOT NULL REFERENCES gp.VisitRequests(VisitRequestId),AccessPassId uniqueidentifier NOT NULL REFERENCES gp.AccessPasses(AccessPassId),OriginalReturnedAtUtc datetime2(3) NOT NULL,OriginalReturnedByUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),OriginalReturnOperationId uniqueidentifier NOT NULL,DevicesVerified bit NOT NULL,CorrectedByUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),CorrectedAtUtc datetime2(3) NOT NULL,Reason nvarchar(300) NOT NULL,OperationId uniqueidentifier NOT NULL UNIQUE REFERENCES gp.IdempotencyRequests(OperationId));
GO
CREATE PROCEDURE gp.LookupReceptionVisits @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@Search nvarchar(max)=NULL,@CredentialHash varbinary(8000)=NULL,@AfterSubmittedAtUtc datetime2(3)=NULL,@AfterVisitRequestId uniqueidentifier=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
 IF @LocationId IS NULL OR @LocationId<=0 OR (@Search IS NULL AND @CredentialHash IS NULL) OR(@Search IS NOT NULL AND @CredentialHash IS NOT NULL) OR(@Search IS NOT NULL AND(LEN(LTRIM(RTRIM(@Search)))<2 OR DATALENGTH(@Search)>200)) OR(@CredentialHash IS NOT NULL AND DATALENGTH(@CredentialHash)<>32) OR(@AfterSubmittedAtUtc IS NULL AND @AfterVisitRequestId IS NOT NULL) OR(@AfterSubmittedAtUtc IS NOT NULL AND @AfterVisitRequestId IS NULL) THROW 53502,'Invalid lookup.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max),@more bit,@time datetime2(3),@id uniqueidentifier;
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireReceptionLocation @actor,@LocationId,@now;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 DECLARE @page table(Id uniqueidentifier PRIMARY KEY,Submitted datetime2(3));
 INSERT @page SELECT TOP(21) v.VisitRequestId,v.SubmittedAtUtc FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
 WHERE v.LocationId=@LocationId AND v.PersonalDataPurgedAtUtc IS NULL AND gp._VisitReadAllowed(@actor,'RECEPTION',v.VisitRequestId,@now,@cutoff)=1
 AND ((@CredentialHash IS NOT NULL AND p.CredentialHash=@CredentialHash) OR(@Search IS NOT NULL AND(CHARINDEX(@Search,v.PersonName)>0 OR CHARINDEX(@Search,v.EmployeeId)>0 OR CHARINDEX(@Search,v.PublicReference)>0 OR CHARINDEX(@Search,p.PublicPassNumber)>0 OR CHARINDEX(@Search,v.PersonEmail)>0 OR CHARINDEX(@Search,v.PersonPhone)>0)))
 AND(@AfterSubmittedAtUtc IS NULL OR v.SubmittedAtUtc<@AfterSubmittedAtUtc OR(v.SubmittedAtUtc=@AfterSubmittedAtUtc AND v.VisitRequestId<@AfterVisitRequestId)) ORDER BY v.SubmittedAtUtc DESC,v.VisitRequestId DESC;
 SET @more=CASE WHEN(SELECT COUNT(*) FROM @page)>20 THEN 1 ELSE 0 END;
 IF @more=1 BEGIN DELETE @page WHERE Id=(SELECT TOP(1) Id FROM @page ORDER BY Submitted,Id);SELECT TOP(1) @time=Submitted,@id=Id FROM @page ORDER BY Submitted,Id;END;
 SET @result=(SELECT JSON_QUERY(COALESCE((SELECT v.VisitRequestId visitRequestId,v.PersonName personName,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.Status status,REPLACE(CONVERT(char(23),v.SubmittedAtUtc,121),' ','T')+'Z' submittedAtUtc FROM @page n JOIN gp.VisitRequests v ON v.VisitRequestId=n.Id JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 ORDER BY n.Submitted DESC,n.Id DESC FOR JSON PATH),N'[]')) matches,@more hasMore,@id afterVisitRequestId,REPLACE(CONVERT(char(23),@time,121),' ','T')+'Z' afterSubmittedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ResultCode) VALUES(@actor,'RECEPTION_LOOKUP','LOCATION',@LocationId,'SUCCESS');COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.CorrectReceptionReturn @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@VisitRequestId uniqueidentifier,@ExpectedPassId uniqueidentifier,@ExpectedReturnedAtUtc datetime2(3),@ClientKey uniqueidentifier,@Reason nvarchar(max)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
 IF @VisitRequestId IS NULL OR @ExpectedPassId IS NULL OR @ExpectedReturnedAtUtc IS NULL OR @ClientKey IS NULL OR @Reason IS NULL OR LEN(LTRIM(RTRIM(@Reason)))<5 OR DATALENGTH(@Reason)>600 THROW 54502,'Reason required.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@location int,@cutoff datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max),@status varchar(12),@deadline datetime2(3);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 SELECT @location=LocationId,@status=Status,@deadline=ApprovalDeadlineUtc FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId;
 IF @location IS NULL THROW 53501,'Not authorized.',1;
 EXEC gp._RequireReceptionLocation @actor,@location,@now;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF gp._VisitReadAllowed(@actor,'RECEPTION',@VisitRequestId,@now,@cutoff)=0 OR NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='PASS_PRINT' WHERE g.UserId=@actor AND g.RoleCode='RECEPTION' AND g.ScopeType='LOCATION' AND g.LocationId=@location AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND(g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)) THROW 53501,'Not authorized.',1;
 DECLARE @payload nvarchar(max)=(SELECT @VisitRequestId visitRequestId,@ExpectedPassId expectedPassId,@ExpectedReturnedAtUtc expectedReturnedAtUtc,@Reason reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 EXEC gp._BeginOperation @actor,'CORRECT_RETURN',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
 IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
 IF @status NOT IN('APPROVED','PENDING') OR NOT EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=@VisitRequestId AND AccessPassId=@ExpectedPassId AND ReturnedAtUtc=@ExpectedReturnedAtUtc)
 OR NOT EXISTS(SELECT 1 FROM gp.AccessPasses WHERE VisitRequestId=@VisitRequestId AND AccessPassId=@ExpectedPassId AND IsCurrent=1 AND Status='REVOKED' AND RevocationReason=N'Printed pass returned at final building exit') THROW 54503,'Return or pass changed.',1;
 IF gp._PersonInsideOffice(@VisitRequestId)=1 THROW 54504,'Reconcile project presence first.',1;
 -- A replacement/overlapping request must not coexist with a reactivated employee or visitor pass.
 IF EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.VisitRequests other ON other.LocationId=v.LocationId AND other.VisitRequestId<>v.VisitRequestId AND other.PersonalDataPurgedAtUtc IS NULL AND other.SubmittedAtUtc>=@ExpectedReturnedAtUtc AND other.Status IN('PENDING','APPROVED') AND other.ValidFromUtc<v.ValidUntilUtc AND v.ValidFromUtc<other.ValidUntilUtc
 AND ((v.EmployeeId IS NOT NULL AND other.EmployeeId=v.EmployeeId) OR(v.EmployeeId IS NULL AND other.EmployeeId IS NULL AND((v.PersonEmail IS NOT NULL AND other.PersonEmail=v.PersonEmail) OR(v.PersonPhone IS NOT NULL AND other.PersonPhone=v.PersonPhone))))
 WHERE v.VisitRequestId=@VisitRequestId AND NOT EXISTS(SELECT 1 FROM gp.PassReturns r WHERE r.VisitRequestId=other.VisitRequestId)) THROW 54503,'Replacement request exists.',1;
 INSERT gp.PassReturnCorrections(VisitRequestId,AccessPassId,OriginalReturnedAtUtc,OriginalReturnedByUserId,OriginalReturnOperationId,DevicesVerified,CorrectedByUserId,CorrectedAtUtc,Reason,OperationId)
 SELECT VisitRequestId,AccessPassId,ReturnedAtUtc,ReturnedByUserId,OperationId,DevicesVerified,@actor,@now,@Reason,@op FROM gp.PassReturns WHERE VisitRequestId=@VisitRequestId;
 DELETE gp.PassReturns WHERE VisitRequestId=@VisitRequestId;
 UPDATE gp.AccessPasses SET Status=CASE WHEN @status='APPROVED' THEN 'ACTIVE' ELSE 'PENDING' END,RevokedAtUtc=NULL,RevocationReason=NULL WHERE AccessPassId=@ExpectedPassId;
 -- Old bearer links and cancelled render jobs stay revoked; a fresh approval notice gets a new dispatch.
 IF @status='PENDING' AND @deadline>@now
 BEGIN
 EXEC gp._TakeLock N'gp:outbox:claim';
 INSERT gp.NotificationOutbox(VisitRequestId,RecipientKind,RecipientEmployeeId,TemplateCode,PayloadJson,DedupeHash)
 SELECT TOP(1) VisitRequestId,RecipientKind,RecipientEmployeeId,TemplateCode,PayloadJson,HASHBYTES('SHA2_256',CONVERT(varchar(36),@op)+':return-correction') FROM gp.NotificationOutbox WHERE VisitRequestId=@VisitRequestId AND TemplateCode='HOST_APPROVAL_REQUEST' ORDER BY NotificationId DESC;
 END;
 SET @result=(SELECT @VisitRequestId visitRequestId,@ExpectedPassId accessPassId,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' correctedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode,MetadataJson) VALUES(@actor,'PASS_RETURN_CORRECTED','VISIT',CONVERT(varchar(36),@VisitRequestId),@location,'SUCCESS',@result);
 EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
ALTER PROCEDURE gp.ReturnReceptionPass @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,
 @VisitRequestId uniqueidentifier,@ExpectedPassId uniqueidentifier,@DevicesVerified bit=0
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54500,'Ambient transaction not accepted.',1;
 IF @ClientKey IS NULL OR @VisitRequestId IS NULL OR @ExpectedPassId IS NULL THROW 54502,'Invalid return input.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@location int,@cutoff datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max);
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  SELECT @location=LocationId FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId;
  IF @location IS NULL THROW 53501,'Not authorized.',1;
  EXEC gp._RequireReceptionLocation @actor,@location,@now;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
  IF gp._VisitReadAllowed(@actor,'RECEPTION',@VisitRequestId,@now,@cutoff)=0 THROW 53501,'Not authorized.',1;
  IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='PASS_PRINT'
   WHERE g.UserId=@actor AND g.RoleCode='RECEPTION' AND g.ScopeType='LOCATION' AND g.LocationId=@location AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND(g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)) THROW 53501,'Not authorized.',1;
  DECLARE @payload nvarchar(max)=(SELECT @VisitRequestId visitRequestId,@ExpectedPassId expectedPassId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF @DevicesVerified=1 SET @payload=JSON_MODIFY(@payload,'$.devicesVerified',CAST(1 AS bit));
  EXEC gp._BeginOperation @actor,'RETURN_PASS',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
  IF @cached IS NOT NULL BEGIN IF NOT EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=@VisitRequestId AND AccessPassId=@ExpectedPassId AND OperationId=@op) THROW 54503,'Return has since been corrected.',1;COMMIT;SELECT @cached;RETURN;END;
  IF NOT EXISTS(SELECT 1 FROM gp.AccessPasses WHERE AccessPassId=@ExpectedPassId AND VisitRequestId=@VisitRequestId AND IsCurrent=1)
   OR EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=@VisitRequestId) THROW 54503,'Pass changed or already returned.',1;
  IF NOT EXISTS(SELECT 1 FROM gp.PassPrintJobs WHERE VisitRequestId=@VisitRequestId AND Status='DISPATCHED') THROW 54503,'Printed pass required.',1;
  IF gp._PersonInsideOffice(@VisitRequestId)=1 THROW 54504,'Project exit must be recorded before final return.',1;
  IF EXISTS(SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId AND DeviceTypesJson<>N'[]') AND ISNULL(@DevicesVerified,0)=0 THROW 54503,'Verify declared devices before final return.',1;
  INSERT gp.PassReturns(VisitRequestId,AccessPassId,ReturnedByUserId,ReturnedAtUtc,OperationId,DevicesVerified) VALUES(@VisitRequestId,@ExpectedPassId,@actor,@now,@op,CASE WHEN @DevicesVerified=1 AND EXISTS(SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId AND DeviceTypesJson<>N'[]') THEN 1 ELSE 0 END);
  UPDATE gp.AccessPasses SET Status='REVOKED',RevokedAtUtc=COALESCE(RevokedAtUtc,@now),RevocationReason=N'Printed pass returned at final building exit' WHERE AccessPassId=@ExpectedPassId;
  UPDATE gp.PassDeliveryLinks SET RevokedAtUtc=COALESCE(RevokedAtUtc,@now) WHERE VisitRequestId=@VisitRequestId;
  UPDATE r SET ClaimToken=NULL,LeaseUntilUtc=NULL,FailureCode='RENDER_FAILED' FROM gp.PassPrintRenderState r JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId
   WHERE j.VisitRequestId=@VisitRequestId AND j.Status IN('REQUESTED','RENDERED');
  UPDATE gp.PassPrintJobs SET Status='FAILED',UpdatedAtUtc=@now WHERE VisitRequestId=@VisitRequestId AND Status IN('REQUESTED','RENDERED');
  EXEC gp._TakeLock N'gp:outbox:claim';
  UPDATE gp.NotificationOutbox SET Status='CANCELLED',LockedBy=NULL,LockedUntilUtc=NULL,LastErrorCode='PASS_RETURNED'
   WHERE VisitRequestId=@VisitRequestId AND Status IN('PENDING','PROCESSING');
  SET @result=(SELECT @VisitRequestId visitRequestId,@ExpectedPassId accessPassId,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' returnedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode,MetadataJson) VALUES(@actor,'PASS_RETURNED','VISIT',CONVERT(varchar(36),@VisitRequestId),@location,'SUCCESS',@result);
  EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.LookupReceptionVisits TO gp_api_runtime;
GRANT EXECUTE ON gp.CorrectReceptionReturn TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('080',N'Reception all-date lookup and audited mistaken-return correction');COMMIT;
