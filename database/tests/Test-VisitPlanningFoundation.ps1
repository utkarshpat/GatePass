#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate,[switch]$IncludePersistence,[switch]$KeepForBrowser)
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
# This creates and removes its own marked database; never opens DesignTest or NHS.
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if($KeepForBrowser -and (Test-Path -LiteralPath (Join-Path $taskRoot 'tmp/planning-browser-fixture.json'))){throw 'An owned browser fixture already exists. Use Cleanup-VisitPlanningBrowser first.'}
$taskSqlServer='localhost\SQLEXPRESS'
if($env:GATEPASS_TEST_SQL_SERVER){
 if($env:CI -ne 'true' -or $env:NODE_ENV -ne 'test' -or $env:GATEPASS_TEST_SQL_SERVER -notmatch '^\(localdb\)\\GatePassCI_[a-f0-9]{32}$'){throw 'CI override requires an isolated test LocalDB instance.'}
 $taskSqlServer=$env:GATEPASS_TEST_SQL_SERVER
}
Add-Type -AssemblyName System.Data.SqlClient
$taskParserPath=Join-Path $taskRoot '.tools/scriptdom/180.140.0/lib/net8.0/Microsoft.SqlServer.TransactSql.ScriptDom.dll'
if(-not(Test-Path -LiteralPath $taskParserPath)){throw 'Existing approved SQL parser required.'}
Add-Type -Path $taskParserPath
$taskDatabase='GatePass_Verification_'+[guid]::NewGuid().ToString('N')
$taskMaster=$null; $taskConnection=$null; $taskCreated=$false; $taskKeepReady=$false; $taskChecks=0
function Open-PlanningSql([string]$catalogue){
 $builder=[Data.SqlClient.SqlConnectionStringBuilder]::new()
 $builder['Data Source']=$taskSqlServer;$builder['Initial Catalog']=$catalogue
 $builder['Integrated Security']=$true;$builder['Encrypt']=$true;$builder['TrustServerCertificate']=[bool]$TrustLocalServerCertificate;$builder['Pooling']=$false
 $connection=[Data.SqlClient.SqlConnection]::new($builder.ConnectionString);$connection.Open();return $connection
}
function Run($connection,[string]$sql){$command=$connection.CreateCommand();$command.CommandText=$sql;$command.CommandTimeout=120;try{return $command.ExecuteScalar()}finally{$command.Dispose()}}
function Pass([bool]$condition,[string]$name){if(-not $condition){throw $name};$script:taskChecks++;Write-Output ('PASS '+$name)}
function Denied([string]$sql,[int[]]$numbers=@(547)){
 try{$null=Run $taskConnection $sql}catch{if($_.Exception.GetBaseException().Number -in $numbers){$script:taskChecks++;return};throw}
 throw 'Expected constraint/permission rejection did not occur.'
}
try{
 $taskMaster=Open-PlanningSql 'master'
 $null=Run $taskMaster "CREATE DATABASE [$taskDatabase]; ALTER DATABASE [$taskDatabase] SET AUTO_CLOSE OFF;"
 $taskCreated=$true;$taskConnection=Open-PlanningSql $taskDatabase
 $null=Run $taskConnection "EXEC sys.sp_addextendedproperty @name=N'GatePass.DisposableVerification',@value=N'$taskDatabase';"
 $taskOperationalBaseline=@{}
 foreach($file in Get-ChildItem -LiteralPath (Join-Path $taskRoot 'database/migrations') -Filter '*.sql' | Sort-Object Name){
  $source=[IO.File]::ReadAllText($file.FullName)
  $parser=[Microsoft.SqlServer.TransactSql.ScriptDom.TSql160Parser]::new($true)
  $errors=[Collections.Generic.List[Microsoft.SqlServer.TransactSql.ScriptDom.ParseError]]::new();$reader=[IO.StringReader]::new($source)
  try{$parsed=$parser.Parse($reader,[ref]$errors)}finally{$reader.Dispose()}
  if($errors.Count){throw "SQL parser rejected $($file.Name): $($errors[0].Message)"}
  foreach($batch in $parsed.Batches){if($batch.FragmentLength -gt 0){$null=Run $taskConnection $source.Substring($batch.StartOffset,$batch.FragmentLength)}}
  if($file.Name.StartsWith('131_')){$name='gp.ChangePlannedVisit';$definition=[string](Run $taskConnection "SELECT OBJECT_DEFINITION(OBJECT_ID('$name'));");Pass ((($definition -replace '^(CREATE|ALTER)','MODULE').Replace("`r`n","`n")) -ceq $taskOperationalBaseline[$name]) 'Scope restoration preserves the original planning workflow before mail-only follow-up'}
  if($file.Name.StartsWith('128_')){foreach($name in @('gp.RecordMovement','gp.RecordGuardDutyMovement','gp.DecideVisit','gp.ReadGuardDutyPass','gp._VisitReadJson','gp.ChangePlannedVisit')){$definition=[string](Run $taskConnection "SELECT OBJECT_DEFINITION(OBJECT_ID('$name'));");$taskOperationalBaseline[$name]=($definition -replace '^(CREATE|ALTER)','MODULE').Replace("`r`n","`n")}}

 }
 foreach($name in @($taskOperationalBaseline.Keys|Where-Object {$_ -ne 'gp.ChangePlannedVisit'})){$definition=[string](Run $taskConnection "SELECT OBJECT_DEFINITION(OBJECT_ID('$name'));");Pass ((($definition -replace '^(CREATE|ALTER)','MODULE').Replace("`r`n","`n")) -ceq $taskOperationalBaseline[$name]) ("Coordination scope correction restores pre-extension definition: "+$name)}
 Pass ((Run $taskConnection "SELECT COUNT(*) FROM sys.database_permissions WHERE major_id=OBJECT_ID('gp.PlannedAccess') AND grantee_principal_id=DATABASE_PRINCIPAL_ID('gp_api_runtime') AND permission_name='EXECUTE';") -eq 0) 'Retired planned operational RPC has no API grant'
 Pass ((Run $taskConnection 'SELECT COUNT(*) FROM gp.SchemaMigrations;') -eq (Get-ChildItem -LiteralPath (Join-Path $taskRoot 'database/migrations') -Filter '*.sql').Count) 'All current migrations apply on a fresh isolated database'
 $null=Run $taskConnection @'
INSERT gp.Users(UserId,IdentityIssuer,IdentitySubject,DisplayName) VALUES
 ('00000000-0000-0000-0000-000000000001','planning-test','host','Synthetic host'),
 ('00000000-0000-0000-0000-000000000002','planning-test','approver','Synthetic approver'),
 ('00000000-0000-0000-0000-000000000003','planning-test','facilities','Synthetic facilities');
INSERT gp.Locations(LocationCode,LocationName) VALUES('PLAN_A','Synthetic office A'),('PLAN_B','Synthetic office B');
INSERT gp.Projects(ExternalProjectCode,ProjectName) VALUES('PLAN_CLIENT','Synthetic client');
INSERT gp.ProjectLocations(ProjectId,LocationId) VALUES(1,1),(1,2);
INSERT gp.SubProjects(SubProjectId,AccountOfficeId,LocationId,Name,ChangedByUserId) VALUES
 ('00000000-0000-0000-0000-000000000100',1,1,'Alpha','00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000101',2,2,'Beta','00000000-0000-0000-0000-000000000001');
INSERT gp.VisitPlans(PlanId,LocationId,HostUserId,Revision,State,CreatedAtUtc) VALUES
 ('00000000-0000-0000-0000-000000001000',1,'00000000-0000-0000-0000-000000000001',1,'DRAFT',SYSUTCDATETIME()),
 ('00000000-0000-0000-0000-000000001001',2,'00000000-0000-0000-0000-000000000001',1,'DRAFT',SYSUTCDATETIME());
INSERT gp.VisitPlanVersions(PlanId,Version,LocationId,IsCurrent,VisitorName,Purpose,StartsAtUtc,UntilUtc,IsVip,PolicySnapshotJson) VALUES
 ('00000000-0000-0000-0000-000000001000',1,1,1,'Synthetic guest','Meeting','2026-11-02','2026-11-03',1,'{}'),
 ('00000000-0000-0000-0000-000000001001',1,2,1,'Synthetic guest','Meeting','2026-11-02','2026-11-03',0,'{}');
INSERT gp.VisitPlanProjects(PlanId,Version,SubProjectId,AccountOfficeId,LocationId) VALUES
 ('00000000-0000-0000-0000-000000001000',1,'00000000-0000-0000-0000-000000000100',1,1);
'@
 Denied "INSERT gp.SubProjects(SubProjectId,AccountOfficeId,LocationId,Name,ChangedByUserId) VALUES(NEWID(),1,2,'Forged office','00000000-0000-0000-0000-000000000001');"
 Denied "INSERT gp.VisitPlanProjects(PlanId,Version,SubProjectId,AccountOfficeId,LocationId) VALUES('00000000-0000-0000-0000-000000001000',1,'00000000-0000-0000-0000-000000000101',2,2);"
 Denied "INSERT gp.VisitPlanVersions(PlanId,Version,LocationId,IsCurrent,VisitorName,Purpose,StartsAtUtc,UntilUtc,IsVip,PolicySnapshotJson) VALUES('00000000-0000-0000-0000-000000001000',2,1,1,'Guest','Meeting','2026-11-02','2026-11-03',0,'{}');" @(2601,2627)
 Denied "INSERT gp.VisitPlanningPolicies(PolicyId,LocationId,ScopeKind,AccountOfficeId,SubProjectId,Revision,IsActive,DefinitionJson,ChangedByUserId,ChangedAtUtc,Reason) VALUES(NEWID(),1,'LOCATION',1,NULL,1,1,'{}','00000000-0000-0000-0000-000000000001',SYSUTCDATETIME(),'Invalid scope');"
 Denied "INSERT gp.VisitPlanningPolicies(PolicyId,LocationId,ScopeKind,Revision,IsActive,DefinitionJson,ChangedByUserId,ChangedAtUtc,Reason) VALUES(NEWID(),1,'LOCATION',1,1,'invalid','00000000-0000-0000-0000-000000000001',SYSUTCDATETIME(),'Invalid JSON');"
 $null=Run $taskConnection @'
INSERT gp.VisitPlanApprovalSteps(PlanId,Version,StepId,SubProjectId,Name,Kind,Mode) VALUES
 ('00000000-0000-0000-0000-000000001000',1,'00000000-0000-0000-0000-000000000200','00000000-0000-0000-0000-000000000100','Client coordinator','CLIENT_CONFIRMATION','ALL');
INSERT gp.VisitPlanApprovers(PlanId,Version,StepId,UserId) VALUES
 ('00000000-0000-0000-0000-000000001000',1,'00000000-0000-0000-0000-000000000200','00000000-0000-0000-0000-000000000002');
'@
 Denied "INSERT gp.VisitPlanDecisions VALUES('00000000-0000-0000-0000-000000001000',1,'00000000-0000-0000-0000-000000000200','00000000-0000-0000-0000-000000000003','CLIENT_CONFIRMATION','APPROVED','Wrong assignee','Ref',SYSUTCDATETIME());"
 Denied "INSERT gp.VisitPlanDecisions VALUES('00000000-0000-0000-0000-000000001000',1,'00000000-0000-0000-0000-000000000200','00000000-0000-0000-0000-000000000002','CLIENT_CONFIRMATION','APPROVED','Missing reference',NULL,SYSUTCDATETIME());"
 $null=Run $taskConnection "INSERT gp.VisitPlanDecisions VALUES('00000000-0000-0000-0000-000000001000',1,'00000000-0000-0000-0000-000000000200','00000000-0000-0000-0000-000000000002','CLIENT_CONFIRMATION','APPROVED','Internal review','Client reference',SYSUTCDATETIME());"
 Pass ((Run $taskConnection 'SELECT COUNT(*) FROM gp.VisitPlanDecisions;') -eq 1) 'Assigned internal client reference stored'
 $null=Run $taskConnection @'
INSERT gp.VisitPlanTasks VALUES('00000000-0000-0000-0000-000000001000',1,'00000000-0000-0000-0000-000000000300','Stay','STAY',0,'REQUESTED','');
INSERT gp.VisitPlanTaskOwners VALUES('00000000-0000-0000-0000-000000001000',1,'00000000-0000-0000-0000-000000000300','00000000-0000-0000-0000-000000000003');
INSERT gp.VisitPlanThreads VALUES
 ('00000000-0000-0000-0000-000000001000',1,'00000000-0000-0000-0000-000000000400','Stay discussion','OPERATIONS',NULL,NULL,'00000000-0000-0000-0000-000000000300','00000000-0000-0000-0000-000000000003',0),
 ('00000000-0000-0000-0000-000000001000',1,'00000000-0000-0000-0000-000000000401','General discussion','GENERAL',NULL,NULL,NULL,'00000000-0000-0000-0000-000000000001',0);
INSERT gp.VisitPlanMessages VALUES('00000000-0000-0000-0000-000000001000',1,'00000000-0000-0000-0000-000000000400','00000000-0000-0000-0000-000000000500',NULL,'00000000-0000-0000-0000-000000000003','Checking availability',SYSUTCDATETIME());
'@
 Denied "INSERT gp.VisitPlanThreads VALUES('00000000-0000-0000-0000-000000001001',1,NEWID(),'Foreign task','OPERATIONS',NULL,NULL,'00000000-0000-0000-0000-000000000300','00000000-0000-0000-0000-000000000001',0);"
 Denied "INSERT gp.VisitPlanMessages VALUES('00000000-0000-0000-0000-000000001000',1,'00000000-0000-0000-0000-000000000401',NEWID(),'00000000-0000-0000-0000-000000000500','00000000-0000-0000-0000-000000000001','Cross-thread reply',SYSUTCDATETIME());"
 Denied "INSERT gp.VisitPlanMessages VALUES('00000000-0000-0000-0000-000000001000',1,'00000000-0000-0000-0000-000000000400',NEWID(),NULL,'00000000-0000-0000-0000-000000000001','',SYSUTCDATETIME());"
 Denied "INSERT gp.VisitPlanParticipants VALUES('00000000-0000-0000-0000-000000001000',1,NEWID(),'00000000-0000-0000-0000-000000000001',NULL,'INFORMED');"
 $null=Run $taskConnection "CREATE USER [gp_planning_api_probe] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [gp_planning_api_probe];EXECUTE AS USER='gp_planning_api_probe';"
 try {foreach($table in @('SubProjects','SubProjectHosts','LocationPlanningHosts','VisitPlanningPolicies','VisitPlans','VisitPlanVersions','VisitPlanProjects','VisitPlanApprovalSteps','VisitPlanApprovers','VisitPlanDecisions','VisitPlanTasks','VisitPlanTaskOwners','VisitPlanParticipants','VisitPlanThreads','VisitPlanMessages','VisitPlanMentions','VisitPlanEvents','VisitPlanOperations','VisitPlanNotices')){Denied ('SELECT COUNT(*) FROM gp.'+$table+';') @(229)}}finally{$null=Run $taskConnection 'REVERT;'}
 Pass ((Run $taskConnection 'SELECT COUNT(*) FROM sys.foreign_keys WHERE is_disabled=1 OR is_not_trusted=1;') -eq 0) 'All foreign keys enabled and trusted'
 Write-Output "PASS: $taskChecks isolated planning schema/permission checks; retained application databases were not opened."
 if($IncludePersistence){ & (Join-Path $PSScriptRoot 'VisitPlanningPersistenceCases.ps1') -Connection $taskConnection; & (Join-Path $PSScriptRoot 'PlanningMailPersistenceCases.ps1') -Connection $taskConnection }
 if($KeepForBrowser){
  if(-not $IncludePersistence -or $env:NODE_ENV -ne 'test'){throw 'Isolated browser retention requires test mode and synthetic persistence fixtures.'}
  $null=Run $taskConnection "EXEC sys.sp_updateextendedproperty @name=N'GatePass.DirectoryMaxAgeSeconds',@value=3600;"
  $taskFixtureJson=@{database=$taskDatabase;createdBy='Test-VisitPlanningFoundation';createdAtUtc=[datetime]::UtcNow.ToString('o')}|ConvertTo-Json
  $taskFixtureDirectory=Join-Path $taskRoot 'tmp';[IO.Directory]::CreateDirectory($taskFixtureDirectory)|Out-Null
  $taskFixtureStream=[IO.File]::Open((Join-Path $taskFixtureDirectory 'planning-browser-fixture.json'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$taskFixtureBytes=[Text.Encoding]::UTF8.GetBytes($taskFixtureJson);$taskFixtureStream.Write($taskFixtureBytes);$taskFixtureStream.Flush($true)}finally{$taskFixtureStream.Dispose()}
  $taskKeepReady=$true;Write-Output 'Owned synthetic database retained for isolated browser tests.'
 }
} finally {
 if($taskConnection){try{$null=Run $taskConnection 'IF @@TRANCOUNT>0 ROLLBACK;'}catch{};$taskConnection.Dispose()}
 if($taskCreated -and $taskMaster -and -not $taskKeepReady){
  # The name is generated in this invocation, never supplied by a caller.
  if($taskDatabase -notmatch '^GatePass_Verification_[a-f0-9]{32}$'){throw 'Unexpected disposable cleanup target.'}
  $owned=Run $taskMaster "SELECT COUNT(*) FROM [$taskDatabase].sys.extended_properties WHERE class=0 AND name=N'GatePass.DisposableVerification' AND CONVERT(nvarchar(100),value)=N'$taskDatabase';"
  if($owned -ne 1){throw 'Refusing cleanup without this run ownership marker.'}
  $null=Run $taskMaster "ALTER DATABASE [$taskDatabase] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$taskDatabase];"
  Write-Output 'Owned disposable planning database removed.'
 }
 if($taskMaster){$taskMaster.Dispose()}
}
