/* Intake-scoped office/project options and bounded host name/email search.
   Existing submission procedures remain the final eligibility authority. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='022') THROW 52000,'Migration 022 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='023') THROW 52000,'Migration 023 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE PROCEDURE gp.GetRegistrationOptions
 @IntakeId uniqueidentifier,@TokenHash varbinary(8000),@IntakeCsrfHash varbinary(8000),
 @SessionHash varbinary(8000)=NULL,@CsrfHash varbinary(8000)=NULL,
 @LocationCode varchar(8000)=NULL,@ProjectLocationId bigint=NULL,@Search nvarchar(max)=NULL
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @LocationCode IS NULL OR DATALENGTH(@LocationCode)>16 OR @LocationCode COLLATE Latin1_General_100_BIN2 NOT IN('NOIDA','BENGALURU','CHENNAI','PUNE')
  OR (@Search IS NOT NULL AND (DATALENGTH(@Search) NOT BETWEEN 4 AND 200 OR LEN(LTRIM(RTRIM(@Search)))<2))
  OR (@Search IS NOT NULL AND @ProjectLocationId IS NULL) THROW 52702,'Invalid registration selector.',1;
 DECLARE @actor uniqueidentifier,@type varchar(12),@now datetime2(3),@cutoff datetime2(3),@location int,@project bigint,@result nvarchar(max),@horizon int,
  @resource nvarchar(255)=N'gp:intake:'+LOWER(CONVERT(char(36),@IntakeId));
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
  EXEC gp._RequireRegistrationIntake @IntakeId,@TokenHash,@IntakeCsrfHash,@SessionHash,@CsrfHash,@actor OUTPUT,@type OUTPUT,@now OUTPUT;
  EXEC gp._TakeLock @resource,'Shared';
  EXEC gp._RequireRegistrationIntake @IntakeId,@TokenHash,@IntakeCsrfHash,@SessionHash,@CsrfHash,@actor OUTPUT,@type OUTPUT,@now OUTPUT;
  EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
  SELECT @location=LocationId FROM gp.Locations WHERE LocationCode=@LocationCode AND IsActive=1;
  SELECT @horizon=TRY_CONVERT(int,value) FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.FutureVisitHorizonDays';
  IF @location IS NULL OR @horizon IS NULL OR @horizon NOT BETWEEN 0 AND 90 THROW 52704,'Office unavailable.',1;
  IF @ProjectLocationId IS NOT NULL
  BEGIN
   SELECT @project=p.ProjectId FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
    WHERE pl.ProjectLocationId=@ProjectLocationId AND pl.LocationId=@location AND pl.IsActive=1 AND p.IsActive=1 AND p.LastSyncedAtUtc BETWEEN @cutoff AND @now;
   IF @project IS NULL THROW 52701,'Project outside office.',1;
  END;
  SET @result=(SELECT @location locationId,@LocationCode locationCode,
   (SELECT LocationName FROM gp.Locations WHERE LocationId=@location) locationName,
   CONVERT(char(10),DATEADD(minute,330,@now),23) currentDate,
   CONVERT(char(10),DATEADD(day,@horizon,DATEADD(minute,330,@now)),23) maxVisitDate,
   JSON_QUERY(COALESCE((SELECT TOP(100) CONVERT(varchar(20),pl.ProjectLocationId) projectLocationId,p.ExternalProjectCode projectCode,p.ProjectName projectName
    FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
    WHERE pl.LocationId=@location AND pl.IsActive=1 AND p.IsActive=1 AND p.LastSyncedAtUtc BETWEEN @cutoff AND @now
    ORDER BY p.ProjectName,pl.ProjectLocationId FOR JSON PATH),N'[]')) projects,
   JSON_QUERY(COALESCE((SELECT TOP(10) e.EmployeeId employeeId,e.FullName displayName,e.OfficialEmail officialEmail
    FROM gp.Employees e JOIN gp.EmployeeProjectMemberships m ON m.EmployeeId=e.EmployeeId LEFT JOIN gp.Users u ON u.UserId=e.UserId
    WHERE @Search IS NOT NULL AND m.ProjectId=@project AND m.IsActive=1 AND m.VerifiedAtUtc BETWEEN @cutoff AND @now
     AND e.IsActive=1 AND e.LastSyncedAtUtc BETWEEN @cutoff AND @now AND (e.UserId IS NULL OR u.IsActive=1)
     AND (CHARINDEX(@Search,e.FullName)>0 OR CHARINDEX(@Search,e.OfficialEmail)>0)
    ORDER BY e.FullName,e.EmployeeId FOR JSON PATH),N'[]')) hosts
   FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  EXEC gp._RequireRegistrationIntake @IntakeId,@TokenHash,@IntakeCsrfHash,@SessionHash,@CsrfHash,@actor OUTPUT,@type OUTPUT,@now OUTPUT;
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode)
   VALUES(@actor,'REGISTRATION_OPTIONS_READ','REGISTRATION_INTAKE',CONVERT(varchar(36),@IntakeId),'SUCCESS');
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.GetRegistrationOptions TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('023',N'Intake-scoped office project options and bounded host name/email search');
COMMIT;
