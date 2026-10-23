/* Only local identities bearing this unique harness run prefix. */
IF DB_NAME()<>N'GatePass_DesignTest' OR @RunId IS NULL THROW 52900,'Owned test database required.',1;
DECLARE @prefix varchar(40)='new-'+LOWER(REPLACE(CONVERT(varchar(36),@RunId),'-',''));
DECLARE @users table(Id uniqueidentifier);INSERT @users SELECT UserId FROM gp.Users WHERE IdentityIssuer='gatepass-local-staff' AND LEFT(IdentitySubject,LEN(@prefix))=@prefix;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DELETE gp.SecurityAuditEvents WHERE ActorUserId IN(SELECT Id FROM @users) OR TargetReference IN(SELECT CONVERT(varchar(36),Id) FROM @users);
DELETE gp.IdempotencyRequests WHERE ActorBindingHash IN(SELECT HASHBYTES('SHA2_256',CONVERT(binary(16),Id)) FROM @users);
DELETE gp.GuardLoginAttempts WHERE UserId IN(SELECT Id FROM @users);
DELETE gp.GuardSetupTickets WHERE UserId IN(SELECT Id FROM @users);
DELETE gp.Sessions WHERE UserId IN(SELECT Id FROM @users);
DELETE gp.GuardCredentials WHERE UserId IN(SELECT Id FROM @users);
DELETE gp.StaffProfiles WHERE UserId IN(SELECT Id FROM @users);
DELETE gp.GuardAssignments WHERE GuardUserId IN(SELECT Id FROM @users);
DELETE c FROM gp.GrantCapabilities c JOIN gp.StaffRoleGrants g ON g.RoleGrantId=c.RoleGrantId WHERE g.UserId IN(SELECT Id FROM @users);
DELETE gp.StaffRoleGrants WHERE UserId IN(SELECT Id FROM @users);
DELETE gp.Users WHERE UserId IN(SELECT Id FROM @users);COMMIT;
