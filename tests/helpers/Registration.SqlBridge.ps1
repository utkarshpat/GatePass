#Requires -Version 7.0
# Test-only .NET RPC bridge. No production route, driver or service identity is
# provisioned. Pipe input/output never carries raw photos, keys or QR plaintext.
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
# Windows redirected console pipes must agree with Node's UTF-8 encoding.
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$taskInput=[Console]::In.ReadToEnd() | ConvertFrom-Json
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskConnection=Open-GatePassLocalSql -Server $taskInput.server -TrustLocalServerCertificate:$taskInput.trustLocalCertificate
try {
    if ($taskInput.mode -eq 'inspect') {
        # Privileged test inspection of one synthetic owned intake. The runtime
        # role still has no SELECT permission on these tables.
        $taskResult=Invoke-GatePassScalar $taskConnection @'
SELECT (SELECT v.VisitRequestId visitRequestId,p.AccessPassId accessPassId,
 CONVERT(varchar(64),p.CredentialHash,2) credentialHash,CONVERT(varchar(64),s.Ciphertext,2) ciphertext,
 CONVERT(varchar(24),s.Nonce,2) nonce,CONVERT(varchar(32),s.AuthenticationTag,2) authenticationTag,s.KeyVersion keyVersion,
 a.StorageKey storageKey,CONVERT(varchar(64),a.ContentHash,2) photoContentHash,a.PixelWidth width,a.PixelHeight height,
 CONVERT(varchar(64),v.SnapshotHash,2) snapshotHash,

 CONVERT(varchar(max),CONVERT(varbinary(max),(SELECT vv.SnapshotVersion snapshotVersion,vv.RequestType requestType,vv.EmployeeId employeeId,
 vv.PersonName personName,vv.PersonEmail personEmail,vv.PersonPhone personPhone,vv.PhotoAssetId photoAssetId,
 CONVERT(varchar(64),aa.ContentHash,2) photoContentHash,vv.LocationId locationId,vv.ProjectLocationId projectLocationId,
 vv.HostEmployeeId hostEmployeeId,vv.Reason reason,vv.TemporaryIdReason temporaryIdReason,
 REPLACE(CONVERT(char(23),vv.ValidFromUtc,121),' ','T')+'Z' validFromUtc,
 REPLACE(CONVERT(char(23),vv.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc
 FROM gp.VisitRequests vv JOIN gp.PhotoAssets aa ON aa.PhotoAssetId=vv.PhotoAssetId WHERE vv.VisitRequestId=v.VisitRequestId
 FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER)),2) snapshotBytes,


 JSON_QUERY((SELECT v.SnapshotVersion snapshotVersion,v.RequestType requestType,v.EmployeeId employeeId,v.PersonName personName,v.PersonEmail personEmail,v.PersonPhone personPhone,
  v.PhotoAssetId photoAssetId,CONVERT(varchar(64),a.ContentHash,2) photoContentHash,v.LocationId locationId,v.ProjectLocationId projectLocationId,v.HostEmployeeId hostEmployeeId,
  v.Reason reason,v.TemporaryIdReason temporaryIdReason,REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc
  FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER)) snapshotValues
 FROM gp.VisitRequests v JOIN gp.RegistrationIntakes i ON i.IntakeId=v.IntakeId
 JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.PassSecrets s ON s.AccessPassId=p.AccessPassId
 JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId
 WHERE v.VisitRequestId=@visit AND v.IntakeId=@intake AND i.TokenHash=@token
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
'@ @{visit=[guid]$taskInput.visitRequestId;intake=[guid]$taskInput.intakeId;token=[Convert]::FromHexString($taskInput.tokenHash)}
        [Console]::Out.Write([string]$taskResult)
    }
    else {
        if ($taskInput.procedure -notin @('gp.CreateRegistrationIntake','gp.RecordRegistrationPhoto','gp.SubmitRegistration')) {throw 'Invalid test procedure.'}
        Invoke-GatePassNonQuery $taskConnection "EXECUTE AS USER='gp_registration_api_fixture';"
        $taskCommand=$taskConnection.CreateCommand()
        try {
            $taskCommand.CommandType=[Data.CommandType]::StoredProcedure;$taskCommand.CommandText=$taskInput.procedure
            foreach ($taskProperty in $taskInput.parameters.PSObject.Properties) {
                $taskValue=$taskProperty.Value
                $taskType=switch ($taskValue.type) {'binary' {[Data.SqlDbType]::VarBinary};'text' {[Data.SqlDbType]::NVarChar};'guid' {[Data.SqlDbType]::UniqueIdentifier};'int' {[Data.SqlDbType]::Int};'bigint' {[Data.SqlDbType]::BigInt};'datetime' {[Data.SqlDbType]::DateTime2};default {throw 'Invalid parameter type.'}}
                $taskParameter=$taskCommand.Parameters.Add('@'+$taskProperty.Name,$taskType)
                if ($taskValue.type -eq 'binary') {$taskParameter.Size=8000};if ($taskValue.type -eq 'text') {$taskParameter.Size=-1};if ($taskValue.type -eq 'datetime') {$taskParameter.Scale=3}
                if ($null -eq $taskValue.value) {$taskParameter.Value=[DBNull]::Value}
                elseif ($taskValue.type -eq 'binary') {$taskParameter.Value=[Convert]::FromBase64String($taskValue.value)}
                elseif ($taskValue.type -eq 'guid') {$taskParameter.Value=[guid]$taskValue.value}
                elseif ($taskValue.type -eq 'datetime') {$taskParameter.Value=[datetime]::Parse($taskValue.value,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind)}
                elseif ($taskValue.type -eq 'bigint') {$taskParameter.Value=[long]$taskValue.value}
                elseif ($taskValue.type -eq 'int') {$taskParameter.Value=[int]$taskValue.value}
                else {$taskParameter.Value=$taskValue.value}
            }
            [Console]::Out.Write([string]$taskCommand.ExecuteScalar())
        } finally {$taskCommand.Dispose()}
    }
}
catch {
    $taskBase=$_.Exception.GetBaseException();$taskNumber=if ($taskBase -is [Data.SqlClient.SqlException]) {$taskBase.Number} else {0}
    [Console]::Out.Write((@{bridgeError=$true;number=$taskNumber} | ConvertTo-Json -Compress))
}
finally {$taskConnection.Dispose()}
