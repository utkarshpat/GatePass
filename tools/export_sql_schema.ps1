param([string]$ScriptDomPath)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
if (-not $ScriptDomPath) { $ScriptDomPath=Join-Path $taskRoot '.tools/scriptdom/180.140.0/lib/net8.0/Microsoft.SqlServer.TransactSql.ScriptDom.dll' }
Add-Type -Path $ScriptDomPath
$taskSourcePath=Join-Path $taskRoot 'database/migrations/001_individual_visit_baseline.sql'
$taskSchemaPaths=@($taskSourcePath,(Join-Path $taskRoot 'database/migrations/006_guard_password_authentication.sql'),(Join-Path $taskRoot 'database/migrations/008_registration_and_digital_id.sql'),(Join-Path $taskRoot 'database/migrations/011_reissue_and_print_lifecycle.sql'),(Join-Path $taskRoot 'database/migrations/014_trusted_card_details.sql'))
$taskSql=($taskSchemaPaths | ForEach-Object { [IO.File]::ReadAllText($_) }) -join "`nGO`n"
$taskParser=[Microsoft.SqlServer.TransactSql.ScriptDom.TSql160Parser]::new($true)
$taskErrors=[Collections.Generic.List[Microsoft.SqlServer.TransactSql.ScriptDom.ParseError]]::new()
$taskReader=[IO.StringReader]::new($taskSql)
try { $taskAst=$taskParser.Parse($taskReader,[ref]$taskErrors) } finally { $taskReader.Dispose() }
if ($taskErrors.Count) { throw 'Cannot derive documentation from SQL containing syntax errors.' }
$taskNodes=[Collections.Generic.List[object]]::new()
function Visit-SqlFragment($node) {
    if ($node.GetType().Name -in @('CreateTableStatement','AlterTableAddTableElementStatement','CreateIndexStatement')) { $taskNodes.Add($node) }
    foreach ($property in $node.GetType().GetProperties()) {
        if ($property.Name -eq 'ScriptTokenStream' -or $property.GetIndexParameters().Count -ne 0) { continue }
        $value=$property.GetValue($node)
        if ($value -is [Microsoft.SqlServer.TransactSql.ScriptDom.TSqlFragment]) { Visit-SqlFragment $value }
        elseif ($value -is [Collections.IEnumerable] -and $value -isnot [string]) {
            foreach ($item in $value) { if ($item -is [Microsoft.SqlServer.TransactSql.ScriptDom.TSqlFragment]) { Visit-SqlFragment $item } }
        }
    }
}
function Get-SqlText($node) {
    if ($null -eq $node) { return $null }
    return $taskSql.Substring($node.StartOffset,$node.FragmentLength)
}
Visit-SqlFragment $taskAst
$taskNotes=Get-Content -LiteralPath (Join-Path $taskRoot 'docs/database/schema-notes.json') -Raw | ConvertFrom-Json -AsHashtable
$taskTables=[Collections.Generic.List[object]]::new()
$taskByName=@{}
foreach ($taskNode in $taskNodes) {
    if ($taskNode.GetType().Name -ne 'CreateTableStatement') { continue }
    $taskName=$taskNode.SchemaObjectName.BaseIdentifier.Value
    $taskNote=$taskNotes[$taskName]
    $taskColumns=[Collections.Generic.List[object]]::new()
    foreach ($taskColumn in $taskNode.Definition.ColumnDefinitions) {
        $taskColumnName=$taskColumn.ColumnIdentifier.Value
        $taskColumnNote=$taskNote.columns[$taskColumnName]
        $taskType=Get-SqlText $taskColumn.DataType
        if ($taskColumn.IdentityOptions) { $taskType+=' IDENTITY('+(Get-SqlText $taskColumn.IdentityOptions.IdentitySeed)+','+(Get-SqlText $taskColumn.IdentityOptions.IdentityIncrement)+')' }
        $taskNullable=$true
        foreach ($taskConstraint in $taskColumn.Constraints) { if ($taskConstraint.GetType().Name -eq 'NullableConstraintDefinition') { $taskNullable=$taskConstraint.Nullable } }
        $taskDefault=if ($taskColumn.DefaultConstraint) { Get-SqlText $taskColumn.DefaultConstraint.Expression } else { $null }
        $taskColumns.Add([ordered]@{name=$taskColumnName;type=$taskType;meaning=$taskColumnNote.meaning;nullable=$taskNullable;default=$taskDefault;sensitive=[bool]$taskColumnNote.sensitive})
    }
    $taskTable=[ordered]@{name=$taskName;purpose=$taskNote.purpose;columns=@($taskColumns);pk=@();unique=[Collections.Generic.List[object]]::new();checks=[Collections.Generic.List[object]]::new();fks=[Collections.Generic.List[object]]::new();indexes=[Collections.Generic.List[object]]::new()}
    foreach ($taskConstraint in $taskNode.Definition.TableConstraints) {
        if ($taskConstraint.GetType().Name -eq 'UniqueConstraintDefinition') {
            $taskKey=@($taskConstraint.Columns | ForEach-Object { $_.Column.MultiPartIdentifier.Identifiers[-1].Value })
            if ($taskConstraint.IsPrimaryKey) { $taskTable.pk=$taskKey } else { $taskTable.unique.Add($taskKey) }
        } elseif ($taskConstraint.GetType().Name -eq 'CheckConstraintDefinition') { $taskTable.checks.Add((Get-SqlText $taskConstraint.CheckCondition)) }
    }
    $taskByName[$taskName]=$taskTable
    $taskTables.Add($taskTable)
}
foreach ($taskNode in $taskNodes) {
    if ($taskNode.GetType().Name -eq 'AlterTableAddTableElementStatement') {
        $taskTable=$taskByName[$taskNode.SchemaObjectName.BaseIdentifier.Value]
        foreach ($taskColumn in $taskNode.Definition.ColumnDefinitions) {
            $taskColumnName=$taskColumn.ColumnIdentifier.Value
            $taskColumnNote=$taskNotes[$taskTable.name].columns[$taskColumnName]
            $taskNullable=$true
            foreach ($taskConstraint in $taskColumn.Constraints) {if ($taskConstraint.GetType().Name -eq 'NullableConstraintDefinition') {$taskNullable=$taskConstraint.Nullable}}
            $taskDefault=if ($taskColumn.DefaultConstraint) {Get-SqlText $taskColumn.DefaultConstraint.Expression} else {$null}
            $taskTable.columns+=@([ordered]@{name=$taskColumnName;type=(Get-SqlText $taskColumn.DataType);meaning=$taskColumnNote.meaning;nullable=$taskNullable;default=$taskDefault;sensitive=[bool]$taskColumnNote.sensitive})
        }
        foreach ($taskConstraint in $taskNode.Definition.TableConstraints) {
            if ($taskConstraint.GetType().Name -eq 'CheckConstraintDefinition') {$taskTable.checks.Add((Get-SqlText $taskConstraint.CheckCondition))}
            elseif ($taskConstraint.GetType().Name -eq 'ForeignKeyConstraintDefinition') {
                $taskTable.fks.Add([ordered]@{columns=@($taskConstraint.Columns | ForEach-Object Value);target=$taskConstraint.ReferenceTableName.BaseIdentifier.Value;target_columns=@($taskConstraint.ReferencedTableColumns | ForEach-Object Value)})
            }
        }
    } elseif ($taskNode.GetType().Name -eq 'CreateIndexStatement') {
        $taskByName[$taskNode.OnName.BaseIdentifier.Value].indexes.Add((Get-SqlText $taskNode))
    }
}
$taskManifest=[ordered]@{
    version='1.11'
    source=[ordered]@{kind='sql-ddl-draft';path='database/migrations/001_individual_visit_baseline.sql';sha256=(Get-FileHash -LiteralPath $taskSourcePath -Algorithm SHA256).Hash.ToLowerInvariant();live_database_verified=$false;
        schema_sources=@($taskSchemaPaths | ForEach-Object { [ordered]@{path=[IO.Path]::GetRelativePath($taskRoot,$_).Replace('\','/');sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()} })}
    tables=@($taskTables)
}
$taskManifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $taskRoot 'database/schema-manifest.json') -Encoding utf8
Write-Output ('Exported documentation metadata FROM SQL: '+$taskTables.Count+' tables. No SQL was generated or executed.')
