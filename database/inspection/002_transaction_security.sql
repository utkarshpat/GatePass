/* Read-only inventory of the applied procedure/role boundary. No secret/session
   values or visitor rows are returned. Module hashes attest deployed SQL text,
   not behavioral correctness. */
SET NOCOUNT ON;
IF DB_NAME() IN(N'master',N'model',N'msdb',N'tempdb') THROW 51200,'Select the GatePass database.',1;
DECLARE @inventory nvarchar(max)=(
    SELECT DB_NAME() AS database_name,SYSUTCDATETIME() AS inspected_at_utc,
        (SELECT TRY_CONVERT(int,value) FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DirectoryMaxAgeSeconds') AS directory_max_age_seconds,
        JSON_QUERY((SELECT o.name,o.type_desc,m.uses_ansi_nulls,m.uses_quoted_identifier,m.execute_as_principal_id,
            CONVERT(varchar(64),HASHBYTES('SHA2_256',m.definition),2) AS module_definition_sha256
            FROM sys.objects o JOIN sys.sql_modules m ON m.object_id=o.object_id
            WHERE o.schema_id=SCHEMA_ID('gp') ORDER BY o.name FOR JSON PATH)) AS modules,
        JSON_QUERY((SELECT p.state_desc,p.permission_name,p.class_desc,
            CASE WHEN p.class=3 THEN SCHEMA_NAME(p.major_id) WHEN p.class=1 THEN OBJECT_SCHEMA_NAME(p.major_id)+'.'+OBJECT_NAME(p.major_id) END AS target
            FROM sys.database_permissions p JOIN sys.database_principals r ON r.principal_id=p.grantee_principal_id
            WHERE r.name='gp_api_runtime' ORDER BY p.class,p.major_id,p.permission_name FOR JSON PATH)) AS api_permissions,
        JSON_QUERY(COALESCE((SELECT r.name AS role_name,m.name AS member_name
            FROM sys.database_role_members rm JOIN sys.database_principals r ON r.principal_id=rm.role_principal_id
            JOIN sys.database_principals m ON m.principal_id=rm.member_principal_id WHERE r.name='gp_api_runtime' FOR JSON PATH),N'[]')) AS api_members
        ,JSON_QUERY((SELECT p.state_desc,p.permission_name,p.class_desc,
            CASE WHEN p.class=3 THEN SCHEMA_NAME(p.major_id) WHEN p.class=1 THEN OBJECT_SCHEMA_NAME(p.major_id)+'.'+OBJECT_NAME(p.major_id) END AS target
            FROM sys.database_permissions p JOIN sys.database_principals r ON r.principal_id=p.grantee_principal_id
            WHERE r.name='gp_worker_runtime' ORDER BY p.class,p.major_id,p.permission_name FOR JSON PATH)) AS worker_permissions
        ,JSON_QUERY(COALESCE((SELECT r.name AS role_name,m.name AS member_name
            FROM sys.database_role_members rm JOIN sys.database_principals r ON r.principal_id=rm.role_principal_id
            JOIN sys.database_principals m ON m.principal_id=rm.member_principal_id WHERE r.name='gp_worker_runtime' FOR JSON PATH),N'[]')) AS worker_members
        ,JSON_QUERY((SELECT p.state_desc,p.permission_name,p.class_desc,
            CASE WHEN p.class=3 THEN SCHEMA_NAME(p.major_id) WHEN p.class=1 THEN OBJECT_SCHEMA_NAME(p.major_id)+'.'+OBJECT_NAME(p.major_id) END AS target
            FROM sys.database_permissions p JOIN sys.database_principals r ON r.principal_id=p.grantee_principal_id
            WHERE r.name='gp_guard_auth_runtime' ORDER BY p.class,p.major_id,p.permission_name FOR JSON PATH)) AS guard_auth_permissions
        ,JSON_QUERY(COALESCE((SELECT r.name AS role_name,m.name AS member_name
            FROM sys.database_role_members rm JOIN sys.database_principals r ON r.principal_id=rm.role_principal_id
            JOIN sys.database_principals m ON m.principal_id=rm.member_principal_id WHERE r.name='gp_guard_auth_runtime' FOR JSON PATH),N'[]')) AS guard_auth_members
        ,JSON_QUERY((SELECT p.state_desc,p.permission_name,p.class_desc,
            CASE WHEN p.class=3 THEN SCHEMA_NAME(p.major_id) WHEN p.class=1 THEN OBJECT_SCHEMA_NAME(p.major_id)+'.'+OBJECT_NAME(p.major_id) END AS target
            FROM sys.database_permissions p JOIN sys.database_principals r ON r.principal_id=p.grantee_principal_id
            WHERE r.name='gp_media_runtime' ORDER BY p.class,p.major_id,p.permission_name FOR JSON PATH)) AS media_permissions
        ,JSON_QUERY(COALESCE((SELECT r.name AS role_name,m.name AS member_name
            FROM sys.database_role_members rm JOIN sys.database_principals r ON r.principal_id=rm.role_principal_id
            JOIN sys.database_principals m ON m.principal_id=rm.member_principal_id WHERE r.name='gp_media_runtime' FOR JSON PATH),N'[]')) AS media_members
        ,JSON_QUERY((SELECT p.state_desc,p.permission_name,p.class_desc,
            CASE WHEN p.class=3 THEN SCHEMA_NAME(p.major_id) WHEN p.class=1 THEN OBJECT_SCHEMA_NAME(p.major_id)+'.'+OBJECT_NAME(p.major_id) END AS target
            FROM sys.database_permissions p JOIN sys.database_principals r ON r.principal_id=p.grantee_principal_id
            WHERE r.name='gp_render_runtime' ORDER BY p.class,p.major_id,p.permission_name FOR JSON PATH)) AS render_permissions
        ,JSON_QUERY(COALESCE((SELECT r.name AS role_name,m.name AS member_name
            FROM sys.database_role_members rm JOIN sys.database_principals r ON r.principal_id=rm.role_principal_id
            JOIN sys.database_principals m ON m.principal_id=rm.member_principal_id WHERE r.name='gp_render_runtime' FOR JSON PATH),N'[]')) AS render_members
    FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
SELECT @inventory;
