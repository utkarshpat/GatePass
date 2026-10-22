SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='062') THROW 54000,'Migration 062 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='063') THROW 54000,'Migration 063 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp._GuardDutyJson @Actor uniqueidentifier,@Kind varchar(10),@Duty bigint,@Location int,@Visit uniqueidentifier,@Now datetime2(3),@Result nvarchar(max) OUTPUT AS
BEGIN
 DECLARE @cutoff datetime2(3),@type varchar(24),@employee nvarchar(64),@presenceVisit uniqueidentifier=@Visit,@inside bit=0,@enter bit=0,@exit bit=0,@common bit=0;
 EXEC gp._DirectoryCutoff @Now,@cutoff OUTPUT;
 IF gp._GuardDutyVisitAllowed(@Actor,@Kind,@Duty,@Location,@Visit,@cutoff,@Now)=0 THROW 52001,'Not authorized.',1;
 EXEC gp._VisitReadJson @Actor,'GUARD',@Visit,@Now,@Result OUTPUT;
 SELECT @type=RequestType,@employee=EmployeeId FROM gp.VisitRequests WHERE VisitRequestId=@Visit;
 IF @Kind='COMMON'
 BEGIN
  IF JSON_VALUE(@Result,'$.status') IN('PENDING','APPROVED') AND JSON_VALUE(@Result,'$.passStatus') IN('PENDING','ACTIVE')
  AND @Now>=TRY_CONVERT(datetime2(3),JSON_VALUE(@Result,'$.validFromUtc')) AND @Now<TRY_CONVERT(datetime2(3),JSON_VALUE(@Result,'$.validUntilUtc'))
  AND JSON_VALUE(@Result,'$.photoAvailable')='true' AND EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@Location AND IsActive=1)
  AND(@employee IS NULL OR EXISTS(SELECT 1 FROM gp.Employees WHERE EmployeeId=@employee AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @Now))
  AND(@type<>'TEMP_ID' OR gp._EmployeeOfficeEligible(@employee,@Location,@cutoff,@Now)=1) SET @common=1;
  SET @Result=JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(@Result,'$.isInside',CONVERT(bit,0)),'$.movements',JSON_QUERY(N'[]')),'$.movementsHasMore',CONVERT(bit,0));
 END
 ELSE IF @type='TEMP_ID'
 BEGIN
  SELECT TOP(1) @inside=IsInside,@presenceVisit=VisitRequestId FROM gp.EmployeeProjectPresence WHERE EmployeeId=@employee AND ProjectLocationId=@Duty AND IsInside=1;
  IF JSON_VALUE(@Result,'$.status')='APPROVED' AND JSON_VALUE(@Result,'$.passStatus')='ACTIVE'
  BEGIN
   IF @inside=1 AND EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 WHERE v.VisitRequestId=@presenceVisit AND v.Status='APPROVED' AND p.Status='ACTIVE') SET @exit=1;
   ELSE IF @inside=0 AND gp._EmployeeProjectLocationEligible(@employee,@Duty,@cutoff,@Now)=1 AND JSON_VALUE(@Result,'$.photoAvailable')='true'
    AND @Now>=TRY_CONVERT(datetime2(3),JSON_VALUE(@Result,'$.validFromUtc')) AND @Now<TRY_CONVERT(datetime2(3),JSON_VALUE(@Result,'$.validUntilUtc')) SET @enter=1;
  END;
  SET @Result=JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(@Result,'$.isInside',@inside),'$.projectLocationId',CONVERT(varchar(20),@Duty)),
   '$.projectName',(SELECT p.ProjectName FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE pl.ProjectLocationId=@Duty)),
   '$.movements',JSON_QUERY(COALESCE((SELECT TOP(100) CONVERT(varchar(20),e.AccessEventId) accessEventId,e.EventType eventType,e.EntryMethod entryMethod,u.DisplayName guardName,
   REPLACE(CONVERT(char(23),e.OccurredAtUtc,121),' ','T')+'Z' occurredAtUtc FROM gp.EmployeeProjectAccessEvents e JOIN gp.Users u ON u.UserId=e.ActorUserId
   WHERE e.ProjectLocationId=@Duty AND EXISTS(SELECT 1 FROM gp.VisitRequests ev WHERE ev.VisitRequestId=e.VisitRequestId AND ev.EmployeeId=@employee) ORDER BY e.OccurredAtUtc DESC,e.AccessEventId DESC FOR JSON PATH),N'[]')));
  SET @Result=JSON_MODIFY(@Result,'$.movementsHasMore',CONVERT(bit,CASE WHEN(SELECT COUNT(*) FROM(SELECT TOP(101) AccessEventId FROM gp.EmployeeProjectAccessEvents WHERE ProjectLocationId=@Duty AND EXISTS(SELECT 1 FROM gp.VisitRequests ev WHERE ev.VisitRequestId=gp.EmployeeProjectAccessEvents.VisitRequestId AND ev.EmployeeId=@employee)) b)>100 THEN 1 ELSE 0 END));
 END
 ELSE BEGIN SET @enter=CASE WHEN JSON_VALUE(@Result,'$.canEnter')='true' THEN 1 ELSE 0 END;SET @exit=CASE WHEN JSON_VALUE(@Result,'$.canExit')='true' THEN 1 ELSE 0 END;END;
 SET @Result=JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(@Result,'$.canEnter',@enter),'$.canExit',@exit),'$.canReconcileExit',CONVERT(bit,CASE WHEN @Kind='PROJECT' AND ((@type='TEMP_ID' AND @inside=1 AND @exit=0 AND gp._HasCapability(@Actor,'RECONCILE_EXIT',@Location,@Duty,1,@Now)=1) OR (@type<>'TEMP_ID' AND JSON_VALUE(@Result,'$.canReconcileExit')='true')) THEN 1 ELSE 0 END));
 SET @Result=JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(@Result,'$.dutyKind',@Kind),'$.dutyId',CONVERT(varchar(20),@Duty)),'$.verificationOnly',CONVERT(bit,CASE WHEN @Kind='COMMON' THEN 1 ELSE 0 END)),'$.commonAccessAllowed',@common);
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('063',N'Preserve project visitor exit reconciliation in duty details');
COMMIT TRANSACTION;
