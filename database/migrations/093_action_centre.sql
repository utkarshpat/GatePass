/* Scoped operational follow-up; no handover workflow. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='092') THROW 54800,'Migration 092 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='093') THROW 54800,'Migration 093 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE FUNCTION gp._OperationsScopeAllowed(@Actor uniqueidentifier,@Workspace varchar(12),@Location int,@Kind varchar(10),@Duty bigint,@Now datetime2(3)) RETURNS bit AS
BEGIN
 IF NOT EXISTS(SELECT 1 FROM gp.Users WHERE UserId=@Actor AND IsActive=1) RETURN 0;
 IF @Workspace='GUARD' AND @Kind IN('PROJECT','COMMON') AND @Duty>0 RETURN gp._GuardDutyAssigned(@Actor,@Kind,@Duty,@Location,@Now);
 IF @Workspace='RECEPTION' AND @Kind='OFFICE' AND @Duty=0 AND EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ'
 JOIN gp.Locations l ON l.LocationId=g.LocationId AND l.IsActive=1 WHERE g.UserId=@Actor AND g.RoleCode='RECEPTION' AND g.ScopeType='LOCATION' AND g.LocationId=@Location AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND(g.ValidUntilUtc IS NULL OR g.ValidUntilUtc>@Now)) RETURN 1;
 IF @Workspace='ADMIN' AND @Kind='OFFICE' AND @Duty=0 AND(gp._AdminScopeAllowed(@Actor,'REPORTS_READ',@Location,NULL,@Now)=1 OR EXISTS(SELECT 1 FROM gp.ProjectLocations WHERE LocationId=@Location AND gp._AdminScopeAllowed(@Actor,'REPORTS_READ',@Location,ProjectLocationId,@Now)=1)) RETURN 1;
 RETURN 0;
END;
GO
CREATE PROCEDURE gp.ReadActionCentre @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@Workspace varchar(12),@LocationId int,@DutyKind varchar(10),@DutyId bigint,
 @Category varchar(20)='PENDING',@AfterSubmittedAtUtc datetime2(3)=NULL,@AfterVisitRequestId uniqueidentifier=NULL AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @Workspace IS NULL OR @Workspace COLLATE Latin1_General_100_BIN2 NOT IN('GUARD','RECEPTION','ADMIN') OR @DutyKind IS NULL OR @DutyKind COLLATE Latin1_General_100_BIN2 NOT IN('PROJECT','COMMON','OFFICE') OR @LocationId IS NULL OR @DutyId IS NULL
 OR @Category IS NULL OR @Category COLLATE Latin1_General_100_BIN2 NOT IN('PENDING','EXPIRED_INSIDE','UNRETURNED') OR(@AfterSubmittedAtUtc IS NULL AND @AfterVisitRequestId IS NOT NULL) OR(@AfterSubmittedAtUtc IS NOT NULL AND @AfterVisitRequestId IS NULL) THROW 52002,'Invalid action scope.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max),@more bit=0,@afterTime datetime2(3),@afterId uniqueidentifier;
 DECLARE @matches table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3),Pending bit,ExpiredInside bit,Unreturned bit);
 DECLARE @page table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3));
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF gp._OperationsScopeAllowed(@actor,@Workspace,@LocationId,@DutyKind,@DutyId,@now)=0 THROW 52001,'Not authorized.',1;
 INSERT @matches SELECT v.VisitRequestId,v.SubmittedAtUtc,flags.Pending,flags.ExpiredInside,flags.Unreturned FROM gp.VisitRequests v
 JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
 CROSS APPLY(SELECT CONVERT(bit,CASE WHEN @Workspace<>'GUARD' THEN gp._PersonInsideOffice(v.VisitRequestId) WHEN @DutyKind='COMMON' THEN 0 WHEN v.RequestType='TEMP_ID' THEN CASE WHEN EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence ep WHERE ep.VisitRequestId=v.VisitRequestId AND ep.ProjectLocationId=@DutyId AND ep.IsInside=1) THEN 1 ELSE 0 END ELSE s.IsInside END) Inside) x
 CROSS APPLY(SELECT CONVERT(bit,CASE WHEN v.Status='PENDING' AND p.Status='PENDING' AND v.ValidUntilUtc>@now AND v.SubmittedAtUtc<=DATEADD(minute,-15,@now) AND NOT EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=v.VisitRequestId) THEN 1 ELSE 0 END) Pending,
 CONVERT(bit,CASE WHEN x.Inside=1 AND v.ValidUntilUtc<=@now THEN 1 ELSE 0 END) ExpiredInside,
 CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM gp.PassPrintJobs WHERE VisitRequestId=v.VisitRequestId AND Status='DISPATCHED') AND NOT EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=v.VisitRequestId) THEN 1 ELSE 0 END) Unreturned) flags
 WHERE v.LocationId=@LocationId AND(flags.Pending=1 OR flags.ExpiredInside=1 OR flags.Unreturned=1)
 AND(@Workspace='GUARD' AND gp._GuardDutyVisitAllowed(@actor,@DutyKind,@DutyId,@LocationId,v.VisitRequestId,@cutoff,@now)=1
 OR @Workspace='RECEPTION' AND gp._VisitReadAllowed(@actor,'RECEPTION',v.VisitRequestId,@now,@cutoff)=1
 OR @Workspace='ADMIN' AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',v.LocationId,v.ProjectLocationId,@now)=1);
 INSERT @page SELECT TOP(25) VisitId,Submitted FROM @matches WHERE(@Category='PENDING' AND Pending=1 OR @Category='EXPIRED_INSIDE' AND ExpiredInside=1 OR @Category='UNRETURNED' AND Unreturned=1)
 AND(@AfterSubmittedAtUtc IS NULL OR Submitted<@AfterSubmittedAtUtc OR Submitted=@AfterSubmittedAtUtc AND VisitId<@AfterVisitRequestId) ORDER BY Submitted DESC,VisitId DESC;
 IF(SELECT COUNT(*) FROM @page)>24 BEGIN SET @more=1;DELETE @page WHERE VisitId=(SELECT TOP(1) VisitId FROM @page ORDER BY Submitted,VisitId);END;
 IF @more=1 SELECT TOP(1) @afterTime=Submitted,@afterId=VisitId FROM @page ORDER BY Submitted,VisitId;
 EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF gp._OperationsScopeAllowed(@actor,@Workspace,@LocationId,@DutyKind,@DutyId,@now)=0 THROW 52001,'Scope changed.',1;
 SET @result=(SELECT @Category category,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc,
 JSON_QUERY((SELECT COALESCE(SUM(CONVERT(int,Pending)),0) pending,COALESCE(SUM(CONVERT(int,ExpiredInside)),0) expiredInside,COALESCE(SUM(CONVERT(int,Unreturned)),0) unreturned FROM @matches FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) counts,
 JSON_QUERY((SELECT v.VisitRequestId visitRequestId,v.PersonName personName,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
 REPLACE(CONVERT(char(23),q.Submitted,121),' ','T')+'Z' submittedAtUtc FROM @page q JOIN gp.VisitRequests v ON v.VisitRequestId=q.VisitId JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 ORDER BY q.Submitted DESC,q.VisitId DESC FOR JSON PATH)) items,
 @more hasMore,@afterId afterVisitRequestId,REPLACE(CONVERT(char(23),@afterTime,121),' ','T')+'Z' afterSubmittedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,'ACTION_CENTRE_READ','REPORT_QUERY',@LocationId,CASE WHEN @DutyKind='PROJECT' THEN @DutyId END,'SUCCESS');
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.ReadActionCentre TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('093',N'Scoped action centre for overdue approvals, expired occupants and unreturned passes');COMMIT;
