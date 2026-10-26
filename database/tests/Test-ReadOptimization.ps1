#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskRun=[guid]::NewGuid();$taskPrefix='GP02-'+$taskRun.ToString('N').Substring(0,20).ToUpperInvariant()
$taskDb=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskApi=$null;$taskCreated=$false;$taskFixtureAttempted=$false;$taskPrincipal='gp_read_sets_'+$taskRun.ToString('N')
$taskBaselines=@{};$taskCases=[Collections.Generic.List[object]]::new();$taskFailure=$null
function Auth([string]$Actor){return @{SessionHash=[Convert]::FromHexString($taskActors[$Actor].sessionHex);CsrfHash=[Convert]::FromHexString($taskActors[$Actor].csrfHex)}}
function Packet([string]$Procedure,[hashtable]$Parameters){
 try{$taskArguments=($Parameters.Keys|ForEach-Object{'@'+$_+'=@'+$_})-join ',';$taskValue=(Invoke-GatePassScalar $taskApi ('EXEC '+$Procedure+' '+$taskArguments) $Parameters)|ConvertFrom-Json;if($null -ne $taskValue.PSObject.Properties['checkedAtUtc']){$taskValue.PSObject.Properties.Remove('checkedAtUtc')};if($null -ne $taskValue.PSObject.Properties['visitors']){foreach($taskRow in $taskValue.visitors){if($null -ne $taskRow.PSObject.Properties['photoVersion']){$taskRow.PSObject.Properties.Remove('photoVersion')}}};return @{ok=$true;packet=$taskValue}}
 catch{$taskException=$_.Exception.GetBaseException();if($taskException -is [Data.SqlClient.SqlException]){return @{ok=$false;number=$taskException.Number}};throw}
}
function Compare-Read([string]$Name,[string]$Procedure,[string]$Actor,[hashtable]$Parameters){
 $taskParameters=(Auth $Actor)+$Parameters
 $taskOld=Packet $taskBaselines[$Procedure] $taskParameters;$taskNew=Packet ('gp.'+$Procedure) $taskParameters
 # The immutable baseline omits an empty row array. Migration 109 intentionally
 # repairs that wire contract; require the new array before comparing other fields.
 $taskArrayField=if($Procedure -eq 'ReadGuardQueue'){'visitors'}elseif($Procedure -eq 'ReadActionCentre'){'items'}else{$null}
 if($taskArrayField -and $taskOld.ok -and $null -eq $taskOld.packet.PSObject.Properties[$taskArrayField]){
  Require ($taskNew.ok -and $null -ne $taskNew.packet.PSObject.Properties[$taskArrayField] -and $taskNew.packet.$taskArrayField -is [array] -and $taskNew.packet.$taskArrayField.Count -eq 0) ('Explicit empty array required: '+$Name)
  $taskOld.packet|Add-Member -NotePropertyName $taskArrayField -NotePropertyValue ([object[]]@())
  # Property order is irrelevant to JSON clients; adding the repaired field last
  # must not change the comparison while all values and array ordering stay exact.
  $taskOld.packet=$taskOld.packet|Select-Object -Property @($taskOld.packet.PSObject.Properties.Name|Sort-Object)
  $taskNew.packet=$taskNew.packet|Select-Object -Property @($taskNew.packet.PSObject.Properties.Name|Sort-Object)
 }
 if(($taskOld|ConvertTo-Json -Depth 18 -Compress) -ne ($taskNew|ConvertTo-Json -Depth 18 -Compress)){
  if($taskOld.ok -and $taskNew.ok){foreach($taskField in $taskOld.packet.PSObject.Properties.Name){if(($taskOld.packet.$taskField|ConvertTo-Json -Depth 18 -Compress) -ne ($taskNew.packet.$taskField|ConvertTo-Json -Depth 18 -Compress)){Write-Host ('Mismatch field: '+$taskField+'; old count '+@($taskOld.packet.$taskField).Count+'; new count '+@($taskNew.packet.$taskField).Count)}}}else{Write-Host ('Old SQL status '+$taskOld['number']+'; new SQL status '+$taskNew['number'])}
  throw ('Output/denial mismatch: '+$Name)
 }
 $taskCases.Add(@{name=$Name;passed=$true;authorized=$taskNew.ok});Write-Host ('PASS: '+$Name)
 return $taskNew
}
function Require($Condition,[string]$Message){if(-not $Condition){throw $Message}}
try{
 Require ((Invoke-GatePassScalar $taskDb "SELECT COUNT(*) FROM gp.SchemaMigrations WHERE Version='100';") -eq 1) 'Migration 100 required'
 $taskFixtureAttempted=$true
 $taskFixture=(& (Join-Path $taskRoot 'tools/LoadStressFixture.ps1') -RunId $taskRun -Action Create)|ConvertFrom-Json
 $null=& (Join-Path $taskRoot 'tools/LoadStressFixture.ps1') -RunId $taskRun -Action Refresh
 $taskPair=[long]$taskFixture.state.pair;$taskDay=[datetime]$taskFixture.state.today
 $taskActors=@{}
 foreach($taskActor in @('GUARD','GUARD2','WRONGPROJECT','WRONGLOCATION','NOCAP','ADMIN','RECEPTION','EXPIRED','BLOCKED')){
  $taskActors[$taskActor]=(Invoke-GatePassScalar $taskDb "SELECT(SELECT TOP(1) CONVERT(varchar(36),u.UserId) actor,CONVERT(varchar(64),s.SessionHash,2) sessionHex,CONVERT(varchar(64),s.CsrfHash,2) csrfHex FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject=@subject ORDER BY s.CreatedAtUtc DESC FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);" @{subject=$taskPrefix+':'+$taskActor})|ConvertFrom-Json
 }
 $taskCommon=[long](Invoke-GatePassScalar $taskDb @'
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
INSERT gp.CommonAreas(LocationId,AreaName) VALUES(1,@name);DECLARE @area bigint=SCOPE_IDENTITY();
INSERT gp.GuardCommonAreaAssignments(GuardUserId,CommonAreaId,AssignedByUserId,ValidFromUtc,Reason) VALUES(@guard,@area,@admin,DATEADD(hour,-1,SYSUTCDATETIME()),N'Owned read equivalence');
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT RoleGrantId,'REPORTS_EXPORT' FROM gp.StaffRoleGrants WHERE UserId=@admin AND RoleCode='LOCATION_ADMIN';
COMMIT;SELECT @area;
'@ @{name=$taskPrefix+' Read common';guard=[guid]$taskActors.GUARD.actor;admin=[guid]$taskActors.ADMIN.actor})
 $taskSources=@{
  ReadGuardQueue='092_workspace_queue_paging.sql';ReadReceptionQueue='092_workspace_queue_paging.sql';
  GetOperationalSummaryRange='091_operational_summary_range.sql';ReadActionCentre='098_digital_id_presence_followups.sql';ReadAdminVisitRegister='099_employee_presence_and_export_authority.sql'
 }
 foreach($taskName in $taskSources.Keys){
  $taskSource=Get-Content -LiteralPath (Join-Path $taskRoot ('database/migrations/'+$taskSources[$taskName])) -Raw
  $taskMatch=[regex]::Match($taskSource,'(?s)(?:CREATE|ALTER) PROCEDURE gp\.'+$taskName+'\b.*?(?=\r?\nGO\s*(?:\r?\n|$)|$)')
  Require $taskMatch.Success ('Immutable baseline source missing: '+$taskName)
  $taskBaseline='gp.ReadBaseline_'+$taskName+'_'+$taskRun.ToString('N');$taskBaselines[$taskName]=$taskBaseline
  Invoke-GatePassNonQuery $taskDb ([regex]::Replace($taskMatch.Value,'^(?:CREATE|ALTER) PROCEDURE gp\.'+$taskName,'CREATE PROCEDURE '+$taskBaseline))
 }
 Invoke-GatePassNonQuery $taskDb "CREATE USER [$taskPrincipal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$taskPrincipal];";$taskCreated=$true
 foreach($taskBaseline in $taskBaselines.Values){Invoke-GatePassNonQuery $taskDb "GRANT EXECUTE ON $taskBaseline TO [$taskPrincipal];"}
 $taskApi=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskApi "EXECUTE AS USER='$taskPrincipal';"
 $taskGuard=@{LocationId=1;DutyKind='PROJECT';DutyId=$taskPair;Queue='EXPECTED';Search=''}
 $taskFirst=Compare-Read 'guard project first page' 'ReadGuardQueue' 'GUARD' $taskGuard
 $taskSecond=$taskGuard.Clone();$taskSecond.AfterSubmittedAtUtc=[datetime]$taskFirst.packet.afterSubmittedAtUtc;$taskSecond.AfterVisitRequestId=[guid]$taskFirst.packet.afterVisitRequestId
 $taskNext=Compare-Read 'guard keyset second page' 'ReadGuardQueue' 'GUARD' $taskSecond
 foreach($taskSearch in @('Rohan Mehta','rohan',($taskPrefix+'-Q1000'),'no-such-owned-name')){$taskP=$taskGuard.Clone();$taskP.Search=$taskSearch;$null=Compare-Read ('guard search '+$taskSearch) 'ReadGuardQueue' 'GUARD' $taskP}
 $taskAll=$taskGuard.Clone();$taskAll.DutyKind='ALL';$taskAll.Remove('DutyId');$null=Compare-Read 'guard combined project/common allocations' 'ReadGuardQueue' 'GUARD' $taskAll
 $taskP=$taskGuard.Clone();$taskP.DutyKind='COMMON';$taskP.DutyId=$taskCommon;$null=Compare-Read 'guard common verification queue' 'ReadGuardQueue' 'GUARD' $taskP
 foreach($taskActor in @('WRONGPROJECT','WRONGLOCATION','NOCAP','EXPIRED','BLOCKED')){$null=Compare-Read ('guard denial '+$taskActor) 'ReadGuardQueue' $taskActor $taskGuard}
 $taskWindow=Packet 'gp.ReadGuardQueue' ((Auth 'GUARD')+$taskGuard+@{Take=48})
 Require $taskWindow.ok 'Guard window rejected';Require (@($taskWindow.packet.visitors).Count -eq 48) 'Guard window size'
 Require ((@($taskFirst.packet.visitors)+@($taskNext.packet.visitors)|ConvertTo-Json -Depth 18 -Compress) -eq ($taskWindow.packet.visitors|ConvertTo-Json -Depth 18 -Compress)) 'Guard window differs from two pages'
 $taskCases.Add(@{name='guard 48-row refresh equals two immutable baseline pages';passed=$true})
 foreach($taskTake in @(0,23,241)){Require ((Packet 'gp.ReadGuardQueue' ((Auth 'GUARD')+$taskGuard+@{Take=$taskTake})).number -eq 52002) 'Guard window bound bypassed'}
 foreach($taskKind in @('PROJECT','COMMON','ALL')){
  $taskEmpty=$taskGuard.Clone();$taskEmpty.DutyKind=$taskKind;$taskEmpty.Search='no-such-owned-name';if($taskKind -eq 'COMMON'){$taskEmpty.DutyId=$taskCommon}elseif($taskKind -eq 'ALL'){$taskEmpty.Remove('DutyId')}
  $taskPacket=Packet 'gp.ReadGuardQueue' ((Auth 'GUARD')+$taskEmpty)
  Require ($taskPacket.ok -and $null -ne $taskPacket.packet.PSObject.Properties['visitors'] -and $taskPacket.packet.visitors -is [array] -and $taskPacket.packet.visitors.Count -eq 0 -and $taskPacket.packet.total -eq 0 -and -not $taskPacket.packet.hasMore) ('Empty guard array contract: '+$taskKind)
  $taskCases.Add(@{name='empty guard '+$taskKind+' emits visitors array and zero total';passed=$true})
 }
 $taskTerminal=$taskGuard.Clone();$taskTerminal.AfterSubmittedAtUtc=[datetime]'1900-01-01';$taskTerminal.AfterVisitRequestId=[guid]::NewGuid()
 $taskPacket=Packet 'gp.ReadGuardQueue' ((Auth 'GUARD')+$taskTerminal)
 Require ($taskPacket.ok -and $taskPacket.packet.visitors -is [array] -and $taskPacket.packet.visitors.Count -eq 0 -and $taskPacket.packet.total -eq $taskFirst.packet.total -and -not $taskPacket.packet.hasMore) 'Terminal guard page must retain total and empty array'
 $taskCases.Add(@{name='terminal guard page retains total and explicit empty array';passed=$true})
 foreach($taskWorkspace in @('GUARD','RECEPTION','ADMIN')){foreach($taskCategory in @('PENDING','EXPIRED_INSIDE','UNRETURNED')){
  $taskP=@{LocationId=1;Workspace=$taskWorkspace;DutyKind=if($taskWorkspace -eq 'GUARD'){'PROJECT'}else{'OFFICE'};DutyId=if($taskWorkspace -eq 'GUARD'){$taskPair}else{[long]0};Category=$taskCategory}
  $null=Compare-Read ('actions '+$taskWorkspace+' '+$taskCategory) 'ReadActionCentre' $taskWorkspace $taskP
 }}
 foreach($taskWorkspace in @('GUARD','RECEPTION','ADMIN')){
  $taskP=@{LocationId=1;Workspace=$taskWorkspace;DutyKind=if($taskWorkspace -eq 'GUARD'){'PROJECT'}else{'OFFICE'};DutyId=if($taskWorkspace -eq 'GUARD'){$taskPair}else{[long]0};Category='PENDING';AfterSubmittedAtUtc=[datetime]'1900-01-01';AfterVisitRequestId=[guid]::NewGuid()}
  $taskPacket=Packet 'gp.ReadActionCentre' ((Auth $taskWorkspace)+$taskP)
  Require ($taskPacket.ok -and $null -ne $taskPacket.packet.PSObject.Properties['items'] -and $taskPacket.packet.items -is [array] -and $taskPacket.packet.items.Count -eq 0 -and -not $taskPacket.packet.hasMore) ('Terminal action array contract: '+$taskWorkspace)
  $taskCases.Add(@{name='terminal actions '+$taskWorkspace+' emits empty items array';passed=$true})
 }
 $taskReception=@{LocationId=1;LocalVisitDate=$taskDay}
 $taskReceptionFirst=Compare-Read 'reception first page and office counts' 'ReadReceptionQueue' 'RECEPTION' $taskReception
 $taskP=$taskReception.Clone();$taskP.AfterSubmittedAtUtc=[datetime]$taskReceptionFirst.packet.afterSubmittedAtUtc;$taskP.AfterVisitRequestId=[guid]$taskReceptionFirst.packet.afterVisitRequestId
 $taskReceptionNext=Compare-Read 'reception second page and office counts' 'ReadReceptionQueue' 'RECEPTION' $taskP
 $taskWindow=Packet 'gp.ReadReceptionQueue' ((Auth 'RECEPTION')+$taskReception+@{Take=100})
 Require ((@($taskReceptionFirst.packet.visits)+@($taskReceptionNext.packet.visits)|ConvertTo-Json -Depth 18 -Compress) -eq ($taskWindow.packet.visits|ConvertTo-Json -Depth 18 -Compress)) 'Reception window differs from two pages'
 $taskCases.Add(@{name='reception 100-row refresh equals two baseline pages';passed=$true})
 foreach($taskPatch in @(@{Search='Rohan'},@{PendingReturns=$true},@{InsideOnly=$true},@{TypeFilter='EMPLOYEE'},@{PrintFilter='UNPRINTED'},@{Status='PENDING'})){$null=Compare-Read ('reception filter '+($taskPatch.Keys -join ',')) 'ReadReceptionQueue' 'RECEPTION' ($taskReception+$taskPatch)}
 $taskSummary=@{LocationId=1;FromDate=$taskDay.AddDays(-30);ToDate=$taskDay;ProjectLocationId=$taskPair}
 $null=Compare-Read 'summary 31-day project and zero days' 'GetOperationalSummaryRange' 'ADMIN' $taskSummary
 $taskP=$taskSummary.Clone();$taskP.Remove('ProjectLocationId');$null=Compare-Read 'summary office counts and current occupants' 'GetOperationalSummaryRange' 'ADMIN' $taskP
 $taskRegister=@{LocationId=1;FromDate=$taskDay;ToDate=$taskDay;ProjectLocationId=$taskPair}
 $null=Compare-Read 'register projection and counts' 'ReadAdminVisitRegister' 'ADMIN' $taskRegister
 $null=Compare-Read 'register late projection second page ascending' 'ReadAdminVisitRegister' 'ADMIN' ($taskRegister+@{Page=2;Direction='ASC'})
 $null=Compare-Read 'register late projection empty last page preserves total' 'ReadAdminVisitRegister' 'ADMIN' ($taskRegister+@{Page=100000})
 $null=Compare-Read 'export fingerprint unchanged' 'ReadAdminVisitRegister' 'ADMIN' ($taskRegister+@{ForExport=$true})
 $taskExport=Packet 'gp.ReadAdminVisitRegister' ((Auth 'ADMIN')+$taskRegister+@{ForExport=$true;PageSize=200})
 Require ($taskExport.ok -and $taskExport.packet.pageSize -eq 200 -and $taskExport.packet.rows.Count -eq 200) 'Bounded export chunk unavailable'
 Require ((Packet 'gp.ReadAdminVisitRegister' ((Auth 'ADMIN')+$taskRegister+@{PageSize=200})).number -eq 52002) 'Read authority gained export-sized chunks'
 $taskCases.Add(@{name='export 200-row chunks require export authority and preserve full fingerprint';passed=$true})
 # Only owned directory data changes; an inside employee remains visible after eligibility expires.
 $taskTemp=$taskFixture.state.movementVisits|Where-Object requestType -eq TEMP_ID
 $taskMove=@{LocationId=1;DutyKind='PROJECT';DutyId=$taskPair;VisitRequestId=[guid]$taskTemp.visitRequestId;AccessPassId=[guid]$taskTemp.accessPassId;ClientKey=[guid]::NewGuid();EventType='ENTRY';EntryMethod='MANUAL'}
 Require ((Packet 'gp.RecordGuardDutyMovement' ((Auth 'GUARD')+$taskMove)).ok) 'Owned employee entry failed'
 Invoke-GatePassNonQuery $taskDb "UPDATE e SET LastSyncedAtUtc=DATEADD(minute,-20,SYSUTCDATETIME()) FROM gp.Employees e JOIN gp.Users u ON u.UserId=e.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%';" @{prefix=$taskPrefix}
 $taskInside=$taskGuard.Clone();$taskInside.Queue='INSIDE';$null=Compare-Read 'inside TEMP_ID survives directory staleness with original entry owner' 'ReadGuardQueue' 'GUARD' $taskInside
 $null=Compare-Read 'stale employee expected list' 'ReadGuardQueue' 'GUARD' $taskGuard
 $taskMove.ClientKey=[guid]::NewGuid();$taskMove.EventType='EXIT';Require ((Packet 'gp.RecordGuardDutyMovement' ((Auth 'GUARD')+$taskMove)).ok) 'Owned employee exit failed'
 Invoke-GatePassNonQuery $taskDb "UPDATE gp.StaffRoleGrants SET RevokedAtUtc=SYSUTCDATETIME(),RevokedByUserId=@actor WHERE UserId=@actor AND RoleCode='LOCATION_ADMIN';" @{actor=[guid]$taskActors.ADMIN.actor}
 $null=Compare-Read 'summary never reuses an earlier administrator grant' 'GetOperationalSummaryRange' 'ADMIN' $taskSummary
}catch{$taskFailure=$_.Exception.Message;Write-Host ('FAIL: '+$taskFailure)}finally{
 if($taskApi){$taskApi.Dispose()}
 foreach($taskBaseline in $taskBaselines.Values){try{Invoke-GatePassNonQuery $taskDb ("DROP PROCEDURE IF EXISTS "+$taskBaseline+';')}catch{$taskFailure='BASELINE_CLEANUP_FAILED'}}
 if($taskCreated){try{Invoke-GatePassNonQuery $taskDb "DROP USER [$taskPrincipal];"}catch{$taskFailure='PRINCIPAL_CLEANUP_FAILED'}}
 $taskDb.Dispose()
 if($taskFixtureAttempted){try{$null=& (Join-Path $taskRoot 'tools/LoadStressFixture.ps1') -RunId $taskRun -Action Cleanup}catch{$taskFailure='FIXTURE_CLEANUP_FAILED'}}
 $taskDirectory=Join-Path $taskRoot ('output/read-optimization/'+$taskRun);$null=New-Item -ItemType Directory -Path $taskDirectory -Force
 @{status=if($taskFailure){'FAIL'}else{'PASS'};runId=$taskRun.ToString();cases=$taskCases.ToArray();failure=$taskFailure}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $taskDirectory 'report.json') -Encoding utf8
 Write-Host ('READ_OPTIMIZATION_REPORT '+(Join-Path $taskDirectory 'report.json'))
}
if($taskFailure){throw $taskFailure}
