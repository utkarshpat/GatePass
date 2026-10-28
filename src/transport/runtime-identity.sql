/* Fixed admission probe, not a migration. @ExpectedRole is a typed driver parameter. */
SELECT CASE WHEN IS_MEMBER(@ExpectedRole)=1
  AND COALESCE(IS_SRVROLEMEMBER('sysadmin'),0)=0
  -- SQL Server grants these two metadata permissions to public by default.
  AND NOT EXISTS(SELECT 1 FROM sys.fn_my_permissions(NULL,'DATABASE') WHERE permission_name NOT IN
    ('CONNECT','VIEW ANY COLUMN ENCRYPTION KEY DEFINITION','VIEW ANY COLUMN MASTER KEY DEFINITION'))
  AND NOT EXISTS(SELECT 1 FROM sys.database_principals WHERE type='R' AND name NOT IN ('public',@ExpectedRole) AND IS_MEMBER(name)=1)
  -- Runtime permissions must come from its one reviewed role. A direct table,
  -- column, schema or helper EXECUTE grant could otherwise pass the role checks.
  AND NOT EXISTS(
    SELECT 1 FROM sys.database_permissions p
    LEFT JOIN sys.objects o ON p.class=1 AND o.object_id=p.major_id
    WHERE p.grantee_principal_id IN(USER_ID(),DATABASE_PRINCIPAL_ID('public'))
      AND p.state IN('G','W')
      AND(p.class=3 OR(p.class=1 AND o.is_ms_shipped=0))
  )
  -- Runtime identities need no schema/user/type-level grants. In particular,
  -- IMPERSONATE ON USER is not a database-wide permission and must be checked
  -- explicitly for the approved role as well as direct/public grants.
  AND NOT EXISTS(
    SELECT 1 FROM sys.database_permissions p
    WHERE p.grantee_principal_id IN(USER_ID(),DATABASE_PRINCIPAL_ID('public'),DATABASE_PRINCIPAL_ID(@ExpectedRole))
      AND p.state IN('G','W') AND p.class NOT IN(0,1)
  )
  -- Server-level permissions are not covered by the database permission list.
  -- These two metadata/connection permissions are public SQL Server defaults.
  AND NOT EXISTS(SELECT 1 FROM sys.fn_my_permissions(NULL,'SERVER')
    WHERE permission_name NOT IN('CONNECT SQL','VIEW ANY DATABASE'))
  -- Also reject effective non-EXECUTE access on user objects inherited from an
  -- accidentally widened approved role (including column-level data access).
  AND NOT EXISTS(
    SELECT 1 FROM sys.objects o
    CROSS APPLY sys.fn_my_permissions(QUOTENAME(SCHEMA_NAME(o.schema_id))+N'.'+QUOTENAME(o.name),'OBJECT') p
    WHERE o.is_ms_shipped=0 AND p.permission_name<>'EXECUTE'
  )
  -- The approved role itself must not acquire arbitrary helper procedures.
  -- Allowed names are bound by the driver, never by an HTTP request.
  AND ISJSON(@AllowedProceduresJson)=1
  AND NOT EXISTS(
    SELECT 1 FROM sys.objects o
    CROSS APPLY sys.fn_my_permissions(QUOTENAME(SCHEMA_NAME(o.schema_id))+N'.'+QUOTENAME(o.name),'OBJECT') p
    WHERE o.is_ms_shipped=0 AND p.permission_name='EXECUTE'
      AND NOT EXISTS(SELECT 1 FROM OPENJSON(@AllowedProceduresJson) j
        WHERE j.type=1 AND j.value COLLATE Latin1_General_100_BIN2=(SCHEMA_NAME(o.schema_id)+N'.'+o.name) COLLATE Latin1_General_100_BIN2)
  )
  THEN 1 ELSE 0 END AS allowed;
