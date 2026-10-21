/* Local development session adapter, NOT a production migration or SSO issuer.
   Parameters are bound by tools/GatePass.DevelopmentSqlBridge.ps1. */
SET NOCOUNT ON; SET XACT_ABORT ON;
IF DB_NAME()<>N'GatePass_DesignTest' OR @@TRANCOUNT<>0
 OR NOT EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DevelopmentDirectoryMarker' AND CONVERT(nvarchar(100),value)=N'SYNTHETIC-DIRECTORY-V1')
 THROW 52920,'Dedicated synthetic development database required.',1;
IF @Action NOT IN('list','create','inspect','touch','logout','refresh') THROW 52920,'Invalid development action.',1;
IF @Action NOT IN('list','refresh') AND (@SessionHash IS NULL OR DATALENGTH(@SessionHash)<>32 OR @CsrfHash IS NULL OR DATALENGTH(@CsrfHash)<>32)
 THROW 52920,'Invalid development session binding.',1;
DECLARE @now datetime2(3),@cutoff datetime2(3),@actor uniqueidentifier,@expires datetime2(3),@idle datetime2(3),@employee nvarchar(64),@name nvarchar(200),@email nvarchar(320);
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @mode nvarchar(32)=CASE WHEN @Action='refresh' THEN N'Exclusive' ELSE N'Shared' END;
 EXEC gp._TakeLock N'gp:authorization',@mode;
 SET @now=SYSUTCDATETIME(); EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF @Action='refresh'
 BEGIN
  -- Refresh only this fixture namespace. Do not grant roles or change auth versions.
  UPDATE e SET LastSyncedAtUtc=@now FROM gp.Employees e JOIN gp.Users u ON u.UserId=e.UserId
   WHERE u.IdentityIssuer=N'urn:gatepass:development-directory' AND u.IdentitySubject=(N'employee:'+e.EmployeeId) COLLATE Latin1_General_100_BIN2 AND e.OfficialEmail LIKE N'%@example.com';
  UPDATE gp.Projects SET LastSyncedAtUtc=@now WHERE ExternalProjectCode COLLATE Latin1_General_100_BIN2 LIKE N'DEMO-PRJ-[0-9][0-9][0-9]';
  UPDATE ep SET VerifiedAtUtc=@now FROM gp.EmployeeProjectMemberships ep JOIN gp.Employees e ON e.EmployeeId=ep.EmployeeId JOIN gp.Users u ON u.UserId=e.UserId
   WHERE u.IdentityIssuer=N'urn:gatepass:development-directory' AND u.IdentitySubject=(N'employee:'+e.EmployeeId) COLLATE Latin1_General_100_BIN2;
  COMMIT; SELECT N'{"ok":true}'; RETURN;
 END;
 IF @Action='create'
 BEGIN
  IF @EmployeeId IS NULL OR @EmployeeId COLLATE Latin1_General_100_BIN2 NOT LIKE N'EMP[0-9][0-9][0-9]' THROW 52921,'Development employee unavailable.',1;
  SELECT @actor=u.UserId FROM gp.Employees e JOIN gp.Users u ON u.UserId=e.UserId
   WHERE e.EmployeeId=@EmployeeId AND e.IsActive=1 AND e.LastSyncedAtUtc BETWEEN @cutoff AND @now AND u.IsActive=1
   AND u.IdentityIssuer=N'urn:gatepass:development-directory' AND u.IdentitySubject=(N'employee:'+e.EmployeeId) COLLATE Latin1_General_100_BIN2
   AND e.OfficialEmail LIKE N'%@example.com';
  IF @actor IS NULL THROW 52921,'Development employee unavailable.',1;
  INSERT gp.Sessions(SessionHash,UserId,CsrfHash,AuthorizationVersionAtIssue,LastSeenAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,CreatedAtUtc)
   SELECT @SessionHash,UserId,@CsrfHash,AuthorizationVersion,@now,DATEADD(minute,15,@now),DATEADD(hour,8,@now),@now FROM gp.Users WHERE UserId=@actor;
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode)
   VALUES(@actor,'DEV_SSO_LOGIN','DEVELOPMENT_SESSION',CONVERT(varchar(64),@SessionHash,2),'SUCCESS');
 END;
 IF @Action IN('inspect','touch','logout')
 BEGIN
  SELECT @actor=u.UserId FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId JOIN gp.Employees e ON e.UserId=u.UserId
   WHERE s.SessionHash=@SessionHash AND s.CsrfHash=@CsrfHash AND s.RevokedAtUtc IS NULL AND u.IsActive=1 AND e.IsActive=1
    AND s.AuthorizationVersionAtIssue=u.AuthorizationVersion AND s.CreatedAtUtc<=@now AND s.LastSeenAtUtc<=@now
    AND @now<s.IdleExpiresAtUtc AND @now<s.AbsoluteExpiresAtUtc AND e.LastSyncedAtUtc BETWEEN @cutoff AND @now
    AND u.IdentityIssuer=N'urn:gatepass:development-directory' AND u.IdentitySubject=(N'employee:'+e.EmployeeId) COLLATE Latin1_General_100_BIN2 AND e.OfficialEmail LIKE N'%@example.com';
  IF @actor IS NULL BEGIN COMMIT; SELECT N'{"ok":false}'; RETURN; END;
 END;
 IF @Action='logout'
 BEGIN
  UPDATE gp.Sessions SET RevokedAtUtc=@now WHERE SessionHash=@SessionHash;
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode)
   VALUES(@actor,'DEV_SSO_LOGOUT','DEVELOPMENT_SESSION',CONVERT(varchar(64),@SessionHash,2),'SUCCESS');
  COMMIT; SELECT N'{"ok":true}'; RETURN;
 END;
 IF @Action='touch'
  UPDATE gp.Sessions SET LastSeenAtUtc=@now,IdleExpiresAtUtc=CASE WHEN DATEADD(minute,15,@now)<AbsoluteExpiresAtUtc THEN DATEADD(minute,15,@now) ELSE AbsoluteExpiresAtUtc END WHERE SessionHash=@SessionHash;
 DECLARE @employees nvarchar(max)=(SELECT e.EmployeeId employeeId,e.FullName displayName,e.OfficialEmail officialEmail,e.ManagerEmployeeId managerEmployeeId,
   JSON_QUERY(CASE WHEN m.EmployeeId IS NOT NULL THEN (SELECT m.EmployeeId employeeId,m.FullName displayName,m.OfficialEmail officialEmail,m.IsActive active FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) END) manager,
   JSON_QUERY(COALESCE((SELECT p.ExternalProjectCode projectCode,p.ProjectName projectName FROM gp.EmployeeProjectMemberships ep JOIN gp.Projects p ON p.ProjectId=ep.ProjectId
     WHERE ep.EmployeeId=e.EmployeeId AND ep.IsActive=1 AND ep.VerifiedAtUtc BETWEEN @cutoff AND @now AND p.IsActive=1 AND p.LastSyncedAtUtc BETWEEN @cutoff AND @now ORDER BY p.ExternalProjectCode FOR JSON PATH),N'[]')) projects
  FROM gp.Employees e JOIN gp.Users u ON u.UserId=e.UserId
  LEFT JOIN gp.Employees m ON m.EmployeeId=e.ManagerEmployeeId AND m.LastSyncedAtUtc BETWEEN @cutoff AND @now
  WHERE e.IsActive=1 AND u.IsActive=1 AND e.LastSyncedAtUtc BETWEEN @cutoff AND @now
   AND u.IdentityIssuer=N'urn:gatepass:development-directory' AND u.IdentitySubject=(N'employee:'+e.EmployeeId) COLLATE Latin1_General_100_BIN2 AND e.OfficialEmail LIKE N'%@example.com'
   AND (@Action='list' OR u.UserId=@actor)
  ORDER BY e.EmployeeId FOR JSON PATH,INCLUDE_NULL_VALUES);
 IF @Action='list' BEGIN COMMIT; SELECT (SELECT CAST(1 AS bit) ok,JSON_QUERY(COALESCE(@employees,N'[]')) employees FOR JSON PATH,WITHOUT_ARRAY_WRAPPER); RETURN; END;
 SELECT @idle=IdleExpiresAtUtc,@expires=AbsoluteExpiresAtUtc FROM gp.Sessions WHERE SessionHash=@SessionHash;
 COMMIT;
 SELECT (SELECT CAST(1 AS bit) ok,JSON_QUERY(JSON_QUERY(@employees,'$[0]')) employee,
  REPLACE(CONVERT(char(23),@idle,121),' ','T')+'Z' idleExpiresAtUtc,REPLACE(CONVERT(char(23),@expires,121),' ','T')+'Z' absoluteExpiresAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
END TRY
BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK; THROW; END CATCH;
