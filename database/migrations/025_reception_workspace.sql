/* Scoped reception workspace; preview is a read, printing keeps its existing lifecycle. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53500,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='024') THROW 53500,'Migration 024 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='025') THROW 53500,'Migration 025 already applied.',1;
BEGIN TRANSACTION;
GO
CREATE PROCEDURE gp._RequireReceptionLocation @Actor uniqueidentifier,@LocationId int,@Now datetime2(3)
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ'
  JOIN gp.Locations l ON l.LocationId=g.LocationId AND l.IsActive=1 WHERE g.UserId=@Actor AND g.RoleCode='RECEPTION' AND g.ScopeType='LOCATION'
  AND g.LocationId=@LocationId AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)) THROW 53501,'Not authorized.',1;
END;
GO
CREATE PROCEDURE gp.GetReceptionContext @SessionHash varbinary(8000),@CsrfHash varbinary(8000)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53500,'Ambient transaction not accepted.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@employee nvarchar(64),@name nvarchar(200),@email nvarchar(320),@result nvarchar(max);
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  EXEC gp._RequireRegistrationEmployee @actor,@now,@employee OUTPUT,@name OUTPUT,@email OUTPUT;
  DECLARE @locations nvarchar(max)=(SELECT TOP(50) l.LocationId locationId,l.LocationName locationName,l.LocationCode locationCode,
   CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM gp.StaffRoleGrants p JOIN gp.GrantCapabilities pc ON pc.RoleGrantId=p.RoleGrantId AND pc.CapabilityCode='PASS_PRINT'
    WHERE p.UserId=@actor AND p.RoleCode='RECEPTION' AND p.ScopeType='LOCATION' AND p.LocationId=l.LocationId AND p.RevokedAtUtc IS NULL
     AND p.ValidFromUtc<=@now AND (p.ValidUntilUtc IS NULL OR @now<p.ValidUntilUtc)) THEN 1 ELSE 0 END) canPrint
   FROM gp.Locations l WHERE l.IsActive=1 AND EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ'
    WHERE g.UserId=@actor AND g.RoleCode='RECEPTION' AND g.ScopeType='LOCATION' AND g.LocationId=l.LocationId AND g.RevokedAtUtc IS NULL
     AND g.ValidFromUtc<=@now AND (g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)) ORDER BY l.LocationName FOR JSON PATH);
  IF @locations IS NULL OR @locations=N'[]' THROW 53501,'Not authorized.',1;
  SET @result=(SELECT @name displayName,CONVERT(char(10),DATEADD(minute,330,@now),23) currentDate,JSON_QUERY(@locations) locations FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.ListReceptionVisits @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@LocalVisitDate date=NULL,
 @Search nvarchar(100)=NULL,@Status varchar(12)='ALL',@AfterSubmittedAtUtc datetime2(3)=NULL,@AfterVisitRequestId uniqueidentifier=NULL
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53500,'Ambient transaction not accepted.',1;
 IF @LocationId IS NULL OR @LocationId<=0 OR @Status IS NULL OR @Status COLLATE Latin1_General_100_BIN2 NOT IN('ALL','PENDING','APPROVED','DENIED','CANCELLED')
  OR (@AfterSubmittedAtUtc IS NULL AND @AfterVisitRequestId IS NOT NULL) OR (@AfterSubmittedAtUtc IS NOT NULL AND @AfterVisitRequestId IS NULL) THROW 53502,'Invalid reception filter.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@today date,@cutoff datetime2(3),@result nvarchar(max);
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  EXEC gp._RequireReceptionLocation @actor,@LocationId,@now;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
  SET @today=CONVERT(date,DATEADD(minute,330,@now));SET @LocalVisitDate=COALESCE(@LocalVisitDate,@today);
  IF @LocalVisitDate<DATEADD(day,-30,@today) OR @LocalVisitDate>DATEADD(day,90,@today) THROW 53502,'Date outside operational range.',1;
  SET @Search=NULLIF(LTRIM(RTRIM(@Search)),N'');
  DECLARE @page table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3));
  INSERT @page SELECT TOP(51) v.VisitRequestId,v.SubmittedAtUtc FROM gp.VisitRequests v
   JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
   WHERE v.LocationId=@LocationId AND v.LocalVisitDate=@LocalVisitDate AND gp._VisitReadAllowed(@actor,'RECEPTION',v.VisitRequestId,@now,@cutoff)=1
    AND (@Status='ALL' OR v.Status=@Status) AND (@Search IS NULL OR CHARINDEX(@Search,v.PersonName)>0 OR CHARINDEX(@Search,v.PublicReference)>0 OR CHARINDEX(@Search,p.PublicPassNumber)>0 OR CHARINDEX(@Search,v.EmployeeId)>0)
    AND (@AfterSubmittedAtUtc IS NULL OR v.SubmittedAtUtc<@AfterSubmittedAtUtc OR v.SubmittedAtUtc=@AfterSubmittedAtUtc AND v.VisitRequestId<@AfterVisitRequestId)
   ORDER BY v.SubmittedAtUtc DESC,v.VisitRequestId DESC;
  DECLARE @more bit=CASE WHEN (SELECT COUNT(*) FROM @page)>50 THEN 1 ELSE 0 END,@afterTime datetime2(3),@afterId uniqueidentifier;
  IF @more=1 DELETE @page WHERE VisitId=(SELECT TOP(1) VisitId FROM @page ORDER BY Submitted,VisitId);
  IF @more=1 SELECT TOP(1) @afterTime=Submitted,@afterId=VisitId FROM @page ORDER BY Submitted,VisitId;
  SET @result=(SELECT JSON_QUERY((SELECT v.VisitRequestId visitRequestId,v.PersonName personName,v.EmployeeId employeeId,
    CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
    p.AccessPassId accessPassId,v.Status status,p.Status passStatus,pj.ProjectName projectName,s.IsInside isInside,
    REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
    REPLACE(CONVERT(char(23),n.Submitted,121),' ','T')+'Z' submittedAtUtc,
    (SELECT COUNT(*) FROM gp.PassPrintJobs j WHERE j.AccessPassId=p.AccessPassId AND j.Status='DISPATCHED') printCount
    FROM @page n JOIN gp.VisitRequests v ON v.VisitRequestId=n.VisitId JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
    JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId
    LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId ORDER BY n.Submitted DESC,n.VisitId DESC FOR JSON PATH)) visits,
    @more hasMore,@afterId afterVisitRequestId,REPLACE(CONVERT(char(23),@afterTime,121),' ','T')+'Z' afterSubmittedAtUtc,
    CONVERT(char(10),@LocalVisitDate,23) visitDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode) VALUES(@actor,'RECEPTION_LIST_READ','LOCATION',CONVERT(varchar(12),@LocationId),@LocationId,'SUCCESS');
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.GetReceptionCardSource
 @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@VisitRequestId uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53500,'Ambient transaction not accepted.',1;
 IF @VisitRequestId IS NULL THROW 53502,'Invalid card request.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@pass uniqueidentifier,@details nvarchar(max),@digest varbinary(32),@result nvarchar(max),
  @lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
  EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  EXEC gp._TakeLock @lock,'Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
  EXEC gp._RequireReceptionPass @actor,@VisitRequestId,@now;
  IF gp._VisitReadAllowed(@actor,'RECEPTION',@VisitRequestId,@now,@cutoff)=0 THROW 53501,'Not authorized.',1;
  SELECT @pass=AccessPassId FROM gp.AccessPasses WHERE VisitRequestId=@VisitRequestId AND IsCurrent=1 AND Status IN('PENDING','ACTIVE');
  IF @pass IS NULL THROW 53501,'Not authorized.',1;
  EXEC gp._RequirePrintablePass @VisitRequestId,@pass,@now;
  EXEC gp._ReadPrintCardDetails @VisitRequestId,@now,@details OUTPUT,@digest OUTPUT;
  SET @result=(SELECT v.VisitRequestId visitRequestId,p.AccessPassId accessPassId,CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.Status visitStatus,
    v.PersonName personName,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,l.LocationName locationName,pj.ProjectName projectName,
    REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
    JSON_QUERY(@details) cardDetails,a.PhotoAssetId photoAssetId,a.StorageKey storageKey,a.MimeType mimeType,a.ByteLength byteLength,
    CONVERT(varchar(64),a.ContentHash,2) photoContentHash,CONVERT(varchar(64),p.CredentialHash,2) credentialHash,
    CONVERT(varchar(max),s.Ciphertext,2) ciphertext,CONVERT(varchar(24),s.Nonce,2) nonce,CONVERT(varchar(32),s.AuthenticationTag,2) authenticationTag,s.KeyVersion keyVersion
    FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.AccessPassId=@pass
    JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId JOIN gp.Locations l ON l.LocationId=v.LocationId
    LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId
    JOIN gp.PassSecrets s ON s.AccessPassId=p.AccessPassId WHERE v.VisitRequestId=@VisitRequestId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF @result IS NULL OR JSON_VALUE(@result,'$.ciphertext') IS NULL THROW 53501,'Not authorized.',1;
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode)
    VALUES(@actor,'RECEPTION_CARD_PREVIEW','VISIT',CONVERT(varchar(36),@VisitRequestId),'SUCCESS');
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.GetReceptionContext TO gp_api_runtime;
GRANT EXECUTE ON gp.ListReceptionVisits TO gp_api_runtime;
GRANT EXECUTE ON gp.GetReceptionCardSource TO gp_render_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('025',N'Scoped reception context, searchable daily list and private card preview');
COMMIT;
