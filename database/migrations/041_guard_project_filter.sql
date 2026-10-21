/* Exact project filter remains inside the existing SQL guard visibility boundary. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='040') THROW 53600,'Migration 040 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='041') THROW 53600,'Migration 041 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.ListGuardVisitors
 @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,
 @Queue varchar(20),@Search nvarchar(200)=N'',@Offset int=0,@ProjectFilter varchar(24)='ALL'
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
 IF @LocationId IS NULL OR @LocationId<=0 OR @Queue IS NULL OR @Queue COLLATE Latin1_General_100_BIN2 NOT IN('EXPECTED','INSIDE')
  OR DATALENGTH(@Queue)<>LEN(@Queue) OR @Search IS NULL OR DATALENGTH(@Search)>200 OR @Offset IS NULL OR @Offset<0 OR @Offset>100000 THROW 52002,'Invalid queue input.',1;
 IF @ProjectFilter IS NULL OR DATALENGTH(@ProjectFilter)<>LEN(@ProjectFilter) OR (@ProjectFilter COLLATE Latin1_General_100_BIN2 NOT IN('ALL','DIGITAL_ID') AND (TRY_CONVERT(bigint,@ProjectFilter) IS NULL OR TRY_CONVERT(bigint,@ProjectFilter)<=0 OR CONVERT(varchar(24),TRY_CONVERT(bigint,@ProjectFilter))<>@ProjectFilter COLLATE Latin1_General_100_BIN2)) THROW 52002,'Invalid project filter.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max),@today date;
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ'
  JOIN gp.Locations l ON l.LocationId=g.LocationId AND l.IsActive=1 WHERE g.UserId=@actor AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION'
  AND g.LocationId=@LocationId AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND(g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)) THROW 52001,'Not authorized.',1;
 SET @today=CONVERT(date,DATEADD(minute,330,@now));SET @Search=LTRIM(RTRIM(@Search));
 DECLARE @page table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3),Position int);
 INSERT @page
 SELECT v.VisitRequestId,v.SubmittedAtUtc,ROW_NUMBER() OVER(ORDER BY v.SubmittedAtUtc DESC,v.VisitRequestId DESC)
 FROM gp.VisitRequests v JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
 JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
 LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId LEFT JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId
 WHERE v.LocationId=@LocationId AND (@ProjectFilter='ALL' OR @ProjectFilter='DIGITAL_ID' AND v.RequestType='TEMP_ID' OR v.ProjectLocationId=TRY_CONVERT(bigint,@ProjectFilter)) AND gp._VisitReadAllowed(@actor,'GUARD',v.VisitRequestId,@now,@cutoff)=1
 /* Reconciliation permission alone must not broaden the upcoming project roster. */
 AND (v.RequestType='TEMP_ID' AND gp._HasCapability(@actor,'TEMP_ID_MOVEMENT',@LocationId,NULL,1,@now)=1
  OR EXISTS(SELECT 1 FROM gp.GuardAssignments a WHERE a.GuardUserId=@actor AND a.ProjectLocationId=v.ProjectLocationId
   AND a.DeallocatedAtUtc IS NULL AND a.ValidFromUtc<=@now AND(a.ValidUntilUtc IS NULL OR @now<a.ValidUntilUtc)))
 AND ((@Queue='EXPECTED' AND s.IsInside=0 AND v.LocalVisitDate=@today AND v.Status IN('PENDING','APPROVED') AND p.Status IN('PENDING','ACTIVE') AND v.ValidUntilUtc>@now)
  OR (@Queue='INSIDE' AND s.IsInside=1 AND EXISTS(SELECT 1 FROM gp.AccessEvents e WHERE e.AccessEventId=s.LastAccessEventId AND e.VisitRequestId=v.VisitRequestId AND e.EventType='ENTRY' AND e.ActorUserId=@actor)))
 AND (@Search=N'' OR CHARINDEX(@Search,v.PersonName COLLATE Latin1_General_100_CI_AI)>0 OR CHARINDEX(@Search,v.PublicReference)>0
  OR CHARINDEX(@Search,p.PublicPassNumber)>0 OR CHARINDEX(@Search,pr.ProjectName COLLATE Latin1_General_100_CI_AI)>0)
 ORDER BY v.SubmittedAtUtc DESC,v.VisitRequestId DESC OFFSET @Offset ROWS FETCH NEXT 51 ROWS ONLY;
 DECLARE @more bit=CASE WHEN (SELECT COUNT(*) FROM @page)>50 THEN 1 ELSE 0 END;
 IF @more=1 DELETE FROM @page WHERE Position=(SELECT MAX(Position) FROM @page);
 SET @result=(SELECT JSON_QUERY(COALESCE((SELECT v.VisitRequestId visitRequestId,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
  v.PersonName personName,CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,pr.ProjectName projectName,
  v.Status status,p.Status passStatus,s.IsInside isInside,
  REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
  CONVERT(bit,CASE WHEN ph.PurgedAtUtc IS NULL AND ph.StorageKey IS NOT NULL THEN 1 ELSE 0 END) photoAvailable
  FROM @page n JOIN gp.VisitRequests v ON v.VisitRequestId=n.VisitId JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
  JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 LEFT JOIN gp.PhotoAssets ph ON ph.PhotoAssetId=v.PhotoAssetId
  LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId LEFT JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId
  ORDER BY n.Position FOR JSON PATH),N'[]')) visitors,@more hasMore FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.ListGuardVisitors TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('041',N'Exact project filtering for scoped guard visitor queues');COMMIT;
