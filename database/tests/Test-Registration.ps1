#Requires -Version 7.0
[CmdletBinding()]
param([string]$Server='localhost\SQLEXPRESS',[switch]$TrustLocalServerCertificate,[string]$SharpPath=$env:GATEPASS_SHARP_PATH)
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskAdmin=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskRun=[guid]::NewGuid(); $taskCases=[Collections.Generic.List[object]]::new(); $taskConnections=[Collections.Generic.List[object]]::new()
$taskOwned=[Collections.Generic.List[object]]::new(); $taskPrincipals=[Collections.Generic.List[string]]::new(); $taskActors=@{}
$taskFixtureReady=$false; $taskComplete=$false; $taskClean=$false
$taskSubmitSql='EXEC gp.SubmitRegistration @IntakeId,@TokenHash,@IntakeCsrfHash,@ClientKey,@RequestType,@LocationId,@Reason,@PeopleJson,@ProjectLocationId,@HostEmployeeId,@TemporaryIdReason,@ValidFromUtc,@ValidUntilUtc,@CredentialsJson,@SessionHash,@CsrfHash;'
function Assert-Condition($Value,[string]$Message) { if (-not $Value) { throw $Message } }
function Random-Hash { return ,([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)) }
function Sql-Number($Exception) { $taskBase=$Exception.GetBaseException(); if ($taskBase -is [Data.SqlClient.SqlException]) { return $taskBase.Number }; return 0 }
function Expect-Error([scriptblock]$Action,[int]$Number) { try { $null=& $Action } catch { if ((Sql-Number $_.Exception) -eq $Number) { return }; throw }; throw "Expected SQL error $Number." }
function Call($Connection,[string]$Procedure,[hashtable]$Parameters) {
    $taskArgs=($Parameters.Keys | ForEach-Object {'@'+$_+'=@'+$_}) -join ','
    return (Invoke-GatePassScalar $Connection ('EXEC '+$Procedure+' '+$taskArgs+';') $Parameters) | ConvertFrom-Json
}
function Auth([string]$Actor='HOST') { return @{SessionHash=[Convert]::FromHexString($taskActors[$Actor].SessionHex);CsrfHash=[Convert]::FromHexString($taskActors[$Actor].CsrfHex)} }
function Cleanup-Registration {
    if ($taskOwned.Count) {
        $taskText=ConvertTo-Json -InputObject @($taskOwned) -Compress -Depth 4
        Invoke-GatePassNonQuery $taskAdmin ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '004_registration_cleanup.sql'))) @{IntakesJson=$taskText;RunId=$taskRun}
        $taskOwned.Clear()
    }
}
function New-Intake([string]$Type='PUBLIC',[string]$Actor='HOST') {
    $taskParams=@{IntakeId=[guid]::NewGuid();TokenHash=(Random-Hash);IntakeCsrfHash=(Random-Hash);IntakeType=$Type;SessionHash=$null;CsrfHash=$null}
    if ($Type -eq 'EMPLOYEE') { $taskAuthParams=Auth $Actor; $taskParams.SessionHash=$taskAuthParams.SessionHash; $taskParams.CsrfHash=$taskAuthParams.CsrfHash }
    $taskOwned.Add(@{intakeId=[string]$taskParams.IntakeId;tokenHash=[Convert]::ToHexString($taskParams.TokenHash)})
    $null=Call $taskApi 'gp.CreateRegistrationIntake' $taskParams
    $taskParams.Remove('IntakeType'); return $taskParams
}
function Add-Photo($Intake,[byte[]]$Content=(Random-Hash)) {
    $taskParams=$Intake.Clone(); $taskParams.PhotoAssetId=[guid]::NewGuid(); $taskParams.ContentHash=$Content
    $taskParams.MimeType='image/jpeg'; $taskParams.ByteLength=100; $taskParams.PixelWidth=100; $taskParams.PixelHeight=100
    $null=Call $taskApi 'gp.RecordRegistrationPhoto' $taskParams
    return $taskParams.PhotoAssetId
}
function New-Credentials($People) {
    return ConvertTo-Json -InputObject @($People | ForEach-Object {@{clientPersonKey=[string]$_.clientPersonKey;visitRequestId=[string][guid]::NewGuid();accessPassId=[string][guid]::NewGuid();
        credentialHash=[Convert]::ToHexString((Random-Hash));ciphertext=[Convert]::ToHexString((Random-Hash));nonce=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(12));
        authenticationTag=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(16));keyVersion='qr.v1.sqlfixture'}}) -Depth 5 -Compress
}
function New-Submission([string]$Type='TEMP_ID',[int]$Count=1,[byte[]]$PhotoContent=[byte[]]::new(32)) {
    $taskIntake=New-Intake $(if ($Type -eq 'EXTERNAL') {'PUBLIC'} else {'EMPLOYEE'})
    $taskPeople=@(for ($taskIndex=0;$taskIndex -lt $Count;$taskIndex++) {
        $taskPerson=@{clientPersonKey=[string][guid]::NewGuid();photoAssetId=[string](Add-Photo $taskIntake $PhotoContent)}
        if ($Type -eq 'EXTERNAL') { $taskPerson.personName='Visitor '+($taskIndex+1);$taskPerson.personEmail=$null;$taskPerson.personPhone='+919876543210' }
        $taskPerson
    })
    $taskParams=$taskIntake.Clone(); $taskParams.ClientKey=[guid]::NewGuid(); $taskParams.RequestType=$Type
    $taskParams.LocationId=[int]$taskFixture.locationId; $taskParams.Reason='Registration test only'; $taskParams.PeopleJson=ConvertTo-Json -InputObject $taskPeople -Depth 5 -Compress
    $taskParams.ProjectLocationId=$null; $taskParams.HostEmployeeId=$null; $taskParams.TemporaryIdReason='FORGOT'; $taskParams.ValidFromUtc=$null; $taskParams.ValidUntilUtc=$null
    if ($Type -ne 'TEMP_ID') {
        $taskParams.ProjectLocationId=[long]$taskFixture.projectLocationId; $taskParams.HostEmployeeId=$taskOtherHost
        $taskParams.TemporaryIdReason=$null
        $taskParams.ValidFromUtc=if ($Type -eq 'EMPLOYEE_PROJECT') {[datetime]::UtcNow.AddMinutes(330).Date.AddMinutes(-330)} else {[datetime]::UtcNow.AddMinutes(330).Date.AddDays(1).AddHours(10).AddMinutes(-330)}
        $taskParams.ValidUntilUtc=if ($Type -eq 'EMPLOYEE_PROJECT') {[datetime]::UtcNow.AddMinutes(330).Date.AddDays(1).AddMinutes(-330)} else {$taskParams.ValidFromUtc.AddHours(2)}
    }
    $taskParams.CredentialsJson=New-Credentials $taskPeople
    return $taskParams
}
function Submit($Parameters) { return Call $taskApi 'gp.SubmitRegistration' $Parameters }
function New-VisitCount { return Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.VisitRequests WHERE IntakeId IN(SELECT intakeId FROM OPENJSON(@ids) WITH(intakeId uniqueidentifier));" @{ids=(ConvertTo-Json -InputObject @($taskOwned) -Depth 4 -Compress)} }
function Move-Visit($Visit,[string]$Event='ENTRY',[guid]$ClientKey=[guid]::NewGuid()) {
    $taskParams=Auth 'GUARD'; $taskParams.ClientKey=$ClientKey;$taskParams.VisitRequestId=[guid]$Visit.visitRequestId;$taskParams.AccessPassId=[guid]$Visit.accessPassId
    $taskParams.LocationId=[int]$taskFixture.locationId;$taskParams.EventType=$Event;$taskParams.EntryMethod='MANUAL';$taskParams.CredentialHash=$null;$taskParams.OccurredAtUtc=$null;$taskParams.ReconciliationReason=$null
    # The fixture selects its known destination; production actions name the visible project explicitly.
    $taskPair=Invoke-GatePassScalar $taskAdmin 'SELECT ProjectLocationId FROM gp.VisitRequests WHERE VisitRequestId=@id;' @{id=[guid]$Visit.visitRequestId}
    $taskParams.SelectedProjectLocationId=if ($taskPair -is [DBNull] -or $null -eq $taskPair) {$null} else {[long]$taskPair}
    $taskType=Invoke-GatePassScalar $taskAdmin 'SELECT RequestType FROM gp.VisitRequests WHERE VisitRequestId=@v;' @{v=$taskParams.VisitRequestId}
    if($taskType -eq 'TEMP_ID'){
      $taskParams.Remove('SelectedProjectLocationId');$taskParams.Remove('OccurredAtUtc');$taskParams.Remove('ReconciliationReason');$taskParams.DutyKind='PROJECT';$taskParams.DutyId=[long]$taskFixture.projectLocationId;$taskParams.Reason=$null
      return Call $taskApi 'gp.RecordGuardDutyMovement' $taskParams
    }
    return Call $taskApi 'gp.RecordMovement' $taskParams
}
function Test-Case([string]$Name,[scriptblock]$Action) {
    try { Cleanup-Registration; $null=& $Action; $taskCases.Add(@{Name=$Name;Passed=$true}); Write-Output ('PASS: '+$Name) }
    catch { $taskCases.Add(@{Name=$Name;Passed=$false;Error=$_.Exception.Message}); Write-Output ('FAIL: '+$Name+' -- '+$_.Exception.Message) }
}
function Open-Restricted([string]$Principal='gp_registration_api_fixture') {
    $taskConnection=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
    Invoke-GatePassNonQuery $taskConnection ("EXECUTE AS USER='"+$Principal+"';")
    $taskConnections.Add($taskConnection); return $taskConnection
}
function Race($FirstCommand,$SecondCommand,$FirstConnection,$SecondConnection) {
    $taskA=Invoke-GatePassScalar $FirstConnection 'SELECT @@SPID;'; $taskB=Invoke-GatePassScalar $SecondConnection 'SELECT @@SPID;'
    Invoke-GatePassNonQuery $taskAdmin 'BEGIN TRANSACTION; EXEC gp._TakeLock N''gp:authorization'',''Exclusive'';'
    try {
        $taskOne=$FirstCommand.ExecuteScalarAsync(); $taskTwo=$SecondCommand.ExecuteScalarAsync(); $taskDeadline=[datetime]::UtcNow.AddSeconds(3)
        do {
            $taskWaiting=Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id IN(@a,@b) AND wait_type LIKE 'LCK_M%';" @{a=$taskA;b=$taskB}
            if ($taskWaiting -eq 2) {break}; [Threading.Thread]::Sleep(20)
        } while ([datetime]::UtcNow -lt $taskDeadline)
        Assert-Condition ($taskWaiting -eq 2) 'Both SQL contenders were not observed waiting.'
    } finally { Invoke-GatePassNonQuery $taskAdmin 'IF @@TRANCOUNT>0 COMMIT;' }
    $taskResults=[Collections.Generic.List[object]]::new()
    try {
        foreach ($taskPending in @($taskOne,$taskTwo)) {
            try { $taskResults.Add(@{Success=$true;Result=($taskPending.GetAwaiter().GetResult() | ConvertFrom-Json)}) }
            catch { $taskResults.Add(@{Success=$false;Error=(Sql-Number $_.Exception)}) }
        }
    } finally { $FirstCommand.Dispose(); $SecondCommand.Dispose() }
    return ,@($taskResults)
}
try {
    Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT DB_NAME();') -eq 'GatePass_DesignTest') 'Dedicated database required.'
    $taskFixture=(Invoke-GatePassScalar $taskAdmin ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '002_transaction_fixtures.sql'))) @{RunId=$taskRun}) | ConvertFrom-Json
    $taskFixtureReady=$true; foreach ($taskActor in $taskFixture.actors) { $taskActors[$taskActor.Label]=$taskActor }
    $taskOtherHost=$taskFixture.prefix+'-OTHERHOST'
    # This suite creates its own requests; baseline movement cases must not occupy its employee windows.
    Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.VisitRequests SET EmployeeId=@other WHERE EmployeeId=@e AND RequestType='EMPLOYEE_PROJECT';" @{e=$taskFixture.hostEmployeeId;other=$taskOtherHost}
    foreach ($taskPair in @(@('gp_registration_api_fixture','gp_api_runtime'),@('gp_registration_worker_fixture','gp_worker_runtime'),@('gp_registration_auth_fixture','gp_guard_auth_runtime'))) {
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM sys.database_principals WHERE name=@name;' @{name=$taskPair[0]}) -eq 0) 'Refusing existing fixture principal.'
        Invoke-GatePassNonQuery $taskAdmin ('CREATE USER '+$taskPair[0]+' WITHOUT LOGIN; ALTER ROLE '+$taskPair[1]+' ADD MEMBER '+$taskPair[0]+';'); $taskPrincipals.Add($taskPair[0])
    }
    $taskApi=Open-Restricted; $taskWorker=Open-Restricted 'gp_registration_worker_fixture'; $taskAuth=Open-Restricted 'gp_registration_auth_fixture'
    Test-Case 'Runtime cannot SELECT intake capabilities or encrypted pass material' {
        foreach ($taskTable in @('RegistrationIntakeAccess','RegistrationIntakes','PassSecrets')) { Expect-Error { Invoke-GatePassScalar $taskApi ('SELECT COUNT(*) FROM gp.'+$taskTable+';') } 229 }
    }
    Test-Case 'Worker and password-auth roles cannot create or submit registrations' {
        foreach ($taskConnection in @($taskWorker,$taskAuth)) { Expect-Error { Invoke-GatePassScalar $taskConnection 'EXEC gp.CreateRegistrationIntake;' } 229; Expect-Error { Invoke-GatePassScalar $taskConnection 'EXEC gp.SubmitRegistration;' } 229 }
        Expect-Error { Invoke-GatePassScalar $taskApi 'EXEC gp._BeginRegistrationOperation;' } 229
    }
    Test-Case 'Every external visitor requires an unpadded international phone before any registration is committed' {
        $taskBefore=New-VisitCount
        foreach($taskMode in @('missing','null','empty','padded','malformed','tooLong')){
            $taskP=New-Submission 'EXTERNAL' 2;$taskPeople=@($taskP.PeopleJson|ConvertFrom-Json)
            if($taskMode -eq 'missing'){$taskPeople[1].PSObject.Properties.Remove('personPhone')}
            else{$taskPeople[1].personPhone=switch($taskMode){'null'{$null};'empty'{''};'padded'{'+919876543210 '};'malformed'{'+91notanumber'};'tooLong'{'+1234567890123456'}}}
            $taskP.PeopleJson=ConvertTo-Json -InputObject $taskPeople -Compress
            Expect-Error {Submit $taskP} 52702
            Assert-Condition ((New-VisitCount) -eq $taskBefore) 'Invalid group contact persisted a participant.'
        }
    }
    Test-Case 'Public intake creation retry preserves one intake and its expiry' {
        $taskIntake=New-Intake; $taskParams=$taskIntake.Clone();$taskParams.IntakeType='PUBLIC'
        $taskOne=Call $taskApi 'gp.CreateRegistrationIntake' $taskParams; $taskTwo=Call $taskApi 'gp.CreateRegistrationIntake' $taskParams
        Assert-Condition ($taskOne.expiresAtUtc -eq $taskTwo.expiresAtUtc) 'Retry extended intake lifetime.'
    }
    Test-Case 'Office QR cannot auto-issue Digital ID outside employee office, even for the same project' {
        $taskP=New-Submission;$taskP.LocationId=[int](Invoke-GatePassScalar $taskAdmin "SELECT LocationId FROM gp.Locations WHERE LocationCode='PUNE';")
        Expect-Error { Submit $taskP } 52701
        Assert-Condition ((New-VisitCount) -eq 0) 'Cross-office ID persisted.'
    }
    Test-Case 'Missing revoked stale and future employee office records block Digital ID issuance' {
        $taskEmployee=$taskFixture.hostEmployeeId;$taskLocation=[int]$taskFixture.locationId
        foreach($taskMode in @('missing','revoked','stale','future')) {
            $taskP=New-Submission
            try {
                $taskSql=switch($taskMode){
                  'missing' {'DELETE gp.EmployeeOfficeMemberships WHERE EmployeeId=@e AND LocationId=@l;'}
                  'revoked' {'UPDATE gp.EmployeeOfficeMemberships SET IsActive=0 WHERE EmployeeId=@e AND LocationId=@l;'}
                  'stale' {'UPDATE gp.EmployeeOfficeMemberships SET VerifiedAtUtc=DATEADD(day,-2,SYSUTCDATETIME()) WHERE EmployeeId=@e AND LocationId=@l;'}
                  'future' {'UPDATE gp.EmployeeOfficeMemberships SET VerifiedAtUtc=DATEADD(day,1,SYSUTCDATETIME()) WHERE EmployeeId=@e AND LocationId=@l;'}
                }
                Invoke-GatePassNonQuery $taskAdmin $taskSql @{e=$taskEmployee;l=$taskLocation}
                Expect-Error { Submit $taskP } 52701
            } finally {
                Invoke-GatePassNonQuery $taskAdmin 'IF NOT EXISTS(SELECT 1 FROM gp.EmployeeOfficeMemberships WHERE EmployeeId=@e AND LocationId=@l) INSERT gp.EmployeeOfficeMemberships(EmployeeId,LocationId,IsActive,VerifiedAtUtc) VALUES(@e,@l,1,SYSUTCDATETIME()); ELSE UPDATE gp.EmployeeOfficeMemberships SET IsActive=1,VerifiedAtUtc=SYSUTCDATETIME() WHERE EmployeeId=@e AND LocationId=@l;' @{e=$taskEmployee;l=$taskLocation}
            }
        }
    }
    Test-Case 'Cached and daily-reused Digital IDs cannot bypass revoked office entitlement' {
        $taskP=New-Submission;$null=Submit $taskP
        try {
            Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeOfficeMemberships SET IsActive=0 WHERE EmployeeId=@e;' @{e=$taskFixture.hostEmployeeId}
            Expect-Error { Submit $taskP } 52701
            $taskRetry=New-Submission;Expect-Error { Submit $taskRetry } 52701
        } finally {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeOfficeMemberships SET IsActive=1,VerifiedAtUtc=SYSUTCDATETIME() WHERE EmployeeId=@e;' @{e=$taskFixture.hostEmployeeId}}
    }
    Test-Case 'Issued Digital ID loses entry permission after office revocation but occupants can exit' {
        $taskP=New-Submission;$taskV=(Submit $taskP).visits[0]
        try {
            Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeOfficeMemberships SET IsActive=0 WHERE EmployeeId=@e;' @{e=$taskFixture.hostEmployeeId}
            Expect-Error { Move-Visit $taskV } 52001
            Expect-Error {Invoke-GatePassScalar $taskAdmin 'EXEC gp._RequireReceptionPass @actor,@visit,@now;' @{actor=[guid]$taskActors.GUARD.UserId;visit=[guid]$taskV.visitRequestId;now=[datetime]::UtcNow}} 53101
            Expect-Error {Invoke-GatePassScalar $taskAdmin 'EXEC gp._RequirePrintablePass @v,@p,@now;' @{v=[guid]$taskV.visitRequestId;p=[guid]$taskV.accessPassId;now=[datetime]::UtcNow}} 53105
            Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeOfficeMemberships SET IsActive=1 WHERE EmployeeId=@e;' @{e=$taskFixture.hostEmployeeId}
            $taskEntryKey=[guid]::NewGuid();$null=Move-Visit $taskV 'ENTRY' $taskEntryKey
            Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeOfficeMemberships SET IsActive=0 WHERE EmployeeId=@e;' @{e=$taskFixture.hostEmployeeId}
            Expect-Error {Move-Visit $taskV 'ENTRY' $taskEntryKey} 52004
            $taskExit=Move-Visit $taskV 'EXIT';Assert-Condition (-not $taskExit.isInside) 'Revocation stranded an occupant.'
        } finally {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeOfficeMemberships SET IsActive=1,VerifiedAtUtc=SYSUTCDATETIME() WHERE EmployeeId=@e;' @{e=$taskFixture.hostEmployeeId}}
    }
    Test-Case 'Project-only host membership cannot authorize a request at another office' {
        $taskP=New-Submission 'EXTERNAL';$taskPair=Invoke-GatePassScalar $taskAdmin 'SELECT pl.ProjectLocationId FROM gp.ProjectLocations pl WHERE pl.ProjectId=(SELECT ProjectId FROM gp.ProjectLocations WHERE ProjectLocationId=@pair) AND pl.LocationId<>@location;' @{pair=[long]$taskFixture.projectLocationId;location=[int]$taskFixture.locationId}
        $taskP.ProjectLocationId=[long]$taskPair;$taskP.LocationId=[int](Invoke-GatePassScalar $taskAdmin 'SELECT LocationId FROM gp.ProjectLocations WHERE ProjectLocationId=@pair;' @{pair=$taskPair})
        Expect-Error { Submit $taskP } 52701
    }
    Test-Case 'Cross-office employee access requires an exact local host, supports approval, and permits scoped movement' {
        $taskP=New-Submission 'EMPLOYEE_PROJECT'
        $taskPair=[long](Invoke-GatePassScalar $taskAdmin 'SELECT ProjectLocationId FROM gp.ProjectLocations WHERE ProjectId=@p AND LocationId=@l;' @{p=[long]$taskFixture.projectId;l=[int]$taskFixture.otherLocationId})
        $taskP.ProjectLocationId=$taskPair;$taskP.LocationId=[int]$taskFixture.otherLocationId
        $taskSelector=New-Intake 'PUBLIC';$taskSelector.LocationCode='PUNE';$taskSelector.ProjectLocationId=$taskPair;$taskSelector.Search='Synthetic'
        Assert-Condition ((Call $taskApi 'gp.GetRegistrationOptions' $taskSelector).hosts.Count -eq 0) 'Project-only host leaked into another office.'
        try {
            Invoke-GatePassNonQuery $taskAdmin 'INSERT gp.EmployeeOfficeMemberships(EmployeeId,LocationId,IsActive,VerifiedAtUtc) VALUES(@e,@l,1,SYSUTCDATETIME());INSERT gp.EmployeeProjectLocationMemberships(EmployeeId,ProjectLocationId,IsActive,VerifiedAtUtc) VALUES(@e,@p,1,SYSUTCDATETIME());' @{e=$taskOtherHost;l=$taskP.LocationId;p=$taskPair}
            Assert-Condition ((Call $taskApi 'gp.GetRegistrationOptions' $taskSelector).hosts.Count -eq 1) 'Explicit local host missing.'
            $taskV=(Submit $taskP).visits[0];Assert-Condition ($taskV.status -eq 'PENDING') 'Cross-office access bypassed approval.'
            $taskDecision=Auth 'OTHERHOST';$taskDecision.ClientKey=[guid]::NewGuid();$taskDecision.VisitRequestId=[guid]$taskV.visitRequestId;$taskDecision.SnapshotVersion=1;$taskDecision.SnapshotHash=[Convert]::FromHexString((Invoke-GatePassScalar $taskAdmin 'SELECT CONVERT(varchar(64),SnapshotHash,2) FROM gp.VisitRequests WHERE VisitRequestId=@id;' @{id=[guid]$taskV.visitRequestId}));$taskDecision.Decision='APPROVED'
            Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectLocationMemberships SET IsActive=0 WHERE EmployeeId=@e AND ProjectLocationId=@p;' @{e=$taskOtherHost;p=$taskPair}
            Assert-Condition ((Call $taskApi 'gp.GetRegistrationOptions' $taskSelector).hosts.Count -eq 0) 'Revoked local host stayed selectable.'
            Expect-Error {Call $taskApi 'gp.DecideVisit' $taskDecision} 52004
            Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectLocationMemberships SET IsActive=1 WHERE EmployeeId=@e AND ProjectLocationId=@p;' @{e=$taskOtherHost;p=$taskPair}
            $null=Call $taskApi 'gp.DecideVisit' $taskDecision
            $taskMove=Auth 'WRONGLOCATION';$taskMove.ClientKey=[guid]::NewGuid();$taskMove.VisitRequestId=[guid]$taskV.visitRequestId;$taskMove.AccessPassId=[guid]$taskV.accessPassId;$taskMove.LocationId=$taskP.LocationId;$taskMove.SelectedProjectLocationId=$taskPair;$taskMove.EventType='ENTRY';$taskMove.EntryMethod='MANUAL'
            Assert-Condition (Call $taskApi 'gp.RecordMovement' $taskMove).isInside 'Approved hosted cross-office employee could not enter.'
            $taskMove.ClientKey=[guid]::NewGuid();$taskMove.EventType='EXIT';$null=Call $taskApi 'gp.RecordMovement' $taskMove
        } finally {Invoke-GatePassNonQuery $taskAdmin 'DELETE gp.EmployeeProjectLocationMemberships WHERE EmployeeId=@e AND ProjectLocationId=@p;DELETE gp.EmployeeOfficeMemberships WHERE EmployeeId=@e AND LocationId=@l;' @{e=$taskOtherHost;p=$taskPair;l=$taskP.LocationId}}
    }
    Test-Case 'Revoked exact host assignment blocks submission despite project membership' {
        $taskP=New-Submission 'EXTERNAL'
        try {
            Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectLocationMemberships SET IsActive=0 WHERE EmployeeId=@e;' @{e=$taskOtherHost}
            Expect-Error { Submit $taskP } 52701
        } finally {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectLocationMemberships SET IsActive=1,VerifiedAtUtc=SYSUTCDATETIME() WHERE EmployeeId=@e;' @{e=$taskOtherHost}}
    }
    Test-Case 'Employee intake requires a verified active employee session and CSRF' {
        Expect-Error { New-Intake 'EMPLOYEE' 'GUARD' } 52701
        $taskIntake=New-Intake 'EMPLOYEE'; $taskParams=$taskIntake.Clone();$taskParams.IntakeType='EMPLOYEE';$taskParams.CsrfHash=Random-Hash
        Expect-Error { Call $taskApi 'gp.CreateRegistrationIntake' $taskParams } 52001
    }
    Test-Case 'Another employee cannot use an intake even when its capability is known' {
        $taskParams=New-Submission; $taskOther=Auth 'OTHERHOST';$taskParams.SessionHash=$taskOther.SessionHash;$taskParams.CsrfHash=$taskOther.CsrfHash
        Expect-Error { Submit $taskParams } 52701
    }
    Test-Case 'Public intake token and intake CSRF are both required and length checked' {
        $taskParams=New-Submission 'EXTERNAL'; $taskToken=$taskParams.TokenHash; $taskCsrf=$taskParams.IntakeCsrfHash
        $taskParams.IntakeCsrfHash=Random-Hash; Expect-Error { Submit $taskParams } 52701
        $taskParams.IntakeCsrfHash=$taskCsrf;$taskParams.TokenHash=[byte[]]::new(33);Expect-Error { Submit $taskParams } 52701
        $taskParams.TokenHash=$taskToken
    }
    Test-Case 'Expired and abandoned intakes cannot upload or submit' {
        $taskParams=New-Submission 'EXTERNAL'
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.RegistrationIntakes SET CreatedAtUtc=DATEADD(hour,-1,SYSUTCDATETIME()),ExpiresAtUtc=DATEADD(second,-1,SYSUTCDATETIME()) WHERE IntakeId=@id;' @{id=$taskParams.IntakeId}
        Expect-Error { Submit $taskParams } 52701
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.RegistrationIntakes SET ExpiresAtUtc=DATEADD(minute,10,SYSUTCDATETIME()),Status=''ABANDONED'' WHERE IntakeId=@id;' @{id=$taskParams.IntakeId}
        Expect-Error { Submit $taskParams } 52701
    }
    Test-Case 'Photo recording is content-bound idempotent and derives a private storage key' {
        $taskIntake=New-Intake;$taskId=Add-Photo $taskIntake
        $taskData=(Invoke-GatePassScalar $taskAdmin 'SELECT (SELECT ContentHash,MimeType,ByteLength,PixelWidth,PixelHeight FROM gp.PhotoAssets WHERE PhotoAssetId=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);' @{id=$taskId}) | ConvertFrom-Json
        $taskParams=$taskIntake.Clone();$taskParams.PhotoAssetId=$taskId;$taskParams.ContentHash=[Convert]::FromBase64String($taskData.ContentHash)
        $taskParams.MimeType='image/jpeg';$taskParams.ByteLength=100;$taskParams.PixelWidth=100;$taskParams.PixelHeight=100
        $taskResult=Call $taskApi 'gp.RecordRegistrationPhoto' $taskParams
        Assert-Condition ($taskResult.storageKey -eq ('intakes/'+$taskIntake.IntakeId.ToString('N')+'/'+$taskId.ToString('N')+'.jpg')) 'Unexpected storage path.'
        $taskParams.ContentHash=Random-Hash;Expect-Error { Call $taskApi 'gp.RecordRegistrationPhoto' $taskParams } 52703
    }
    Test-Case 'Photo declarations are bounded and cannot attach to a submitted intake' {
        $taskParams=New-Submission;$null=Submit $taskParams
        $taskPhoto=@{IntakeId=$taskParams.IntakeId;TokenHash=$taskParams.TokenHash;IntakeCsrfHash=$taskParams.IntakeCsrfHash;SessionHash=$taskParams.SessionHash;CsrfHash=$taskParams.CsrfHash;
            PhotoAssetId=[guid]::NewGuid();ContentHash=(Random-Hash);MimeType='image/jpeg';ByteLength=100;PixelWidth=100;PixelHeight=100}
        Expect-Error { Call $taskApi 'gp.RecordRegistrationPhoto' $taskPhoto } 52705
        $taskPhoto.ByteLength=5242881;Expect-Error { Call $taskApi 'gp.RecordRegistrationPhoto' $taskPhoto } 52702
    }
    Test-Case 'Credential preflight leaves intake visits slot and idempotency unmodified' {
        $taskParams=New-Submission;$taskParams.CredentialsJson=$null
        Assert-Condition ((Submit $taskParams).status -eq 'NEEDS_CREDENTIALS') 'Expected key-free preflight.'
        Assert-Condition ((New-VisitCount) -eq 0) 'Preflight created a visit.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.IdempotencyRequests WHERE ClientKey=@key;' @{key=$taskParams.ClientKey}) -eq 0) 'Preflight persisted idempotency state.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT Status FROM gp.RegistrationIntakes WHERE IntakeId=@id;' @{id=$taskParams.IntakeId}) -eq 'DRAFT') 'Preflight consumed intake.'
    }
    Test-Case 'Digital ID is auto-approved with one active pass presence and manager-only notification' {
        $taskParams=New-Submission;$taskResult=Submit $taskParams;$taskVisit=$taskResult.visits[0]
        Assert-Condition ($taskVisit.status -eq 'APPROVED' -and -not $taskVisit.reused) 'Digital ID not approved.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.AccessPasses p JOIN gp.PassSecrets s ON s.AccessPassId=p.AccessPassId JOIN gp.VisitPresence v ON v.VisitRequestId=p.VisitRequestId WHERE p.AccessPassId=@id AND p.Status=''ACTIVE'' AND v.IsInside=0;' @{id=[guid]$taskVisit.accessPassId}) -eq 1) 'Initial pass/secret/presence missing.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.NotificationOutbox WHERE VisitRequestId=@id AND TemplateCode='TEMP_ID_MANAGER_NOTICE' AND RecipientKind='MANAGER' AND RecipientEmployeeId=@employee AND RecipientEmail IS NULL;" @{id=[guid]$taskVisit.visitRequestId;employee=$taskFixture.hostEmployeeId}) -eq 1) 'Incorrect initial manager notice.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.ApprovalDecisions WHERE VisitRequestId=@id;' @{id=[guid]$taskVisit.visitRequestId}) -eq 0) 'Manager approval was introduced.'
    }
    foreach($taskReturnedType in @('TEMP_ID','EMPLOYEE_PROJECT')){
    Test-Case ("A returned "+$taskReturnedType+" permits a fresh request without reopening or reusing the returned pass") {
        $taskFirst=Submit (New-Submission $taskReturnedType);$taskV=$taskFirst.visits[0]
        foreach($cap in @('VISITS_READ','PASS_PRINT')){Invoke-GatePassNonQuery $taskAdmin 'INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT @g,@cap WHERE NOT EXISTS(SELECT 1 FROM gp.GrantCapabilities WHERE RoleGrantId=@g AND CapabilityCode=@cap);' @{g=[long]$taskActors.RECEPTION.GrantId;cap=$cap}}
        $taskPrint=Auth 'RECEPTION';$taskPrint.ClientKey=[guid]::NewGuid();$taskPrint.VisitRequestId=[guid]$taskV.visitRequestId;$taskPrint.ExpectedPassId=[guid]$taskV.accessPassId
        $null=Call $taskApi 'gp.RequestPassPrint' $taskPrint
        Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.PassPrintJobs SET Status='DISPATCHED',UpdatedAtUtc=SYSUTCDATETIME() WHERE VisitRequestId=@v;" @{v=$taskPrint.VisitRequestId}
        $taskPrint.ClientKey=[guid]::NewGuid();$taskReceipt=Call $taskApi 'gp.ReturnReceptionPass' $taskPrint
        $taskDetail=Auth 'RECEPTION';$taskDetail.VisitRequestId=$taskPrint.VisitRequestId;$taskDetail.View='RECEPTION';$taskDetailResult=Call $taskApi 'gp.GetVisitDetail' $taskDetail
        Assert-Condition ($taskDetailResult.returnedAtUtc -eq $taskReceipt.returnedAtUtc -and $taskDetailResult.printCount -eq 1) 'Fresh receipt missing from detail read.'
        $taskNew=Submit (New-Submission $taskReturnedType)
        Assert-Condition (-not $taskNew.visits[0].reused -and $taskNew.visits[0].visitRequestId -ne $taskV.visitRequestId -and $taskNew.visits[0].accessPassId -ne $taskV.accessPassId) 'Returned credential reused or new visit blocked.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.AccessPasses WHERE AccessPassId=@p AND Status='REVOKED';" @{p=[guid]$taskV.accessPassId}) -eq 1) 'Closed pass was reopened.'
        $taskAgain=Submit (New-Submission $taskReturnedType)
        Assert-Condition ($taskAgain.visits[0].reused -and $taskAgain.visits[0].accessPassId -eq $taskNew.visits[0].accessPassId) 'Existing fresh request was duplicated.'
    }
    }
    Test-Case 'Digital ID uses trusted employee identity and current India local-day expiry' {
        $taskResult=Submit (New-Submission);$taskVisit=$taskResult.visits[0]
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.VisitRequests v JOIN gp.Employees e ON e.EmployeeId=v.EmployeeId WHERE v.VisitRequestId=@id AND v.PersonName=e.FullName AND v.PersonEmail=e.OfficialEmail AND v.ProjectLocationId IS NULL AND v.HostEmployeeId IS NULL AND v.ValidUntilUtc=DATEADD(minute,-330,DATEADD(day,1,CONVERT(datetime2(3),v.LocalVisitDate)));' @{id=[guid]$taskVisit.visitRequestId}) -eq 1) 'Incorrect trusted identity or expiry.'
        $taskParams=New-Submission;$taskPeople=$taskParams.PeopleJson | ConvertFrom-Json -NoEnumerate;$taskPeople[0] | Add-Member personEmail 'personal@example.invalid'
        $taskParams.PeopleJson=ConvertTo-Json -InputObject $taskPeople -Compress;Expect-Error { Submit $taskParams } 52702
    }
    Test-Case 'Public flow cannot request Digital ID and employee flow cannot submit external people' {
        $taskParams=New-Submission 'EXTERNAL';$taskParams.RequestType='TEMP_ID';Expect-Error { Submit $taskParams } 52701
        $taskParams=New-Submission;$taskParams.RequestType='EXTERNAL';Expect-Error { Submit $taskParams } 52701
    }
    Test-Case 'Digital ID rejects project host caller-controlled validity and missing reason' {
        foreach ($taskField in @('ProjectLocationId','HostEmployeeId','ValidFromUtc','TemporaryIdReason')) {
            $taskParams=New-Submission
            switch ($taskField) { 'ProjectLocationId' {$taskParams.ProjectLocationId=[long]$taskFixture.projectLocationId}; 'HostEmployeeId' {$taskParams.HostEmployeeId=$taskOtherHost}; 'ValidFromUtc' {$taskParams.ValidFromUtc=[datetime]::UtcNow}; 'TemporaryIdReason' {$taskParams.TemporaryIdReason=$null} }
            Expect-Error { Submit $taskParams } 52702
        }
    }
    Test-Case 'Separate intake on the same employee office and day reuses its existing credential without another notice' {
        $taskFirst=Submit (New-Submission);$taskSecond=Submit (New-Submission)
        Assert-Condition ($taskFirst.visits[0].accessPassId -eq $taskSecond.visits[0].accessPassId -and $taskSecond.visits[0].reused) 'Daily credential was duplicated.'
        Assert-Condition ((New-VisitCount) -eq 1) 'Parallel daily visits created.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.NotificationOutbox WHERE VisitRequestId=@id AND TemplateCode=''TEMP_ID_MANAGER_NOTICE'';' @{id=[guid]$taskFirst.visits[0].visitRequestId}) -eq 1) 'Duplicate manager notice.'
    }
    Test-Case 'An inside usable Digital ID is reused without creating another occupancy record' {
        $taskFirst=Submit (New-Submission);$null=Move-Visit $taskFirst.visits[0]
        $taskSecond=Submit (New-Submission)
        Assert-Condition ($taskSecond.visits[0].reused -and (New-VisitCount) -eq 1) 'Inside occupant got another visit.'
    }
    Test-Case 'A revoked outside Digital ID requires explicit reissue instead of silent replacement' {
        $taskFirst=Submit (New-Submission)
        Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.AccessPasses SET Status='REVOKED',RevokedAtUtc=SYSUTCDATETIME(),RevocationReason=N'Synthetic test' WHERE AccessPassId=@id;" @{id=[guid]$taskFirst.visits[0].accessPassId}
        Expect-Error { Submit (New-Submission) } 52705
    }
    Test-Case 'A cancelled inside visit blocks replacement until authorized departure' {
        $taskFirst=Submit (New-Submission);$null=Move-Visit $taskFirst.visits[0]
        Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.VisitRequests SET Status='CANCELLED',CancelledAtUtc=SYSUTCDATETIME() WHERE VisitRequestId=@id;" @{id=[guid]$taskFirst.visits[0].visitRequestId}
        Expect-Error { Submit (New-Submission) } 52705
    }
    Test-Case 'A cancelled outside visit may be replaced while its original history stays linked' {
        $taskFirst=Submit (New-Submission)
        Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.VisitRequests SET Status='CANCELLED',CancelledAtUtc=SYSUTCDATETIME() WHERE VisitRequestId=@id; UPDATE gp.AccessPasses SET Status='REVOKED',RevokedAtUtc=SYSUTCDATETIME(),RevocationReason=N'Synthetic test' WHERE VisitRequestId=@id;" @{id=[guid]$taskFirst.visits[0].visitRequestId}
        $taskSecond=Submit (New-Submission)
        Assert-Condition ($taskFirst.visits[0].visitRequestId -ne $taskSecond.visits[0].visitRequestId -and (New-VisitCount) -eq 2) 'History was overwritten.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT VisitRequestId FROM gp.TemporaryIdSlots WHERE EmployeeId=@employee AND LocationId=@location;' @{employee=$taskFixture.hostEmployeeId;location=[int]$taskFixture.locationId}) -eq [guid]$taskSecond.visits[0].visitRequestId) 'Daily pointer not updated.'
    }
    Test-Case 'Same employee can hold separate location-scoped daily IDs' {
        $taskFirst=Submit (New-Submission);$taskParams=New-Submission;$taskParams.LocationId=[int]$taskFixture.otherLocationId
        try {
          Invoke-GatePassNonQuery $taskAdmin 'INSERT gp.EmployeeOfficeMemberships(EmployeeId,LocationId,IsActive,VerifiedAtUtc) VALUES(@e,@l,1,SYSUTCDATETIME());' @{e=$taskFixture.hostEmployeeId;l=$taskParams.LocationId}
          $taskSecond=Submit $taskParams
        } finally {Invoke-GatePassNonQuery $taskAdmin 'DELETE gp.EmployeeOfficeMemberships WHERE EmployeeId=@e AND LocationId=@l;' @{e=$taskFixture.hostEmployeeId;l=$taskParams.LocationId}}
        Assert-Condition ($taskFirst.visits[0].visitRequestId -ne $taskSecond.visits[0].visitRequestId -and (New-VisitCount) -eq 2) 'Locations incorrectly coupled.'
    }
    Test-Case 'External multi-person registration permits optional contact and creates independent pending rows' {
        $taskResult=Submit (New-Submission 'EXTERNAL' 3)
        Assert-Condition ($taskResult.visits.Count -eq 3 -and @($taskResult.visits | Where-Object {$_.status -ne 'PENDING'}).Count -eq 0) 'Individual pending visits missing.'
        Assert-Condition ((New-VisitCount) -eq 3) 'Incorrect final visit count.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.NotificationOutbox WHERE VisitRequestId IN(SELECT visitRequestId FROM OPENJSON(@j,''$.visits'') WITH(visitRequestId uniqueidentifier)) AND TemplateCode=''HOST_APPROVAL_REQUEST'';' @{j=($taskResult | ConvertTo-Json -Depth 6 -Compress)}) -eq 3) 'Individual notices missing.'
    }
    Test-Case 'Independent host decisions do not approve or move other people from the same form' {
        $taskResult=Submit (New-Submission 'EXTERNAL' 3);$taskIndex=0
        foreach ($taskDecision in @('APPROVED','DENIED')) {
            $taskVisit=$taskResult.visits[$taskIndex];$taskParams=Auth 'OTHERHOST';$taskParams.ClientKey=[guid]::NewGuid();$taskParams.VisitRequestId=[guid]$taskVisit.visitRequestId;$taskParams.SnapshotVersion=1
            $taskParams.SnapshotHash=[Convert]::FromHexString((Invoke-GatePassScalar $taskAdmin 'SELECT CONVERT(varchar(64),SnapshotHash,2) FROM gp.VisitRequests WHERE VisitRequestId=@id;' @{id=$taskParams.VisitRequestId}))
            $taskParams.Decision=$taskDecision;$taskParams.Comment=$null;$null=Call $taskApi 'gp.DecideVisit' $taskParams;$taskIndex++
        }
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT Status FROM gp.VisitRequests WHERE VisitRequestId=@id;' @{id=[guid]$taskResult.visits[2].visitRequestId}) -eq 'PENDING') 'Third person changed with another decision.'
        Expect-Error { Move-Visit $taskResult.visits[2] } 52005
    }
    Test-Case 'One invalid person rolls back the whole form without partial visits' {
        $taskParams=New-Submission 'EXTERNAL' 3;$taskPeople=$taskParams.PeopleJson | ConvertFrom-Json -NoEnumerate;$taskPeople[1].personName='';$taskParams.PeopleJson=ConvertTo-Json -InputObject $taskPeople -Compress
        Expect-Error { Submit $taskParams } 52702;Assert-Condition ((New-VisitCount) -eq 0) 'Partial registration persisted.'
    }
    Test-Case 'Borrowed purged and previously used photos cannot be submitted' {
        $taskParams=New-Submission 'EXTERNAL';$taskOther=New-Submission 'EXTERNAL';$taskPeople=$taskParams.PeopleJson | ConvertFrom-Json -NoEnumerate;$taskOtherPeople=$taskOther.PeopleJson | ConvertFrom-Json -NoEnumerate
        $taskPeople[0].photoAssetId=$taskOtherPeople[0].photoAssetId;$taskParams.PeopleJson=ConvertTo-Json -InputObject $taskPeople -Compress;Expect-Error { Submit $taskParams } 52701
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.PhotoAssets SET PurgedAtUtc=SYSUTCDATETIME(),StorageKey=NULL WHERE PhotoAssetId=@id;' @{id=[guid]$taskOtherPeople[0].photoAssetId}
        Expect-Error { Submit $taskOther } 52701
    }
    Test-Case 'Duplicate person keys and duplicate photo references are rejected' {
        foreach ($taskField in @('clientPersonKey','photoAssetId')) {
            $taskParams=New-Submission 'EXTERNAL' 2;$taskPeople=$taskParams.PeopleJson | ConvertFrom-Json -NoEnumerate;$taskPeople[1].$taskField=$taskPeople[0].$taskField
            $taskParams.PeopleJson=ConvertTo-Json -InputObject $taskPeople -Compress;Expect-Error { Submit $taskParams } 52702
        }
    }
    Test-Case 'Unknown duplicate or overlong JSON properties cannot be silently dropped or truncated' {
        $taskParams=New-Submission 'EXTERNAL';$taskOriginal=$taskParams.PeopleJson
        $taskParams.PeopleJson=$taskOriginal.Replace('"personName":','"employeeId":"forged","personName":');Expect-Error { Submit $taskParams } 52702
        $taskParams.PeopleJson=$taskOriginal.Replace('"personName":','"personName":"duplicate","personName":');Expect-Error { Submit $taskParams } 52702
        $taskPeople=$taskOriginal | ConvertFrom-Json -NoEnumerate;$taskPeople[0].personEmail=('x'*5000)+'@example.invalid';$taskParams.PeopleJson=ConvertTo-Json -InputObject $taskPeople -Compress
        Expect-Error { Submit $taskParams } 52702
    }
    Test-Case 'Configured person limit is enforced atomically' {
        $taskParams=New-Submission 'EXTERNAL' 11;Expect-Error { Submit $taskParams } 52702;Assert-Condition ((New-VisitCount) -eq 0) 'Limit caused partial submission.'
    }
    Test-Case 'Host must be active fresh and a current member of the requested project' {
        $taskParams=New-Submission 'EXTERNAL'
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectMemberships SET IsActive=0 WHERE EmployeeId=@id;' @{id=$taskOtherHost}
        try { Expect-Error { Submit $taskParams } 52701 }
        finally { Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectMemberships SET IsActive=1,VerifiedAtUtc=SYSUTCDATETIME() WHERE EmployeeId=@id;' @{id=$taskOtherHost} }
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Employees SET LastSyncedAtUtc=DATEADD(day,-1,SYSUTCDATETIME()) WHERE EmployeeId=@id;' @{id=$taskOtherHost}
        try { Expect-Error { Submit $taskParams } 52701 }
        finally { Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Employees SET LastSyncedAtUtc=SYSUTCDATETIME() WHERE EmployeeId=@id;' @{id=$taskOtherHost} }
    }
    Test-Case 'Project availability and location must agree' {
        $taskParams=New-Submission 'EXTERNAL';$taskParams.LocationId=[int]$taskFixture.otherLocationId;Expect-Error { Submit $taskParams } 52704
    }
    Test-Case 'Cross-day expired and over-horizon planned windows are rejected' {
        $taskParams=New-Submission 'EXTERNAL';$taskParams.ValidUntilUtc=$taskParams.ValidFromUtc.AddDays(1);Expect-Error { Submit $taskParams } 52702
        $taskParams=New-Submission 'EXTERNAL';$taskParams.ValidFromUtc=$taskParams.ValidFromUtc.AddDays(31);$taskParams.ValidUntilUtc=$taskParams.ValidFromUtc.AddHours(1);Expect-Error { Submit $taskParams } 52702
    }
    Test-Case 'Employee project registration remains pending and an equivalent new intake is reused' {
        $taskFirst=Submit (New-Submission 'EMPLOYEE_PROJECT');$taskSecond=Submit (New-Submission 'EMPLOYEE_PROJECT')
        Assert-Condition ($taskFirst.visits[0].status -eq 'PENDING' -and $taskSecond.visits[0].reused -and (New-VisitCount) -eq 1) 'Equivalent project request duplicated.'
    }
    Test-Case 'Employee project overlap with changed reason photo or window is rejected' {
        $null=Submit (New-Submission 'EMPLOYEE_PROJECT')
        foreach ($taskChange in @('reason','photo','window')) {
            $taskParams=New-Submission 'EMPLOYEE_PROJECT' 1 $(if ($taskChange -eq 'photo') {Random-Hash} else {[byte[]]::new(32)})
            if ($taskChange -eq 'reason') {$taskParams.Reason='Materially changed'}; if ($taskChange -eq 'window') {$taskParams.ValidUntilUtc=$taskParams.ValidUntilUtc.AddMinutes(-10)}
            Expect-Error { Submit $taskParams } 52703
        }
    }
    Test-Case 'Half-open adjacent employee project windows are independently allowed' {
        $taskFirst=New-Submission 'EMPLOYEE_PROJECT';$taskDayEnd=$taskFirst.ValidUntilUtc;$taskFirst.ValidUntilUtc=[datetime]::UtcNow.AddTicks([long](($taskDayEnd-[datetime]::UtcNow).Ticks/2));$null=Submit $taskFirst;$taskSecond=New-Submission 'EMPLOYEE_PROJECT'
        $taskSecond.ValidFromUtc=$taskFirst.ValidUntilUtc;$taskSecond.ValidUntilUtc=$taskDayEnd;$null=Submit $taskSecond
        Assert-Condition ((New-VisitCount) -eq 2) 'Adjacent windows were treated as overlap.'
    }
    Test-Case 'Same-key and new-key retries return the original result even without encryption envelopes' {
        $taskParams=New-Submission 'EXTERNAL' 2;$taskOne=Submit $taskParams;$taskParams.CredentialsJson=$null;$taskTwo=Submit $taskParams
        $taskParams.ClientKey=[guid]::NewGuid();$taskThree=Submit $taskParams
        Assert-Condition (($taskOne | ConvertTo-Json -Depth 7 -Compress) -eq ($taskTwo | ConvertTo-Json -Depth 7 -Compress)) 'Same-key result changed.'
        Assert-Condition (($taskOne | ConvertTo-Json -Depth 7 -Compress) -eq ($taskThree | ConvertTo-Json -Depth 7 -Compress)) 'New-key intake retry duplicated submission.'
        Assert-Condition ((New-VisitCount) -eq 2) 'Retry created extra people.'
    }
    Test-Case 'Changed payload with reused key or submitted intake cannot alter frozen content' {
        $taskParams=New-Submission 'EXTERNAL';$null=Submit $taskParams;$taskParams.Reason='Changed';Expect-Error { Submit $taskParams } 52703
        $taskParams.ClientKey=[guid]::NewGuid();Expect-Error { Submit $taskParams } 52703
    }
    Test-Case 'Idempotency replay reauthenticates expired sessions before returning stored results' {
        $taskParams=New-Submission;$null=Submit $taskParams;$taskParams.CsrfHash=Random-Hash;Expect-Error { Submit $taskParams } 52001
    }
    Test-Case 'Malformed encryption material or mismatched person mapping cannot create a partial form' {
        $taskParams=New-Submission 'EXTERNAL' 2;$taskCredentials=$taskParams.CredentialsJson | ConvertFrom-Json -NoEnumerate;$taskCredentials[1].nonce='00';$taskParams.CredentialsJson=ConvertTo-Json -InputObject $taskCredentials -Compress
        Expect-Error { Submit $taskParams } 52702;Assert-Condition ((New-VisitCount) -eq 0) 'Partial envelope registration persisted.'
    }
    Test-Case 'Audit failure rolls back visits credentials notices daily slot and intake state together' {
        $taskParams=New-Submission
        Invoke-GatePassNonQuery $taskAdmin ("CREATE TRIGGER gp.RegistrationFixtureFault ON gp.SecurityAuditEvents AFTER INSERT AS BEGIN IF EXISTS(SELECT 1 FROM inserted WHERE ActionCode='REGISTRATION_SUBMITTED' AND TargetReference='"+$taskParams.IntakeId+"') THROW 52997,'Synthetic registration fault',1; END;")
        try {
            Expect-Error { Submit $taskParams } 52997;Assert-Condition ((New-VisitCount) -eq 0) 'Visit escaped rollback.'
            Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT Status FROM gp.RegistrationIntakes WHERE IntakeId=@id;' @{id=$taskParams.IntakeId}) -eq 'DRAFT') 'Intake escaped rollback.'
            Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.IdempotencyRequests WHERE ClientKey=@key;' @{key=$taskParams.ClientKey}) -eq 0) 'Idempotency escaped rollback.'
        } finally { Invoke-GatePassNonQuery $taskAdmin 'DROP TRIGGER gp.RegistrationFixtureFault;' }
    }
    Test-Case 'Concurrent same-intake retries create one set of individual records' {
        $taskParams=New-Submission 'EXTERNAL' 2;$taskOne=Open-Restricted;$taskTwo=Open-Restricted
        $taskRace=Race (New-GatePassSqlCommand $taskOne $taskSubmitSql $taskParams) (New-GatePassSqlCommand $taskTwo $taskSubmitSql $taskParams) $taskOne $taskTwo
        Assert-Condition (@($taskRace | Where-Object Success).Count -eq 2 -and (New-VisitCount) -eq 2) 'Concurrent retry duplicated records.'
        Assert-Condition (($taskRace[0].Result | ConvertTo-Json -Depth 6 -Compress) -eq ($taskRace[1].Result | ConvertTo-Json -Depth 6 -Compress)) 'Retry outcomes differ.'
    }
    Test-Case 'Concurrent different keys on one intake preserve one submitted outcome' {
        $taskParams=New-Submission 'EXTERNAL';$taskOther=$taskParams.Clone();$taskOther.ClientKey=[guid]::NewGuid();$taskOne=Open-Restricted;$taskTwo=Open-Restricted
        $taskRace=Race (New-GatePassSqlCommand $taskOne $taskSubmitSql $taskParams) (New-GatePassSqlCommand $taskTwo $taskSubmitSql $taskOther) $taskOne $taskTwo
        Assert-Condition (@($taskRace | Where-Object Success).Count -eq 2 -and (New-VisitCount) -eq 1) 'New concurrent key duplicated submission.'
    }
    Test-Case 'Concurrent daily Digital ID intakes issue one pass and reuse it for the other' {
        $taskA=New-Submission;$taskB=New-Submission;$taskOne=Open-Restricted;$taskTwo=Open-Restricted
        $taskRace=Race (New-GatePassSqlCommand $taskOne $taskSubmitSql $taskA) (New-GatePassSqlCommand $taskTwo $taskSubmitSql $taskB) $taskOne $taskTwo
        Assert-Condition (@($taskRace | Where-Object Success).Count -eq 2 -and (New-VisitCount) -eq 1) 'Concurrent daily slots duplicated.'
        Assert-Condition ($taskRace[0].Result.visits[0].accessPassId -eq $taskRace[1].Result.visits[0].accessPassId) 'Different daily credentials returned.'
    }
    Test-Case 'Concurrent conflicting employee project windows cannot both commit' {
        $taskA=New-Submission 'EMPLOYEE_PROJECT';$taskB=New-Submission 'EMPLOYEE_PROJECT';$taskB.Reason='Conflict';$taskOne=Open-Restricted;$taskTwo=Open-Restricted
        $taskRace=Race (New-GatePassSqlCommand $taskOne $taskSubmitSql $taskA) (New-GatePassSqlCommand $taskTwo $taskSubmitSql $taskB) $taskOne $taskTwo
        Assert-Condition (@($taskRace | Where-Object Success).Count -eq 1 -and @($taskRace | Where-Object {-not $_.Success -and $_.Error -eq 52703}).Count -eq 1 -and (New-VisitCount) -eq 1) 'Conflicting overlap was not serialized.'
    }
    Test-Case 'Cancelled inside employee project blocks overlap until actual reconciled exit' {
        $taskFirstParams=New-Submission 'EMPLOYEE_PROJECT';$taskFirstParams.ValidFromUtc=[datetime]::UtcNow;$taskFirstParams.ValidUntilUtc=[datetime]::UtcNow.AddMinutes(330).Date.AddDays(1).AddMinutes(-330)
        $taskFirst=Submit $taskFirstParams;$taskV=$taskFirst.visits[0]
        $taskP=Auth OTHERHOST;$taskP.VisitRequestId=[guid]$taskV.visitRequestId;$taskP.View='HOST';$taskD=Call $taskApi 'gp.GetVisitDetail' $taskP;$taskP.Remove('View');$taskP.ClientKey=[guid]::NewGuid();$taskP.SnapshotVersion=1;$taskP.SnapshotHash=[Convert]::FromHexString($taskD.snapshotHash);$taskP.Decision='APPROVED';$null=Call $taskApi 'gp.DecideVisit' $taskP
        $null=Move-Visit $taskV
        $taskP=Auth HOST;$taskP.ClientKey=[guid]::NewGuid();$taskP.VisitRequestId=[guid]$taskV.visitRequestId;$taskP.ExpectedPassId=[guid]$taskV.accessPassId;$taskP.Reason='Actual cancellation while inside';$taskR=Call $taskApi 'gp.CancelVisit' $taskP;Assert-Condition $taskR.wasInsideAtCancellation 'Cancellation lost existing occupancy.'
        $taskNext=New-Submission 'EMPLOYEE_PROJECT';$taskNext.ValidFromUtc=$taskFirstParams.ValidFromUtc;$taskNext.ValidUntilUtc=$taskFirstParams.ValidUntilUtc;Expect-Error {Submit $taskNext} 52705
        $taskP=Auth RECON;$taskP.ClientKey=[guid]::NewGuid();$taskP.VisitRequestId=[guid]$taskV.visitRequestId;$taskP.AccessPassId=[guid]$taskV.accessPassId;$taskP.LocationId=[int]$taskFixture.locationId;$taskP.EventType='EXIT';$taskP.EntryMethod='RECONCILE';$taskP.ReconciliationReason='Actual project departure confirmed';$null=Call $taskApi 'gp.RecordMovement' $taskP
        $taskNew=Submit $taskNext;Assert-Condition ($taskNew.visits[0].status -eq 'PENDING' -and $taskNew.visits[0].visitRequestId -ne $taskV.visitRequestId) 'Departure failed to release overlap; old request must remain historical.'
    }
    Test-Case 'Cancelled outside employee project allows a fresh individual request' {
        $taskFirstParams=New-Submission 'EMPLOYEE_PROJECT';$taskFirst=Submit $taskFirstParams;$taskV=$taskFirst.visits[0]
        $taskP=Auth HOST;$taskP.ClientKey=[guid]::NewGuid();$taskP.VisitRequestId=[guid]$taskV.visitRequestId;$taskP.ExpectedPassId=[guid]$taskV.accessPassId;$taskP.Reason='Outside cancellation';$taskR=Call $taskApi 'gp.CancelVisit' $taskP;Assert-Condition (-not $taskR.wasInsideAtCancellation) 'Outside occupant was invented.'
        $taskNext=New-Submission 'EMPLOYEE_PROJECT';$taskNext.ValidFromUtc=$taskFirstParams.ValidFromUtc;$taskNext.ValidUntilUtc=$taskFirstParams.ValidUntilUtc;$taskNew=Submit $taskNext;Assert-Condition ($taskNew.visits[0].visitRequestId -ne $taskV.visitRequestId -and (New-VisitCount) -eq 2) 'Independent cancelled history was overwritten.'
    }
    Test-Case 'Actual photo decoder AES recovery and registration service interoperate with restricted SQL' {
        if (-not $SharpPath) {
            $SharpPath=Join-Path $taskRoot 'node_modules/sharp'
            if (-not (Test-Path -LiteralPath $SharpPath)) {$SharpPath=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'}
        }
        if (-not (Test-Path -LiteralPath $SharpPath)) {throw 'Provide the existing sharp package path with -SharpPath; no software was installed.'}
        $taskRawSession=Random-Hash;$taskRawCsrf=Random-Hash
        Invoke-GatePassNonQuery $taskAdmin @'
DECLARE @now datetime2(3)=SYSUTCDATETIME();
INSERT gp.Sessions(SessionHash,UserId,CsrfHash,AuthorizationVersionAtIssue,LastSeenAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,CreatedAtUtc)
SELECT @session,UserId,@csrf,AuthorizationVersion,@now,DATEADD(hour,1,@now),DATEADD(hour,2,@now),@now FROM gp.Users WHERE UserId=@id;
'@ @{session=[Security.Cryptography.SHA256]::HashData($taskRawSession);csrf=[Security.Cryptography.SHA256]::HashData($taskRawCsrf);id=[guid]$taskActors.HOST.UserId}
        $taskInfo=[Diagnostics.ProcessStartInfo]::new();$taskInfo.FileName=(Get-Command node -CommandType Application | Select-Object -First 1).Source
        $taskInfo.ArgumentList.Add((Join-Path $taskRoot 'tests/registration.sql-integration.ts'))
        $taskInfo.WorkingDirectory=$taskRoot;$taskInfo.UseShellExecute=$false;$taskInfo.CreateNoWindow=$true
        $taskInfo.RedirectStandardInput=$true;$taskInfo.RedirectStandardOutput=$true;$taskInfo.RedirectStandardError=$true
        $taskNode=[Diagnostics.Process]::new();$taskNode.StartInfo=$taskInfo
        try {
            $null=$taskNode.Start();$taskStdout=$taskNode.StandardOutput.ReadToEndAsync();$taskStderr=$taskNode.StandardError.ReadToEndAsync()
            $taskNode.StandardInput.Write((@{server=$Server;trustLocalCertificate=[bool]$TrustLocalServerCertificate;powerShell=(Join-Path $PSHOME 'pwsh.exe');sharpPath=$SharpPath;
                sessionToken=[Convert]::ToBase64String($taskRawSession).TrimEnd('=').Replace('+','-').Replace('/','_');csrfToken=[Convert]::ToBase64String($taskRawCsrf).TrimEnd('=').Replace('+','-').Replace('/','_');
                employeeId=$taskFixture.hostEmployeeId;hostEmployeeId=$taskOtherHost;locationId=[int]$taskFixture.locationId;projectLocationId=[long]$taskFixture.projectLocationId} | ConvertTo-Json -Compress))
            $taskNode.StandardInput.Close()
            $taskExited=$taskNode.WaitForExit(60000);if (-not $taskExited) {$taskNode.Kill($true);$taskNode.WaitForExit()}
            $taskIntegration=$null
            foreach ($taskLine in ($taskStdout.GetAwaiter().GetResult() -split '\r?\n' | Where-Object {$_})) {
                $taskItem=$taskLine | ConvertFrom-Json
                if ($taskItem.kind -eq 'owned') {$taskOwned.Add(@{intakeId=$taskItem.intakeId;tokenHash=$taskItem.tokenHash})}
                elseif ($taskItem.kind -eq 'report') {$taskIntegration=$taskItem}
            }
            if (-not $taskExited) {throw 'Registration backend integration timed out; owned data will be cleaned.'}
            if ($taskNode.ExitCode -ne 0) {throw ('Registration backend integration failed: '+$taskStderr.GetAwaiter().GetResult())}
            Assert-Condition ($null -ne $taskIntegration -and $taskIntegration.Status -eq 'PASS' -and $taskIntegration.CaseCount -eq 6) 'Incomplete backend integration evidence.'
            $taskIntegration.PSObject.Properties.Remove('kind')
            $taskIntegration | Add-Member -NotePropertyName CheckedAtUtc -NotePropertyValue ([datetime]::UtcNow.ToString('o'))
            $taskIntegration | Add-Member -NotePropertyName SourceSha256 -NotePropertyValue @(@('src/registration/RegistrationService.ts','src/registration/SqlRegistrationRepository.ts','src/registration/RegistrationPhoto.ts','src/registration/QrCredentialEnvelope.ts','tests/registration.sql-integration.ts','tests/helpers/Registration.SqlBridge.ps1') | ForEach-Object {@{File=$_;Sha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot $_) -Algorithm SHA256).Hash}})
            $taskIntegration | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $taskRoot 'database/validation/registration-backend-integration.json') -Encoding utf8
        } finally {$taskNode.Dispose();[Array]::Clear($taskRawSession,0,$taskRawSession.Length);[Array]::Clear($taskRawCsrf,0,$taskRawCsrf.Length)}
    }
    $taskComplete=$true
}
finally {
    foreach ($taskConnection in $taskConnections) {$taskConnection.Dispose()}
    try {
        Invoke-GatePassNonQuery $taskAdmin "IF @@TRANCOUNT>0 ROLLBACK; IF OBJECT_ID('gp.RegistrationFixtureFault','TR') IS NOT NULL DROP TRIGGER gp.RegistrationFixtureFault;"
        Cleanup-Registration
        if ($taskFixtureReady) { Invoke-GatePassNonQuery $taskAdmin ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '003_transaction_cleanup.sql'))) @{RunId=$taskRun} }
        foreach ($taskPrincipal in $taskPrincipals) {Invoke-GatePassNonQuery $taskAdmin ('DROP USER '+$taskPrincipal+';')}
        $taskClean=$true
    } finally {
        $taskAdmin.Dispose()
        [ordered]@{Status=if ($taskComplete -and $taskClean -and $taskCases.Count -gt 0 -and @($taskCases | Where-Object {-not $_.Passed}).Count -eq 0) {'PASS'} else {'FAIL'};
            CheckedAtUtc=[datetime]::UtcNow.ToString('o');Database='GatePass_DesignTest';CaseCount=$taskCases.Count;CleanupPassed=$taskClean;
            ConcurrentCasesWithBothWaitersObserved=4;NestedActualBackendIntegrationCases=6;
            Scope='Restricted API SQL lifecycle cases use synthetic photo/envelope declarations. Six nested Node cases exercise real sharp normalization, AES-GCM and SQL RPC. Not real SSO, mail, HTTP/browser or production driver/storage.';
            SnapshotCorrectionSha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot 'database/migrations/009_registration_snapshot_canonicalization.sql') -Algorithm SHA256).Hash;
            MigrationSha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot 'database/migrations/008_registration_and_digital_id.sql') -Algorithm SHA256).Hash;
            CancelledOccupantCorrectionSha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot 'database/migrations/016_cancelled_occupant_overlap.sql') -Algorithm SHA256).Hash;
            HarnessSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash;
            CleanupSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot '004_registration_cleanup.sql') -Algorithm SHA256).Hash;Cases=@($taskCases)} |
            ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskRoot 'database/validation/registration-report.json') -Encoding utf8
    }
}
if (-not $taskComplete -or @($taskCases | Where-Object {-not $_.Passed}).Count) {throw 'Registration suite failed.'}
Write-Output "All $($taskCases.Count) registration cases passed; exact owned data and temporary principals removed."
