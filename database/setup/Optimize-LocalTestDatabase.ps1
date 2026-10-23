#Requires -Version 7.0
[CmdletBinding()]
param([string]$Server='localhost\SQLEXPRESS',[switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
# Explicit local maintenance only. Runtime requests never change database options.
Import-Module (Join-Path $PSScriptRoot '../../tools/GatePass.LocalSql.psm1') -Force
$taskConnection=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
try {
    $taskResult=Invoke-GatePassScalar $taskConnection @'
SET NOCOUNT ON;
IF DB_NAME()<>N'GatePass_DesignTest' OR @@TRANCOUNT<>0 OR NOT EXISTS(
 SELECT 1 FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DevelopmentDirectoryMarker'
 AND CONVERT(nvarchar(100),value)=N'SYNTHETIC-DIRECTORY-V1')
 THROW 53600,'Dedicated synthetic local database required.',1;
DECLARE @before bit=(SELECT is_auto_close_on FROM sys.databases WHERE database_id=DB_ID());
IF @before=1 ALTER DATABASE [GatePass_DesignTest] SET AUTO_CLOSE OFF;
IF EXISTS(SELECT 1 FROM sys.databases WHERE database_id=DB_ID() AND is_auto_close_on=1)
 THROW 53600,'Database option verification failed.',1;
SELECT DB_NAME() databaseName,@before autoCloseBefore,CAST(0 AS bit) autoCloseAfter FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;
'@
    $taskResult | ConvertFrom-Json
} finally { $taskConnection.Dispose() }
