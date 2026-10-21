/* Test-only committed fixtures for independent concurrent connections.
   @RunId is provided as a SQL parameter by the PowerShell harness.
   Every row is owned by a unique random run prefix and explicitly cleaned up.
   No real photo, QR, employee, SSO session or external message is used. */
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'GatePass_DesignTest' OR @RunId IS NULL
    THROW 52900, 'Fixtures require the dedicated test database and run ID.', 1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='003') THROW 52900, 'Migration 003 required.', 1;
DECLARE @prefix varchar(30)='GP02-'+LEFT(REPLACE(CONVERT(varchar(36),@RunId),'-',''),20);
IF EXISTS(SELECT 1 FROM gp.Users WHERE IdentityIssuer='gatepass-phase02-fixture' AND IdentitySubject LIKE @prefix+':%')
    THROW 52900, 'Fixture run already exists.', 1;
BEGIN TRANSACTION;
DECLARE @now datetime2(3)=SYSUTCDATETIME(),@loc int=(SELECT LocationId FROM gp.Locations WHERE LocationCode='NOIDA'),
    @pune int=(SELECT LocationId FROM gp.Locations WHERE LocationCode='PUNE');
DECLARE @actors table(Label varchar(20),UserId uniqueidentifier,SessionHex varchar(64),CsrfHex varchar(64),GrantId bigint NULL,AssignmentId bigint NULL);
INSERT @actors(Label,UserId,SessionHex,CsrfHex)
SELECT label,NEWID(),CONVERT(varchar(64),HASHBYTES('SHA2_256',@prefix+':session:'+label),2),
    CONVERT(varchar(64),HASHBYTES('SHA2_256',@prefix+':csrf:'+label),2)
FROM (VALUES('HOST'),('OTHERHOST'),('GUARD'),('GUARD2'),('WRONGPROJECT'),('WRONGLOCATION'),
    ('NOCAP'),('RECON'),('ADMIN'),('RECEPTION'),('SPLIT'),('BLOCKED'),('STALE'),('EXPIRED')) labels(label);
INSERT gp.Users(UserId,IdentityIssuer,IdentitySubject,DisplayName,IsActive)
SELECT UserId,'gatepass-phase02-fixture',@prefix+':'+Label,N'Synthetic '+Label,CASE WHEN Label='BLOCKED' THEN 0 ELSE 1 END FROM @actors;
INSERT gp.Sessions(SessionHash,UserId,CsrfHash,AuthorizationVersionAtIssue,LastSeenAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,CreatedAtUtc)
SELECT CONVERT(varbinary(32),SessionHex,2),UserId,CONVERT(varbinary(32),CsrfHex,2),CASE WHEN Label='STALE' THEN 2 ELSE 1 END,
    DATEADD(second,-5,@now),CASE WHEN Label='EXPIRED' THEN DATEADD(second,-1,@now) ELSE DATEADD(hour,1,@now) END,
    DATEADD(hour,3,@now),DATEADD(hour,-2,@now) FROM @actors;
DECLARE @host uniqueidentifier=(SELECT UserId FROM @actors WHERE Label='HOST'),@hostCode nvarchar(64)=@prefix+'-HOST';
INSERT gp.Employees(EmployeeId,UserId,FullName,OfficialEmail,IsActive,LastSyncedAtUtc)
SELECT @prefix+'-'+Label,UserId,N'Synthetic '+Label,LOWER(@prefix+'-'+Label)+'@example.invalid',1,@now
FROM @actors WHERE Label IN ('HOST','OTHERHOST');
INSERT gp.Projects(ExternalProjectCode,ProjectName,LastSyncedAtUtc) VALUES(@prefix+'-A',N'Synthetic Alpha',@now),(@prefix+'-B',N'Synthetic Beta',@now);
DECLARE @projectA bigint=(SELECT ProjectId FROM gp.Projects WHERE ExternalProjectCode=@prefix+'-A'),
    @projectB bigint=(SELECT ProjectId FROM gp.Projects WHERE ExternalProjectCode=@prefix+'-B');
INSERT gp.ProjectLocations(ProjectId,LocationId) VALUES(@projectA,@loc),(@projectB,@loc),(@projectA,@pune);
DECLARE @pair bigint=(SELECT ProjectLocationId FROM gp.ProjectLocations WHERE ProjectId=@projectA AND LocationId=@loc),
    @otherPair bigint=(SELECT ProjectLocationId FROM gp.ProjectLocations WHERE ProjectId=@projectB AND LocationId=@loc),
    @punePair bigint=(SELECT ProjectLocationId FROM gp.ProjectLocations WHERE ProjectId=@projectA AND LocationId=@pune);
INSERT gp.EmployeeProjectMemberships(EmployeeId,ProjectId,IsActive,VerifiedAtUtc)
SELECT @prefix+'-'+Label,@projectA,1,@now FROM @actors WHERE Label IN ('HOST','OTHERHOST');
INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,LocationId,GrantedByUserId,ValidFromUtc)
SELECT UserId,CASE WHEN Label='ADMIN' THEN 'LOCATION_ADMIN' WHEN Label='RECEPTION' THEN 'RECEPTION' ELSE 'GUARD' END,
    'LOCATION',CASE WHEN Label='WRONGLOCATION' THEN @pune ELSE @loc END,@host,DATEADD(hour,-1,@now)
FROM @actors WHERE Label IN ('GUARD','GUARD2','WRONGPROJECT','WRONGLOCATION','NOCAP','RECON','ADMIN','RECEPTION','SPLIT');
UPDATE a SET GrantId=g.RoleGrantId FROM @actors a JOIN gp.StaffRoleGrants g ON g.UserId=a.UserId;
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode)
SELECT GrantId,'PROJECT_MOVEMENT' FROM @actors WHERE Label IN ('GUARD','GUARD2','WRONGPROJECT','WRONGLOCATION','RECEPTION');
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT GrantId,'TEMP_ID_MOVEMENT' FROM @actors WHERE Label IN ('GUARD','GUARD2');
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT GrantId,'RECONCILE_EXIT' FROM @actors WHERE Label='RECON';
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT GrantId,'GUARDS_MANAGE' FROM @actors WHERE Label='ADMIN';
-- Deliberately invalid capability-on-role and split-scope records exercise defense in depth.
DECLARE @split uniqueidentifier=(SELECT UserId FROM @actors WHERE Label='SPLIT');
INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,LocationId,GrantedByUserId,ValidFromUtc)
VALUES(@split,'GUARD','LOCATION',@pune,@host,DATEADD(hour,-1,@now));
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(CONVERT(bigint,SCOPE_IDENTITY()),'PROJECT_MOVEMENT');
INSERT gp.GuardAssignments(GuardUserId,ProjectLocationId,AssignedByUserId,ValidFromUtc)
SELECT UserId,CASE WHEN Label='WRONGPROJECT' THEN @otherPair WHEN Label='WRONGLOCATION' THEN @punePair ELSE @pair END,
    @host,DATEADD(hour,-1,@now) FROM @actors WHERE Label IN ('GUARD','GUARD2','WRONGPROJECT','WRONGLOCATION','RECEPTION','SPLIT');
UPDATE a SET AssignmentId=g.GuardAssignmentId FROM @actors a JOIN gp.GuardAssignments g ON g.GuardUserId=a.UserId;
DECLARE @intake uniqueidentifier=NEWID();
INSERT gp.RegistrationIntakes(IntakeId,TokenHash,IntakeType,Status,SubmittedAtUtc,ExpiresAtUtc)
VALUES(@intake,HASHBYTES('SHA2_256',@prefix+':intake'),'PUBLIC','SUBMITTED',@now,DATEADD(hour,2,@now));
DECLARE @visits table(Label varchar(30),VisitId uniqueidentifier,PhotoId uniqueidentifier,PassId uniqueidentifier,SnapshotHex varchar(64),CredentialHex varchar(64));
INSERT @visits
SELECT label,NEWID(),NEWID(),NEWID(),CONVERT(varchar(64),HASHBYTES('SHA2_256',@prefix+':snapshot:'+label),2),
    CONVERT(varchar(64),HASHBYTES('SHA2_256',@prefix+':qr:'+label),2)
FROM (VALUES('DECISION_AP'),('DECISION_DENY'),('GROUP_OTHER'),('SNAPSHOT'),('DEADLINE'),('HOST_CHECK'),
    ('MOVEMENT'),('DUPENTRY'),('SAMERETRY'),('MOVEMENT_RACE'),('IDEM_RACE'),('DECISION_RACE'),
    ('EXIT_EXPIRED'),('RECON_REVOKED'),('RECON_BADTIME'),('PENDING'),('PHOTO_PURGED'),('EMP_DISABLED'),
    ('EMP_STALE'),('TEMP'),('OTHER_PAIR'),('DEACTIVATED'),('REVOKE_BLOCK'),('REPLAY_REAUTH'),('FAULT')) names(label);
INSERT gp.PhotoAssets(PhotoAssetId,IntakeId,StorageKey,ContentHash,MimeType,ByteLength,PixelWidth,PixelHeight,CapturedAtUtc)
SELECT PhotoId,@intake,N'test-only/'+@prefix+'/'+Label,HASHBYTES('SHA2_256',@prefix+Label),'image/jpeg',100,100,100,@now FROM @visits;
DECLARE @day date=CONVERT(date,DATEADD(minute,330,@now));
DECLARE @dayStart datetime2(3)=DATEADD(minute,-330,CONVERT(datetime2(3),@day)),
    @dayEnd datetime2(3)=DATEADD(minute,-330,DATEADD(day,1,CONVERT(datetime2(3),@day)));
DECLARE @start datetime2(3)=CASE WHEN DATEADD(minute,-5,@now)<@dayStart THEN @dayStart ELSE DATEADD(minute,-5,@now) END,
    @end datetime2(3)=CASE WHEN DATEADD(hour,2,@now)>@dayEnd THEN @dayEnd ELSE DATEADD(hour,2,@now) END;
INSERT gp.VisitRequests(VisitRequestId,PublicReference,IntakeId,ClientPersonKey,RequestType,EmployeeId,PersonName,PersonEmail,PhotoAssetId,
    LocationId,ProjectLocationId,HostEmployeeId,Reason,TemporaryIdReason,Status,LocalVisitDate,ValidFromUtc,ValidUntilUtc,
    ApprovalDeadlineUtc,SnapshotHash,DecisionAtUtc,SubmittedAtUtc)
SELECT v.VisitId,@prefix+'-'+CONVERT(varchar(4),ROW_NUMBER() OVER(ORDER BY Label)),@intake,v.VisitId,
    CASE WHEN Label='TEMP' THEN 'TEMP_ID' WHEN Label IN ('EMP_DISABLED','EMP_STALE') THEN 'EMPLOYEE_PROJECT' ELSE 'EXTERNAL' END,
    CASE WHEN Label IN ('TEMP','EMP_DISABLED','EMP_STALE') THEN @hostCode ELSE NULL END,
    N'Synthetic '+Label,LOWER(@prefix)+'@example.invalid',PhotoId,@loc,
    CASE WHEN Label='TEMP' THEN NULL WHEN Label='OTHER_PAIR' THEN @otherPair ELSE @pair END,
    CASE WHEN Label='TEMP' THEN NULL ELSE @hostCode END,N'Transaction test only',CASE WHEN Label='TEMP' THEN 'FORGOT' ELSE NULL END,
    CASE WHEN Label IN ('DECISION_AP','DECISION_DENY','GROUP_OTHER','SNAPSHOT','DEADLINE','HOST_CHECK','DECISION_RACE','PENDING','FAULT') THEN 'PENDING' ELSE 'APPROVED' END,
    CASE WHEN Label='EXIT_EXPIRED' THEN DATEADD(day,-1,@day) ELSE @day END,
    CASE WHEN Label='EXIT_EXPIRED' THEN DATEADD(day,-1,@dayStart) ELSE @start END,
    CASE WHEN Label='EXIT_EXPIRED' THEN @dayStart ELSE @end END,
    CASE WHEN Label='TEMP' THEN NULL WHEN Label='EXIT_EXPIRED' THEN @dayStart WHEN Label='DEADLINE' THEN DATEADD(second,-1,@now) ELSE @end END,
    CONVERT(varbinary(32),SnapshotHex,2),
    CASE WHEN Label IN ('DECISION_AP','DECISION_DENY','GROUP_OTHER','SNAPSHOT','DEADLINE','HOST_CHECK','DECISION_RACE','PENDING','FAULT') THEN NULL ELSE @now END,
    DATEADD(day,-2,@now) FROM @visits v;
INSERT gp.AccessPasses(AccessPassId,VisitRequestId,PassVersion,PublicPassNumber,CredentialHash,Status)
SELECT PassId,VisitId,1,@prefix+'-'+CONVERT(varchar(4),ROW_NUMBER() OVER(ORDER BY Label)),CONVERT(varbinary(32),CredentialHex,2),
    CASE WHEN Label IN ('DECISION_AP','DECISION_DENY','GROUP_OTHER','SNAPSHOT','DEADLINE','HOST_CHECK','DECISION_RACE','PENDING','FAULT') THEN 'PENDING' ELSE 'ACTIVE' END FROM @visits;
INSERT gp.VisitPresence(VisitRequestId) SELECT VisitId FROM @visits;
COMMIT;
DECLARE @fixture nvarchar(max)=(SELECT @prefix AS prefix,@hostCode AS hostEmployeeId,@loc AS locationId,@pune AS otherLocationId,
    @pair AS projectLocationId,@projectA AS projectId,
    JSON_QUERY((SELECT * FROM @actors FOR JSON PATH)) AS actors,
    JSON_QUERY((SELECT * FROM @visits FOR JSON PATH)) AS visits FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
SELECT @fixture;
