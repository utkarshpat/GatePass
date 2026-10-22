/* Printed pass return is the final building exit. No signature or retention policy is introduced. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54500,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='070') THROW 54500,'Migration 070 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='071') THROW 54500,'Migration 071 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
CREATE TABLE gp.PassReturns(
 VisitRequestId uniqueidentifier NOT NULL CONSTRAINT PK_PassReturns PRIMARY KEY,
 AccessPassId uniqueidentifier NOT NULL,
 ReturnedByUserId uniqueidentifier NOT NULL,
 ReturnedAtUtc datetime2(3) NOT NULL,
 OperationId uniqueidentifier NOT NULL,
 CONSTRAINT FK_PassReturns_Visit FOREIGN KEY(VisitRequestId) REFERENCES gp.VisitRequests(VisitRequestId),
 CONSTRAINT FK_PassReturns_Pass FOREIGN KEY(AccessPassId) REFERENCES gp.AccessPasses(AccessPassId),
 CONSTRAINT FK_PassReturns_User FOREIGN KEY(ReturnedByUserId) REFERENCES gp.Users(UserId),
 CONSTRAINT FK_PassReturns_Operation FOREIGN KEY(OperationId) REFERENCES gp.IdempotencyRequests(OperationId)
);
GO
CREATE FUNCTION gp._PersonInsideOffice(@Visit uniqueidentifier) RETURNS bit AS
BEGIN
 DECLARE @employee nvarchar(64),@intake uniqueidentifier,@person uniqueidentifier,@location int;
 SELECT @employee=EmployeeId,@intake=IntakeId,@person=ClientPersonKey,@location=LocationId FROM gp.VisitRequests WHERE VisitRequestId=@Visit;
 IF EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId WHERE v.LocationId=@location AND s.IsInside=1
  AND(v.VisitRequestId=@Visit OR @employee IS NOT NULL AND v.EmployeeId=@employee OR @employee IS NULL AND v.IntakeId=@intake AND v.ClientPersonKey=@person)) RETURN 1;
 IF @employee IS NOT NULL AND EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence s JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=s.ProjectLocationId WHERE s.EmployeeId=@employee AND pl.LocationId=@location AND s.IsInside=1) RETURN 1;
 RETURN 0;
END;
GO
CREATE PROCEDURE gp.ReturnReceptionPass @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,
 @VisitRequestId uniqueidentifier,@ExpectedPassId uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54500,'Ambient transaction not accepted.',1;
 IF @ClientKey IS NULL OR @VisitRequestId IS NULL OR @ExpectedPassId IS NULL THROW 54502,'Invalid return input.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@location int,@cutoff datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max);
 BEGIN TRY
  -- All movement, rendering and replacement writers take this gate Shared first.
  -- Exclusive makes the presence check and closure atomic against those operations.
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  SELECT @location=LocationId FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId;
  IF @location IS NULL THROW 53501,'Not authorized.',1;
  EXEC gp._RequireReceptionLocation @actor,@location,@now;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
  IF gp._VisitReadAllowed(@actor,'RECEPTION',@VisitRequestId,@now,@cutoff)=0 THROW 53501,'Not authorized.',1;
  -- A return requires both reception visibility and the print capability at this office.
  IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='PASS_PRINT'
   WHERE g.UserId=@actor AND g.RoleCode='RECEPTION' AND g.ScopeType='LOCATION' AND g.LocationId=@location AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND(g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)) THROW 53501,'Not authorized.',1;
  DECLARE @payload nvarchar(max)=(SELECT @VisitRequestId visitRequestId,@ExpectedPassId expectedPassId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  EXEC gp._BeginOperation @actor,'RETURN_PASS',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
  IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
  IF NOT EXISTS(SELECT 1 FROM gp.AccessPasses WHERE AccessPassId=@ExpectedPassId AND VisitRequestId=@VisitRequestId AND IsCurrent=1)
   OR EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=@VisitRequestId) THROW 54503,'Pass changed or already returned.',1;
  IF NOT EXISTS(SELECT 1 FROM gp.PassPrintJobs WHERE VisitRequestId=@VisitRequestId AND Status='DISPATCHED') THROW 54503,'Printed pass required.',1;
  IF gp._PersonInsideOffice(@VisitRequestId)=1 THROW 54504,'Project exit must be recorded before final return.',1;
  INSERT gp.PassReturns(VisitRequestId,AccessPassId,ReturnedByUserId,ReturnedAtUtc,OperationId) VALUES(@VisitRequestId,@ExpectedPassId,@actor,@now,@op);
  UPDATE gp.AccessPasses SET Status='REVOKED',RevokedAtUtc=COALESCE(RevokedAtUtc,@now),RevocationReason=N'Printed pass returned at final building exit' WHERE AccessPassId=@ExpectedPassId;
  UPDATE gp.PassDeliveryLinks SET RevokedAtUtc=COALESCE(RevokedAtUtc,@now) WHERE VisitRequestId=@VisitRequestId;
  SET @result=(SELECT @VisitRequestId visitRequestId,@ExpectedPassId accessPassId,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' returnedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode,MetadataJson) VALUES(@actor,'PASS_RETURNED','VISIT',CONVERT(varchar(36),@VisitRequestId),@location,'SUCCESS',@result);
  EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
ALTER PROCEDURE gp.ListReceptionVisits @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@LocalVisitDate date=NULL,
 @Search nvarchar(100)=NULL,@Status varchar(12)='ALL',@AfterSubmittedAtUtc datetime2(3)=NULL,@AfterVisitRequestId uniqueidentifier=NULL,@PendingReturns bit=0
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53500,'Ambient transaction not accepted.',1;
 IF @PendingReturns IS NULL OR @LocationId IS NULL OR @LocationId<=0 OR @Status IS NULL OR @Status COLLATE Latin1_General_100_BIN2 NOT IN('ALL','PENDING','APPROVED','DENIED','CANCELLED')
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
   WHERE v.LocationId=@LocationId AND (@PendingReturns=1 OR v.LocalVisitDate=@LocalVisitDate) AND gp._VisitReadAllowed(@actor,'RECEPTION',v.VisitRequestId,@now,@cutoff)=1
    AND (@PendingReturns=0 OR NOT EXISTS(SELECT 1 FROM gp.PassReturns r WHERE r.VisitRequestId=v.VisitRequestId) AND EXISTS(SELECT 1 FROM gp.PassPrintJobs j WHERE j.VisitRequestId=v.VisitRequestId AND j.Status='DISPATCHED'))
    AND (@Status='ALL' OR v.Status=@Status) AND (@Search IS NULL OR CHARINDEX(@Search,v.PersonName)>0 OR CHARINDEX(@Search,v.PublicReference)>0 OR CHARINDEX(@Search,p.PublicPassNumber)>0 OR CHARINDEX(@Search,v.EmployeeId)>0)
    AND (@AfterSubmittedAtUtc IS NULL OR v.SubmittedAtUtc<@AfterSubmittedAtUtc OR v.SubmittedAtUtc=@AfterSubmittedAtUtc AND v.VisitRequestId<@AfterVisitRequestId)
   ORDER BY v.SubmittedAtUtc DESC,v.VisitRequestId DESC;
  DECLARE @more bit=CASE WHEN (SELECT COUNT(*) FROM @page)>50 THEN 1 ELSE 0 END,@afterTime datetime2(3),@afterId uniqueidentifier;
  IF @more=1 DELETE @page WHERE VisitId=(SELECT TOP(1) VisitId FROM @page ORDER BY Submitted,VisitId);
  IF @more=1 SELECT TOP(1) @afterTime=Submitted,@afterId=VisitId FROM @page ORDER BY Submitted,VisitId;
  SET @result=(SELECT JSON_QUERY(COALESCE((SELECT v.VisitRequestId visitRequestId,v.PersonName personName,v.EmployeeId employeeId,
    CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
    p.AccessPassId accessPassId,v.Status status,p.Status passStatus,pj.ProjectName projectName,he.FullName hostName,he.OfficialEmail hostEmail,JSON_QUERY(CASE WHEN v.RequestType='TEMP_ID' THEN gp._EmployeeProjectSummary(v.EmployeeId,@cutoff,@now,v.LocationId) END) employeeProjects,CONVERT(bit,CASE WHEN gp._PersonInsideOffice(v.VisitRequestId)=1 THEN 1 ELSE 0 END) isInside,
    REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
    REPLACE(CONVERT(char(23),n.Submitted,121),' ','T')+'Z' submittedAtUtc,
    REPLACE(CONVERT(char(23),ret.ReturnedAtUtc,121),' ','T')+'Z' returnedAtUtc,
    (SELECT COUNT(*) FROM gp.PassPrintJobs j WHERE j.VisitRequestId=v.VisitRequestId AND j.Status='DISPATCHED') printCount
    FROM @page n JOIN gp.VisitRequests v ON v.VisitRequestId=n.VisitId JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
    JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId LEFT JOIN gp.PassReturns ret ON ret.VisitRequestId=v.VisitRequestId LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId
    LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId LEFT JOIN gp.Employees he ON he.EmployeeId=v.HostEmployeeId AND he.IsActive=1 AND he.LastSyncedAtUtc BETWEEN @cutoff AND @now ORDER BY n.Submitted DESC,n.VisitId DESC FOR JSON PATH),N'[]')) visits,
    (SELECT COUNT(*) FROM gp.VisitRequests rv WHERE rv.LocationId=@LocationId AND gp._VisitReadAllowed(@actor,'RECEPTION',rv.VisitRequestId,@now,@cutoff)=1 AND NOT EXISTS(SELECT 1 FROM gp.PassReturns r WHERE r.VisitRequestId=rv.VisitRequestId) AND EXISTS(SELECT 1 FROM gp.PassPrintJobs j WHERE j.VisitRequestId=rv.VisitRequestId AND j.Status='DISPATCHED')) pendingReturnCount,
    @more hasMore,@afterId afterVisitRequestId,REPLACE(CONVERT(char(23),@afterTime,121),' ','T')+'Z' afterSubmittedAtUtc,
    CONVERT(char(10),@LocalVisitDate,23) visitDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode) VALUES(@actor,'RECEPTION_LIST_READ','LOCATION',CONVERT(varchar(12),@LocationId),@LocationId,'SUCCESS');
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;

GO
ALTER PROCEDURE gp._RequireReceptionPass
    @Actor uniqueidentifier,@Visit uniqueidentifier,@Now datetime2(3),@Reissue bit=0
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.StaffRoleGrants g ON g.LocationId=v.LocationId
        JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='PASS_PRINT'
        WHERE v.VisitRequestId=@Visit AND g.UserId=@Actor AND g.RoleCode='RECEPTION' AND g.ScopeType='LOCATION'
        AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)
        AND (@Reissue=0 OR EXISTS(SELECT 1 FROM gp.GrantCapabilities x WHERE x.RoleGrantId=g.RoleGrantId AND x.CapabilityCode='PASS_REISSUE')))
        THROW 53101,'Not authorized.',1;
    IF EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=@Visit) THROW 53105,'Returned pass is closed.',1;
    -- Resolve role/scope first: an unrelated actor must not observe employee office state.
    DECLARE @officeCutoff datetime2(3);EXEC gp._DirectoryCutoff @Now,@officeCutoff OUTPUT;
    IF EXISTS(SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId=@Visit AND RequestType='TEMP_ID' AND gp._EmployeeOfficeEligible(EmployeeId,LocationId,@officeCutoff,@Now)=0) THROW 53105,'Current employee office entitlement required.',1;
END;
GO
GRANT EXECUTE ON gp.ReturnReceptionPass TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('071',N'Printed pass final returns and pending return reception queue');COMMIT;

