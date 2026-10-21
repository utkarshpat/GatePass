/* Keep a cancelled employee project occupant blocking overlapping replacement until actual departure.
   Forward migration; existing immutable submissions and Digital ID daily-slot behavior remain intact. */
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52700,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='015') THROW 52700,'Migration 015 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='016') THROW 52700,'Migration 016 already applied.',1;
BEGIN TRANSACTION;
EXEC gp._TakeLock N'gp:authorization','Exclusive';
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
       WHERE p.[key] COLLATE Latin1_General_100_BIN2 NOT IN('clientPersonKey','photoAssetId','personName','personEmail','personPhone')
          OR p.type NOT IN(0,1)) OR EXISTS(SELECT 1 FROM OPENJSON(@PeopleJson) x CROSS APPLY OPENJSON(x.value) p
            GROUP BY x.[key],p.[key] COLLATE Latin1_General_100_BIN2 HAVING COUNT(*)>1) THROW 52702,'Invalid person properties.',1;
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
        IF @RequestType<>'TEMP_ID' AND (NOT EXISTS(SELECT 1 FROM gp.Employees e LEFT JOIN gp.Users u ON u.UserId=e.UserId
                WHERE e.EmployeeId=@HostEmployeeId AND e.IsActive=1 AND e.LastSyncedAtUtc BETWEEN @cutoff AND @now AND (e.UserId IS NULL OR u.IsActive=1))
            OR NOT EXISTS(SELECT 1 FROM gp.EmployeeProjectMemberships WHERE EmployeeId=@HostEmployeeId AND ProjectId=@project AND IsActive=1 AND VerifiedAtUtc BETWEEN @cutoff AND @now)
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
                OR EXISTS(SELECT 1 FROM OPENJSON(@CredentialsJson) x CROSS APPLY OPENJSON(x.value) p GROUP BY x.[key],p.[key] COLLATE Latin1_General_100_BIN2 HAVING COUNT(*)>1)
                THROW 52702,'Invalid credential properties.',1;
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
                OR KeyVersion COLLATE Latin1_General_100_BIN2 LIKE N'%[^A-Za-z0-9._-]%' OR DATALENGTH(KeyVersion)<>LEN(KeyVersion)*2)
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
                OR NOT EXISTS(SELECT 1 FROM gp.EmployeeProjectMemberships WHERE EmployeeId=@HostEmployeeId AND ProjectId=@project AND IsActive=1 AND VerifiedAtUtc BETWEEN @cutoff AND @now)
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
INSERT gp.SchemaMigrations(Version,Description) VALUES('016',N'Cancelled employee project occupant blocks overlapping replacement until departure');
COMMIT;
