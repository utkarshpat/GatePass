#Requires -Version 7.0
[CmdletBinding()]param([Parameter(Mandatory)][guid]$RunId,[ValidateSet('Create','Cleanup')][string]$Action)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if($Action -eq 'Cleanup'){& (Join-Path $PSScriptRoot 'AdminConsoleFixture.ps1') -RunId $RunId -Action Cleanup;exit}
$base=(& (Join-Path $PSScriptRoot 'AdminConsoleFixture.ps1') -RunId $RunId -Action Create)|ConvertFrom-Json
Import-Module (Join-Path $root 'tools/GatePass.LocalSql.psm1') -Force
$db=Open-GatePassLocalSql -TrustLocalServerCertificate
try{
 $result=Invoke-GatePassScalar $db @'
SET NOCOUNT ON;SET XACT_ABORT ON;
IF DB_NAME()<>'GatePass_DesignTest' THROW 52900,'Test database required.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @now datetime2(3)=SYSUTCDATETIME(),@guard uniqueidentifier,@reception uniqueidentifier;
SELECT @guard=UserId FROM gp.Users WHERE IdentityIssuer='gatepass-phase02-fixture' AND IdentitySubject=@prefix+':GUARD';
SELECT @reception=UserId FROM gp.Users WHERE IdentityIssuer='gatepass-phase02-fixture' AND IdentitySubject=@prefix+':RECEPTION';
IF @guard IS NULL OR @reception IS NULL THROW 52900,'Owned actors required.',1;
INSERT gp.StaffProfiles(UserId,StaffCode) VALUES(@guard,@prefix+'-G'),(@reception,@prefix+'-R');
INSERT gp.GuardCredentials(UserId,LoginId,EncodedPasswordHash,MustChangePassword,PasswordChangedAtUtc)
SELECT u.UserId,LOWER(@prefix)+CASE WHEN u.UserId=@guard THEN '-guard' ELSE '-reception' END+'@example.invalid',g.EncodedPasswordHash,0,@now
FROM gp.Users u CROSS JOIN gp.GuardCredentials g WHERE u.UserId IN(@guard,@reception) AND g.LoginId='admin2@example.com';
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT RoleGrantId,'VISITS_READ' FROM gp.StaffRoleGrants WHERE UserId=@reception AND RoleCode='RECEPTION';
DECLARE @source uniqueidentifier=(SELECT TOP(1) VisitRequestId FROM gp.VisitRequests WHERE PublicReference LIKE @prefix+'-%' AND PersonName=N'Synthetic MOVEMENT');
IF @source IS NULL THROW 52900,'Owned source required.',1;
DECLARE @rows table(N int PRIMARY KEY,VisitId uniqueidentifier,PhotoId uniqueidentifier);
;WITH n AS(SELECT 1 N UNION ALL SELECT N+1 FROM n WHERE N<1000) INSERT @rows SELECT N,NEWID(),NEWID() FROM n OPTION(MAXRECURSION 1000);
INSERT gp.PhotoAssets(PhotoAssetId,IntakeId,StorageKey,ContentHash,MimeType,ByteLength,PixelWidth,PixelHeight,CapturedAtUtc,PurgedAtUtc)
SELECT r.PhotoId,v.IntakeId,NULL,HASHBYTES('SHA2_256',@prefix+CONVERT(varchar(10),r.N)),'image/jpeg',100,100,100,@now,@now FROM @rows r CROSS JOIN gp.VisitRequests v WHERE v.VisitRequestId=@source;
INSERT gp.VisitRequests(VisitRequestId,PublicReference,IntakeId,ClientPersonKey,RequestType,PersonName,PersonEmail,PhotoAssetId,LocationId,ProjectLocationId,HostEmployeeId,Reason,Status,LocalVisitDate,ValidFromUtc,ValidUntilUtc,ApprovalDeadlineUtc,SnapshotHash,DecisionAtUtc,SubmittedAtUtc)
SELECT r.VisitId,@prefix+'-Q'+CONVERT(varchar(4),r.N),v.IntakeId,r.VisitId,'EXTERNAL',
CASE r.N%4 WHEN 0 THEN N'Rohan Mehta' WHEN 1 THEN N'Asha Rao' WHEN 2 THEN N'Priya Shah' ELSE N'Kunal Verma' END+N' '+CONVERT(nvarchar(4),r.N),LOWER(@prefix)+'@example.invalid',r.PhotoId,
v.LocationId,v.ProjectLocationId,v.HostEmployeeId,N'Owned queue performance fixture','APPROVED',v.LocalVisitDate,v.ValidFromUtc,v.ValidUntilUtc,v.ApprovalDeadlineUtc,HASHBYTES('SHA2_256',@prefix+':snapshot:'+CONVERT(varchar(4),r.N)),@now,DATEADD(millisecond,-r.N,@now)
FROM @rows r CROSS JOIN gp.VisitRequests v WHERE v.VisitRequestId=@source;
INSERT gp.AccessPasses(VisitRequestId,PassVersion,PublicPassNumber,CredentialHash,Status) SELECT VisitId,1,@prefix+'-Q'+CONVERT(varchar(4),N),HASHBYTES('SHA2_256',@prefix+':pass:'+CONVERT(varchar(4),N)),'ACTIVE' FROM @rows;
INSERT gp.VisitPresence(VisitRequestId) SELECT VisitId FROM @rows;
DECLARE @latest uniqueidentifier=(SELECT VisitId FROM @rows WHERE N=1),@last uniqueidentifier=(SELECT VisitId FROM @rows WHERE N=1000);
COMMIT;
SELECT(SELECT LOWER(@prefix)+'-guard@example.invalid' guardLogin,LOWER(@prefix)+'-reception@example.invalid' receptionLogin,@source movementVisitId,@latest latestId,@last lastId,1000 addedRows FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
'@ @{prefix=$base.prefix}
 $queue=$result|ConvertFrom-Json
 @{guardLogin=$queue.guardLogin;receptionLogin=$queue.receptionLogin;movementVisitId=$queue.movementVisitId;latestId=$queue.latestId;lastId=$queue.lastId;addedRows=$queue.addedRows;pair=$base.pair;prefix=$base.prefix;adminLogin=$base.login}|ConvertTo-Json -Compress
}finally{$db.Dispose()}
