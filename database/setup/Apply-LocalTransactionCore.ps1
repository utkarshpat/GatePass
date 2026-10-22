#Requires -Version 7.0
[CmdletBinding()]
param([string]$Server='localhost\SQLEXPRESS',[switch]$TrustLocalServerCertificate,
    [ValidateSet('003','004','005','006','007','008','009','010','011','012','013','014','015','016','017','018','019','020','021','022','023','024','025','026','027','028','029','030','031','032','033','034','035','036','037','038','039','040','041','042','043','044','045','046','047','048','049','050','051','052','053','054','055','056','057','058','059','060','061','062','063','064','065','066','067','068','069','070','071','072','073','074')][string]$Migration='003')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
Add-Type -Path (Join-Path $taskRoot '.tools/scriptdom/180.140.0/lib/net8.0/Microsoft.SqlServer.TransactSql.ScriptDom.dll')
$taskMigrationFiles=@{'074'='074_returned_lifecycle_and_scope_guards.sql';'073'='073_returned_visit_registration.sql';'072'='072_returned_entry_replay.sql';'071'='071_printed_pass_returns.sql';'070'='070_admin_console_reads.sql';'069'='069_reminder_pass_state.sql';'068'='068_host_reminders.sql';'067'='067_reception_employee_timeline.sql';'066'='066_reception_intake_audit_type.sql';'065'='065_reception_operations.sql';'064'='064_presence_reads_and_visitor_mobile.sql';'063'='063_guard_visitor_reconciliation.sql';'003'='003_transaction_security_core.sql';'004'='004_notification_worker_leases.sql';'005'='005_worker_contract_hardening.sql';'006'='006_guard_password_authentication.sql';'007'='007_guard_challenge_generation.sql';'008'='008_registration_and_digital_id.sql';'009'='009_registration_snapshot_canonicalization.sql';'010'='010_scoped_visit_reads.sql';'011'='011_reissue_and_print_lifecycle.sql';'012'='012_visitor_cards_and_guard_project_context.sql';'013'='013_multi_project_guard_scan.sql';'014'='014_trusted_card_details.sql';'015'='015_individual_cancellation.sql';'016'='016_cancelled_occupant_overlap.sql';'017'='017_scoped_staff_administration.sql';'018'='018_staff_role_audit_scope.sql';'019'='019_scoped_administration_reads.sql';'020'='020_admin_read_boundaries.sql';'021'='021_registration_locations.sql';'022'='022_qr_key_identifier_validation.sql';'023'='023_registration_project_host_options.sql';'024'='024_own_digital_id_image.sql';'025'='025_reception_workspace.sql';'026'='026_reception_empty_list.sql';'027'='027_common_staff_entry.sql';'028'='028_guard_email_login.sql';'029'='029_local_staff_authentication.sql';'030'='030_staff_login_provider.sql';'031'='031_external_reception_context.sql';'032'='032_project_lead_identity_policy.sql';'033'='033_platform_and_scoped_delegation.sql';'034'='034_staff_discovery_scope.sql';'035'='035_admin_project_lead_workspace.sql';'036'='036_guard_workspace.sql';'037'='037_guard_pass_lookup.sql';'038'='038_guard_lookup_audit.sql';'039'='039_guard_dashboard_cards.sql';'040'='040_guard_visitor_queues.sql';'041'='041_guard_project_filter.sql';'042'='042_guard_movement_timeline.sql';'043'='043_movement_timeline_boundaries.sql';'044'='044_registration_property_memory.sql';'045'='045_preserve_qr_key_alphabet.sql';'046'='046_guard_host_name.sql';'047'='047_guard_employee_projects.sql';'048'='048_employee_office_authorization.sql';'049'='049_employee_office_card_lifecycle.sql';'050'='050_employee_authorization_query_plans.sql';'051'='051_employee_office_replay_authorization.sql';'053'='053_guard_duty_contexts.sql';'054'='054_guard_duty_workflows.sql';'055'='055_guard_duty_legacy_boundaries.sql';'056'='056_common_duty_administration.sql';'057'='057_guard_duty_inside_owner.sql';'058'='058_guard_duty_input_and_replay.sql';'059'='059_employee_project_presence_identity.sql';'060'='060_project_presence_conflict_checks.sql';'061'='061_email_request_workflow.sql';'062'='062_outlook_action_decisions.sql';'052'='052_scoped_office_card_revalidation.sql'}
$taskFile=Join-Path $taskRoot ('database/migrations/'+$taskMigrationFiles[$Migration])
$taskSql=[IO.File]::ReadAllText($taskFile)
$taskParser=[Microsoft.SqlServer.TransactSql.ScriptDom.TSql160Parser]::new($true)
$taskErrors=[Collections.Generic.List[Microsoft.SqlServer.TransactSql.ScriptDom.ParseError]]::new()
$taskReader=[IO.StringReader]::new($taskSql)
try { $taskScript=$taskParser.Parse($taskReader,[ref]$taskErrors) }
finally { $taskReader.Dispose() }
if ($taskErrors.Count) { throw ('Migration syntax errors: '+($taskErrors.Message -join '; ')) }
$taskConnection=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
try {
    $taskApplied=Invoke-GatePassScalar $taskConnection 'SELECT COUNT(*) FROM gp.SchemaMigrations WHERE Version=@version;' @{version=$Migration}
    if ($taskApplied -eq 1) { throw "Migration $Migration already exists; it will not be edited/reapplied." }
    foreach ($taskBatch in $taskScript.Batches) {
        if ($taskBatch.FragmentLength -gt 0) {
            Invoke-GatePassNonQuery $taskConnection $taskSql.Substring($taskBatch.StartOffset,$taskBatch.FragmentLength)
        }
    }
    $taskState=Invoke-GatePassScalar $taskConnection @'
SELECT (SELECT COUNT(*) FROM gp.SchemaMigrations WHERE Version=@version) AS migration_records,
       (SELECT COUNT(*) FROM sys.procedures WHERE schema_id=SCHEMA_ID('gp')) AS procedure_count,
       (SELECT COUNT(*) FROM sys.database_principals WHERE name='gp_api_runtime' AND type='R') AS api_role_count,
       (SELECT COUNT(*) FROM sys.database_principals WHERE name='gp_worker_runtime' AND type='R') AS worker_role_count,
       CONVERT(nvarchar(128),SERVERPROPERTY('ProductVersion')) AS engine_version,
       SYSUTCDATETIME() AS checked_at_utc
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;
'@ @{version=$Migration}
    $taskReport=[ordered]@{ Status='PASS'; Database='GatePass_DesignTest'; Server=$Server;
        Migration=$Migration; Sha256=(Get-FileHash -LiteralPath $taskFile -Algorithm SHA256).Hash;
        ParsedBatches=$taskScript.Batches.Count; TrustLocalServerCertificate=[bool]$TrustLocalServerCertificate;
        Result=($taskState | ConvertFrom-Json) }
    $taskReportName=switch ($Migration) {'004' {'worker-migration-report.json'};'005' {'worker-hardening-migration-report.json'};'006' {'guard-auth-migration-report.json'};'007' {'guard-auth-generation-migration-report.json'};'008' {'registration-migration-report.json'};'009' {'registration-snapshot-migration-report.json'};'010' {'visit-reads-migration-report.json'};'011' {'pass-print-migration-report.json'};'012' {'guard-context-migration-report.json'};'013' {'multi-project-scan-migration-report.json'};'014' {'card-details-migration-report.json'};'015' {'cancellation-migration-report.json'};'016' {'cancelled-occupant-migration-report.json'};'017' {'staff-administration-migration-report.json'};'018' {'staff-role-audit-migration-report.json'};'019' {'admin-reads-migration-report.json'};'020' {'admin-read-boundaries-migration-report.json'};'021' {'registration-locations-migration-report.json'};'022' {'qr-key-validation-migration-report.json'};'023' {'registration-options-migration-report.json'};'024' {'own-card-image-migration-report.json'};'025' {'reception-migration-report.json'};'026' {'reception-empty-list-migration-report.json'};'027' {'staff-entry-migration-report.json'};'028' {'guard-email-login-migration-report.json'};'029' {'local-staff-auth-migration-report.json'};'030' {'staff-provider-migration-report.json'};'031' {'external-reception-migration-report.json'};'032' {'project-lead-policy-migration-report.json'};'033' {'platform-delegation-migration-report.json'};'034' {'staff-discovery-scope-migration-report.json'};'035' {'admin-lead-workspace-migration-report.json'};'036' {'guard-workspace-migration-report.json'};'037' {'guard-lookup-migration-report.json'};'038' {'guard-lookup-audit-migration-report.json'};'039' {'guard-card-migration-report.json'};'040' {'guard-visitors-migration-report.json'};'041' {'guard-project-filter-migration-report.json'};'042' {'guard-timeline-migration-report.json'};'043' {'movement-timeline-boundaries-migration-report.json'};'044' {'registration-property-memory-migration-report.json'};'045' {'preserve-qr-key-alphabet-migration-report.json'};'046' {'guard-host-name-migration-report.json'};'052' {'scoped-office-card-revalidation-migration-report.json'};'051' {'employee-office-replay-authorization-migration-report.json'};'050' {'employee-authorization-query-plans-migration-report.json'};'049' {'employee-office-card-lifecycle-migration-report.json'};'048' {'employee-office-authorization-migration-report.json'};'047' {'guard-employee-projects-migration-report.json'};default {'transaction-migration-report.json'}}
    $taskReport | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskRoot ('database/validation/'+$taskReportName)) -Encoding utf8
    Write-Output ('Migration '+$Migration+' applied atomically: '+$taskScript.Batches.Count+' parsed SQL batches; no logins or real users created.')
}
catch {
    try { Invoke-GatePassNonQuery $taskConnection 'IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;' } catch { }
    throw
}
finally { $taskConnection.Dispose() }

