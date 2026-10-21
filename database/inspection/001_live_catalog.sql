/* Read-only database-first inspection. Execute only after connecting to the
   intended GatePass database. No schema or permission changes are made.
   Export the JSON result as the authoritative live catalog evidence. */
SET NOCOUNT ON;
IF DB_NAME() IN (N'master',N'model',N'msdb',N'tempdb')
    THROW 51200, 'Select the intended GatePass database before inspecting its schema.', 1;
SELECT DB_NAME() AS database_name,
       CONVERT(nvarchar(128),SERVERPROPERTY('ProductVersion')) AS sql_server_version,
       SYSUTCDATETIME() AS inspected_at_utc,
       JSON_QUERY((
         SELECT s.name AS schema_name,t.name AS table_name,
           JSON_QUERY((
             SELECT c.column_id,c.name,ty.name AS sql_type,c.max_length,c.precision,c.scale,
                    c.is_nullable,c.is_identity,c.collation_name,dc.definition AS default_definition
             FROM sys.columns c JOIN sys.types ty ON c.user_type_id=ty.user_type_id
             LEFT JOIN sys.default_constraints dc ON c.default_object_id=dc.object_id
             WHERE c.object_id=t.object_id ORDER BY c.column_id FOR JSON PATH
           )) AS columns,
           JSON_QUERY((
             SELECT i.name,i.is_unique,i.is_primary_key,i.filter_definition,
               JSON_QUERY((SELECT c.name,ic.key_ordinal,ic.is_included_column
                 FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
                 WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id ORDER BY ic.index_column_id FOR JSON PATH)) AS columns
             FROM sys.indexes i WHERE i.object_id=t.object_id AND i.index_id>0 ORDER BY i.index_id FOR JSON PATH
           )) AS indexes,
           JSON_QUERY((
             SELECT cc.name,cc.definition,cc.is_disabled,cc.is_not_trusted
             FROM sys.check_constraints cc WHERE cc.parent_object_id=t.object_id ORDER BY cc.name FOR JSON PATH
           )) AS checks,
           JSON_QUERY((
             SELECT fk.name,OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS target_schema,
                    OBJECT_NAME(fk.referenced_object_id) AS target_table,fk.is_disabled,fk.is_not_trusted,
               JSON_QUERY((SELECT pc.name AS parent_column,rc.name AS target_column
                 FROM sys.foreign_key_columns fc
                 JOIN sys.columns pc ON pc.object_id=fc.parent_object_id AND pc.column_id=fc.parent_column_id
                 JOIN sys.columns rc ON rc.object_id=fc.referenced_object_id AND rc.column_id=fc.referenced_column_id
                 WHERE fc.constraint_object_id=fk.object_id ORDER BY fc.constraint_column_id FOR JSON PATH)) AS columns
             FROM sys.foreign_keys fk WHERE fk.parent_object_id=t.object_id ORDER BY fk.name FOR JSON PATH
           )) AS foreign_keys
         FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
         WHERE s.name=N'gp' ORDER BY t.name FOR JSON PATH
       )) AS tables
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;
