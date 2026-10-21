/* Test administrator only. Exact random intake IDs AND ownership token digests
   are required; existing development master data is never selected for deletion. */
SET NOCOUNT ON; SET XACT_ABORT ON;
IF DB_NAME()<>N'GatePass_DesignTest' OR ISJSON(@IntakesJson)<>1 OR @RunId IS NULL THROW 52900,'Owned registration cleanup input required.',1;
DECLARE @prefix varchar(30)='GP02-'+LEFT(REPLACE(CONVERT(varchar(36),@RunId),'-',''),20);
DECLARE @intakes table(Id uniqueidentifier,TokenHash varbinary(32));
INSERT @intakes SELECT intakeId,TRY_CONVERT(varbinary(32),tokenHash,2) FROM OPENJSON(@IntakesJson) WITH(intakeId uniqueidentifier,tokenHash varchar(64));
IF EXISTS(SELECT 1 FROM @intakes x JOIN gp.RegistrationIntakes i ON i.IntakeId=x.Id WHERE i.TokenHash<>x.TokenHash OR x.TokenHash IS NULL)
    THROW 52900,'Registration cleanup ownership mismatch.',1;
DECLARE @users table(Id uniqueidentifier); INSERT @users SELECT UserId FROM gp.Users WHERE IdentityIssuer='gatepass-phase02-fixture' AND IdentitySubject LIKE @prefix+':%';
DECLARE @visits table(Id uniqueidentifier); INSERT @visits SELECT VisitRequestId FROM gp.VisitRequests WHERE IntakeId IN(SELECT Id FROM @intakes);
DECLARE @ops table(Id uniqueidentifier);
INSERT @ops SELECT OperationId FROM gp.AccessEvents WHERE VisitRequestId IN(SELECT Id FROM @visits)
    UNION SELECT OperationId FROM gp.EmployeeProjectAccessEvents WHERE VisitRequestId IN(SELECT Id FROM @visits)
    UNION SELECT OperationId FROM gp.ApprovalDecisions WHERE VisitRequestId IN(SELECT Id FROM @visits)
    UNION SELECT OperationId FROM gp.PassPrintJobs WHERE VisitRequestId IN(SELECT Id FROM @visits);
DECLARE @notifications table(Id bigint);
INSERT @notifications SELECT NotificationId FROM gp.NotificationOutbox WHERE VisitRequestId IN(SELECT Id FROM @visits);
BEGIN TRANSACTION;
DELETE gp.NotificationOutbox WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE r FROM gp.PassPrintRenderState r JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId WHERE j.VisitRequestId IN(SELECT Id FROM @visits);
DELETE gp.PassPrintJobs WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE gp.PassDeliveryLinks WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE gp.PassScanAttempts WHERE VisitRequestId IN(SELECT Id FROM @visits);
UPDATE gp.VisitPresence SET IsInside=0,LastAccessEventId=NULL,LastMovementAtUtc=NULL WHERE VisitRequestId IN(SELECT Id FROM @visits);
UPDATE gp.EmployeeProjectPresence SET LastEventId=NULL WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE gp.EmployeeProjectAccessEvents WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE gp.EmployeeProjectPresence WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE gp.AccessEvents WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE gp.VisitPresence WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE gp.ApprovalDecisions WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE s FROM gp.PassSecrets s JOIN gp.AccessPasses p ON p.AccessPassId=s.AccessPassId WHERE p.VisitRequestId IN(SELECT Id FROM @visits);
DELETE gp.AccessPasses WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE gp.TemporaryIdSlots WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE gp.SecurityAuditEvents WHERE TargetType='NOTIFICATION' AND TargetReference IN(SELECT CONVERT(varchar(100),Id) FROM @notifications);
DELETE gp.SecurityAuditEvents WHERE TargetReference IN(SELECT CONVERT(varchar(36),Id) FROM @visits)
    OR TargetReference IN(SELECT CONVERT(varchar(36),Id) FROM @intakes);
DELETE gp.VisitRequests WHERE VisitRequestId IN(SELECT Id FROM @visits);
DELETE gp.PhotoAssets WHERE IntakeId IN(SELECT Id FROM @intakes);
DELETE gp.IdempotencyRequests WHERE OperationId IN(SELECT Id FROM @ops) OR (OperationCode='SUBMIT_REGISTRATION' AND
    (ActorBindingHash IN(SELECT HASHBYTES('SHA2_256',CONVERT(binary(16),Id)) FROM @users)
    OR ActorBindingHash IN(SELECT HASHBYTES('SHA2_256',CONVERT(varbinary(max),'PUBLIC_REGISTRATION:')+TokenHash) FROM @intakes)));
DELETE gp.RegistrationIntakeAccess WHERE IntakeId IN(SELECT Id FROM @intakes);
DELETE gp.RegistrationIntakes WHERE IntakeId IN(SELECT Id FROM @intakes);
COMMIT;
