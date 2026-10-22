/* Removes ONLY synthetic rows owned by the current harness @RunId.
   This is not a production retention or database reset script. */
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'GatePass_DesignTest' OR @RunId IS NULL THROW 52900, 'Dedicated test database/run ID required.', 1;
DECLARE @prefix varchar(30)='GP02-'+LEFT(REPLACE(CONVERT(varchar(36),@RunId),'-',''),20);
DECLARE @users table(Id uniqueidentifier);
DECLARE @visits table(Id uniqueidentifier);
DECLARE @intakes table(Id uniqueidentifier);
DECLARE @assignments table(Id bigint);
INSERT @users SELECT UserId FROM gp.Users WHERE IdentityIssuer='gatepass-phase02-fixture' AND IdentitySubject LIKE @prefix+':%';
INSERT @visits SELECT VisitRequestId FROM gp.VisitRequests WHERE PublicReference LIKE @prefix+'-%';
INSERT @intakes SELECT DISTINCT IntakeId FROM gp.VisitRequests WHERE VisitRequestId IN(SELECT Id FROM @visits);
INSERT @assignments SELECT GuardAssignmentId FROM gp.GuardAssignments WHERE GuardUserId IN(SELECT Id FROM @users);
DECLARE @notifications table(Id bigint);
INSERT @notifications SELECT NotificationId FROM gp.NotificationOutbox WHERE VisitRequestId IN(SELECT Id FROM @visits);
BEGIN TRANSACTION;
-- Serialize owned-fixture removal with API reads and writes that use the same gate.
EXEC gp._TakeLock N'gp:authorization','Exclusive';
DELETE FROM gp.NotificationOutbox WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE r FROM gp.PassPrintRenderState r JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId WHERE j.VisitRequestId IN(SELECT Id FROM @visits);
DELETE FROM gp.PassPrintJobs WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE FROM gp.PassDeliveryLinks WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE FROM gp.PassScanAttempts WHERE VisitRequestId IN(SELECT Id FROM @visits) OR ActorUserId IN(SELECT Id FROM @users);
UPDATE gp.VisitPresence SET IsInside=0,LastAccessEventId=NULL,LastMovementAtUtc=NULL WHERE VisitRequestId IN(SELECT Id FROM @visits);
UPDATE gp.EmployeeProjectPresence SET LastEventId=NULL WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE gp.EmployeeProjectAccessEvents WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE gp.EmployeeProjectPresence WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE FROM gp.AccessEvents WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE FROM gp.VisitPresence WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE FROM gp.ApprovalDecisions WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE s FROM gp.PassSecrets s JOIN gp.AccessPasses p ON p.AccessPassId=s.AccessPassId WHERE p.VisitRequestId IN(SELECT Id FROM @visits);
DELETE FROM gp.AccessPasses WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE FROM gp.TemporaryIdSlots WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE gp.SecurityAuditEvents WHERE TargetType='NOTIFICATION' AND TargetReference IN(SELECT CONVERT(varchar(100),Id) FROM @notifications);
DELETE FROM gp.SecurityAuditEvents WHERE ActorUserId IN(SELECT Id FROM @users)
    OR TargetReference IN(SELECT CONVERT(varchar(36),Id) FROM @visits)
    OR (ActionCode IN('GUARD_DEALLOCATED','GUARD_DEALLOCATION_FAILED')
        AND TargetReference IN(SELECT CONVERT(varchar(100),Id) FROM @assignments));
DELETE FROM gp.IdempotencyRequests WHERE ActorBindingHash IN(SELECT HASHBYTES('SHA2_256',CONVERT(binary(16),Id)) FROM @users);
DELETE FROM gp.VisitRequests WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE FROM gp.PhotoAssets WHERE IntakeId IN(SELECT Id FROM @intakes);
DELETE FROM gp.RegistrationIntakes WHERE IntakeId IN(SELECT Id FROM @intakes);
DELETE c FROM gp.GrantCapabilities c JOIN gp.StaffRoleGrants g ON g.RoleGrantId=c.RoleGrantId WHERE g.UserId IN(SELECT Id FROM @users);
DELETE FROM gp.StaffRoleGrants WHERE UserId IN(SELECT Id FROM @users);
DELETE gp.GuardCommonAreaAssignments WHERE GuardUserId IN(SELECT Id FROM @users);
DELETE gp.CommonAreas WHERE AreaName LIKE @prefix+'%';
DELETE FROM gp.GuardAssignments WHERE GuardUserId IN(SELECT Id FROM @users);
DELETE FROM gp.EmployeeProjectLocationMemberships WHERE EmployeeId IN(SELECT EmployeeId FROM gp.Employees WHERE UserId IN(SELECT Id FROM @users));
DELETE FROM gp.EmployeeOfficeMemberships WHERE EmployeeId IN(SELECT EmployeeId FROM gp.Employees WHERE UserId IN(SELECT Id FROM @users));
DELETE FROM gp.EmployeeProjectMemberships WHERE EmployeeId IN(SELECT EmployeeId FROM gp.Employees WHERE UserId IN(SELECT Id FROM @users));
DELETE FROM gp.Employees WHERE UserId IN(SELECT Id FROM @users);
DELETE FROM gp.Sessions WHERE UserId IN(SELECT Id FROM @users);
DELETE FROM gp.Users WHERE UserId IN(SELECT Id FROM @users);
DELETE FROM gp.ProjectLocations WHERE ProjectId IN(SELECT ProjectId FROM gp.Projects WHERE ExternalProjectCode IN(@prefix+'-A',@prefix+'-B'));
DELETE FROM gp.Projects WHERE ExternalProjectCode IN(@prefix+'-A',@prefix+'-B');
IF EXISTS(SELECT 1 FROM gp.Users WHERE UserId IN(SELECT Id FROM @users))
 OR EXISTS(SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId IN(SELECT Id FROM @visits))
 OR EXISTS(SELECT 1 FROM gp.SecurityAuditEvents WHERE ActorUserId IN(SELECT Id FROM @users)
    OR TargetReference IN(SELECT CONVERT(varchar(36),Id) FROM @visits)
    OR (ActionCode IN('GUARD_DEALLOCATED','GUARD_DEALLOCATION_FAILED')
        AND TargetReference IN(SELECT CONVERT(varchar(100),Id) FROM @assignments)))
 THROW 52900,'Owned transaction-test fixture cleanup incomplete.',1;
COMMIT;
