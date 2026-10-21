/* Email-driven self-service and notification content. No dashboard or automatic GET decisions. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54100,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='060') THROW 54100,'Migration 060 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='061') THROW 54100,'Migration 061 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.SubmitRegistration
    @IntakeId uniqueidentifier,@TokenHash varbinary(8000),@IntakeCsrfHash varbinary(8000),@ClientKey uniqueidentifier,
    @RequestType varchar(8000),@LocationId int,@Reason nvarchar(max),@PeopleJson nvarchar(max),
    @ProjectLocationId bigint=NULL,@HostEmployeeId nvarchar(max)=NULL,@TemporaryIdReason varchar(8000)=NULL,
    @ValidFromUtc datetime2(3)=NULL,@ValidUntilUtc datetime2(3)=NULL,@CredentialsJson nvarchar(max)=NULL,
    @SessionHash varbinary(8000)=NULL,@CsrfHash varbinary(8000)=NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52700,'Ambient transaction not accepted.',1;
    IF @RequestType IS NULL OR DATALENGTH(@RequestType)<>LEN(@RequestType) OR @RequestType COLLATE Latin1_General_100_BIN2 NOT IN('TEMP_ID','EMPLOYEE_PROJECT','EXTERNAL')
       OR @LocationId IS NULL OR @Reason IS NULL OR DATALENGTH(@Reason) NOT BETWEEN 2 AND 2000 OR LEN(LTRIM(RTRIM(@Reason)))=0
       OR @ClientKey IS NULL OR @PeopleJson IS NULL OR DATALENGTH(@PeopleJson)>262144 OR ISJSON(@PeopleJson)<>1 OR LEFT(LTRIM(@PeopleJson),1)<>'['
       OR (@CredentialsJson IS NOT NULL AND (DATALENGTH(@CredentialsJson)>524288 OR ISJSON(@CredentialsJson)<>1 OR LEFT(LTRIM(@CredentialsJson),1)<>'['))
       OR DATALENGTH(@HostEmployeeId)>128 THROW 52702,'Invalid submission input.',1;
    -- Parse unbounded text first; fixed SQL widths must never silently truncate input.
    IF EXISTS(SELECT 1 FROM OPENJSON(@PeopleJson) WHERE type<>5) THROW 52702,'People must be objects.',1;
    IF EXISTS(SELECT 1 FROM OPENJSON(@PeopleJson) x CROSS APPLY OPENJSON(x.value) p
       WHERE p.[key] COLLATE Latin1_General_100_BIN2 NOT IN('clientPersonKey','photoAssetId','personName','personEmail','personPhone') OR p.type NOT IN(0,1)) THROW 52702,'Invalid person properties.',1;
    -- Check the original unbounded property names before narrowing known names.
    DECLARE @personProperties table(PersonOrdinal int,PropertyName nvarchar(32) COLLATE Latin1_General_100_BIN2);
    INSERT @personProperties SELECT CONVERT(int,x.[key]),CONVERT(nvarchar(32),p.[key]) FROM OPENJSON(@PeopleJson) x CROSS APPLY OPENJSON(x.value) p;
    IF EXISTS(SELECT 1 FROM @personProperties GROUP BY PersonOrdinal,PropertyName HAVING COUNT(*)>1) THROW 52702,'Invalid person properties.',1;
    DECLARE @raw table(PersonKey nvarchar(max),PhotoId nvarchar(max),PersonName nvarchar(max),Email nvarchar(max),Phone nvarchar(max));
    INSERT @raw SELECT clientPersonKey,photoAssetId,personName,personEmail,personPhone FROM OPENJSON(@PeopleJson)
        WITH(clientPersonKey nvarchar(max),photoAssetId nvarchar(max),personName nvarchar(max),personEmail nvarchar(max),personPhone nvarchar(max));
    IF NOT EXISTS(SELECT 1 FROM @raw) OR EXISTS(SELECT 1 FROM @raw WHERE LEN(PersonKey)<>36 OR DATALENGTH(PersonKey)<>72 OR TRY_CONVERT(uniqueidentifier,PersonKey) IS NULL
        OR LEN(PhotoId)<>36 OR DATALENGTH(PhotoId)<>72 OR TRY_CONVERT(uniqueidentifier,PhotoId) IS NULL
        OR PersonKey IS NULL OR PhotoId IS NULL OR DATALENGTH(PersonName)>400 OR DATALENGTH(Email)>640 OR DATALENGTH(Phone)>60
        OR (PersonName IS NOT NULL AND LEN(LTRIM(RTRIM(PersonName)))=0)
        OR (Email IS NOT NULL AND (Email NOT LIKE N'%_@_%._%' OR Email LIKE N'% %' OR CHARINDEX(NCHAR(13),Email)>0 OR CHARINDEX(NCHAR(10),Email)>0 OR CHARINDEX(NCHAR(9),Email)>0))
        OR (Phone IS NOT NULL AND (LEN(LTRIM(RTRIM(Phone)))=0 OR CHARINDEX(NCHAR(13),Phone)>0 OR CHARINDEX(NCHAR(10),Phone)>0)))
        THROW 52702,'Invalid person identity/contact.',1;
    DECLARE @people table(PersonKey uniqueidentifier,PhotoId uniqueidentifier,PersonName nvarchar(200),Email nvarchar(320),Phone nvarchar(30));
    INSERT @people SELECT TRY_CONVERT(uniqueidentifier,PersonKey),TRY_CONVERT(uniqueidentifier,PhotoId),PersonName,Email,Phone FROM @raw;
    IF EXISTS(SELECT PersonKey FROM @people GROUP BY PersonKey HAVING COUNT(*)>1) OR EXISTS(SELECT PhotoId FROM @people GROUP BY PhotoId HAVING COUNT(*)>1)
        THROW 52702,'Duplicate person/photo in intake.',1;
    DECLARE @actor uniqueidentifier,@type varchar(12),@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@binding varbinary(32),@payload nvarchar(max),@payloadHash varbinary(32),
        @max int,@horizon int,@employee nvarchar(64),@employeeName nvarchar(200),@employeeEmail nvarchar(320),@cutoff datetime2(3),@project bigint,@day date,
        @start datetime2(3),@end datetime2(3),@oldPayload varbinary(32),@oldResult nvarchar(max),@result nvarchar(max),@reuse uniqueidentifier;
    DECLARE @results table(PersonKey uniqueidentifier,VisitId uniqueidentifier,PassId uniqueidentifier,PublicReference varchar(40),PassNumber varchar(50),Status varchar(12),Reused bit);
    BEGIN TRY
        BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequireRegistrationIntake @IntakeId,@TokenHash,@IntakeCsrfHash,@SessionHash,@CsrfHash,@actor OUTPUT,@type OUTPUT,@now OUTPUT;
        IF (@type='PUBLIC' AND @RequestType<>'EXTERNAL') OR (@type='EMPLOYEE' AND @RequestType='EXTERNAL') THROW 52701,'Intake identity does not match request type.',1;
        IF @RequestType<>'EXTERNAL'
        BEGIN
            IF (SELECT COUNT(*) FROM @people)<>1 OR EXISTS(SELECT 1 FROM @people WHERE PersonName IS NOT NULL OR Email IS NOT NULL OR Phone IS NOT NULL)
                THROW 52702,'Employee identity must come from the authenticated directory.',1;
            EXEC gp._RequireRegistrationEmployee @actor,@now,@employee OUTPUT,@employeeName OUTPUT,@employeeEmail OUTPUT;
        END
        ELSE IF EXISTS(SELECT 1 FROM @people WHERE PersonName IS NULL) THROW 52702,'Visitor name required.',1;
        IF @RequestType='TEMP_ID'
        BEGIN
            IF @ProjectLocationId IS NOT NULL OR @HostEmployeeId IS NOT NULL OR @ValidFromUtc IS NOT NULL OR @ValidUntilUtc IS NOT NULL
               OR @TemporaryIdReason IS NULL OR DATALENGTH(@TemporaryIdReason)<>LEN(@TemporaryIdReason) OR @TemporaryIdReason COLLATE Latin1_General_100_BIN2 NOT IN('FORGOT','LOST','OTHER') THROW 52702,'Invalid Digital ID scope/reason.',1;
        END
        ELSE IF @ProjectLocationId IS NULL OR @HostEmployeeId IS NULL OR LEN(LTRIM(RTRIM(@HostEmployeeId)))=0
            OR @TemporaryIdReason IS NOT NULL OR @ValidFromUtc IS NULL OR @ValidUntilUtc IS NULL OR @ValidFromUtc>=@ValidUntilUtc
            THROW 52702,'Project host/window required.',1;
        EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
        IF @RequestType='TEMP_ID' AND gp._EmployeeOfficeEligible(@employee,@LocationId,@cutoff,@now)=0 THROW 52701,'Employee is not assigned to this office.',1;
        IF @RequestType<>'TEMP_ID' AND gp._EmployeeProjectLocationEligible(@HostEmployeeId,@ProjectLocationId,@cutoff,@now)=0 THROW 52701,'Host is not assigned to the requested project office.',1;
        IF @RequestType='EMPLOYEE_PROJECT' AND CONVERT(date,DATEADD(minute,330,@ValidFromUtc))<>CONVERT(date,DATEADD(minute,330,@now)) THROW 52702,'Employee requests are for today only.',1;
        SET @payload=(SELECT 1 contractVersion,@IntakeId intakeId,@RequestType requestType,@employee employeeId,@LocationId locationId,
            @ProjectLocationId projectLocationId,@HostEmployeeId hostEmployeeId,@Reason reason,@TemporaryIdReason temporaryIdReason,
            CONVERT(char(23),@ValidFromUtc,126) validFromUtc,CONVERT(char(23),@ValidUntilUtc,126) validUntilUtc,
            JSON_QUERY((SELECT PersonKey clientPersonKey,PhotoId photoAssetId,PersonName personName,Email personEmail,Phone personPhone
                FROM @people ORDER BY LOWER(CONVERT(char(36),PersonKey)) COLLATE Latin1_General_100_BIN2 FOR JSON PATH,INCLUDE_NULL_VALUES)) people
            FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
        SET @payloadHash=HASHBYTES('SHA2_256',@payload);
        SET @binding=CASE WHEN @actor IS NULL THEN HASHBYTES('SHA2_256',CONVERT(varbinary(max),'PUBLIC_REGISTRATION:')+@TokenHash) ELSE HASHBYTES('SHA2_256',CONVERT(binary(16),@actor)) END;
        EXEC gp._BeginRegistrationOperation @binding,@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
        DECLARE @resource nvarchar(255)=N'gp:intake:'+LOWER(CONVERT(char(36),@IntakeId)); EXEC gp._TakeLock @resource;
        EXEC gp._RequireRegistrationIntake @IntakeId,@TokenHash,@IntakeCsrfHash,@SessionHash,@CsrfHash,@actor OUTPUT,@type OUTPUT,@now OUTPUT;
        SELECT @oldPayload=SubmittedPayloadHash,@oldResult=SubmissionResultJson FROM gp.RegistrationIntakeAccess WHERE IntakeId=@IntakeId;
        EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
        IF @RequestType='TEMP_ID' AND gp._EmployeeOfficeEligible(@employee,@LocationId,@cutoff,@now)=0 THROW 52701,'Employee office entitlement unavailable.',1;
        IF @RequestType<>'TEMP_ID' AND gp._EmployeeProjectLocationEligible(@HostEmployeeId,@ProjectLocationId,@cutoff,@now)=0 THROW 52701,'Host office entitlement unavailable.',1;
        IF @oldPayload IS NOT NULL
        BEGIN
            IF @oldPayload<>@payloadHash THROW 52703,'Submitted intake is immutable.',1;
            IF @cached IS NULL EXEC gp._CompleteOperation @op,@oldResult;
            COMMIT; SELECT @oldResult; RETURN;
        END;
        IF @cached IS NOT NULL OR NOT EXISTS(SELECT 1 FROM gp.RegistrationIntakes WHERE IntakeId=@IntakeId AND Status='DRAFT') THROW 52705,'Intake cannot be submitted.',1;
        SELECT @max=TRY_CONVERT(int,value) FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.MaxPeoplePerIntake';
        SELECT @horizon=TRY_CONVERT(int,value) FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.FutureVisitHorizonDays';
        IF @max IS NULL OR @max NOT BETWEEN 1 AND 50 OR @horizon IS NULL OR @horizon NOT BETWEEN 0 AND 90 THROW 52704,'Registration policy unavailable.',1;
        IF (SELECT COUNT(*) FROM @people)>@max THROW 52702,'Too many people in intake.',1;
        IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId AND IsActive=1) THROW 52704,'Target unavailable.',1;
        IF EXISTS(SELECT 1 FROM @people p WHERE NOT EXISTS(SELECT 1 FROM gp.PhotoAssets a WHERE a.PhotoAssetId=p.PhotoId AND a.IntakeId=@IntakeId
            AND a.PurgedAtUtc IS NULL AND a.StorageKey IS NOT NULL AND a.CapturedAtUtc<=@now) OR EXISTS(SELECT 1 FROM gp.VisitRequests v WHERE v.PhotoAssetId=p.PhotoId))
            THROW 52701,'Photo is not available to this intake.',1;
        SET @day=CASE WHEN @RequestType='TEMP_ID' THEN CONVERT(date,DATEADD(minute,330,@now)) ELSE CONVERT(date,DATEADD(minute,330,@ValidFromUtc)) END;
        SET @start=CASE WHEN @RequestType='TEMP_ID' THEN @now ELSE @ValidFromUtc END;
        SET @end=CASE WHEN @RequestType='TEMP_ID' THEN DATEADD(minute,-330,DATEADD(day,1,CONVERT(datetime2(3),@day))) ELSE @ValidUntilUtc END;
        IF @day<CONVERT(date,DATEADD(minute,330,@now)) OR @day>DATEADD(day,@horizon,CONVERT(date,DATEADD(minute,330,@now)))
            OR @end<=@now OR @end>DATEADD(minute,-330,DATEADD(day,1,CONVERT(datetime2(3),@day))) THROW 52702,'Invalid same-day visit window.',1;
        IF @RequestType<>'TEMP_ID'
        BEGIN
            SELECT @project=pl.ProjectId FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
                WHERE pl.ProjectLocationId=@ProjectLocationId AND pl.LocationId=@LocationId AND pl.IsActive=1 AND p.IsActive=1;
            IF @project IS NULL THROW 52704,'Project unavailable at location.',1;
        END;
        IF @employee IS NOT NULL
        BEGIN
            SET @resource=N'gp:employee-day:'+CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(nvarchar(max),@employee)+N'|'+CONVERT(nvarchar(12),@LocationId)+N'|'+CONVERT(nvarchar(10),@day,23)),2);
            EXEC gp._TakeLock @resource;
            EXEC gp._RequireRegistrationIntake @IntakeId,@TokenHash,@IntakeCsrfHash,@SessionHash,@CsrfHash,@actor OUTPUT,@type OUTPUT,@now OUTPUT;
            IF @RequestType='TEMP_ID' AND @day<>CONVERT(date,DATEADD(minute,330,@now)) THROW 52706,'Local day changed; retry.',1;
            IF @RequestType='TEMP_ID'
                SELECT @reuse=VisitRequestId FROM gp.TemporaryIdSlots WHERE EmployeeId=@employee AND LocationId=@LocationId AND LocalVisitDate=@day;
            ELSE
            BEGIN
                -- A cancelled credential does not mean the person has left the project.
                IF EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
                    WHERE v.EmployeeId=@employee AND v.ProjectLocationId=@ProjectLocationId AND v.RequestType='EMPLOYEE_PROJECT'
                    AND v.Status='CANCELLED' AND s.IsInside=1 AND v.ValidFromUtc<@end AND @start<v.ValidUntilUtc)
                    THROW 52705,'Existing cancelled occupant requires departure/reconciliation.',1;
                IF (SELECT COUNT(*) FROM gp.VisitRequests WHERE EmployeeId=@employee AND ProjectLocationId=@ProjectLocationId AND RequestType='EMPLOYEE_PROJECT'
                    AND Status IN('PENDING','APPROVED') AND ValidFromUtc<@end AND @start<ValidUntilUtc)>1 THROW 52703,'Conflicting existing requests.',1;
                SELECT @reuse=VisitRequestId FROM gp.VisitRequests WHERE EmployeeId=@employee AND ProjectLocationId=@ProjectLocationId AND RequestType='EMPLOYEE_PROJECT'
                    AND Status IN('PENDING','APPROVED') AND ValidFromUtc<@end AND @start<ValidUntilUtc;
            END;
            IF @reuse IS NOT NULL
            BEGIN
                SET @resource=N'gp:visit:'+LOWER(CONVERT(char(36),@reuse)); EXEC gp._TakeLock @resource;
                EXEC gp._RequireRegistrationIntake @IntakeId,@TokenHash,@IntakeCsrfHash,@SessionHash,@CsrfHash,@actor OUTPUT,@type OUTPUT,@now OUTPUT;
                IF @RequestType='TEMP_ID' AND @day<>CONVERT(date,DATEADD(minute,330,@now)) THROW 52706,'Local day changed; retry.',1;
                IF @RequestType='TEMP_ID'
                BEGIN
                    IF EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId
                        JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId WHERE v.VisitRequestId=@reuse AND v.Status='APPROVED' AND p.IsCurrent=1 AND p.Status='ACTIVE'
                        AND v.ValidFromUtc<=@now AND @now<v.ValidUntilUtc AND v.PersonalDataPurgedAtUtc IS NULL AND a.PurgedAtUtc IS NULL AND a.StorageKey IS NOT NULL)
                        INSERT @results SELECT n.PersonKey,v.VisitRequestId,p.AccessPassId,v.PublicReference,p.PublicPassNumber,v.Status,1 FROM @people n
                            CROSS JOIN gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 WHERE v.VisitRequestId=@reuse;
                    ELSE
                    BEGIN
                        IF EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence WHERE VisitRequestId=@reuse AND IsInside=1) THROW 52705,'Existing project occupants require departure/reconciliation.',1;
                        IF NOT EXISTS(SELECT 1 FROM gp.VisitPresence WHERE VisitRequestId=@reuse AND IsInside=0) THROW 52705,'Existing occupant requires departure/reconciliation.',1;
                        IF NOT EXISTS(SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId=@reuse AND (Status='CANCELLED' OR ValidUntilUtc<=@now))
                            THROW 52705,'Existing Digital ID requires explicit reissue.',1;
                        SET @reuse=NULL;
                    END;
                END
                ELSE
                BEGIN
                    IF NOT EXISTS(SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId=@reuse AND Status IN('PENDING','APPROVED') AND ValidFromUtc<@end AND @start<ValidUntilUtc) SET @reuse=NULL;
                    IF @reuse IS NOT NULL
                    BEGIN
                    IF EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId
                        CROSS JOIN @people n JOIN gp.PhotoAssets np ON np.PhotoAssetId=n.PhotoId
                        WHERE v.VisitRequestId=@reuse AND v.Status IN('PENDING','APPROVED') AND v.HostEmployeeId=@HostEmployeeId
                        AND v.Reason=@Reason COLLATE Latin1_General_100_BIN2 AND DATALENGTH(v.Reason)=DATALENGTH(@Reason)
                        AND v.ValidFromUtc=@start AND v.ValidUntilUtc=@end AND v.PersonalDataPurgedAtUtc IS NULL AND a.ContentHash=np.ContentHash
                        AND a.PurgedAtUtc IS NULL AND EXISTS(SELECT 1 FROM gp.AccessPasses WHERE VisitRequestId=v.VisitRequestId AND IsCurrent=1 AND Status IN('PENDING','ACTIVE')))
                        INSERT @results SELECT n.PersonKey,v.VisitRequestId,p.AccessPassId,v.PublicReference,p.PublicPassNumber,v.Status,1 FROM @people n
                            CROSS JOIN gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 WHERE v.VisitRequestId=@reuse;
                    ELSE THROW 52703,'Employee project window overlaps an existing request.',1;
                    END;
                END;
            END;
        END;
        -- Recheck freshness after lock waits. No directory/key network call occurs here.
        SET @now=SYSUTCDATETIME(); EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
        IF @actor IS NOT NULL EXEC gp._RequireRegistrationEmployee @actor,@now,@employee OUTPUT,@employeeName OUTPUT,@employeeEmail OUTPUT;
        IF @RequestType='TEMP_ID' AND gp._EmployeeOfficeEligible(@employee,@LocationId,@cutoff,@now)=0 THROW 52701,'Employee office entitlement unavailable.',1;
        IF @RequestType<>'TEMP_ID' AND (NOT EXISTS(SELECT 1 FROM gp.Employees e LEFT JOIN gp.Users u ON u.UserId=e.UserId
                WHERE e.EmployeeId=@HostEmployeeId AND e.IsActive=1 AND e.LastSyncedAtUtc BETWEEN @cutoff AND @now AND (e.UserId IS NULL OR u.IsActive=1))
            OR gp._EmployeeProjectLocationEligible(@HostEmployeeId,@ProjectLocationId,@cutoff,@now)=0
            OR NOT EXISTS(SELECT 1 FROM gp.Projects WHERE ProjectId=@project AND LastSyncedAtUtc BETWEEN @cutoff AND @now)) THROW 52704,'Current host/project directory required.',1;
        IF NOT EXISTS(SELECT 1 FROM @results)
        BEGIN
            IF @CredentialsJson IS NULL
            BEGIN
                -- Durable state is untouched. Resolve retries/reuse before asking for keys.
                SET @result=N'{"status":"NEEDS_CREDENTIALS"}'; ROLLBACK; SELECT @result; RETURN;
            END;
            IF EXISTS(SELECT 1 FROM OPENJSON(@CredentialsJson) WHERE type<>5) THROW 52702,'Invalid credential envelope.',1;
            IF EXISTS(SELECT 1 FROM OPENJSON(@CredentialsJson) x CROSS APPLY OPENJSON(x.value) p WHERE p.type<>1
                OR p.[key] COLLATE Latin1_General_100_BIN2 NOT IN('clientPersonKey','visitRequestId','accessPassId','credentialHash','ciphertext','nonce','authenticationTag','keyVersion'))
                
                THROW 52702,'Invalid credential properties.',1;
            DECLARE @credentialProperties table(PersonOrdinal int,PropertyName nvarchar(32) COLLATE Latin1_General_100_BIN2);
            INSERT @credentialProperties SELECT CONVERT(int,x.[key]),CONVERT(nvarchar(32),p.[key]) FROM OPENJSON(@CredentialsJson) x CROSS APPLY OPENJSON(x.value) p;
            IF EXISTS(SELECT 1 FROM @credentialProperties GROUP BY PersonOrdinal,PropertyName HAVING COUNT(*)>1) THROW 52702,'Invalid credential properties.',1;
            DECLARE @rawCredentials table(PersonKey nvarchar(max),VisitId nvarchar(max),PassId nvarchar(max),Credential nvarchar(max),Cipher nvarchar(max),Nonce nvarchar(max),Tag nvarchar(max),KeyVersion nvarchar(max));
            INSERT @rawCredentials SELECT clientPersonKey,visitRequestId,accessPassId,credentialHash,ciphertext,nonce,authenticationTag,keyVersion FROM OPENJSON(@CredentialsJson)
                WITH(clientPersonKey nvarchar(max),visitRequestId nvarchar(max),accessPassId nvarchar(max),credentialHash nvarchar(max),ciphertext nvarchar(max),nonce nvarchar(max),authenticationTag nvarchar(max),keyVersion nvarchar(max));
            IF (SELECT COUNT(*) FROM @rawCredentials)<>(SELECT COUNT(*) FROM @people) OR EXISTS(SELECT 1 FROM @rawCredentials WHERE
                PersonKey IS NULL OR LEN(PersonKey)<>36 OR DATALENGTH(PersonKey)<>72 OR TRY_CONVERT(uniqueidentifier,PersonKey) IS NULL
                OR VisitId IS NULL OR LEN(VisitId)<>36 OR DATALENGTH(VisitId)<>72 OR TRY_CONVERT(uniqueidentifier,VisitId) IS NULL
                OR PassId IS NULL OR LEN(PassId)<>36 OR DATALENGTH(PassId)<>72 OR TRY_CONVERT(uniqueidentifier,PassId) IS NULL
                OR Credential IS NULL OR DATALENGTH(Credential)<>128 OR TRY_CONVERT(varbinary(32),Credential,2) IS NULL
                OR Cipher IS NULL OR DATALENGTH(Cipher)<>128 OR TRY_CONVERT(varbinary(32),Cipher,2) IS NULL
                OR Nonce IS NULL OR DATALENGTH(Nonce)<>48 OR TRY_CONVERT(varbinary(12),Nonce,2) IS NULL
                OR Tag IS NULL OR DATALENGTH(Tag)<>64 OR TRY_CONVERT(varbinary(16),Tag,2) IS NULL
                OR KeyVersion IS NULL OR DATALENGTH(KeyVersion) NOT BETWEEN 14 AND 172 OR KeyVersion COLLATE Latin1_General_100_BIN2 NOT LIKE N'qr.v1.[A-Za-z0-9_-]%'
                OR KeyVersion COLLATE Latin1_General_100_BIN2 LIKE N'%[^-A-Za-z0-9._]%' OR DATALENGTH(KeyVersion)<>LEN(KeyVersion)*2)
                THROW 52702,'Invalid credential envelope size/encoding.',1;
            DECLARE @credentials table(PersonKey uniqueidentifier,VisitId uniqueidentifier,PassId uniqueidentifier,Credential varbinary(32),Cipher varbinary(32),Nonce varbinary(12),Tag varbinary(16),KeyVersion varchar(100));
            INSERT @credentials SELECT TRY_CONVERT(uniqueidentifier,PersonKey),TRY_CONVERT(uniqueidentifier,VisitId),TRY_CONVERT(uniqueidentifier,PassId),
                TRY_CONVERT(varbinary(32),Credential,2),TRY_CONVERT(varbinary(32),Cipher,2),TRY_CONVERT(varbinary(12),Nonce,2),TRY_CONVERT(varbinary(16),Tag,2),KeyVersion FROM @rawCredentials;
            IF EXISTS(SELECT 1 FROM @people p WHERE (SELECT COUNT(*) FROM @credentials c WHERE c.PersonKey=p.PersonKey)<>1)
                OR EXISTS(SELECT VisitId FROM @credentials GROUP BY VisitId HAVING COUNT(*)>1) OR EXISTS(SELECT PassId FROM @credentials GROUP BY PassId HAVING COUNT(*)>1)
                THROW 52702,'Credential/person mapping differs.',1;
            DECLARE @visit uniqueidentifier,@pass uniqueidentifier,@personKey uniqueidentifier,@photo uniqueidentifier,@personName nvarchar(200),@email nvarchar(320),@phone nvarchar(30),
                @credential varbinary(32),@cipher varbinary(32),@nonce varbinary(12),@tag varbinary(16),@keyVersion varchar(100),@snapshot nvarchar(max),@snapshotHash varbinary(32),@photoHash varbinary(32),
                @status varchar(12)=CASE WHEN @RequestType='TEMP_ID' THEN 'APPROVED' ELSE 'PENDING' END,@reference varchar(40),@passNumber varchar(50),@notice nvarchar(max);
            DECLARE lockVisits CURSOR LOCAL FAST_FORWARD FOR SELECT VisitId FROM @credentials ORDER BY LOWER(CONVERT(char(36),VisitId)) COLLATE Latin1_General_100_BIN2;
            OPEN lockVisits; FETCH NEXT FROM lockVisits INTO @visit;
            WHILE @@FETCH_STATUS=0
            BEGIN
                SET @resource=N'gp:visit:'+LOWER(CONVERT(char(36),@visit)); EXEC gp._TakeLock @resource;
                FETCH NEXT FROM lockVisits INTO @visit;
            END;
            CLOSE lockVisits; DEALLOCATE lockVisits;
            EXEC gp._RequireRegistrationIntake @IntakeId,@TokenHash,@IntakeCsrfHash,@SessionHash,@CsrfHash,@actor OUTPUT,@type OUTPUT,@now OUTPUT;
            EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
            IF @RequestType='TEMP_ID'
            BEGIN
                IF @day<>CONVERT(date,DATEADD(minute,330,@now)) THROW 52706,'Local day changed; retry.',1;
                SET @start=@now;
            END;
            IF @now>=@end THROW 52702,'Visit window expired.',1;
            IF @RequestType<>'TEMP_ID' AND (NOT EXISTS(SELECT 1 FROM gp.Employees WHERE EmployeeId=@HostEmployeeId AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @now)
                OR gp._EmployeeProjectLocationEligible(@HostEmployeeId,@ProjectLocationId,@cutoff,@now)=0
                OR NOT EXISTS(SELECT 1 FROM gp.Projects WHERE ProjectId=@project AND LastSyncedAtUtc BETWEEN @cutoff AND @now)) THROW 52704,'Current host/project directory required.',1;
            DECLARE createVisits CURSOR LOCAL FAST_FORWARD FOR SELECT n.PersonKey,n.PhotoId,
                CASE WHEN @employee IS NULL THEN n.PersonName ELSE @employeeName END,CASE WHEN @employee IS NULL THEN n.Email ELSE @employeeEmail END,n.Phone,
                c.VisitId,c.PassId,c.Credential,c.Cipher,c.Nonce,c.Tag,c.KeyVersion,a.ContentHash FROM @people n
                JOIN @credentials c ON c.PersonKey=n.PersonKey JOIN gp.PhotoAssets a ON a.PhotoAssetId=n.PhotoId
                ORDER BY LOWER(CONVERT(char(36),c.VisitId)) COLLATE Latin1_General_100_BIN2;
            OPEN createVisits;
            FETCH NEXT FROM createVisits INTO @personKey,@photo,@personName,@email,@phone,@visit,@pass,@credential,@cipher,@nonce,@tag,@keyVersion,@photoHash;
            WHILE @@FETCH_STATUS=0
            BEGIN
                SET @reference='V-'+REPLACE(LOWER(CONVERT(char(36),@visit)),'-',''); SET @passNumber='GP-'+REPLACE(LOWER(CONVERT(char(36),@pass)),'-','');
                INSERT gp.VisitRequests(VisitRequestId,PublicReference,IntakeId,ClientPersonKey,RequestType,EmployeeId,PersonName,PersonEmail,PersonPhone,PhotoAssetId,
                    LocationId,ProjectLocationId,HostEmployeeId,Reason,TemporaryIdReason,Status,LocalVisitDate,ValidFromUtc,ValidUntilUtc,ApprovalDeadlineUtc,SnapshotHash,DecisionAtUtc,SubmittedAtUtc)
                    VALUES(@visit,@reference,@IntakeId,@personKey,@RequestType,@employee,@personName,@email,@phone,@photo,@LocationId,@ProjectLocationId,@HostEmployeeId,@Reason,
                        @TemporaryIdReason,@status,@day,@start,@end,CASE WHEN @RequestType='TEMP_ID' THEN NULL ELSE @end END,HASHBYTES('SHA2_256',CONVERT(binary(16),@visit)),CASE WHEN @RequestType='TEMP_ID' THEN @now END,@now);
                -- Derive the immutable digest from the typed persisted row, before any
                -- dependent approval/pass/outbox rows exist. The initial non-null hash
                -- is transaction-local; no caller can observe the intermediate state.
                SET @snapshot=(SELECT v.SnapshotVersion snapshotVersion,v.RequestType requestType,v.EmployeeId employeeId,
                    v.PersonName personName,v.PersonEmail personEmail,v.PersonPhone personPhone,v.PhotoAssetId photoAssetId,
                    CONVERT(varchar(64),a.ContentHash,2) photoContentHash,v.LocationId locationId,v.ProjectLocationId projectLocationId,
                    v.HostEmployeeId hostEmployeeId,v.Reason reason,v.TemporaryIdReason temporaryIdReason,
                    REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,
                    REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc
                    FROM gp.VisitRequests v JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId WHERE v.VisitRequestId=@visit
                    FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
                SET @snapshotHash=HASHBYTES('SHA2_256',@snapshot);
                UPDATE gp.VisitRequests SET SnapshotHash=@snapshotHash WHERE VisitRequestId=@visit;
                INSERT gp.AccessPasses(AccessPassId,VisitRequestId,PassVersion,PublicPassNumber,CredentialHash,Status)
                    VALUES(@pass,@visit,1,@passNumber,@credential,CASE WHEN @RequestType='TEMP_ID' THEN 'ACTIVE' ELSE 'PENDING' END);
                INSERT gp.PassSecrets(AccessPassId,Ciphertext,Nonce,AuthenticationTag,KeyVersion) VALUES(@pass,@cipher,@nonce,@tag,@keyVersion);
                INSERT gp.VisitPresence(VisitRequestId) VALUES(@visit);
                SET @notice=(SELECT @visit visitRequestId,@RequestType requestType,1 snapshotVersion,CONVERT(varchar(64),@snapshotHash,2) snapshotHash FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
                INSERT gp.NotificationOutbox(VisitRequestId,RecipientKind,RecipientEmployeeId,TemplateCode,PayloadJson,DedupeHash)
                    VALUES(@visit,CASE WHEN @RequestType='TEMP_ID' THEN 'MANAGER' ELSE 'EMPLOYEE' END,CASE WHEN @RequestType='TEMP_ID' THEN @employee ELSE @HostEmployeeId END,
                        CASE WHEN @RequestType='TEMP_ID' THEN 'TEMP_ID_MANAGER_NOTICE' ELSE 'HOST_APPROVAL_REQUEST' END,@notice,HASHBYTES('SHA2_256',CONVERT(char(36),@visit)+':INITIAL_NOTICE'));
                INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson)
                    VALUES(@actor,'VISIT_REGISTERED','VISIT',CONVERT(varchar(36),@visit),@LocationId,@ProjectLocationId,'SUCCESS',@notice);
                IF @RequestType<>'EXTERNAL' OR @email IS NOT NULL
                    INSERT gp.NotificationOutbox(VisitRequestId,RecipientKind,RecipientEmployeeId,RecipientEmail,TemplateCode,PayloadJson,DedupeHash)
                    VALUES(@visit,CASE WHEN @RequestType='EXTERNAL' THEN 'EMAIL' ELSE 'EMPLOYEE' END,CASE WHEN @RequestType='EXTERNAL' THEN NULL ELSE @employee END,@email,
                    'REQUEST_RECEIVED',@notice,HASHBYTES('SHA2_256',CONVERT(char(36),@visit)+':REQUEST_RECEIVED'));
                INSERT @results VALUES(@personKey,@visit,@pass,@reference,@passNumber,@status,0);
                IF @RequestType='TEMP_ID'
                BEGIN
                    UPDATE gp.TemporaryIdSlots SET VisitRequestId=@visit WHERE EmployeeId=@employee AND LocationId=@LocationId AND LocalVisitDate=@day;
                    IF @@ROWCOUNT=0 INSERT gp.TemporaryIdSlots(EmployeeId,LocationId,LocalVisitDate,VisitRequestId) VALUES(@employee,@LocationId,@day,@visit);
                END;
                FETCH NEXT FROM createVisits INTO @personKey,@photo,@personName,@email,@phone,@visit,@pass,@credential,@cipher,@nonce,@tag,@keyVersion,@photoHash;
            END;
            CLOSE createVisits; DEALLOCATE createVisits;
        END;
        SET @result=(SELECT 'SUBMITTED' status,@op operationId,@IntakeId intakeId,@RequestType requestType,
            JSON_QUERY((SELECT PersonKey clientPersonKey,VisitId visitRequestId,PassId accessPassId,PublicReference publicReference,PassNumber publicPassNumber,Status status,Reused reused
                FROM @results ORDER BY LOWER(CONVERT(char(36),PersonKey)) COLLATE Latin1_General_100_BIN2 FOR JSON PATH)) visits FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        UPDATE gp.RegistrationIntakes SET Status='SUBMITTED',SubmittedAtUtc=@now WHERE IntakeId=@IntakeId;
        UPDATE gp.RegistrationIntakeAccess SET SubmittedPayloadHash=@payloadHash,SubmissionResultJson=@result WHERE IntakeId=@IntakeId;
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode)
            VALUES(@actor,'REGISTRATION_SUBMITTED','INTAKE',CONVERT(varchar(36),@IntakeId),@LocationId,@ProjectLocationId,'SUCCESS');
        EXEC gp._CompleteOperation @op,@result;
        COMMIT; SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
ALTER PROCEDURE gp._NotificationRelevance @NotificationId bigint,@Now datetime2(3),@Reason varchar(40) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;SET @Reason=NULL;
    DECLARE @visit uniqueidentifier,@link uniqueidentifier,@template varchar(40),@kind varchar(12),@recipient nvarchar(64),@email nvarchar(320),@payload nvarchar(max);
    SELECT @visit=VisitRequestId,@link=DeliveryLinkId,@template=TemplateCode,@kind=RecipientKind,@recipient=RecipientEmployeeId,@email=RecipientEmail,@payload=PayloadJson
        FROM gp.NotificationOutbox WHERE NotificationId=@NotificationId;
    IF @template NOT IN('HOST_APPROVAL_REQUEST','TEMP_ID_MANAGER_NOTICE','VISIT_DECIDED','PASS_DELIVERY','PASS_REISSUED','REQUEST_RECEIVED') BEGIN SET @Reason='UNSUPPORTED_TEMPLATE';RETURN;END;
    IF @visit IS NULL BEGIN SET @Reason='MISSING_VISIT';RETURN;END;
    DECLARE @state varchar(12),@type varchar(24),@employee nvarchar(64),@personEmail nvarchar(320),@host nvarchar(64),@pair bigint,@location int,
        @deadline datetime2(3),@end datetime2(3),@project bigint,@cutoff datetime2(3);
    SELECT @state=Status,@type=RequestType,@employee=EmployeeId,@personEmail=PersonEmail,@host=HostEmployeeId,@pair=ProjectLocationId,
        @location=LocationId,@deadline=ApprovalDeadlineUtc,@end=ValidUntilUtc FROM gp.VisitRequests WHERE VisitRequestId=@visit;
    IF @state IS NULL BEGIN SET @Reason='MISSING_VISIT';RETURN;END;
    IF @template='REQUEST_RECEIVED'
    BEGIN
      IF EXISTS(SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId=@visit AND PersonalDataPurgedAtUtc IS NOT NULL) OR @Now>=@end BEGIN SET @Reason='STATE_CHANGED';RETURN;END;
      IF(@employee IS NULL AND(@kind<>'EMAIL' OR @email IS NULL OR @personEmail IS NULL OR @email<>@personEmail)) OR(@employee IS NOT NULL AND(@kind<>'EMPLOYEE' OR @recipient IS NULL OR @recipient<>@employee)) SET @Reason='RECIPIENT_MISMATCH';
      RETURN;
    END;
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
    IF @official IS NULL THROW 52004,'Current employee directory data must be verified.',1;
    IF @kind<>'EMPLOYEE' OR @recipient IS NULL OR @recipient<>@employee OR @linkEmail<>@official SET @Reason='RECIPIENT_MISMATCH';
END;
GO

CREATE PROCEDURE gp.GetNotificationEmail @NotificationId bigint,@ClaimToken uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52000,'Ambient transactions are not accepted.',1;
    IF @NotificationId IS NULL OR @ClaimToken IS NULL THROW 52002,'Claim reference required.',1;
    -- Statement-scoped initial lookup releases row read locks before visit locks.
    DECLARE @visit uniqueidentifier,@found bit=0;
    SELECT @visit=VisitRequestId,@found=1 FROM gp.NotificationOutbox
        WHERE NotificationId=@NotificationId AND Status='PROCESSING' AND LockedBy=@ClaimToken;
    IF @found=0 THROW 52003,'Notification lease unavailable.',1;
    BEGIN TRY
        BEGIN TRANSACTION;
        EXEC gp._TakeLock N'gp:authorization','Shared';
        IF @visit IS NOT NULL
        BEGIN
            DECLARE @visitLock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@visit));
            EXEC gp._TakeLock @visitLock,'Shared';
        END;
        EXEC gp._TakeLock N'gp:outbox:claim';
        DECLARE @now datetime2(3)=SYSUTCDATETIME();
        IF NOT EXISTS(SELECT 1 FROM gp.NotificationOutbox WITH(UPDLOCK) WHERE NotificationId=@NotificationId
            AND Status='PROCESSING' AND LockedBy=@ClaimToken AND @now<LockedUntilUtc)
            THROW 52003,'Notification lease unavailable.',1;
        DECLARE @reason varchar(40),@result nvarchar(max);
        EXEC gp._NotificationRelevance @NotificationId,@now,@reason OUTPUT;
        IF @reason IS NOT NULL
        BEGIN
            UPDATE gp.NotificationOutbox SET Status='CANCELLED',LockedBy=NULL,LockedUntilUtc=NULL,LastErrorCode=@reason
                WHERE NotificationId=@NotificationId;
            SET @result=(SELECT @NotificationId AS notificationId,'CANCELLED' AS status,@reason AS reasonCode FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
            INSERT gp.SecurityAuditEvents(ActionCode,TargetType,TargetReference,ResultCode,MetadataJson)
            VALUES('NOTIFICATION_CANCELLED','NOTIFICATION',CONVERT(varchar(100),@NotificationId),'SUCCESS',@result);
        END
        ELSE
            SELECT @result=(SELECT NotificationId AS notificationId,'READY' AS status,VisitRequestId AS visitRequestId,
                DeliveryLinkId AS deliveryLinkId,RecipientKind AS recipientKind,RecipientEmployeeId AS recipientEmployeeId,
                CASE WHEN RecipientKind='EMAIL' THEN RecipientEmail END AS recipientEmail,TemplateCode AS templateCode,
                JSON_QUERY(PayloadJson) AS payload,AttemptCount AS attemptCount,LockedUntilUtc AS leaseUntilUtc,
                JSON_QUERY((SELECT v.VisitRequestId visitRequestId,v.PublicReference publicReference,v.RequestType requestType,v.PersonName personName,v.Reason purpose,v.Status visitStatus,
                l.LocationName locationName,p.ProjectName projectName,h.FullName hostName,
                CONVERT(varchar(64),v.SnapshotHash,2) snapshotHash,
                CONVERT(varchar(64),HASHBYTES('SHA2_256',LOWER(v.PersonEmail)),2) recipientEmailHash,
                REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc
                FROM gp.VisitRequests v JOIN gp.Locations l ON l.LocationId=v.LocationId LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId
                LEFT JOIN gp.Projects p ON p.ProjectId=pl.ProjectId LEFT JOIN gp.Employees h ON h.EmployeeId=v.HostEmployeeId WHERE v.VisitRequestId=NotificationOutbox.VisitRequestId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) details
                FROM gp.NotificationOutbox WHERE NotificationId=@NotificationId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        COMMIT;
        SELECT @result AS ResultJson;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
CREATE PROCEDURE gp.GetEmployeeRequestCard
 @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@VisitRequestId uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53400,'Ambient transaction not accepted.',1;
 IF @VisitRequestId IS NULL THROW 53402,'Invalid card request.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@pass uniqueidentifier,@details nvarchar(max),@digest varbinary(32),@result nvarchar(max),
  @lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
  EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  EXEC gp._TakeLock @lock,'Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
  IF gp._VisitReadAllowed(@actor,'OWN',@VisitRequestId,@now,@cutoff)=0 OR NOT EXISTS(
    SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId AND RequestType IN('TEMP_ID','EMPLOYEE_PROJECT') AND Status IN('PENDING','APPROVED'))
   THROW 53401,'Not authorized.',1;
  SELECT @pass=AccessPassId FROM gp.AccessPasses WHERE VisitRequestId=@VisitRequestId AND IsCurrent=1 AND Status IN('PENDING','ACTIVE');
  IF @pass IS NULL THROW 53401,'Not authorized.',1;
  EXEC gp._RequirePrintablePass @VisitRequestId,@pass,@now;
  EXEC gp._ReadPrintCardDetails @VisitRequestId,@now,@details OUTPUT,@digest OUTPUT;
  SET @result=(SELECT v.VisitRequestId visitRequestId,p.AccessPassId accessPassId,CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.Status visitStatus,
    v.PersonName personName,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,l.LocationName locationName,
    REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
    (SELECT pr.ProjectName FROM gp.ProjectLocations pl JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId WHERE pl.ProjectLocationId=v.ProjectLocationId) projectName,JSON_QUERY(@details) cardDetails,a.PhotoAssetId photoAssetId,a.StorageKey storageKey,a.MimeType mimeType,a.ByteLength byteLength,
    CONVERT(varchar(64),a.ContentHash,2) photoContentHash,CONVERT(varchar(64),p.CredentialHash,2) credentialHash,
    CONVERT(varchar(max),s.Ciphertext,2) ciphertext,CONVERT(varchar(24),s.Nonce,2) nonce,CONVERT(varchar(32),s.AuthenticationTag,2) authenticationTag,s.KeyVersion keyVersion
    FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.AccessPassId=@pass
    JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId JOIN gp.Locations l ON l.LocationId=v.LocationId
    JOIN gp.PassSecrets s ON s.AccessPassId=p.AccessPassId WHERE v.VisitRequestId=@VisitRequestId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF @result IS NULL OR JSON_VALUE(@result,'$.ciphertext') IS NULL THROW 53401,'Not authorized.',1;
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode)
    VALUES(@actor,'OWN_CARD_EXPORT_AUTHORIZED','VISIT',CONVERT(varchar(36),@VisitRequestId),'SUCCESS');
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.GetEmailRequestCard
 @VisitRequestId uniqueidentifier,@RecipientEmailHash varbinary(8000),@SnapshotHash varbinary(8000)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53400,'Ambient transaction not accepted.',1;
 IF @VisitRequestId IS NULL THROW 53402,'Invalid card request.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@pass uniqueidentifier,@details nvarchar(max),@digest varbinary(32),@result nvarchar(max),
  @lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
  SET @now=SYSUTCDATETIME();
  EXEC gp._TakeLock @lock,'Shared';SET @now=SYSUTCDATETIME();
  EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
  IF DATALENGTH(@RecipientEmailHash)<>32 OR DATALENGTH(@SnapshotHash)<>32 OR NOT EXISTS(SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId AND RequestType='EXTERNAL' AND PersonalDataPurgedAtUtc IS NULL AND PersonEmail IS NOT NULL AND HASHBYTES('SHA2_256',LOWER(PersonEmail))=@RecipientEmailHash AND SnapshotHash=@SnapshotHash AND @now<DATEADD(day,1,ValidUntilUtc) AND Status IN('PENDING','APPROVED'))
   THROW 53401,'Not authorized.',1;
  SELECT @pass=AccessPassId FROM gp.AccessPasses WHERE VisitRequestId=@VisitRequestId AND IsCurrent=1 AND Status IN('PENDING','ACTIVE');
  IF @pass IS NULL THROW 53401,'Not authorized.',1;
  EXEC gp._RequirePrintablePass @VisitRequestId,@pass,@now;
  EXEC gp._ReadPrintCardDetails @VisitRequestId,@now,@details OUTPUT,@digest OUTPUT;
  SET @result=(SELECT v.VisitRequestId visitRequestId,p.AccessPassId accessPassId,CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.Status visitStatus,
    v.PersonName personName,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,l.LocationName locationName,
    REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
    (SELECT pr.ProjectName FROM gp.ProjectLocations pl JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId WHERE pl.ProjectLocationId=v.ProjectLocationId) projectName,JSON_QUERY(@details) cardDetails,a.PhotoAssetId photoAssetId,a.StorageKey storageKey,a.MimeType mimeType,a.ByteLength byteLength,
    CONVERT(varchar(64),a.ContentHash,2) photoContentHash,CONVERT(varchar(64),p.CredentialHash,2) credentialHash,
    CONVERT(varchar(max),s.Ciphertext,2) ciphertext,CONVERT(varchar(24),s.Nonce,2) nonce,CONVERT(varchar(32),s.AuthenticationTag,2) authenticationTag,s.KeyVersion keyVersion
    FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.AccessPassId=@pass
    JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId JOIN gp.Locations l ON l.LocationId=v.LocationId
    JOIN gp.PassSecrets s ON s.AccessPassId=p.AccessPassId WHERE v.VisitRequestId=@VisitRequestId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF @result IS NULL OR JSON_VALUE(@result,'$.ciphertext') IS NULL THROW 53401,'Not authorized.',1;
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode)
    VALUES(@actor,'EMAIL_CARD_EXPORT_AUTHORIZED','VISIT',CONVERT(varchar(36),@VisitRequestId),'SUCCESS');
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO

CREATE PROCEDURE gp.ReadEmailRequest @VisitRequestId uniqueidentifier,@RecipientEmailHash varbinary(8000),@SnapshotHash varbinary(8000) AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;IF @@TRANCOUNT<>0 THROW 54100,'Ambient transaction not accepted.',1;
 IF @VisitRequestId IS NULL OR @RecipientEmailHash IS NULL OR DATALENGTH(@RecipientEmailHash)<>32 OR @SnapshotHash IS NULL OR DATALENGTH(@SnapshotHash)<>32 THROW 54102,'Invalid request.',1;
 DECLARE @now datetime2(3)=SYSUTCDATETIME(),@result nvarchar(max),@lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock @lock,'Shared';
 IF NOT EXISTS(SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId AND RequestType='EXTERNAL' AND PersonEmail IS NOT NULL AND HASHBYTES('SHA2_256',LOWER(PersonEmail))=@RecipientEmailHash AND SnapshotHash=@SnapshotHash AND PersonalDataPurgedAtUtc IS NULL AND @now<DATEADD(day,1,ValidUntilUtc)) THROW 54101,'Request unavailable.',1;
 SET @result=(SELECT v.VisitRequestId visitRequestId,v.PersonName personName,v.PublicReference publicReference,v.Status status,p.Status passStatus,l.LocationName locationName,pr.ProjectName projectName,h.FullName hostName,v.Reason reason,
 REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc
 FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.Locations l ON l.LocationId=v.LocationId
 JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId JOIN gp.Employees h ON h.EmployeeId=v.HostEmployeeId
 WHERE v.VisitRequestId=@VisitRequestId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.GetNotificationEmail TO gp_worker_runtime;
GRANT EXECUTE ON gp.ReadEmailRequest TO gp_api_runtime;
GRANT EXECUTE ON gp.GetEmployeeRequestCard TO gp_render_runtime;
GRANT EXECUTE ON gp.GetEmailRequestCard TO gp_render_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('061',N'Email request receipts, fenced content and scoped request/pass retrieval');COMMIT;
