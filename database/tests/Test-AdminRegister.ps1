#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
Import-Module (Join-Path (Split-Path -Parent $PSScriptRoot) '../tools/GatePass.LocalSql.psm1') -Force
$db=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate
$api=$null;$runs=@();$fixtures=@();$principal='gp_register_test_'+[guid]::NewGuid().ToString('N');$created=$false
function Assert($ok,$message){if(-not $ok){throw $message}}
function Expect([scriptblock]$work,[int]$number){try{$null=&$work}catch{if($_.Exception.GetBaseException().Number -eq $number){return};throw};throw "Expected SQL $number"}
function Params($label='ADMIN'){$a=$fixtures[0].actors.Where({$_.Label -eq $label})[0];return @{SessionHash=[Convert]::FromHexString($a.SessionHex);CsrfHash=[Convert]::FromHexString($a.CsrfHex);LocationId=[int]$fixtures[0].locationId;FromDate=$day;ToDate=$day;FiltersJson=(@{companyName=$marker}|ConvertTo-Json -Compress);Sort='personName';Direction='ASC';Page=1}}
function Read($p){$argsSql=($p.Keys|ForEach-Object{'@'+$_+'=@'+$_}) -join ',';return (Invoke-GatePassScalar $api ('EXEC gp.ReadAdminVisitRegister '+$argsSql) $p)|ConvertFrom-Json}
try{
 $day=Invoke-GatePassScalar $db 'SELECT CONVERT(char(10),CONVERT(date,DATEADD(minute,330,SYSUTCDATETIME())),23);'
 $marker='Register-'+[guid]::NewGuid().ToString('N')
 foreach($i in 1..3){$run=[guid]::NewGuid();$runs+=,$run;$f=(Invoke-GatePassScalar $db (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$run})|ConvertFrom-Json;$fixtures+=,$f
 Invoke-GatePassNonQuery $db 'UPDATE gp.VisitRequests SET CompanyName=@marker,DeviceTypesJson=N''["LAPTOP","PEN_DRIVE"]'' WHERE PublicReference LIKE @prefix+''-%'';' @{marker=$marker;prefix=$f.prefix}}
 $admin=$fixtures[0].actors.Where({$_.Label -eq 'ADMIN'})[0]
 Invoke-GatePassNonQuery $db "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(@grant,'VISITS_READ');CREATE USER [$principal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$principal];" @{grant=[long]$admin.GrantId};$created=$true
 $api=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $api "EXECUTE AS USER='$principal';"
 $p=Params;$first=Read $p;Assert ($first.rows.Count -eq 50 -and $first.total -gt 50) 'First register page/count incorrect'
 $again=Read $p;Assert (($first.rows.visitRequestId -join ',') -eq ($again.rows.visitRequestId -join ',')) 'Tied names did not have stable ordering'
 $p.Page=2;$second=Read $p;Assert (($first.rows.Count+$second.rows.Count) -eq $first.total) 'Register dropped records across pages'
 Assert (@($first.rows.visitRequestId|Where-Object{$_ -in $second.rows.visitRequestId}).Count -eq 0) 'Duplicate record across pages'
 Assert (@($first.rows|Where-Object{$_.companyName -ne $marker}).Count -eq 0) 'Filter leaked unrelated records'
 $p.Page=1;$p.Direction='DESC';$descending=Read $p;Assert ($descending.rows[0].personName -ge $first.rows[0].personName) 'Descending sort failed'
 foreach($sort in @('localVisitDate','personEmail','deviceTypes','hostName','status','printStatus','returnedAtUtc','validUntilUtc')){$p.Sort=$sort;$null=Read $p}
 Write-Output 'PASS: execute-only identity, true range filtering, stable sorting and 50-row pagination'
 $p=Params;$p.ForExport=$true;$export=Read $p;Assert ($export.datasetVersion -cmatch '^[a-f0-9]{64}$') 'Export fingerprint missing'
 $p.Page=2;$exportNext=Read $p;Assert ($export.datasetVersion -ceq $exportNext.datasetVersion) 'Unchanged pages produced different fingerprints'
 $changed=[guid]$first.rows[0].visitRequestId
 Invoke-GatePassNonQuery $db 'UPDATE gp.VisitRequests SET Reason=Reason+N'' export test'' WHERE VisitRequestId=@id;' @{id=$changed}
 $p.Page=1;$afterChange=Read $p;Assert ($afterChange.total -eq $export.total -and $afterChange.datasetVersion -cne $export.datasetVersion) 'Same-count content change was not detected'
 $p.Sort='validUntilUtc';Assert ((Read $p).datasetVersion -ceq $afterChange.datasetVersion) 'Fingerprint depends on pagination sort'
 Write-Output 'PASS: export fingerprint is stable across pages and detects same-count content changes'
 $p=Params;$p.FiltersJson=(@{companyName=$marker;status='PENDING';deviceTypes='PEN_DRIVE';hostName='Synthetic HOST'}|ConvertTo-Json -Compress);$r=Read $p;Assert ($r.total -gt 0 -and @($r.rows|Where-Object{$_.status -ne 'PENDING' -or $_.hostName -ne 'Synthetic HOST'}).Count -eq 0) 'Combined filters incorrect'
 $p.FiltersJson=(@{companyName=$marker;printStatus='PRINTED'}|ConvertTo-Json -Compress);Assert ((Read $p).total -eq 0) 'PRINTED incorrectly matched NOT_PRINTED'
 $p.FiltersJson='{"personName":"%"}';Assert ((Read $p).total -eq 0) 'Wildcard was interpreted instead of matched literally'
 $p=Params;$p.ProjectLocationId=[long]$fixtures[0].projectLocationId;$r=Read $p;Assert ($r.total -gt 0 -and $r.total -lt $first.total -and @($r.rows|Where-Object{$_.projectName -ne 'Synthetic Alpha'}).Count -eq 0) 'Project scope did not narrow records'
 Write-Output 'PASS: combined name/host/device/status filters, exact states and literal text matching'
 $guard=$fixtures[0].actors.Where({$_.Label -eq 'GUARD'})[0]
 $movement=$fixtures[0].visits.Where({$_.Label -eq 'MOVEMENT'})[0]
 foreach($event in @('ENTRY','EXIT')){
  $m=@{SessionHash=[Convert]::FromHexString($guard.SessionHex);CsrfHash=[Convert]::FromHexString($guard.CsrfHex);ClientKey=[guid]::NewGuid();VisitRequestId=[guid]$movement.VisitId;AccessPassId=[guid]$movement.PassId;LocationId=[int]$fixtures[0].locationId;SelectedProjectLocationId=[long]$fixtures[0].projectLocationId;EventType=$event;EntryMethod='MANUAL'}
  $argsSql=($m.Keys|ForEach-Object{'@'+$_+'=@'+$_}) -join ',';$null=Invoke-GatePassScalar $api ('EXEC gp.RecordMovement '+$argsSql) $m
 }
 $p=Params;$p.FiltersJson=(@{companyName=$marker;personName='Synthetic MOVEMENT'}|ConvertTo-Json -Compress);$r=Read $p;$record=$r.rows.Where({[guid]$_.visitRequestId -eq [guid]$movement.VisitId})[0]
 Assert ($null -ne $record.firstEntryAtUtc -and $null -ne $record.lastEntryAtUtc -and $null -ne $record.lastExitAtUtc -and $record.presence -eq 'OUTSIDE') 'Movement timestamps missing or incorrect'
 # Another request belonging to the same employee must not mark this project's visit as inside.
 $sibling=$fixtures[0].visits.Where({$_.Label -eq 'EMP_STALE'})[0]
 $m.VisitRequestId=[guid]$sibling.VisitId;$m.AccessPassId=[guid]$sibling.PassId;$m.ClientKey=[guid]::NewGuid();$m.EventType='ENTRY';$argsSql=($m.Keys|ForEach-Object{'@'+$_+'=@'+$_}) -join ',';$null=Invoke-GatePassScalar $api ('EXEC gp.RecordMovement '+$argsSql) $m
 $p.FiltersJson=(@{companyName=$marker;personName='Synthetic EMP_DISABLED'}|ConvertTo-Json -Compress);$r=Read $p;Assert (@($r.rows|Where-Object{$_.presence -ne 'OUTSIDE'}).Count -eq 0) 'Sibling request leaked presence into another project visit'
 Write-Output 'PASS: first/latest entry and latest exit timestamps; project visits retain their own recorded presence'
 foreach($label in @('HOST','GUARD','WRONGLOCATION','NOCAP')){Expect {Read (Params $label)} 52001}
 $p=Params;$p.LocationId=[int]$fixtures[0].otherLocationId;Expect {Read $p} 52001
 $p=Params;$p.ProjectLocationId=[long]$fixtures[0].projectLocationId;$p.LocationId=[int]$fixtures[0].otherLocationId;Expect {Read $p} 52001
 foreach($change in @(@{Sort='personName]; DROP TABLE gp.Users;--'},@{Direction='DESC;'},@{Page=0},@{FiltersJson='{"password":"secret"}'},@{FiltersJson='{"status":"PENDING","status":"APPROVED"}'},@{ToDate='2099-01-01'})){$p=Params;foreach($key in $change.Keys){$p[$key]=$change[$key]};Expect {Read $p} 52002}
 $p=Params;$p.Page=999;Assert ((Read $p).rows.Count -eq 0) 'Out-of-range page did not return an empty page'
 $projectActor=$fixtures[0].actors.Where({$_.Label -eq 'OTHERHOST'})[0]
 Invoke-GatePassNonQuery $db @'
INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,ProjectLocationId,GrantedByUserId,ValidFromUtc)
VALUES(@user,'PROJECT_ADMIN','PROJECT_LOCATION',@pair,@admin,DATEADD(minute,-1,SYSUTCDATETIME()));
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(CONVERT(bigint,SCOPE_IDENTITY()),'VISITS_READ');
'@ @{user=[guid]$projectActor.UserId;pair=[long]$fixtures[0].projectLocationId;admin=[guid]$admin.UserId}
 $p=Params 'OTHERHOST';Expect {Read $p} 52001
 $p.ProjectLocationId=[long]$fixtures[0].projectLocationId;$scoped=Read $p;Assert ($scoped.total -gt 0 -and $scoped.total -lt $first.total -and @($scoped.rows|Where-Object{$_.projectName -ne 'Synthetic Alpha'}).Count -eq 0) 'Project administrator escaped own project'
 $p.ProjectLocationId=[long]$fixtures[1].projectLocationId;Expect {Read $p} 52001
 Invoke-GatePassNonQuery $db "DELETE gp.GrantCapabilities WHERE RoleGrantId=@grant AND CapabilityCode='VISITS_READ';" @{grant=[long]$admin.GrantId};Expect {Read (Params)} 52001
 Expect {Invoke-GatePassScalar $api 'SELECT COUNT(*) FROM gp.VisitRequests;'} 229
 Write-Output 'PASS: office/project/role boundaries, fresh capability revocation, unknown/duplicate filter rejection, sort injection rejection and no direct table reads'
}finally{
 if($api){$api.Dispose()}
 try{foreach($run in $runs){Invoke-GatePassNonQuery $db (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$run}};if($created){Invoke-GatePassNonQuery $db "DROP USER [$principal];"}}finally{$db.Dispose()}
}
