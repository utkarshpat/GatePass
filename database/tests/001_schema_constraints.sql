/* GatePass v1.2 - ENGINE constraint scenarios, not service/authorization tests.
   Run only on dedicated GatePass_DesignTest AFTER migrations 001 and 002.
   Synthetic fixtures are transactionally rolled back. No real PII or credentials.
   Intentionally XACT_ABORT OFF inside this test harness so expected FK/CHECK
   failures can be inspected and their savepoint rolled back. Runtime uses ON. */
SET NOCOUNT ON;
SET XACT_ABORT OFF;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;

IF DB_NAME() <> N'GatePass_DesignTest'
    THROW 51100, 'Constraint fixtures are restricted to the dedicated GatePass_DesignTest database.', 1;
IF NOT EXISTS (SELECT 1 FROM gp.SchemaMigrations WHERE Version='002')
    THROW 51101, 'Apply migrations 001 and 002 first.', 1;

DECLARE @Results table (CaseNo int, CaseName nvarchar(200), Passed bit, ObservedError int, Detail nvarchar(1000));
BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @Now datetime2(3)=SYSUTCDATETIME();
    DECLARE @Day date=DATEADD(day,1,CONVERT(date,@Now));
    DECLARE @Start datetime2(3)=DATEADD(hour,10,CONVERT(datetime2(3),@Day));
    DECLARE @End datetime2(3)=DATEADD(hour,18,CONVERT(datetime2(3),@Day));
    DECLARE @Noida int=(SELECT LocationId FROM gp.Locations WHERE LocationCode='NOIDA');
    DECLARE @Pune int=(SELECT LocationId FROM gp.Locations WHERE LocationCode='PUNE');
    DECLARE @Host uniqueidentifier='00000000-0000-0000-0000-000000000101';
    DECLARE @Guard uniqueidentifier='00000000-0000-0000-0000-000000000102';
    DECLARE @Intake uniqueidentifier='00000000-0000-0000-0000-000000000201';
    DECLARE @OtherIntake uniqueidentifier='00000000-0000-0000-0000-000000000202';
    DECLARE @A uniqueidentifier='00000000-0000-0000-0000-000000000301';
    DECLARE @B uniqueidentifier='00000000-0000-0000-0000-000000000302';
    DECLARE @C uniqueidentifier='00000000-0000-0000-0000-000000000303';
    DECLARE @PassA uniqueidentifier='00000000-0000-0000-0000-000000000401';
    DECLARE @PassB uniqueidentifier='00000000-0000-0000-0000-000000000402';
    DECLARE @OpA uniqueidentifier='00000000-0000-0000-0000-000000000501';
    DECLARE @OpB uniqueidentifier='00000000-0000-0000-0000-000000000502';

    INSERT gp.Users(UserId,IdentityIssuer,IdentitySubject,DisplayName)
    VALUES (@Host,N'test-only',N'test-host',N'Synthetic Host'),(@Guard,N'test-only',N'test-guard',N'Synthetic Guard');
    INSERT gp.Employees(EmployeeId,UserId,FullName,OfficialEmail,IsActive,LastSyncedAtUtc)
    VALUES (N'TEST-HOST',@Host,N'Synthetic Host',N'host@example.invalid',1,@Now);
    INSERT gp.Projects(ExternalProjectCode,ProjectName) VALUES (N'TEST-ALPHA',N'Synthetic Alpha');
    DECLARE @Project bigint=SCOPE_IDENTITY();
    INSERT gp.ProjectLocations(ProjectId,LocationId) VALUES (@Project,@Noida),(@Project,@Pune);
    DECLARE @Pair bigint=(SELECT ProjectLocationId FROM gp.ProjectLocations WHERE ProjectId=@Project AND LocationId=@Noida);
    INSERT gp.RegistrationIntakes(IntakeId,TokenHash,IntakeType,Status,SubmittedAtUtc,ExpiresAtUtc)
    VALUES (@Intake,HASHBYTES('SHA2_256','intake-1'),'PUBLIC','SUBMITTED',@Now,DATEADD(hour,1,@Now)),
           (@OtherIntake,HASHBYTES('SHA2_256','intake-2'),'PUBLIC','DRAFT',NULL,DATEADD(hour,1,@Now));
    INSERT gp.PhotoAssets(PhotoAssetId,IntakeId,StorageKey,ContentHash,MimeType,ByteLength,PixelWidth,PixelHeight,CapturedAtUtc)
    VALUES ('00000000-0000-0000-0000-000000000601',@Intake,N'test/a',HASHBYTES('SHA2_256','photo-a'),'image/jpeg',1024,100,100,@Now),
           ('00000000-0000-0000-0000-000000000602',@Intake,N'test/b',HASHBYTES('SHA2_256','photo-b'),'image/jpeg',1024,100,100,@Now),
           ('00000000-0000-0000-0000-000000000603',@Intake,N'test/c',HASHBYTES('SHA2_256','photo-c'),'image/jpeg',1024,100,100,@Now),
           ('00000000-0000-0000-0000-000000000604',@OtherIntake,N'test/other',HASHBYTES('SHA2_256','photo-other'),'image/jpeg',1024,100,100,@Now);

    INSERT gp.VisitRequests(VisitRequestId,PublicReference,IntakeId,ClientPersonKey,RequestType,PersonName,PhotoAssetId,LocationId,ProjectLocationId,HostEmployeeId,Reason,Status,LocalVisitDate,ValidFromUtc,ValidUntilUtc,ApprovalDeadlineUtc,SnapshotHash)
    VALUES (@A,'TEST-A',@Intake,@A,'EXTERNAL',N'Synthetic A','00000000-0000-0000-0000-000000000601',@Noida,@Pair,N'TEST-HOST',N'Test meeting','PENDING',@Day,@Start,@End,@End,HASHBYTES('SHA2_256','snapshot-a')),
           (@B,'TEST-B',@Intake,@B,'EXTERNAL',N'Synthetic B','00000000-0000-0000-0000-000000000602',@Noida,@Pair,N'TEST-HOST',N'Test meeting','PENDING',@Day,@Start,@End,@End,HASHBYTES('SHA2_256','snapshot-b')),
           (@C,'TEST-C',@Intake,@C,'EXTERNAL',N'Synthetic C','00000000-0000-0000-0000-000000000603',@Noida,@Pair,N'TEST-HOST',N'Test meeting','PENDING',@Day,@Start,@End,@End,HASHBYTES('SHA2_256','snapshot-c'));
    INSERT gp.IdempotencyRequests(OperationId,ActorBindingHash,OperationCode,ClientKey,PayloadHash,Status,ResultJson,CompletedAtUtc,ExpiresAtUtc)
    VALUES (@OpA,HASHBYTES('SHA2_256','guard'),'RECORD_MOVEMENT',@OpA,HASHBYTES('SHA2_256','move-a'),'COMPLETED',N'{}',@Now,DATEADD(day,1,@Now)),
           (@OpB,HASHBYTES('SHA2_256','guard'),'DECIDE_VISIT',@OpB,HASHBYTES('SHA2_256','decide-a'),'COMPLETED',N'{}',@Now,DATEADD(day,1,@Now));
    INSERT gp.AccessPasses(AccessPassId,VisitRequestId,PassVersion,PublicPassNumber,CredentialHash,Status)
    VALUES (@PassA,@A,1,'TEST-PASS-A',HASHBYTES('SHA2_256','fake-qr-a'),'PENDING'),
           (@PassB,@B,1,'TEST-PASS-B',HASHBYTES('SHA2_256','fake-qr-b'),'PENDING');
    INSERT gp.VisitPresence(VisitRequestId) VALUES (@A),(@B),(@C);

    -- Positive relational case: same intake, three independent status records.
    UPDATE gp.VisitRequests SET Status='APPROVED',DecisionAtUtc=@Now WHERE VisitRequestId=@A;
    UPDATE gp.VisitRequests SET Status='DENIED',DecisionAtUtc=@Now WHERE VisitRequestId=@B;
    UPDATE gp.AccessPasses SET Status='ACTIVE' WHERE AccessPassId=@PassA;
    UPDATE gp.AccessPasses SET Status='DENIED' WHERE AccessPassId=@PassB;
    INSERT @Results VALUES (1,N'Individuals from one intake keep independent status',
        CASE WHEN (SELECT Status FROM gp.VisitRequests WHERE VisitRequestId=@A)='APPROVED'
               AND (SELECT Status FROM gp.VisitRequests WHERE VisitRequestId=@B)='DENIED'
               AND (SELECT Status FROM gp.VisitRequests WHERE VisitRequestId=@C)='PENDING' THEN 1 ELSE 0 END,0,N'Relational independence only, not service transition enforcement.');
    INSERT gp.ApprovalDecisions(VisitRequestId,ApproverEmployeeId,SnapshotVersion,SnapshotHash,Decision,DecisionSource,OperationId)
    SELECT VisitRequestId,N'TEST-HOST',SnapshotVersion,SnapshotHash,'APPROVED','WEB',@OpB FROM gp.VisitRequests WHERE VisitRequestId=@A;
    INSERT gp.AccessEvents(VisitRequestId,AccessPassId,ActorUserId,LocationId,EventType,EntryMethod,OperationId,OccurredAtUtc)
    VALUES (@A,@PassA,@Guard,@Noida,'ENTRY','SCAN',@OpA,@Now);
    DECLARE @Event bigint=SCOPE_IDENTITY();

    DECLARE @Cases table (CaseNo int, CaseName nvarchar(200), Statement nvarchar(max), ExpectedError int);
    INSERT @Cases VALUES
    (2,N'Visit cannot target a project at a different office',N'UPDATE gp.VisitRequests SET LocationId=(SELECT LocationId FROM gp.Locations WHERE LocationCode=''PUNE'') WHERE PublicReference=''TEST-C'';',547),
    (3,N'Photo cannot be borrowed from another intake',N'UPDATE gp.VisitRequests SET PhotoAssetId=''00000000-0000-0000-0000-000000000604'' WHERE PublicReference=''TEST-C'';',547),
    (4,N'External visit requires a host',N'UPDATE gp.VisitRequests SET HostEmployeeId=NULL WHERE PublicReference=''TEST-C'';',547),
    (5,N'TEMP_ID cannot have a project or host',N'UPDATE gp.VisitRequests SET RequestType=''TEMP_ID'' WHERE PublicReference=''TEST-C'';',547),
    (6,N'Visit cannot have an empty/reversed time window',N'UPDATE gp.VisitRequests SET ValidUntilUtc=ValidFromUtc WHERE PublicReference=''TEST-C'';',547),
    (7,N'Visit cannot silently extend into a second local day',N'UPDATE gp.VisitRequests SET ValidUntilUtc=DATEADD(day,2,ValidUntilUtc) WHERE PublicReference=''TEST-C'';',547),
    (8,N'Only one current pass per individual visit',N'INSERT gp.AccessPasses(VisitRequestId,PassVersion,PublicPassNumber,CredentialHash,Status) SELECT VisitRequestId,2,''TEST-PASS-A2'',HASHBYTES(''SHA2_256'',''fake-qr-a2''),''ACTIVE'' FROM gp.VisitRequests WHERE PublicReference=''TEST-A'';',2601),
    (9,N'Credential hash must have all 32 bytes',N'UPDATE gp.AccessPasses SET CredentialHash=0x01 WHERE PublicPassNumber=''TEST-PASS-A'';',547),
    (10,N'Noncurrent credentials must be revoked',N'UPDATE gp.AccessPasses SET IsCurrent=0 WHERE PublicPassNumber=''TEST-PASS-A'';',547),
    (11,N'Cross-visitor last movement is rejected',N'UPDATE gp.VisitPresence SET LastAccessEventId=(SELECT MAX(AccessEventId) FROM gp.AccessEvents WHERE VisitRequestId=''00000000-0000-0000-0000-000000000301''),LastMovementAtUtc=SYSUTCDATETIME(),IsInside=1 WHERE VisitRequestId=''00000000-0000-0000-0000-000000000302'';',547),
    (12,N'Movement cannot switch its credential to another visitor',N'UPDATE gp.AccessEvents SET AccessPassId=''00000000-0000-0000-0000-000000000402'' WHERE VisitRequestId=''00000000-0000-0000-0000-000000000301'';',547),
    (13,N'Movement office must equal individual visit office',N'UPDATE gp.AccessEvents SET LocationId=(SELECT LocationId FROM gp.Locations WHERE LocationCode=''PUNE'') WHERE VisitRequestId=''00000000-0000-0000-0000-000000000301'';',547),
    (14,N'Approval must bind the exact submitted snapshot',N'UPDATE gp.ApprovalDecisions SET SnapshotHash=HASHBYTES(''SHA2_256'',''different snapshot'') WHERE VisitRequestId=''00000000-0000-0000-0000-000000000301'';',547),
    (15,N'One photo asset cannot represent two visitors',N'UPDATE gp.VisitRequests SET PhotoAssetId=''00000000-0000-0000-0000-000000000601'' WHERE PublicReference=''TEST-C'';',2627),
    (16,N'Unknown scan must not claim a known visit',N'INSERT gp.PassScanAttempts(VisitRequestId,ActorUserId,LocationId,OutcomeCode) SELECT VisitRequestId,''00000000-0000-0000-0000-000000000102'',LocationId,''NOT_FOUND'' FROM gp.VisitRequests WHERE PublicReference=''TEST-C'';',547),
    (17,N'Processing notification requires a worker lease',N'INSERT gp.NotificationOutbox(RecipientKind,RecipientEmail,TemplateCode,PayloadJson,DedupeHash,Status) VALUES (''EMAIL'',N''test@example.invalid'',''TEST'',N''{}'',HASHBYTES(''SHA2_256'',''job-1''),''PROCESSING'');',547),
    (18,N'Role and scope must be compatible',N'INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,GrantedByUserId) VALUES (''00000000-0000-0000-0000-000000000102'',''GUARD'',''INDIA'',''00000000-0000-0000-0000-000000000101'');',547);

    DECLARE @Case int,@Name nvarchar(200),@Statement nvarchar(max),@Expected int,@Observed int,@Detail nvarchar(1000);
    DECLARE cases CURSOR LOCAL FAST_FORWARD FOR SELECT CaseNo,CaseName,Statement,ExpectedError FROM @Cases ORDER BY CaseNo;
    OPEN cases;
    FETCH NEXT FROM cases INTO @Case,@Name,@Statement,@Expected;
    WHILE @@FETCH_STATUS=0
    BEGIN
        SAVE TRANSACTION ConstraintCase;
        SET @Observed=0; SET @Detail=N'Unexpected success';
        BEGIN TRY
            EXEC sys.sp_executesql @Statement;
        END TRY
        BEGIN CATCH
            SET @Observed=ERROR_NUMBER(); SET @Detail=ERROR_MESSAGE();
            IF XACT_STATE()<>1 THROW;
        END CATCH;
        ROLLBACK TRANSACTION ConstraintCase;
        INSERT @Results VALUES (@Case,@Name,CASE WHEN @Observed=@Expected THEN 1 ELSE 0 END,@Observed,@Detail);
        FETCH NEXT FROM cases INTO @Case,@Name,@Statement,@Expected;
    END;
    CLOSE cases; DEALLOCATE cases;
    SELECT CaseNo,CaseName,Passed,ObservedError,Detail FROM @Results ORDER BY CaseNo;
    DECLARE @Failures int=(SELECT COUNT(*) FROM @Results WHERE Passed=0);
    ROLLBACK TRANSACTION;
    IF @Failures<>0 THROW 51102, 'One or more constraint scenarios failed; fixtures rolled back.', 1;
    PRINT 'All 18 constraint scenarios passed; synthetic fixture data rolled back.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
