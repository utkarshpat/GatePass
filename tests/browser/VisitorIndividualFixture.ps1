#Requires -Version 7.0
param([Parameter(Mandatory)][guid]$RunId,[ValidateSet('Check','Cleanup')][string]$Action)
$ErrorActionPreference='Stop';Import-Module './tools/GatePass.LocalSql.psm1' -Force
$db=Open-GatePassLocalSql -TrustLocalServerCertificate
try{
 $marker='Visitor-'+$RunId.ToString('N')
 $json=Invoke-GatePassScalar $db 'SELECT DISTINCT v.IntakeId intakeId,CONVERT(varchar(64),i.TokenHash,2) tokenHash FROM gp.VisitRequests v JOIN gp.RegistrationIntakes i ON i.IntakeId=v.IntakeId WHERE v.RequestType=''EXTERNAL'' AND v.PersonName=@name FOR JSON PATH;' @{name=$marker}
 if($Action -eq 'Cleanup'){Invoke-GatePassNonQuery $db (Get-Content database/tests/004_registration_cleanup.sql -Raw) @{IntakesJson=$json;RunId=$RunId}}
 else{Invoke-GatePassScalar $db 'SELECT v.RequestType requestType,CONVERT(char(10),v.LocalVisitDate,23) startDate,CONVERT(char(10),DATEADD(minute,330,v.ValidUntilUtc),23) endExclusive,l.LocationCode office,v.HostEmployeeId host,CONVERT(varchar(20),v.ProjectLocationId) pair FROM gp.VisitRequests v JOIN gp.Locations l ON l.LocationId=v.LocationId WHERE v.PersonName=@name FOR JSON PATH;' @{name=$marker}}
}finally{$db.Dispose()}
