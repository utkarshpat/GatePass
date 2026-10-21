SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53900,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='056') THROW 53900,'Migration 056 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='057') THROW 53900,'Migration 057 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.ListGuardDutyVisitors @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@DutyKind varchar(10),@DutyId bigint,
 @Queue varchar(10),@Search nvarchar(200)=N'',@Offset int=0 AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @DutyKind IS NULL OR @DutyKind COLLATE Latin1_General_100_BIN2 NOT IN('COMMON','PROJECT') OR @DutyId IS NULL OR @DutyId<=0 OR @LocationId IS NULL OR @LocationId<=0 OR @Queue IS NULL OR @Queue COLLATE Latin1_General_100_BIN2 NOT IN('EXPECTED','INSIDE')
 OR(@DutyKind='COMMON' AND @Queue<>'EXPECTED') OR @Search IS NULL OR DATALENGTH(@Search)>200 OR @Offset IS NULL OR @Offset<0 OR @Offset>100000 THROW 52002,'Invalid duty queue.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@more bit=0,@result nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF gp._GuardDutyAssigned(@actor,@DutyKind,@DutyId,@LocationId,@now)=0 THROW 52001,'Not authorized.',1;
 DECLARE @page table(Position int,VisitId uniqueidentifier,IsInside bit);
 INSERT @page SELECT ROW_NUMBER() OVER(ORDER BY v.SubmittedAtUtc DESC,v.VisitRequestId DESC),v.VisitRequestId,
 CASE WHEN @DutyKind='COMMON' THEN 0 WHEN v.RequestType='TEMP_ID' THEN COALESCE(ep.IsInside,0) ELSE s.IsInside END
 FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
 LEFT JOIN gp.EmployeeProjectPresence ep ON ep.VisitRequestId=v.VisitRequestId AND ep.ProjectLocationId=@DutyId
 WHERE v.LocationId=@LocationId AND gp._GuardDutyVisitAllowed(@actor,@DutyKind,@DutyId,@LocationId,v.VisitRequestId,@cutoff,@now)=1
 AND(@Search=N'' OR CHARINDEX(@Search,v.PersonName COLLATE Latin1_General_100_CI_AI)>0 OR CHARINDEX(@Search,v.PublicReference)>0 OR CHARINDEX(@Search,p.PublicPassNumber)>0)
 AND((@Queue='EXPECTED' AND v.LocalVisitDate=CONVERT(date,DATEADD(minute,330,@now)) AND v.Status IN('PENDING','APPROVED') AND p.Status IN('PENDING','ACTIVE') AND v.ValidUntilUtc>@now
 AND(@DutyKind='COMMON' OR CASE WHEN v.RequestType='TEMP_ID' THEN COALESCE(ep.IsInside,0) ELSE s.IsInside END=0))
 OR(@Queue='INSIDE' AND CASE WHEN v.RequestType='TEMP_ID' THEN COALESCE(ep.IsInside,0) ELSE s.IsInside END=1
 AND((v.RequestType='TEMP_ID' AND EXISTS(SELECT 1 FROM gp.EmployeeProjectAccessEvents e WHERE e.AccessEventId=ep.LastEventId AND e.ActorUserId=@actor AND e.EventType='ENTRY'))
 OR(v.RequestType<>'TEMP_ID' AND EXISTS(SELECT 1 FROM gp.AccessEvents e WHERE e.AccessEventId=s.LastAccessEventId AND e.ActorUserId=@actor AND e.EventType='ENTRY')))))
 ORDER BY v.SubmittedAtUtc DESC,v.VisitRequestId DESC OFFSET @Offset ROWS FETCH NEXT 51 ROWS ONLY;
 IF(SELECT COUNT(*) FROM @page)>50 BEGIN SET @more=1;DELETE @page WHERE Position=(SELECT MAX(Position) FROM @page);END;
 SET @result=(SELECT JSON_QUERY(COALESCE((SELECT v.VisitRequestId visitRequestId,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,v.PersonName personName,
 CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,
 CASE WHEN @DutyKind='PROJECT' THEN(SELECT pr.ProjectName FROM gp.ProjectLocations pl JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId WHERE pl.ProjectLocationId=@DutyId)
 ELSE(SELECT pr.ProjectName FROM gp.ProjectLocations pl JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId WHERE pl.ProjectLocationId=v.ProjectLocationId) END projectName,
 he.FullName hostName,JSON_QUERY(CASE WHEN v.RequestType='TEMP_ID' THEN gp._EmployeeProjectSummary(v.EmployeeId,@cutoff,@now,v.LocationId) END) employeeProjects,
 v.Status status,p.Status passStatus,q.IsInside isInside,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
 CONVERT(bit,CASE WHEN ph.PurgedAtUtc IS NULL AND ph.StorageKey IS NOT NULL THEN 1 ELSE 0 END) photoAvailable
 FROM @page q JOIN gp.VisitRequests v ON v.VisitRequestId=q.VisitId JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
 JOIN gp.PhotoAssets ph ON ph.PhotoAssetId=v.PhotoAssetId LEFT JOIN gp.Employees he ON he.EmployeeId=v.HostEmployeeId ORDER BY q.Position FOR JSON PATH),N'[]')) visitors,@more hasMore FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('057',N'Duty inside queue follows the guard who recorded the current project entry');COMMIT;
