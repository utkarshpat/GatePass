/* Revalidate office entitlement for printing/replacement and queued card delivery. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='048') THROW 53800,'Migration 048 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='049') THROW 53800,'Migration 049 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp._RequirePrintablePass
    @Visit uniqueidentifier,@Pass uniqueidentifier,@Now datetime2(3),@AllowRevoked bit=0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @cutoff datetime2(3);EXEC gp._DirectoryCutoff @Now,@cutoff OUTPUT;
    IF NOT EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId
        JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId JOIN gp.Locations l ON l.LocationId=v.LocationId
        WHERE v.VisitRequestId=@Visit AND p.AccessPassId=@Pass AND p.IsCurrent=1 AND v.PersonalDataPurgedAtUtc IS NULL
        AND v.Status IN('PENDING','APPROVED') AND @Now<v.ValidUntilUtc AND l.IsActive=1
        AND (v.Status='APPROVED' OR @Now<v.ApprovalDeadlineUtc)
        AND ((v.Status='PENDING' AND p.Status='PENDING') OR (v.Status='APPROVED' AND p.Status='ACTIVE') OR (@AllowRevoked=1 AND p.Status='REVOKED'))
        AND a.PurgedAtUtc IS NULL AND a.StorageKey IS NOT NULL AND a.ContentHash IS NOT NULL
        AND (v.ProjectLocationId IS NULL OR EXISTS(SELECT 1 FROM gp.ProjectLocations pl JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId
            WHERE pl.ProjectLocationId=v.ProjectLocationId AND pl.IsActive=1 AND pj.IsActive=1))
        AND (v.RequestType<>'TEMP_ID' OR gp._EmployeeOfficeEligible(v.EmployeeId,v.LocationId,@cutoff,@Now)=1)
        AND (v.EmployeeId IS NULL OR EXISTS(SELECT 1 FROM gp.Employees e WHERE e.EmployeeId=v.EmployeeId AND e.IsActive=1 AND e.LastSyncedAtUtc BETWEEN @cutoff AND @Now)))
        THROW 53105,'Credential cannot be printed or replaced.',1;
END;
GO
ALTER PROCEDURE gp._ReadPrintCardDetails
    @Visit uniqueidentifier,@Now datetime2(3),@Details nvarchar(max) OUTPUT,@Digest varbinary(32) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @Details=NULL;SET @Digest=NULL;
    DECLARE @type varchar(24),@employee nvarchar(64),@host nvarchar(64),@hostName nvarchar(200),@purpose nvarchar(1000),@reason varchar(12),
        @location int,@cutoff datetime2(3),@projects nvarchar(max)=N'[]',@count int=0;
    EXEC gp._DirectoryCutoff @Now,@cutoff OUTPUT;
    SELECT @location=LocationId,@type=RequestType,@employee=EmployeeId,@host=HostEmployeeId,@purpose=Reason,@reason=TemporaryIdReason FROM gp.VisitRequests WHERE VisitRequestId=@Visit;
    IF @type IS NULL THROW 53105,'Card details unavailable.',1;
    IF @type='TEMP_ID' AND gp._EmployeeOfficeEligible(@employee,@location,@cutoff,@Now)=0 THROW 53105,'Current employee office entitlement required.',1;
    IF @employee IS NOT NULL
    BEGIN
        IF NOT EXISTS(SELECT 1 FROM gp.Employees WHERE EmployeeId=@employee AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @Now)
            THROW 53105,'Current employee data required for card.',1;
        IF @type='TEMP_ID' AND EXISTS(SELECT 1 FROM gp.EmployeeProjectLocationMemberships m JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=m.ProjectLocationId WHERE m.EmployeeId=@employee AND pl.LocationId=@location AND m.IsActive=1 AND gp._EmployeeProjectLocationEligible(@employee,m.ProjectLocationId,@cutoff,@Now)=0) THROW 53105,'Current office project assignments required.',1;
        -- Never silently turn stale active memberships into a partial assignment list.
        IF EXISTS(SELECT 1 FROM gp.EmployeeProjectLocationMemberships m JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=m.ProjectLocationId JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
            WHERE m.EmployeeId=@employee AND pl.LocationId=@location AND m.IsActive=1 AND p.IsActive=1
            AND (m.VerifiedAtUtc<@cutoff OR m.VerifiedAtUtc>@Now OR p.LastSyncedAtUtc IS NULL OR p.LastSyncedAtUtc<@cutoff OR p.LastSyncedAtUtc>@Now))
            THROW 53105,'Current project data required for card.',1;
        SELECT @count=COUNT(*) FROM gp.EmployeeProjectLocationMemberships m JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=m.ProjectLocationId JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE m.EmployeeId=@employee AND pl.LocationId=@location AND m.IsActive=1 AND p.IsActive=1;
        SET @projects=(SELECT TOP(3) p.ExternalProjectCode code,p.ProjectName name FROM gp.EmployeeProjectLocationMemberships m JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=m.ProjectLocationId JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
            WHERE m.EmployeeId=@employee AND pl.LocationId=@location AND m.IsActive=1 AND p.IsActive=1 ORDER BY p.ExternalProjectCode COLLATE Latin1_General_100_BIN2 FOR JSON PATH);
    END;
    IF @type='EXTERNAL'
    BEGIN
        SELECT @hostName=FullName FROM gp.Employees WHERE EmployeeId=@host AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @Now;
        IF @hostName IS NULL OR LEN(LTRIM(RTRIM(@hostName)))=0 THROW 53105,'Current host details required for card.',1;
    END
    ELSE SET @host=NULL;
    IF @type='TEMP_ID' SET @purpose=CASE @reason WHEN 'FORGOT' THEN N'Forgot physical ID' WHEN 'LOST' THEN N'Lost physical ID' WHEN 'OTHER' THEN N'ID card unavailable' END;
    IF @purpose IS NULL OR LEN(LTRIM(RTRIM(@purpose)))=0 THROW 53105,'Card purpose unavailable.',1;
    SET @Details=(SELECT @employee employeeId,@host hostEmployeeId,@hostName hostName,@purpose purpose,
        @count assignedProjectCount,JSON_QUERY(COALESCE(@projects,N'[]')) assignedProjects FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
    SET @Digest=HASHBYTES('SHA2_256',@Details);
END;
GO
ALTER PROCEDURE gp._NotificationRelevance @NotificationId bigint,@Now datetime2(3),@Reason varchar(40) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;SET @Reason=NULL;
    DECLARE @visit uniqueidentifier,@link uniqueidentifier,@template varchar(40),@kind varchar(12),@recipient nvarchar(64),@email nvarchar(320),@payload nvarchar(max);
    SELECT @visit=VisitRequestId,@link=DeliveryLinkId,@template=TemplateCode,@kind=RecipientKind,@recipient=RecipientEmployeeId,@email=RecipientEmail,@payload=PayloadJson
        FROM gp.NotificationOutbox WHERE NotificationId=@NotificationId;
    IF @template NOT IN('HOST_APPROVAL_REQUEST','TEMP_ID_MANAGER_NOTICE','VISIT_DECIDED','PASS_DELIVERY','PASS_REISSUED') BEGIN SET @Reason='UNSUPPORTED_TEMPLATE';RETURN;END;
    IF @visit IS NULL BEGIN SET @Reason='MISSING_VISIT';RETURN;END;
    DECLARE @state varchar(12),@type varchar(24),@employee nvarchar(64),@personEmail nvarchar(320),@host nvarchar(64),@pair bigint,@location int,
        @deadline datetime2(3),@end datetime2(3),@project bigint,@cutoff datetime2(3);
    SELECT @state=Status,@type=RequestType,@employee=EmployeeId,@personEmail=PersonEmail,@host=HostEmployeeId,@pair=ProjectLocationId,
        @location=LocationId,@deadline=ApprovalDeadlineUtc,@end=ValidUntilUtc FROM gp.VisitRequests WHERE VisitRequestId=@visit;
    IF @state IS NULL BEGIN SET @Reason='MISSING_VISIT';RETURN;END;
    -- Replacement and issuance notices describe history; they carry no access link.
    IF @template='PASS_REISSUED'
    BEGIN
        IF TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.visitRequestId')) IS NULL
            OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.visitRequestId'))<>@visit OR NOT EXISTS(SELECT 1 FROM gp.AccessPasses
                WHERE AccessPassId=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.accessPassId')) AND VisitRequestId=@visit AND PassVersion>1)
            BEGIN SET @Reason='STATE_CHANGED';RETURN;END;
        IF (@employee IS NULL AND (@kind<>'EMAIL' OR @email IS NULL OR @personEmail IS NULL OR @email<>@personEmail))
            OR (@employee IS NOT NULL AND (@kind<>'EMPLOYEE' OR @recipient IS NULL OR @recipient<>@employee)) SET @Reason='RECIPIENT_MISMATCH';
        RETURN;
    END;
    IF @template='TEMP_ID_MANAGER_NOTICE'
    BEGIN
        IF @type<>'TEMP_ID' OR @kind<>'MANAGER' OR @recipient IS NULL OR @recipient<>@employee SET @Reason='RECIPIENT_MISMATCH';RETURN;
    END;
    IF @template='VISIT_DECIDED'
    BEGIN
        IF @state NOT IN('APPROVED','DENIED') OR NOT EXISTS(SELECT 1 FROM gp.ApprovalDecisions WHERE VisitRequestId=@visit AND Decision=@state)
            OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.visitRequestId')) IS NULL OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.visitRequestId'))<>@visit
            OR JSON_VALUE(@payload,'$.decision') IS NULL OR JSON_VALUE(@payload,'$.decision')<>@state BEGIN SET @Reason='STATE_CHANGED';RETURN;END;
        IF (@employee IS NULL AND (@kind<>'EMAIL' OR @email IS NULL OR @personEmail IS NULL OR @email<>@personEmail))
            OR (@employee IS NOT NULL AND (@kind<>'EMPLOYEE' OR @recipient IS NULL OR @recipient<>@employee)) SET @Reason='RECIPIENT_MISMATCH';RETURN;
    END;
    IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@location AND IsActive=1) BEGIN SET @Reason='TARGET_INACTIVE';RETURN;END;
    IF @pair IS NOT NULL
    BEGIN
        SELECT @project=pl.ProjectId FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE pl.ProjectLocationId=@pair AND pl.IsActive=1 AND p.IsActive=1;
        IF @project IS NULL BEGIN SET @Reason='TARGET_INACTIVE';RETURN;END;
    END;
    IF @template='HOST_APPROVAL_REQUEST'
    BEGIN
        IF @state<>'PENDING' OR @deadline IS NULL OR @Now>=@deadline OR @Now>=@end BEGIN SET @Reason='STATE_CHANGED';RETURN;END;
        IF @kind<>'EMPLOYEE' OR @recipient IS NULL OR @recipient<>@host BEGIN SET @Reason='RECIPIENT_MISMATCH';RETURN;END;
        EXEC gp._DirectoryCutoff @Now,@cutoff OUTPUT;
        IF NOT EXISTS(SELECT 1 FROM gp.Employees WHERE EmployeeId=@host AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @Now)
            OR gp._EmployeeProjectLocationEligible(@host,@pair,@cutoff,@Now)=0
            THROW 52004,'Current host directory data must be verified.',1;
        RETURN;
    END;
    IF @state<>'APPROVED' OR @Now>=@end OR @link IS NULL BEGIN SET @Reason='STATE_CHANGED';RETURN;END;
    DECLARE @linkEmail nvarchar(320);
    SELECT @linkEmail=l.RecipientEmail FROM gp.PassDeliveryLinks l JOIN gp.AccessPasses p ON p.AccessPassId=l.AccessPassId AND p.VisitRequestId=l.VisitRequestId
        WHERE l.DeliveryLinkId=@link AND l.VisitRequestId=@visit AND l.RevokedAtUtc IS NULL AND @Now<l.ExpiresAtUtc AND p.IsCurrent=1 AND p.Status='ACTIVE';
    IF @linkEmail IS NULL BEGIN SET @Reason='LINK_UNAVAILABLE';RETURN;END;
    IF @employee IS NULL
    BEGIN
        IF @kind<>'EMAIL' OR @email IS NULL OR @personEmail IS NULL OR @email<>@linkEmail OR @email<>@personEmail SET @Reason='RECIPIENT_MISMATCH';RETURN;
    END;
    EXEC gp._DirectoryCutoff @Now,@cutoff OUTPUT;DECLARE @official nvarchar(320);
    SELECT @official=OfficialEmail FROM gp.Employees WHERE EmployeeId=@employee AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @Now;
    IF @type='TEMP_ID' AND gp._EmployeeOfficeEligible(@employee,@location,@cutoff,@Now)=0 THROW 52004,'Current employee office data must be verified.',1;
    IF @official IS NULL THROW 52004,'Current employee directory data must be verified.',1;
    IF @kind<>'EMPLOYEE' OR @recipient IS NULL OR @recipient<>@employee OR @linkEmail<>@official SET @Reason='RECIPIENT_MISMATCH';
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('049',N'Employee office revalidation for card lifecycle');COMMIT;
