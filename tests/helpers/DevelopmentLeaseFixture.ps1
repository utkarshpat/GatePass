#Requires -Version 7.0
param([Parameter(Mandatory)][guid]$RunId,[ValidateSet('Create','Auth','Inspect','Cleanup')][string]$Action,[int]$WorkerPid=0,[ValidateSet('ADMIN','GUARD','RECEPTION')][string]$Actor='ADMIN')
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if($Action -in @('Create','Cleanup')){& (Join-Path $taskRoot 'tools/LoadStressFixture.ps1') -RunId $RunId -Action $Action;exit}
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskDb=Open-GatePassLocalSql -TrustLocalServerCertificate
try{
 if($Action -eq 'Auth'){
  Invoke-GatePassScalar $taskDb "SELECT(SELECT TOP(1) CONVERT(varchar(64),s.SessionHash,2) sessionHex,CONVERT(varchar(64),s.CsrfHash,2) csrfHex FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject=@subject AND s.RevokedAtUtc IS NULL ORDER BY s.CreatedAtUtc DESC FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);" @{subject='GP02-'+$RunId.ToString('N').Substring(0,20).ToUpperInvariant()+':'+$Actor}
 }else{
  if($WorkerPid -le 0){throw 'Owned worker process required'}
  Invoke-GatePassScalar $taskDb @'
DECLARE @gate int;EXEC @gate=sys.sp_getapplock @Resource=N'gp:development:principal-ddl',@LockMode='Shared',@LockOwner='Session',@LockTimeout=10000;
IF @gate<0 THROW 52901,'Diagnostic metadata gate unavailable.',1;
DECLARE @rows table(Name sysname,RoleName sysname,Memberships int);
INSERT @rows SELECT p.name,r.name,(SELECT COUNT(*) FROM sys.database_role_members x WHERE x.member_principal_id=p.principal_id)
 FROM sys.database_principals p JOIN sys.extended_properties e ON e.class=4 AND e.major_id=p.principal_id AND e.name=N'GatePass.DevelopmentRpcWorker'
 JOIN sys.database_role_members m ON m.member_principal_id=p.principal_id JOIN sys.database_principals r ON r.principal_id=m.role_principal_id
 WHERE TRY_CONVERT(int,e.value)=@pid AND p.name LIKE 'gp[_]dev[_]rpc[_]%';
DECLARE @name sysname,@denied bit=1;
DECLARE owned CURSOR LOCAL FAST_FORWARD FOR SELECT DISTINCT Name FROM @rows;
OPEN owned;FETCH NEXT FROM owned INTO @name;
WHILE @@FETCH_STATUS=0
BEGIN
 EXECUTE AS USER=@name;
 IF COALESCE(HAS_PERMS_BY_NAME('gp.Users','OBJECT','SELECT'),1)<>0 SET @denied=0;
 REVERT;
 FETCH NEXT FROM owned INTO @name;
END;
CLOSE owned;DEALLOCATE owned;
SELECT(SELECT COUNT(*) principals,JSON_QUERY('['+COALESCE(STRING_AGG(CONVERT(nvarchar(max),'"'+STRING_ESCAPE(RoleName,'json')+'"'),','),'')+']') roles,
 CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM @rows WHERE Memberships<>1) THEN 0 ELSE 1 END) singleRole,@denied tableReadDenied,
 (SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE program_name='GatePass Phase02 Local Validation' AND host_process_id=@pid) sessions FROM @rows FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
EXEC sys.sp_releaseapplock @Resource=N'gp:development:principal-ddl',@LockOwner='Session';
'@ @{pid=$WorkerPid}
 }
}finally{$taskDb.Dispose()}
