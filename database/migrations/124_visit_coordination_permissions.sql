/* Scoped collaboration authority. These functions do not authorize movement. */
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='123') THROW 52000,'Migration 123 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='124') THROW 52000,'Migration 124 already applied.',1;
BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE FUNCTION gp._PlanningInternal(@User uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3)) RETURNS bit WITH INLINE=OFF AS BEGIN
 IF EXISTS(SELECT 1 FROM gp.Users u JOIN gp.Employees e ON e.UserId=u.UserId WHERE u.UserId=@User AND u.IsActive=1 AND e.IsActive=1 AND e.LastSyncedAtUtc BETWEEN @Cutoff AND @Now) RETURN 1;
 RETURN 0;
END;
GO
CREATE FUNCTION gp._PlanningAdmin(@User uniqueidentifier,@Location int,@Sub uniqueidentifier,@Now datetime2(3)) RETURNS bit WITH INLINE=OFF AS BEGIN
 DECLARE @pair bigint;
 IF @Sub IS NOT NULL BEGIN
  SELECT @pair=AccountOfficeId FROM gp.SubProjects WHERE SubProjectId=@Sub AND LocationId=@Location;
  IF @pair IS NULL RETURN 0;
 END;
 RETURN gp._AdminScopeAllowed(@User,'ROLE_GRANTS_MANAGE',@Location,@pair,@Now);
END;
GO
CREATE FUNCTION gp._PlanningHost(@User uniqueidentifier,@Location int,@Sub uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3)) RETURNS bit WITH INLINE=OFF AS BEGIN
 IF gp._PlanningInternal(@User,@Now,@Cutoff)=0 RETURN 0;
 IF @Sub IS NULL BEGIN
  IF EXISTS(SELECT 1 FROM gp.LocationPlanningHosts h JOIN gp.Employees e ON e.EmployeeId=h.EmployeeId WHERE h.LocationId=@Location AND h.IsActive=1 AND e.UserId=@User AND gp._EmployeeOfficeEligible(e.EmployeeId,@Location,@Cutoff,@Now)=1) RETURN 1;
 END ELSE IF EXISTS(SELECT 1 FROM gp.SubProjects s JOIN gp.SubProjectHosts h ON h.SubProjectId=s.SubProjectId JOIN gp.Employees e ON e.EmployeeId=h.EmployeeId
  WHERE s.SubProjectId=@Sub AND s.LocationId=@Location AND s.IsActive=1 AND h.IsActive=1 AND e.UserId=@User AND gp._AccountHostEligible(e.EmployeeId,s.AccountOfficeId,@Cutoff,@Now)=1) RETURN 1;
 RETURN 0;
END;
GO
CREATE FUNCTION gp._PlanLiveApprover(@User uniqueidentifier,@Plan uniqueidentifier,@Version int,@Step uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3)) RETURNS bit WITH INLINE=OFF AS BEGIN
 IF gp._PlanningInternal(@User,@Now,@Cutoff)=0 RETURN 0;
 IF EXISTS(SELECT 1 FROM gp.VisitPlanApprovers a JOIN gp.VisitPlanApprovalSteps s ON s.PlanId=a.PlanId AND s.Version=a.Version AND s.StepId=a.StepId
  JOIN gp.VisitPlans v ON v.PlanId=a.PlanId JOIN gp.VisitPlanningPolicies p ON p.LocationId=v.LocationId AND p.IsActive=1 AND
   ((s.SubProjectId IS NULL AND p.ScopeKind='LOCATION') OR (s.SubProjectId IS NOT NULL AND p.ScopeKind='SUBPROJECT' AND p.SubProjectId=s.SubProjectId))
  CROSS APPLY OPENJSON(p.DefinitionJson,'$.approvalRules') WITH(id uniqueidentifier,approverIds nvarchar(max) AS JSON) r
  CROSS APPLY OPENJSON(r.approverIds) m
  WHERE a.PlanId=@Plan AND a.Version=@Version AND a.StepId=@Step AND a.UserId=@User AND r.id=@Step AND TRY_CONVERT(uniqueidentifier,m.value)=@User) RETURN 1;
 RETURN 0;
END;
GO
CREATE FUNCTION gp._PlanLiveTaskOwner(@User uniqueidentifier,@Plan uniqueidentifier,@Version int,@Task uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3)) RETURNS bit WITH INLINE=OFF AS BEGIN
 IF gp._PlanningInternal(@User,@Now,@Cutoff)=0 RETURN 0;
 IF EXISTS(SELECT 1 FROM gp.VisitPlanTaskOwners a JOIN gp.VisitPlans v ON v.PlanId=a.PlanId
  JOIN gp.VisitPlanningPolicies p ON p.LocationId=v.LocationId AND p.ScopeKind='LOCATION' AND p.IsActive=1
  CROSS APPLY OPENJSON(p.DefinitionJson,'$.arrangements') WITH(id uniqueidentifier,ownerIds nvarchar(max) AS JSON) r CROSS APPLY OPENJSON(r.ownerIds) m
  WHERE a.PlanId=@Plan AND a.Version=@Version AND a.TaskId=@Task AND a.UserId=@User AND r.id=@Task AND TRY_CONVERT(uniqueidentifier,m.value)=@User) RETURN 1;
 RETURN 0;
END;
GO
CREATE FUNCTION gp._PlanOfficeParticipant(@User uniqueidentifier,@Plan uniqueidentifier,@Version int,@Now datetime2(3),@Cutoff datetime2(3)) RETURNS bit WITH INLINE=OFF AS BEGIN
 IF gp._PlanningInternal(@User,@Now,@Cutoff)=0 RETURN 0;
 IF EXISTS(SELECT 1 FROM gp.VisitPlanParticipants a JOIN gp.VisitPlans v ON v.PlanId=a.PlanId JOIN gp.VisitPlanningPolicies p ON p.LocationId=v.LocationId AND p.ScopeKind='LOCATION' AND p.IsActive=1
  CROSS APPLY OPENJSON(CASE a.RoleCode WHEN 'RECEPTION' THEN JSON_QUERY(p.DefinitionJson,'$.receptionIds') WHEN 'SECURITY' THEN JSON_QUERY(p.DefinitionJson,'$.securityIds') END) m
  WHERE a.PlanId=@Plan AND a.Version=@Version AND a.UserId=@User AND TRY_CONVERT(uniqueidentifier,m.value)=@User) RETURN 1;
 IF EXISTS(SELECT 1 FROM gp.VisitPlanApprovalSteps s WHERE s.PlanId=@Plan AND s.Version=@Version AND s.SubProjectId IS NULL AND gp._PlanLiveApprover(@User,@Plan,@Version,s.StepId,@Now,@Cutoff)=1) RETURN 1;
 RETURN 0;
END;
GO
CREATE FUNCTION gp._PlanFullManager(@User uniqueidentifier,@Plan uniqueidentifier,@Version int,@Now datetime2(3)) RETURNS bit WITH INLINE=OFF AS BEGIN
 DECLARE @location int=(SELECT LocationId FROM gp.VisitPlans WHERE PlanId=@Plan);
 IF gp._PlanningAdmin(@User,@location,NULL,@Now)=1 RETURN 1;
 IF EXISTS(SELECT 1 FROM gp.VisitPlanProjects WHERE PlanId=@Plan AND Version=@Version)
  AND NOT EXISTS(SELECT 1 FROM gp.VisitPlanProjects WHERE PlanId=@Plan AND Version=@Version AND gp._PlanningAdmin(@User,@location,SubProjectId,@Now)=0) RETURN 1;
 RETURN 0;
END;
GO
CREATE FUNCTION gp._PlanProjectReadable(@User uniqueidentifier,@Plan uniqueidentifier,@Version int,@Sub uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3)) RETURNS bit WITH INLINE=OFF AS BEGIN
 DECLARE @location int,@owner uniqueidentifier;
 SELECT @location=LocationId,@owner=HostUserId FROM gp.VisitPlans WHERE PlanId=@Plan;
 IF @owner=@User AND gp._PlanningInternal(@User,@Now,@Cutoff)=1 RETURN 1;
 IF gp._PlanningAdmin(@User,@location,@Sub,@Now)=1 OR gp._PlanOfficeParticipant(@User,@Plan,@Version,@Now,@Cutoff)=1 RETURN 1;
 IF EXISTS(SELECT 1 FROM gp.VisitPlanApprovalSteps WHERE PlanId=@Plan AND Version=@Version AND SubProjectId=@Sub AND gp._PlanLiveApprover(@User,@Plan,@Version,StepId,@Now,@Cutoff)=1) RETURN 1;
 RETURN 0;
END;
GO
CREATE FUNCTION gp._PlanVisible(@User uniqueidentifier,@Plan uniqueidentifier,@Version int,@Now datetime2(3),@Cutoff datetime2(3)) RETURNS bit WITH INLINE=OFF AS BEGIN
 DECLARE @owner uniqueidentifier,@state varchar(12);SELECT @owner=HostUserId,@state=State FROM gp.VisitPlans WHERE PlanId=@Plan;
 IF @owner=@User AND gp._PlanningInternal(@User,@Now,@Cutoff)=1 OR gp._PlanFullManager(@User,@Plan,@Version,@Now)=1 RETURN 1;
 IF @state='DRAFT' RETURN 0;
 IF gp._PlanOfficeParticipant(@User,@Plan,@Version,@Now,@Cutoff)=1 RETURN 1;
 IF EXISTS(SELECT 1 FROM gp.VisitPlanProjects WHERE PlanId=@Plan AND Version=@Version AND gp._PlanProjectReadable(@User,@Plan,@Version,SubProjectId,@Now,@Cutoff)=1) RETURN 1;
 IF EXISTS(SELECT 1 FROM gp.VisitPlanTasks WHERE PlanId=@Plan AND Version=@Version AND gp._PlanLiveTaskOwner(@User,@Plan,@Version,TaskId,@Now,@Cutoff)=1) RETURN 1;
 RETURN 0;
END;
GO
CREATE FUNCTION gp._PlanThreadReadable(@User uniqueidentifier,@Plan uniqueidentifier,@Version int,@Thread uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3)) RETURNS bit WITH INLINE=OFF AS BEGIN
 IF gp._PlanVisible(@User,@Plan,@Version,@Now,@Cutoff)=0 RETURN 0;
 DECLARE @sub uniqueidentifier,@audience varchar(10),@step uniqueidentifier,@task uniqueidentifier,@owner uniqueidentifier,@location int;
 SELECT @sub=SubProjectId,@audience=Audience,@step=ApprovalStepId,@task=TaskId FROM gp.VisitPlanThreads WHERE PlanId=@Plan AND Version=@Version AND ThreadId=@Thread;
 SELECT @owner=HostUserId,@location=LocationId FROM gp.VisitPlans WHERE PlanId=@Plan;
 IF @audience IS NULL OR (@sub IS NOT NULL AND gp._PlanProjectReadable(@User,@Plan,@Version,@sub,@Now,@Cutoff)=0) RETURN 0;
 IF @audience='GENERAL' RETURN 1;
 IF @audience='OPERATIONS' AND(@User=@owner OR gp._PlanFullManager(@User,@Plan,@Version,@Now)=1 OR gp._PlanLiveTaskOwner(@User,@Plan,@Version,@task,@Now,@Cutoff)=1) RETURN 1;
 IF @audience='APPROVAL' AND(gp._PlanningAdmin(@User,@location,@sub,@Now)=1 OR gp._PlanLiveApprover(@User,@Plan,@Version,@step,@Now,@Cutoff)=1) RETURN 1;
 RETURN 0;
END;
GO
CREATE FUNCTION gp._PlanPolicyFresh(@Plan uniqueidentifier,@Version int) RETURNS bit WITH INLINE=OFF AS BEGIN
 DECLARE @snapshot nvarchar(max)=(SELECT PolicySnapshotJson FROM gp.VisitPlanVersions WHERE PlanId=@Plan AND Version=@Version);
 IF NOT EXISTS(SELECT 1 FROM OPENJSON(@snapshot,'$.policies')) RETURN 0;
 IF EXISTS(SELECT 1 FROM OPENJSON(@snapshot,'$.policies') WITH(policyId uniqueidentifier,revision int) s LEFT JOIN gp.VisitPlanningPolicies p ON p.PolicyId=s.policyId
  WHERE p.PolicyId IS NULL OR p.IsActive=0 OR p.Revision<>s.revision) RETURN 0;
 IF EXISTS(SELECT 1 FROM OPENJSON(@snapshot,'$.projects') WITH(subProjectId uniqueidentifier,revision int,accountOfficeId bigint) s LEFT JOIN gp.SubProjects p ON p.SubProjectId=s.subProjectId
  WHERE p.SubProjectId IS NULL OR p.IsActive=0 OR p.Revision<>s.revision OR p.AccountOfficeId<>s.accountOfficeId) RETURN 0;
 RETURN 1;
END;
GO
CREATE FUNCTION gp._PlanStepStatus(@Plan uniqueidentifier,@Version int,@Step uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3)) RETURNS varchar(8) WITH INLINE=OFF AS BEGIN
 IF EXISTS(SELECT 1 FROM gp.VisitPlanDecisions WHERE PlanId=@Plan AND Version=@Version AND StepId=@Step AND Decision='REJECTED' AND gp._PlanLiveApprover(UserId,@Plan,@Version,@Step,@Now,@Cutoff)=1) RETURN 'REJECTED';
 DECLARE @mode varchar(3)=(SELECT Mode FROM gp.VisitPlanApprovalSteps WHERE PlanId=@Plan AND Version=@Version AND StepId=@Step);
 IF @mode='ANY' AND EXISTS(SELECT 1 FROM gp.VisitPlanDecisions WHERE PlanId=@Plan AND Version=@Version AND StepId=@Step AND Decision='APPROVED' AND gp._PlanLiveApprover(UserId,@Plan,@Version,@Step,@Now,@Cutoff)=1) RETURN 'APPROVED';
 IF @mode='ALL' AND EXISTS(SELECT 1 FROM gp.VisitPlanApprovers WHERE PlanId=@Plan AND Version=@Version AND StepId=@Step)
  AND NOT EXISTS(SELECT 1 FROM gp.VisitPlanApprovers a WHERE a.PlanId=@Plan AND a.Version=@Version AND a.StepId=@Step AND
   (gp._PlanLiveApprover(a.UserId,@Plan,@Version,@Step,@Now,@Cutoff)=0 OR NOT EXISTS(SELECT 1 FROM gp.VisitPlanDecisions d WHERE d.PlanId=@Plan AND d.Version=@Version AND d.StepId=@Step AND d.UserId=a.UserId AND d.Decision='APPROVED'))) RETURN 'APPROVED';
 RETURN 'PENDING';
END;
GO
CREATE FUNCTION gp._PlanReadiness(@Plan uniqueidentifier,@Version int,@Sub uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3)) RETURNS varchar(16) WITH INLINE=OFF AS BEGIN
 DECLARE @state varchar(12),@host uniqueidentifier,@location int,@until datetime2(3);
 SELECT @state=State,@host=HostUserId,@location=LocationId FROM gp.VisitPlans WHERE PlanId=@Plan;
 SELECT @until=UntilUtc FROM gp.VisitPlanVersions WHERE PlanId=@Plan AND Version=@Version;
 IF @state<>'SUBMITTED' RETURN @state;
 IF @Now>=@until RETURN 'EXPIRED';
 IF gp._PlanPolicyFresh(@Plan,@Version)=0 RETURN 'POLICY_CHANGED';
 IF EXISTS(SELECT 1 FROM gp.VisitPlanProjects WHERE PlanId=@Plan AND Version=@Version) BEGIN
  IF EXISTS(SELECT 1 FROM gp.VisitPlanProjects WHERE PlanId=@Plan AND Version=@Version AND gp._PlanningHost(@host,@location,SubProjectId,@Now,@Cutoff)=0) RETURN 'BLOCKED';
 END ELSE IF gp._PlanningHost(@host,@location,NULL,@Now,@Cutoff)=0 RETURN 'BLOCKED';
 IF EXISTS(SELECT 1 FROM gp.VisitPlanApprovalSteps WHERE PlanId=@Plan AND Version=@Version AND(SubProjectId IS NULL OR SubProjectId=@Sub) AND gp._PlanStepStatus(@Plan,@Version,StepId,@Now,@Cutoff)='REJECTED') RETURN 'REJECTED';
 IF EXISTS(SELECT 1 FROM gp.VisitPlanTasks t WHERE t.PlanId=@Plan AND t.Version=@Version AND t.MandatoryForEntry=1 AND(t.Status='UNAVAILABLE' OR NOT EXISTS(SELECT 1 FROM gp.VisitPlanTaskOwners o WHERE o.PlanId=t.PlanId AND o.Version=t.Version AND o.TaskId=t.TaskId AND gp._PlanLiveTaskOwner(o.UserId,@Plan,@Version,t.TaskId,@Now,@Cutoff)=1))) RETURN 'BLOCKED';
 IF NOT EXISTS(SELECT 1 FROM gp.VisitPlanApprovalSteps WHERE PlanId=@Plan AND Version=@Version AND(SubProjectId IS NULL OR SubProjectId=@Sub)) RETURN 'PENDING';
 IF EXISTS(SELECT 1 FROM gp.VisitPlanApprovalSteps WHERE PlanId=@Plan AND Version=@Version AND(SubProjectId IS NULL OR SubProjectId=@Sub) AND gp._PlanStepStatus(@Plan,@Version,StepId,@Now,@Cutoff)<>'APPROVED') RETURN 'PENDING';
 IF EXISTS(SELECT 1 FROM gp.VisitPlanTasks WHERE PlanId=@Plan AND Version=@Version AND MandatoryForEntry=1 AND Status<>'CONFIRMED') RETURN 'PENDING';
 RETURN 'READY';
END;
GO
CREATE FUNCTION gp._PlanningAvailable(@User uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3)) RETURNS bit WITH INLINE=OFF AS BEGIN
 IF EXISTS(SELECT 1 FROM gp.Employees WHERE UserId=@User) AND gp._PlanningInternal(@User,@Now,@Cutoff)=0 RETURN 0;
 IF EXISTS(SELECT 1 FROM gp.Locations l WHERE l.IsActive=1 AND gp._PlanningAdmin(@User,l.LocationId,NULL,@Now)=1) RETURN 1;
 IF EXISTS(SELECT 1 FROM gp.ProjectLocations p WHERE p.IsActive=1 AND gp._AdminScopeAllowed(@User,'ROLE_GRANTS_MANAGE',p.LocationId,p.ProjectLocationId,@Now)=1) RETURN 1;
 IF gp._PlanningInternal(@User,@Now,@Cutoff)=0 RETURN 0;
 IF EXISTS(SELECT 1 FROM gp.SubProjects s WHERE gp._PlanningHost(@User,s.LocationId,s.SubProjectId,@Now,@Cutoff)=1) RETURN 1;
 IF EXISTS(SELECT 1 FROM gp.LocationPlanningHosts h WHERE gp._PlanningHost(@User,h.LocationId,NULL,@Now,@Cutoff)=1) RETURN 1;
 DECLARE @candidates table(PlanId uniqueidentifier PRIMARY KEY);
 INSERT @candidates SELECT PlanId FROM gp.VisitPlans WHERE HostUserId=@User UNION SELECT PlanId FROM gp.VisitPlanApprovers WHERE UserId=@User UNION SELECT PlanId FROM gp.VisitPlanTaskOwners WHERE UserId=@User UNION SELECT PlanId FROM gp.VisitPlanParticipants WHERE UserId=@User;
 IF EXISTS(SELECT 1 FROM @candidates c JOIN gp.VisitPlanVersions v ON v.PlanId=c.PlanId AND v.IsCurrent=1 WHERE gp._PlanVisible(@User,v.PlanId,v.Version,@Now,@Cutoff)=1) RETURN 1;
 RETURN 0;
END;
GO
/* Existing sign-in context gains an optional, capability-derived workspace. */
DECLARE @definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.GetStaffAccessContext'));
DECLARE @needle nvarchar(100)=N'@name displayName,';
IF @definition IS NULL OR CHARINDEX(@needle,@definition)=0 THROW 52000,'Staff context contract required.',1;
SET @definition=REPLACE(@definition,@needle,N'@name displayName,CONVERT(bit,gp._PlanningAvailable(@actor,@now,@cutoff)) coordinationAvailable,');
SET @definition=STUFF(@definition,1,CHARINDEX(' ',@definition)-1,'ALTER'); EXEC sys.sp_executesql @definition;
INSERT gp.SchemaMigrations(Version,Description) VALUES('124',N'Live internal planning authority, scoped project/thread visibility and capability-derived workspace');
COMMIT;
