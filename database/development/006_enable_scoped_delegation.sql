/* One-time, explicitly approved development capability expansion. Reruns preserve removals. */
SET NOCOUNT ON;SET XACT_ABORT ON;
IF DB_NAME()<>N'GatePass_DesignTest' OR @@TRANCOUNT<>0 OR NOT EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DevelopmentDirectoryMarker' AND CONVERT(nvarchar(100),value)=N'SYNTHETIC-DIRECTORY-V1') THROW 53600,'Dedicated synthetic database required.',1;
BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
 IF NOT EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DevelopmentScopedDelegationV1')
 BEGIN
  DECLARE @added table(RoleGrantId bigint,UserId uniqueidentifier);
  INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode)
  OUTPUT inserted.RoleGrantId,NULL INTO @added
  SELECT g.RoleGrantId,'ROLE_GRANTS_MANAGE' FROM gp.StaffRoleGrants g JOIN gp.Users u ON u.UserId=g.UserId
  WHERE g.RevokedAtUtc IS NULL AND((u.IdentityIssuer=N'urn:gatepass:development-staff' AND u.IdentitySubject IN(N'staff:ADM002',N'staff:ADM003',N'staff:ADM004',N'staff:ADM005') AND g.RoleCode='LOCATION_ADMIN') OR(u.IdentityIssuer=N'urn:gatepass:development-directory' AND u.IdentitySubject IN(N'employee:EMP019',N'employee:EMP024',N'employee:EMP020',N'employee:EMP021',N'employee:EMP022',N'employee:EMP023') AND g.RoleCode='PROJECT_ADMIN'))
  AND NOT EXISTS(SELECT 1 FROM gp.GrantCapabilities c WHERE c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='ROLE_GRANTS_MANAGE');
  UPDATE a SET UserId=g.UserId FROM @added a JOIN gp.StaffRoleGrants g ON g.RoleGrantId=a.RoleGrantId;
  UPDATE u SET AuthorizationVersion=AuthorizationVersion+1 FROM gp.Users u WHERE EXISTS(SELECT 1 FROM @added a WHERE a.UserId=u.UserId);
  DECLARE @actor uniqueidentifier=(SELECT UserId FROM gp.Users WHERE IdentityIssuer=N'urn:gatepass:development-directory' AND IdentitySubject=N'local-seed');
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode) SELECT @actor,'DEV_DELEGATION_ENABLED','ROLE_GRANT',CONVERT(varchar(100),RoleGrantId),'SUCCESS' FROM @added;
  EXEC sys.sp_addextendedproperty @name=N'GatePass.DevelopmentScopedDelegationV1',@value=N'ENABLED';
 END;
 COMMIT;
END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
