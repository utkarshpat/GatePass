/* Common verification is not project movement. Existing presence/history is preserved. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53900,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='052') THROW 53900,'Migration 052 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='053') THROW 53900,'Migration 053 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
ALTER TABLE gp.EmployeeOfficeMemberships ADD IsPrimary bit NOT NULL CONSTRAINT DF_EmployeeOffice_Primary DEFAULT(0);
GO
CREATE UNIQUE INDEX UX_EmployeeOffice_Primary ON gp.EmployeeOfficeMemberships(EmployeeId) WHERE IsPrimary=1;
CREATE TABLE gp.CommonAreas(
 CommonAreaId bigint IDENTITY PRIMARY KEY,LocationId int NOT NULL REFERENCES gp.Locations(LocationId),
 AreaName nvarchar(100) NOT NULL,IsActive bit NOT NULL DEFAULT(1),
 CONSTRAINT UQ_CommonArea_Name UNIQUE(LocationId,AreaName),CONSTRAINT CK_CommonArea_Name CHECK(LEN(LTRIM(RTRIM(AreaName)))>0));
CREATE TABLE gp.GuardCommonAreaAssignments(
 AssignmentId bigint IDENTITY PRIMARY KEY,GuardUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),
 CommonAreaId bigint NOT NULL REFERENCES gp.CommonAreas(CommonAreaId),AssignedByUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),
 ValidFromUtc datetime2(3) NOT NULL,ValidUntilUtc datetime2(3) NULL,DeallocatedAtUtc datetime2(3) NULL,
 Reason nvarchar(300) NOT NULL,CONSTRAINT CK_CommonDuty_Window CHECK(ValidUntilUtc IS NULL OR ValidUntilUtc>ValidFromUtc));
CREATE INDEX IX_CommonDuty_Guard ON gp.GuardCommonAreaAssignments(GuardUserId,CommonAreaId,DeallocatedAtUtc,ValidFromUtc);
CREATE UNIQUE INDEX UX_CommonDuty_Current ON gp.GuardCommonAreaAssignments(GuardUserId,CommonAreaId) WHERE DeallocatedAtUtc IS NULL;
CREATE TABLE gp.EmployeeProjectPresence(
 VisitRequestId uniqueidentifier NOT NULL REFERENCES gp.VisitRequests(VisitRequestId),
 ProjectLocationId bigint NOT NULL REFERENCES gp.ProjectLocations(ProjectLocationId),IsInside bit NOT NULL DEFAULT(0),
 LastEventId bigint NULL,LastMovementAtUtc datetime2(3) NULL,PRIMARY KEY(VisitRequestId,ProjectLocationId));
CREATE TABLE gp.EmployeeProjectAccessEvents(
 AccessEventId bigint IDENTITY PRIMARY KEY,VisitRequestId uniqueidentifier NOT NULL,ProjectLocationId bigint NOT NULL,
 AccessPassId uniqueidentifier NOT NULL REFERENCES gp.AccessPasses(AccessPassId),ActorUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),
 OperationId uniqueidentifier NOT NULL UNIQUE REFERENCES gp.IdempotencyRequests(OperationId),
 EventType varchar(5) NOT NULL CHECK(EventType IN('ENTRY','EXIT')),EntryMethod varchar(10) NOT NULL CHECK(EntryMethod IN('SCAN','MANUAL','RECONCILE')),
 OccurredAtUtc datetime2(3) NOT NULL,Reason nvarchar(300) NULL,
 FOREIGN KEY(VisitRequestId,ProjectLocationId) REFERENCES gp.EmployeeProjectPresence(VisitRequestId,ProjectLocationId));
CREATE INDEX IX_EmployeeProjectEvents_Visit ON gp.EmployeeProjectAccessEvents(VisitRequestId,ProjectLocationId,OccurredAtUtc DESC,AccessEventId DESC);
ALTER TABLE gp.EmployeeProjectPresence ADD CONSTRAINT FK_EmployeeProjectPresence_Event FOREIGN KEY(LastEventId) REFERENCES gp.EmployeeProjectAccessEvents(AccessEventId);
GO
CREATE FUNCTION gp._GuardDutyAssigned(@Actor uniqueidentifier,@Kind varchar(10),@Duty bigint,@Location int,@Now datetime2(3))
RETURNS bit WITH INLINE=OFF AS BEGIN
 IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId
 WHERE g.UserId=@Actor AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=@Location
 AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND(g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc) AND c.CapabilityCode='VISITS_READ') RETURN 0;
 IF @Kind='COMMON' AND EXISTS(SELECT 1 FROM gp.GuardCommonAreaAssignments a JOIN gp.CommonAreas c ON c.CommonAreaId=a.CommonAreaId
 JOIN gp.Locations l ON l.LocationId=c.LocationId WHERE a.GuardUserId=@Actor AND c.CommonAreaId=@Duty AND c.LocationId=@Location AND c.IsActive=1 AND l.IsActive=1
 AND a.DeallocatedAtUtc IS NULL AND a.ValidFromUtc<=@Now AND(a.ValidUntilUtc IS NULL OR @Now<a.ValidUntilUtc)) RETURN 1;
 IF @Kind='PROJECT' AND gp._HasCapability(@Actor,'PROJECT_MOVEMENT',@Location,@Duty,1,@Now)=1 AND EXISTS(
 SELECT 1 FROM gp.GuardAssignments a JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=a.ProjectLocationId
 WHERE a.GuardUserId=@Actor AND a.ProjectLocationId=@Duty AND pl.LocationId=@Location AND a.DeallocatedAtUtc IS NULL
 AND a.ValidFromUtc<=@Now AND(a.ValidUntilUtc IS NULL OR @Now<a.ValidUntilUtc)) RETURN 1;
 RETURN 0;
END;
GO
CREATE FUNCTION gp._GuardDutyVisitAllowed(@Actor uniqueidentifier,@Kind varchar(10),@Duty bigint,@Location int,@Visit uniqueidentifier,@Cutoff datetime2(3),@Now datetime2(3))
RETURNS bit WITH INLINE=OFF AS BEGIN
 IF gp._GuardDutyAssigned(@Actor,@Kind,@Duty,@Location,@Now)=0 RETURN 0;
 IF EXISTS(SELECT 1 FROM gp.VisitRequests v WHERE v.VisitRequestId=@Visit AND v.LocationId=@Location AND v.PersonalDataPurgedAtUtc IS NULL AND
 (@Kind='COMMON' OR v.ProjectLocationId=@Duty OR v.RequestType='TEMP_ID' AND (
 gp._EmployeeProjectLocationEligible(v.EmployeeId,@Duty,@Cutoff,@Now)=1 OR EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence s
 WHERE s.VisitRequestId=v.VisitRequestId AND s.ProjectLocationId=@Duty AND s.IsInside=1)))) RETURN 1;
 RETURN 0;
END;
GO
DENY SELECT,INSERT,UPDATE,DELETE,ALTER ON gp.CommonAreas TO gp_api_runtime;
DENY SELECT,INSERT,UPDATE,DELETE,ALTER ON gp.GuardCommonAreaAssignments TO gp_api_runtime;
DENY SELECT,INSERT,UPDATE,DELETE,ALTER ON gp.EmployeeProjectPresence TO gp_api_runtime;
DENY SELECT,INSERT,UPDATE,DELETE,ALTER ON gp.EmployeeProjectAccessEvents TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('053',N'Explicit primary office, common duties and independent employee project presence');COMMIT;
