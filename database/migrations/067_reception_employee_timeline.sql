/* Reception reads employee project movements only within its authorized office. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54400,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='066') THROW 54400,'Migration 066 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='067') THROW 54400,'Migration 067 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE PROCEDURE gp.GetReceptionEmployeeTimeline @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@VisitRequestId uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54400,'Ambient transaction not accepted.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@location int,@employee nvarchar(64),@result nvarchar(max);
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
  IF gp._VisitReadAllowed(@actor,'RECEPTION',@VisitRequestId,@now,@cutoff)=0 THROW 53501,'Not authorized.',1;
  SELECT @location=LocationId,@employee=EmployeeId FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId AND RequestType='TEMP_ID';
  IF @location IS NULL OR @employee IS NULL THROW 53501,'Not authorized.',1;
  EXEC gp._RequireReceptionLocation @actor,@location,@now;
  DECLARE @events table(Id bigint PRIMARY KEY,Occurred datetime2(3),EventType varchar(20),EntryMethod varchar(20),GuardName nvarchar(200),ProjectName nvarchar(200));
  INSERT @events SELECT TOP(101) e.AccessEventId,e.OccurredAtUtc,e.EventType,e.EntryMethod,u.DisplayName,p.ProjectName
   FROM gp.EmployeeProjectAccessEvents e JOIN gp.VisitRequests v ON v.VisitRequestId=e.VisitRequestId
   JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=e.ProjectLocationId JOIN gp.Projects p ON p.ProjectId=pl.ProjectId JOIN gp.Users u ON u.UserId=e.ActorUserId
   WHERE v.EmployeeId=@employee AND pl.LocationId=@location ORDER BY e.OccurredAtUtc DESC,e.AccessEventId DESC;
  DECLARE @more bit=CASE WHEN(SELECT COUNT(*) FROM @events)>100 THEN 1 ELSE 0 END;
  IF @more=1 DELETE @events WHERE Id=(SELECT TOP(1) Id FROM @events ORDER BY Occurred,Id);
  SET @result=(SELECT CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence s JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=s.ProjectLocationId WHERE s.EmployeeId=@employee AND pl.LocationId=@location AND s.IsInside=1) THEN 1 ELSE 0 END) isInside,
   JSON_QUERY(COALESCE((SELECT CONVERT(varchar(20),Id) accessEventId,EventType eventType,EntryMethod entryMethod,GuardName guardName,ProjectName projectName,REPLACE(CONVERT(char(23),Occurred,121),' ','T')+'Z' occurredAtUtc FROM @events ORDER BY Occurred DESC,Id DESC FOR JSON PATH),N'[]')) movements,@more movementsHasMore FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode) VALUES(@actor,'RECEPTION_TIMELINE_READ','VISIT',CONVERT(varchar(36),@VisitRequestId),@location,'SUCCESS');
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.GetReceptionEmployeeTimeline TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('067',N'Office-scoped employee project timeline for reception and replacement IDs');
COMMIT;
