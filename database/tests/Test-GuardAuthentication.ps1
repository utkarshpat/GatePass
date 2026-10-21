#Requires -Version 7.0
[CmdletBinding()]
param([string]$Server='localhost\SQLEXPRESS',[switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskAdmin=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskRun=[guid]::NewGuid(); $taskCases=[Collections.Generic.List[object]]::new()
$taskConnections=[Collections.Generic.List[object]]::new(); $taskPrincipals=[Collections.Generic.List[string]]::new()
$taskSources=[Collections.Generic.HashSet[string]]::new(); $taskActors=@{}
$taskFixtureReady=$false; $taskComplete=$false; $taskClean=$false
# Deliberately synthetic PHC for SQL contract tests. SQL trusts the isolated
# verifier's attestation; these cases do not claim to verify a password algorithm.
$taskHash='$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
function Assert-Condition($Value,[string]$Message) { if (-not $Value) { throw $Message } }
function Random-Hash { return ,([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)) }
function New-Source { $taskValue=Random-Hash; $null=$taskSources.Add([Convert]::ToHexString($taskValue)); return ,$taskValue }
function Sql-Number($Exception) { $taskBase=$Exception.GetBaseException(); if ($taskBase -is [Data.SqlClient.SqlException]) { return $taskBase.Number }; return 0 }
function Expect-Error([scriptblock]$Action,[int]$Number) {
    try { $null=& $Action } catch { if ((Sql-Number $_.Exception) -eq $Number) { return }; throw }; throw "Expected SQL error $Number."
}
function Call($Connection,[string]$Procedure,[hashtable]$Parameters) {
    $taskArguments=($Parameters.Keys | ForEach-Object { '@'+$_+'=@'+$_ }) -join ','
    return (Invoke-GatePassScalar $Connection ('EXEC '+$Procedure+' '+$taskArguments+';') $Parameters) | ConvertFrom-Json
}
function Admin-Parameters([string]$Actor='ADMIN',[string]$Target='GUARD') {
    return @{SessionHash=[Convert]::FromHexString($taskActors[$Actor].SessionHex);CsrfHash=[Convert]::FromHexString($taskActors[$Actor].CsrfHex);
        TargetUserId=[guid]$taskActors[$Target].UserId;Action='ISSUE_SETUP';LoginId=$taskLogin;SetupTokenHash=(Random-Hash)}
}
function Issue-Setup([string]$Target='GUARD') {
    $taskParams=Admin-Parameters -Target $Target
    if ($Target -eq 'GUARD2') { $taskParams.LoginId=$taskLogin+'2' }
    $null=Call $taskApi 'gp.ManageGuardCredential' $taskParams
    return ,$taskParams.SetupTokenHash
}
function Setup-Guard([string]$Target='GUARD') {
    $taskTicket=Issue-Setup $Target
    $taskResult=Call $taskAuth 'gp.CompleteGuardSetup' @{TokenHash=$taskTicket;SourceHash=(New-Source);NewEncodedPasswordHash=$taskHash}
    Assert-Condition ($taskResult.status -eq 'OK') 'Fixture setup was denied.'
}
function Begin-Login([string]$Login=$taskLogin,$Source=(New-Source)) {
    $taskParams=@{LoginId=$Login;AttemptHash=(Random-Hash);SourceHash=$Source}
    $taskResult=Call $taskAuth 'gp.BeginGuardLogin' $taskParams
    return @{Parameters=$taskParams;Result=$taskResult}
}
function Complete-Parameters($Attempt,[bool]$Verified=$true) {
    return @{AttemptHash=$Attempt.Parameters.AttemptHash;SourceHash=$Attempt.Parameters.SourceHash;PasswordVerified=$Verified;
        SessionHash=(Random-Hash);CsrfHash=(Random-Hash);NewEncodedPasswordHash=$null}
}
function Complete-Login($Attempt,[bool]$Verified=$true) {
    $taskParams=Complete-Parameters $Attempt $Verified
    return @{Parameters=$taskParams;Result=(Call $taskAuth 'gp.CompleteGuardLogin' $taskParams)}
}
function Test-Case([string]$Name,[scriptblock]$Action,[switch]$WithoutSetup) {
    try {
        if (-not $WithoutSetup) { Setup-Guard }
        $null=& $Action; $taskCases.Add(@{Name=$Name;Passed=$true}); Write-Output ('PASS: '+$Name)
    } catch { $taskCases.Add(@{Name=$Name;Passed=$false;Error=$_.Exception.Message}); Write-Output ('FAIL: '+$Name+' -- '+$_.Exception.Message) }
}
function Open-Restricted([string]$Principal) {
    $taskConnection=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
    Invoke-GatePassNonQuery $taskConnection ("EXECUTE AS USER='"+$Principal+"';")
    $taskConnections.Add($taskConnection); return $taskConnection
}
function Race($FirstConnection,$FirstCommand,$SecondConnection,$SecondCommand) {
    $taskFirstSid=Invoke-GatePassScalar $FirstConnection 'SELECT @@SPID;'
    $taskSecondSid=Invoke-GatePassScalar $SecondConnection 'SELECT @@SPID;'
    Invoke-GatePassNonQuery $taskAdmin 'BEGIN TRANSACTION; EXEC gp._TakeLock N''gp:authorization'',''Exclusive'';'
    $taskFirst=$null; $taskSecond=$null
    try {
        $taskFirst=$FirstCommand.ExecuteScalarAsync(); $taskSecond=$SecondCommand.ExecuteScalarAsync()
        $taskDeadline=[datetime]::UtcNow.AddSeconds(3)
        do {
            $taskWaiting=Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id IN(@a,@b) AND wait_type LIKE 'LCK_M%';" @{a=$taskFirstSid;b=$taskSecondSid}
            if ($taskWaiting -eq 2) { break }; [Threading.Thread]::Sleep(20)
        } while ([datetime]::UtcNow -lt $taskDeadline)
        Assert-Condition ($taskWaiting -eq 2) 'Both independent SQL contenders were not observed waiting.'
    } finally { Invoke-GatePassNonQuery $taskAdmin 'IF @@TRANCOUNT>0 COMMIT;' }
    $taskResults=[Collections.Generic.List[object]]::new()
    try {
        foreach ($taskPending in @($taskFirst,$taskSecond)) {
            try { $taskResults.Add(@{Succeeded=$true;Value=($taskPending.GetAwaiter().GetResult() | ConvertFrom-Json)}) }
            catch { $taskResults.Add(@{Succeeded=$false;Error=(Sql-Number $_.Exception)}) }
        }
    } finally { $FirstCommand.Dispose(); $SecondCommand.Dispose() }
    return ,@($taskResults)
}
try {
    Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT DB_NAME();') -eq 'GatePass_DesignTest') 'Dedicated database required.'
    $taskFixture=(Invoke-GatePassScalar $taskAdmin ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '002_transaction_fixtures.sql'))) @{RunId=$taskRun}) | ConvertFrom-Json
    $taskFixtureReady=$true; foreach ($taskItem in $taskFixture.actors) { $taskActors[$taskItem.Label]=$taskItem }
    $taskGuard=[guid]$taskActors.GUARD.UserId; $taskLogin=('g'+$taskRun.ToString('N').Substring(0,20))
    Invoke-GatePassNonQuery $taskAdmin "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(@id,'GUARD_CREDENTIALS_MANAGE');" @{id=[long]$taskActors.ADMIN.GrantId}
    foreach ($taskPair in @(@('gp_guard_auth_fixture','gp_guard_auth_runtime'),@('gp_guard_api_fixture','gp_api_runtime'),@('gp_guard_worker_fixture','gp_worker_runtime'))) {
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM sys.database_principals WHERE name=@name;' @{name=$taskPair[0]}) -eq 0) 'Refusing existing test principal.'
        Invoke-GatePassNonQuery $taskAdmin ("CREATE USER "+$taskPair[0]+" WITHOUT LOGIN; ALTER ROLE "+$taskPair[1]+" ADD MEMBER "+$taskPair[0]+";")
        $taskPrincipals.Add($taskPair[0])
    }
    $taskAuth=Open-Restricted 'gp_guard_auth_fixture'; $taskApi=Open-Restricted 'gp_guard_api_fixture'; $taskWorker=Open-Restricted 'gp_guard_worker_fixture'
    Test-Case 'Auth role cannot SELECT password hashes sessions or reset tickets' {
        foreach ($taskTable in @('GuardCredentials','Sessions','GuardSetupTickets')) { Expect-Error { Invoke-GatePassScalar $taskAuth ('SELECT COUNT(*) FROM gp.'+$taskTable+';') } 229 }
    } -WithoutSetup
    Test-Case 'General API and worker cannot invoke password verification entry points' {
        $taskParams=@{LoginId=$taskLogin;AttemptHash=(Random-Hash);SourceHash=(New-Source)}
        Expect-Error { Call $taskApi 'gp.BeginGuardLogin' $taskParams } 229
        Expect-Error { Call $taskWorker 'gp.BeginGuardLogin' $taskParams } 229
    } -WithoutSetup
    Test-Case 'Auth role cannot manage credentials approve visits or call private helpers' {
        Expect-Error { Call $taskAuth 'gp.ManageGuardCredential' (Admin-Parameters) } 229
        Expect-Error { Invoke-GatePassScalar $taskAuth 'EXEC gp.DecideVisit;' } 229
        Expect-Error { Invoke-GatePassScalar $taskAuth 'EXEC gp._TakeLock N''probe'';' } 229
    } -WithoutSetup
    Test-Case 'Guard cannot provision their own credential or elevate scope' {
        Expect-Error { Call $taskApi 'gp.ManageGuardCredential' (Admin-Parameters 'GUARD') } 52601
    } -WithoutSetup
    Test-Case 'Scoped admin cannot reset another location or a multi-location guard' {
        Expect-Error { Call $taskApi 'gp.ManageGuardCredential' (Admin-Parameters -Target 'WRONGLOCATION') } 52601
        Expect-Error { Call $taskApi 'gp.ManageGuardCredential' (Admin-Parameters -Target 'SPLIT') } 52601
    } -WithoutSetup
    Test-Case 'Employee and non-guard identities cannot receive a local guard password' {
        Expect-Error { Call $taskApi 'gp.ManageGuardCredential' (Admin-Parameters -Target 'HOST') } 52601
        Expect-Error { Call $taskApi 'gp.ManageGuardCredential' (Admin-Parameters -Target 'RECEPTION') } 52601
    } -WithoutSetup
    Test-Case 'Separate credential-management capability is mandatory' {
        Invoke-GatePassNonQuery $taskAdmin "DELETE gp.GrantCapabilities WHERE RoleGrantId=@id AND CapabilityCode='GUARD_CREDENTIALS_MANAGE';" @{id=[long]$taskActors.ADMIN.GrantId}
        try { Expect-Error { Issue-Setup } 52601 }
        finally { Invoke-GatePassNonQuery $taskAdmin "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(@id,'GUARD_CREDENTIALS_MANAGE');" @{id=[long]$taskActors.ADMIN.GrantId} }
    } -WithoutSetup
    Test-Case 'Login ID grammar and full-length hashes are enforced before mutation' {
        foreach ($taskBad in @('UPPERCASE','space name','trailing ','_prefix',('x'*65))) {
            $taskParams=Admin-Parameters; $taskParams.LoginId=$taskBad; Expect-Error { Call $taskApi 'gp.ManageGuardCredential' $taskParams } 52602
        }
        $taskParams=Admin-Parameters; $taskParams.SetupTokenHash=[byte[]](1,2); Expect-Error { Call $taskApi 'gp.ManageGuardCredential' $taskParams } 52602
    } -WithoutSetup
    Test-Case 'Provisioning invalidates previous sessions without creating a password or guard role' {
        $taskBefore=Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.StaffRoleGrants WHERE UserId=@id;' @{id=$taskGuard}
        $null=Issue-Setup
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.GuardCredentials WHERE UserId=@id AND EncodedPasswordHash IS NULL AND MustChangePassword=1;' @{id=$taskGuard}) -eq 1) 'Unexpected password after provisioning.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.Sessions WHERE UserId=@id AND RevokedAtUtc IS NULL;' @{id=$taskGuard}) -eq 0) 'Old session survived.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.StaffRoleGrants WHERE UserId=@id;' @{id=$taskGuard}) -eq $taskBefore) 'Provisioning granted a role.'
    } -WithoutSetup
    Test-Case 'Duplicate login IDs cannot be assigned to another guard' {
        Expect-Error { Call $taskApi 'gp.ManageGuardCredential' (Admin-Parameters -Target 'GUARD2') } 2627
    }
    Test-Case 'Reset cannot silently rename an existing login ID' {
        $taskParams=Admin-Parameters; $taskParams.LoginId=$taskLogin+'other'; Expect-Error { Call $taskApi 'gp.ManageGuardCredential' $taskParams } 52602
    }
    Test-Case 'Setup handles are single-use and only supported encoded hashes are accepted' {
        $taskToken=Issue-Setup; $taskSource=New-Source
        Expect-Error { Call $taskAuth 'gp.CompleteGuardSetup' @{TokenHash=$taskToken;SourceHash=$taskSource;NewEncodedPasswordHash='plaintext-or-fast-sha256'} } 52602
        $taskParams=@{TokenHash=$taskToken;SourceHash=$taskSource;NewEncodedPasswordHash=$taskHash}
        Assert-Condition ((Call $taskAuth 'gp.CompleteGuardSetup' $taskParams).status -eq 'OK') 'Valid setup failed.'
        Assert-Condition ((Call $taskAuth 'gp.CompleteGuardSetup' $taskParams).status -eq 'DENIED') 'Setup replay succeeded.'
    }
    Test-Case 'New reset invalidates earlier reset handles and current password' {
        $taskOld=Issue-Setup; $null=Issue-Setup
        Assert-Condition ((Call $taskAuth 'gp.CompleteGuardSetup' @{TokenHash=$taskOld;SourceHash=(New-Source);NewEncodedPasswordHash=$taskHash}).status -eq 'DENIED') 'Old reset accepted.'
        Assert-Condition ((Begin-Login).Result.status -eq 'DENIED') 'Old password remained usable during reset.'
    }
    Test-Case 'Expired reset handles fail without changing credentials' {
        $taskToken=Issue-Setup
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.GuardSetupTickets SET CreatedAtUtc=DATEADD(hour,-1,SYSUTCDATETIME()),ExpiresAtUtc=DATEADD(second,-1,SYSUTCDATETIME()) WHERE TokenHash=@hash;' @{hash=$taskToken}
        Assert-Condition ((Call $taskAuth 'gp.CompleteGuardSetup' @{TokenHash=$taskToken;SourceHash=(New-Source);NewEncodedPasswordHash=$taskHash}).status -eq 'DENIED') 'Expired setup accepted.'
    }
    Test-Case 'Unknown locked and disabled guards have the same private denied shape' {
        $taskUnknown=(Begin-Login ($taskLogin+'unknown')).Result | ConvertTo-Json -Compress
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.GuardCredentials SET IsEnabled=0 WHERE UserId=@id;' @{id=$taskGuard}
        $taskDisabled=(Begin-Login).Result | ConvertTo-Json -Compress
        Assert-Condition ($taskUnknown -eq $taskDisabled -and $taskUnknown -eq '{"status":"DENIED"}') 'Account existence disclosed.'
    }
    Test-Case 'Only two unconsumed login challenges are permitted per guard' {
        Assert-Condition ((Begin-Login).Result.status -eq 'READY') 'First challenge failed.'
        Assert-Condition ((Begin-Login).Result.status -eq 'READY') 'Second challenge failed.'
        Assert-Condition ((Begin-Login).Result.status -eq 'DENIED') 'Unbounded challenges accepted.'
    }
    Test-Case 'Abandoned old challenges do not block login immediately after reset' {
        $null=Begin-Login; $null=Begin-Login; Setup-Guard
        Assert-Condition ((Begin-Login).Result.status -eq 'READY') 'Reset left obsolete verification slots occupied.'
    }
    Test-Case 'Successful verified challenge creates one current opaque session' {
        $taskAttempt=Begin-Login; $taskLoginResult=Complete-Login $taskAttempt
        Assert-Condition ($taskLoginResult.Result.status -eq 'OK') 'Verified login failed.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE s.SessionHash=@hash AND s.AuthorizationVersionAtIssue=u.AuthorizationVersion AND s.RevokedAtUtc IS NULL;' @{hash=$taskLoginResult.Parameters.SessionHash}) -eq 1) 'Current session not found.'
    }
    Test-Case 'Login challenge replay cannot mint another session' {
        $taskAttempt=Begin-Login; $taskParams=Complete-Parameters $taskAttempt
        Assert-Condition ((Call $taskAuth 'gp.CompleteGuardLogin' $taskParams).status -eq 'OK') 'Initial login failed.'
        $taskParams.SessionHash=Random-Hash
        Assert-Condition ((Call $taskAuth 'gp.CompleteGuardLogin' $taskParams).status -eq 'DENIED') 'Challenge replay succeeded.'
    }
    Test-Case 'Password-issued session can move only a visit in its allocated project and location' {
        $taskSession=Complete-Login (Begin-Login); Assert-Condition ($taskSession.Result.status -eq 'OK') 'Password login failed.'
        foreach ($taskLabel in @('MOVEMENT','OTHER_PAIR')) {
            $taskVisit=@($taskFixture.visits | Where-Object {$_.Label -eq $taskLabel})[0]
            $taskParams=@{SessionHash=$taskSession.Parameters.SessionHash;CsrfHash=$taskSession.Parameters.CsrfHash;ClientKey=[guid]::NewGuid();
                VisitRequestId=[guid]$taskVisit.VisitId;AccessPassId=[guid]$taskVisit.PassId;LocationId=[int]$taskFixture.locationId;
                EventType='ENTRY';EntryMethod='MANUAL';CredentialHash=$null;OccurredAtUtc=$null;ReconciliationReason=$null;SelectedProjectLocationId=[long]$taskFixture.projectLocationId}
            if ($taskLabel -eq 'OTHER_PAIR') { Expect-Error { Call $taskApi 'gp.RecordMovement' $taskParams } 52001 }
            else { $null=Call $taskApi 'gp.RecordMovement' $taskParams }
        }
    }
    Test-Case 'Source binding prevents stealing another challenge' {
        $taskAttempt=Begin-Login; $taskParams=Complete-Parameters $taskAttempt; $taskParams.SourceHash=New-Source
        Assert-Condition ((Call $taskAuth 'gp.CompleteGuardLogin' $taskParams).status -eq 'DENIED') 'Wrong source accepted.'
        Assert-Condition ((Complete-Login $taskAttempt).Result.status -eq 'OK') 'Wrong source consumed the real challenge.'
    }
    Test-Case 'Expired login challenge cannot issue a session' {
        $taskAttempt=Begin-Login
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.GuardLoginAttempts SET CreatedAtUtc=DATEADD(minute,-2,SYSUTCDATETIME()),ExpiresAtUtc=DATEADD(second,-1,SYSUTCDATETIME()) WHERE AttemptHash=@hash;' @{hash=$taskAttempt.Parameters.AttemptHash}
        Assert-Condition ((Complete-Login $taskAttempt).Result.status -eq 'DENIED') 'Expired login accepted.'
    }
    Test-Case 'Five failed verifications cause temporary account lockout' {
        for ($taskIndex=0;$taskIndex -lt 5;$taskIndex++) { Assert-Condition ((Complete-Login (Begin-Login) $false).Result.status -eq 'DENIED') 'Wrong password accepted.' }
        Assert-Condition ((Begin-Login).Result.status -eq 'DENIED') 'Locked account returned a challenge.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.GuardCredentials WHERE UserId=@id AND LockedUntilUtc>SYSUTCDATETIME();' @{id=$taskGuard}) -eq 1) 'Lockout not persisted.'
    }
    Test-Case 'Successful verification clears previous failures' {
        $null=Complete-Login (Begin-Login) $false; $null=Complete-Login (Begin-Login)
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT FailedCount FROM gp.GuardCredentials WHERE UserId=@id;' @{id=$taskGuard}) -eq 0) 'Failure count not reset.'
    }
    Test-Case 'Source budget applies to unknown accounts and resets after its window' {
        $taskSource=New-Source
        for ($taskIndex=0;$taskIndex -lt 20;$taskIndex++) { Assert-Condition ((Begin-Login ($taskLogin+'unknown') $taskSource).Result.status -eq 'DENIED') 'Unknown account unexpectedly ready.' }
        Assert-Condition ((Begin-Login $taskLogin $taskSource).Result.status -eq 'THROTTLED') 'Source budget bypassed.'
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.GuardAuthSources SET WindowStartUtc=DATEADD(minute,-2,SYSUTCDATETIME()) WHERE SourceHash=@hash;' @{hash=$taskSource}
        Assert-Condition ((Begin-Login $taskLogin $taskSource).Result.status -eq 'READY') 'Rate window did not recover.'
    }
    Test-Case 'Credential reset fences a password verification already in flight' {
        $taskAttempt=Begin-Login; $null=Issue-Setup
        Assert-Condition ((Complete-Login $taskAttempt).Result.status -eq 'DENIED') 'Old verification survived reset.'
    }
    Test-Case 'Credential disable fences in-flight login and revokes existing sessions' {
        $taskSession=Complete-Login (Begin-Login); $taskAttempt=Begin-Login
        $taskParams=Admin-Parameters; $taskParams.Action='DISABLE'; $null=Call $taskApi 'gp.ManageGuardCredential' $taskParams
        Assert-Condition ((Complete-Login $taskAttempt).Result.status -eq 'DENIED') 'Disabled credential logged in.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.Sessions WHERE SessionHash=@hash AND RevokedAtUtc IS NOT NULL;' @{hash=$taskSession.Parameters.SessionHash}) -eq 1) 'Session survived disable.'
    }
    Test-Case 'Disabled user and revoked guard role block pending login completion' {
        $taskAttempt=Begin-Login
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Users SET IsActive=0 WHERE UserId=@id;' @{id=$taskGuard}
        try { Assert-Condition ((Complete-Login $taskAttempt).Result.status -eq 'DENIED') 'Disabled user accepted.' }
        finally { Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Users SET IsActive=1 WHERE UserId=@id;' @{id=$taskGuard} }
        $taskAttempt=Begin-Login
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.StaffRoleGrants SET RevokedAtUtc=SYSUTCDATETIME(),RevokedByUserId=@actor WHERE RoleGrantId=@grant;' @{actor=[guid]$taskActors.ADMIN.UserId;grant=[long]$taskActors.GUARD.GrantId}
        try { Assert-Condition ((Complete-Login $taskAttempt).Result.status -eq 'DENIED') 'Revoked role accepted.' }
        finally { Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.StaffRoleGrants SET RevokedAtUtc=NULL,RevokedByUserId=NULL WHERE RoleGrantId=@grant;' @{grant=[long]$taskActors.GUARD.GrantId} }
    }
    Test-Case 'Password change revokes older sessions and challenges before issuing a replacement' {
        $taskSession=Complete-Login (Begin-Login); $taskOne=Begin-Login; $taskTwo=Begin-Login
        $taskParams=Complete-Parameters $taskOne; $taskParams.NewEncodedPasswordHash=$taskHash
        Assert-Condition ((Call $taskAuth 'gp.CompleteGuardLogin' $taskParams).status -eq 'OK') 'Password change failed.'
        Assert-Condition ((Complete-Login $taskTwo).Result.status -eq 'DENIED') 'Old concurrent challenge survived password change.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.Sessions WHERE SessionHash=@hash AND RevokedAtUtc IS NOT NULL;' @{hash=$taskSession.Parameters.SessionHash}) -eq 1) 'Old session survived password change.'
    }
    Test-Case 'Session touch checks CSRF and does not extend absolute expiry' {
        $taskSession=Complete-Login (Begin-Login); $taskParams=@{SessionHash=$taskSession.Parameters.SessionHash;CsrfHash=$taskSession.Parameters.CsrfHash}
        $taskBefore=Invoke-GatePassScalar $taskAdmin 'SELECT AbsoluteExpiresAtUtc FROM gp.Sessions WHERE SessionHash=@hash;' @{hash=$taskParams.SessionHash}
        Assert-Condition ((Call $taskAuth 'gp.TouchGuardSession' $taskParams).status -eq 'OK') 'Touch failed.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT AbsoluteExpiresAtUtc FROM gp.Sessions WHERE SessionHash=@hash;' @{hash=$taskParams.SessionHash}) -eq $taskBefore) 'Absolute expiry extended.'
        $taskParams.CsrfHash=Random-Hash; Expect-Error { Call $taskAuth 'gp.TouchGuardSession' $taskParams } 52001
    }
    Test-Case 'Logout is CSRF-bound and repeated logout remains safe' {
        $taskSession=Complete-Login (Begin-Login); $taskParams=@{SessionHash=$taskSession.Parameters.SessionHash;CsrfHash=(Random-Hash)}
        $null=Call $taskAuth 'gp.RevokeGuardSession' $taskParams
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.Sessions WHERE SessionHash=@hash AND RevokedAtUtc IS NULL;' @{hash=$taskParams.SessionHash}) -eq 1) 'Wrong CSRF logged out the real session.'
        $taskParams.CsrfHash=$taskSession.Parameters.CsrfHash
        $null=Call $taskAuth 'gp.RevokeGuardSession' $taskParams; $null=Call $taskAuth 'gp.RevokeGuardSession' $taskParams
        Expect-Error { Call $taskAuth 'gp.TouchGuardSession' $taskParams } 52001
    }
    Test-Case 'Oversized and truncated authentication hashes are rejected' {
        foreach ($taskSize in @(2,33)) {
            $taskParams=@{LoginId=$taskLogin;AttemptHash=[byte[]]::new($taskSize);SourceHash=(New-Source)}
            Expect-Error { Call $taskAuth 'gp.BeginGuardLogin' $taskParams } 52602
        }
    }
    Test-Case 'Audit failure rolls back session creation and challenge consumption together' {
        $taskAttempt=Begin-Login; $taskParams=Complete-Parameters $taskAttempt
        Invoke-GatePassNonQuery $taskAdmin ("CREATE TRIGGER gp.GuardAuthFixtureFault ON gp.SecurityAuditEvents AFTER INSERT AS BEGIN IF EXISTS(SELECT 1 FROM inserted WHERE ActorUserId='"+$taskGuard+"' AND ActionCode='GUARD_LOGIN_SUCCEEDED') THROW 52998,'Synthetic audit fault',1; END;")
        try {
            Expect-Error { Call $taskAuth 'gp.CompleteGuardLogin' $taskParams } 52998
            Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.Sessions WHERE SessionHash=@hash;' @{hash=$taskParams.SessionHash}) -eq 0) 'Session escaped failed audit.'
            Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.GuardLoginAttempts WHERE AttemptHash=@hash AND UsedAtUtc IS NULL;' @{hash=$taskParams.AttemptHash}) -eq 1) 'Challenge consumed on rollback.'
        } finally { Invoke-GatePassNonQuery $taskAdmin 'DROP TRIGGER gp.GuardAuthFixtureFault;' }
    }
    Test-Case 'Concurrent completion of one challenge creates exactly one session' {
        $taskAttempt=Begin-Login; $taskOne=Open-Restricted 'gp_guard_auth_fixture'; $taskTwo=Open-Restricted 'gp_guard_auth_fixture'
        $taskSql='EXEC gp.CompleteGuardLogin @AttemptHash,@SourceHash,@PasswordVerified,@SessionHash,@CsrfHash,@NewEncodedPasswordHash;'
        $taskResults=Race $taskOne (New-GatePassSqlCommand $taskOne $taskSql (Complete-Parameters $taskAttempt)) $taskTwo (New-GatePassSqlCommand $taskTwo $taskSql (Complete-Parameters $taskAttempt))
        Assert-Condition (@($taskResults | Where-Object {$_.Succeeded -and $_.Value.status -eq 'OK'}).Count -eq 1) 'Challenge produced multiple successes.'
        Assert-Condition (@($taskResults | Where-Object {$_.Succeeded -and $_.Value.status -eq 'DENIED'}).Count -eq 1) 'Losing challenge was not denied.'
    }
    Test-Case 'Concurrent failed challenges preserve both failure increments' {
        $taskA=Begin-Login; $taskB=Begin-Login; $taskOne=Open-Restricted 'gp_guard_auth_fixture'; $taskTwo=Open-Restricted 'gp_guard_auth_fixture'
        $taskSql='EXEC gp.CompleteGuardLogin @AttemptHash,@SourceHash,@PasswordVerified,@SessionHash,@CsrfHash,@NewEncodedPasswordHash;'
        $taskResults=Race $taskOne (New-GatePassSqlCommand $taskOne $taskSql (Complete-Parameters $taskA $false)) $taskTwo (New-GatePassSqlCommand $taskTwo $taskSql (Complete-Parameters $taskB $false))
        Assert-Condition (@($taskResults | Where-Object {$_.Succeeded -and $_.Value.status -eq 'DENIED'}).Count -eq 2) 'Failure completion failed.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT FailedCount FROM gp.GuardCredentials WHERE UserId=@id;' @{id=$taskGuard}) -eq 2) 'Concurrent failure increment lost.'
    }
    Test-Case 'Concurrent setup consumption commits once' {
        $taskTicket=Issue-Setup; $taskOne=Open-Restricted 'gp_guard_auth_fixture'; $taskTwo=Open-Restricted 'gp_guard_auth_fixture'
        $taskSql='EXEC gp.CompleteGuardSetup @TokenHash,@SourceHash,@NewEncodedPasswordHash;'
        $taskParams=@{TokenHash=$taskTicket;SourceHash=(New-Source);NewEncodedPasswordHash=$taskHash}
        $taskResults=Race $taskOne (New-GatePassSqlCommand $taskOne $taskSql $taskParams) $taskTwo (New-GatePassSqlCommand $taskTwo $taskSql $taskParams)
        Assert-Condition (@($taskResults | Where-Object {$_.Succeeded -and $_.Value.status -eq 'OK'}).Count -eq 1) 'Reset used multiple times.'
    }
    Test-Case 'Reset racing login leaves no live old-credential session in either commit order' {
        $taskAttempt=Begin-Login; $taskOne=Open-Restricted 'gp_guard_auth_fixture'; $taskTwo=Open-Restricted 'gp_guard_api_fixture'
        $taskParams=Complete-Parameters $taskAttempt; $taskReset=Admin-Parameters
        $taskResults=Race $taskOne (New-GatePassSqlCommand $taskOne 'EXEC gp.CompleteGuardLogin @AttemptHash,@SourceHash,@PasswordVerified,@SessionHash,@CsrfHash,@NewEncodedPasswordHash;' $taskParams) $taskTwo (New-GatePassSqlCommand $taskTwo 'EXEC gp.ManageGuardCredential @SessionHash,@CsrfHash,@TargetUserId,@Action,@LoginId,@SetupTokenHash;' $taskReset)
        Assert-Condition ($taskResults[1].Succeeded -and $taskResults[1].Value.status -eq 'OK') 'Reset did not complete.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE s.SessionHash=@hash AND s.RevokedAtUtc IS NULL AND s.AuthorizationVersionAtIssue=u.AuthorizationVersion;' @{hash=$taskParams.SessionHash}) -eq 0) 'Old verification left a usable session.'
    }
    Test-Case 'Maintenance role cleans only expired transient auth state in bounded batches' {
        $taskSource=New-Source; $null=Begin-Login ($taskLogin+'unknown') $taskSource
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.GuardAuthSources SET WindowStartUtc=DATEADD(day,-3,SYSUTCDATETIME()),LastSeenAtUtc=DATEADD(day,-2,SYSUTCDATETIME()) WHERE SourceHash=@hash;' @{hash=$taskSource}
        $taskResult=Call $taskWorker 'gp.PurgeGuardAuthTransient' @{BatchSize=1}
        Assert-Condition ($taskResult.sourcesDeleted -eq 1) 'Expired source not removed.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.GuardCredentials WHERE UserId=@id;' @{id=$taskGuard}) -eq 1) 'Maintenance deleted credentials.'
        Expect-Error { Call $taskWorker 'gp.PurgeGuardAuthTransient' @{BatchSize=1001} } 52602
    }
    Test-Case 'Backend Argon2 service completes real restricted SQL setup login change and logout' {
        $taskInfo=[Diagnostics.ProcessStartInfo]::new()
        $taskInfo.FileName=(Get-Command node -CommandType Application | Select-Object -First 1).Source
        $taskInfo.ArgumentList.Add((Join-Path $taskRoot 'tests/guard-auth.sql-integration.ts'))
        $taskInfo.WorkingDirectory=$taskRoot; $taskInfo.UseShellExecute=$false; $taskInfo.CreateNoWindow=$true
        $taskInfo.RedirectStandardInput=$true; $taskInfo.RedirectStandardOutput=$true; $taskInfo.RedirectStandardError=$true
        $taskNode=[Diagnostics.Process]::new(); $taskNode.StartInfo=$taskInfo
        try {
            $null=$taskNode.Start()
            $taskNodeOutput=$taskNode.StandardOutput.ReadToEndAsync(); $taskNodeError=$taskNode.StandardError.ReadToEndAsync()
            $taskNode.StandardInput.Write((@{server=$Server;trustLocalCertificate=[bool]$TrustLocalServerCertificate;powerShell=(Join-Path $PSHOME 'pwsh.exe');
                sourceHex=[Convert]::ToHexString((New-Source));adminSessionHex=$taskActors.ADMIN.SessionHex;adminCsrfHex=$taskActors.ADMIN.CsrfHex;
                guardUserId=[string]$taskGuard;login=$taskLogin} | ConvertTo-Json -Compress))
            $taskNode.StandardInput.Close()
            if (-not $taskNode.WaitForExit(60000)) { $taskNode.Kill($true); throw 'Backend integration test timed out.' }
            if ($taskNode.ExitCode -ne 0) { throw ('Backend integration failed: '+$taskNodeError.GetAwaiter().GetResult()) }
            $taskIntegration=$taskNodeOutput.GetAwaiter().GetResult() | ConvertFrom-Json
            Assert-Condition ($taskIntegration.Status -eq 'PASS' -and $taskIntegration.CaseCount -eq 6) 'Incomplete backend integration evidence.'
            $taskIntegration | Add-Member -NotePropertyName CheckedAtUtc -NotePropertyValue ([datetime]::UtcNow.ToString('o'))
            $taskIntegration | Add-Member -NotePropertyName SourceSha256 -NotePropertyValue @(@('src/security/GuardAuthService.ts','src/security/GuardPasswordHasher.ts','src/security/SqlGuardAuthRepository.ts','tests/guard-auth.sql-integration.ts','tests/helpers/GuardAuth.SqlBridge.ps1') | ForEach-Object { @{File=$_;Sha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot $_) -Algorithm SHA256).Hash} })
            $taskIntegration | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $taskRoot 'database/validation/guard-auth-backend-integration.json') -Encoding utf8
        } finally { $taskNode.Dispose() }
    }
    $taskComplete=$true
}
finally {
    foreach ($taskConnection in $taskConnections) { $taskConnection.Dispose() }
    try {
        Invoke-GatePassNonQuery $taskAdmin "IF @@TRANCOUNT>0 ROLLBACK; IF OBJECT_ID('gp.GuardAuthFixtureFault','TR') IS NOT NULL DROP TRIGGER gp.GuardAuthFixtureFault;"
        if ($taskFixtureReady) {
            Invoke-GatePassNonQuery $taskAdmin @'
DELETE a FROM gp.GuardLoginAttempts a JOIN gp.Users u ON u.UserId=a.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%';
DELETE t FROM gp.GuardSetupTickets t JOIN gp.Users u ON u.UserId=t.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%';
DELETE c FROM gp.GuardCredentials c JOIN gp.Users u ON u.UserId=c.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%';
'@ @{prefix=$taskFixture.prefix}
            foreach ($taskSource in $taskSources) { Invoke-GatePassNonQuery $taskAdmin 'DELETE gp.GuardAuthSources WHERE SourceHash=@hash;' @{hash=[Convert]::FromHexString($taskSource)} }
            Invoke-GatePassNonQuery $taskAdmin ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '003_transaction_cleanup.sql'))) @{RunId=$taskRun}
        }
        foreach ($taskPrincipal in $taskPrincipals) { Invoke-GatePassNonQuery $taskAdmin ('DROP USER '+$taskPrincipal+';') }
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.Users WHERE IdentityIssuer=''gatepass-phase02-fixture'' AND IdentitySubject LIKE @prefix+'':%'';' @{prefix=$taskFixture.prefix}) -eq 0) 'Owned actors remain.'
        $taskClean=$true
    } finally {
        $taskAdmin.Dispose()
        [ordered]@{Status=if ($taskComplete -and $taskClean -and $taskCases.Count -gt 0 -and @($taskCases | Where-Object {-not $_.Passed}).Count -eq 0) {'PASS'} else {'FAIL'};
            CheckedAtUtc=[datetime]::UtcNow.ToString('o');Database='GatePass_DesignTest';CaseCount=$taskCases.Count;CleanupPassed=$taskClean;
            ConcurrentCasesWithBothWaitersObserved=4;SqlContractCasesUseSyntheticPasswordHash=$true;NestedActualBackendIntegrationCases=6;BrowserHttpTest=$false;
            Scope='Restricted-role SQL lifecycle uses a synthetic PHC/trusted-verifier boolean; six nested Node/SQL cases exercise actual Argon2. Not an HTTP/browser or production-driver test.';
            HarnessSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash;
            MigrationSha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot 'database/migrations/006_guard_password_authentication.sql') -Algorithm SHA256).Hash;
            GenerationFixSha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot 'database/migrations/007_guard_challenge_generation.sql') -Algorithm SHA256).Hash;
            Cases=@($taskCases)} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskRoot 'database/validation/guard-auth-report.json') -Encoding utf8
    }
}
if (-not $taskComplete -or @($taskCases | Where-Object {-not $_.Passed}).Count) { throw 'Guard SQL authentication suite failed.' }
Write-Output "All $($taskCases.Count) guard SQL authentication cases passed; owned data and test principals removed."
