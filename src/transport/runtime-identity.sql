/* Fixed admission probe, not a migration. @ExpectedRole is a typed driver parameter. */
SELECT CASE WHEN IS_MEMBER(@ExpectedRole)=1
  AND COALESCE(IS_SRVROLEMEMBER('sysadmin'),0)=0
  -- SQL Server grants these two metadata permissions to public by default.
  AND NOT EXISTS(SELECT 1 FROM sys.fn_my_permissions(NULL,'DATABASE') WHERE permission_name NOT IN
    ('CONNECT','VIEW ANY COLUMN ENCRYPTION KEY DEFINITION','VIEW ANY COLUMN MASTER KEY DEFINITION'))
  AND NOT EXISTS(SELECT 1 FROM sys.database_principals WHERE type='R' AND name NOT IN ('public',@ExpectedRole) AND IS_MEMBER(name)=1)
  THEN 1 ELSE 0 END AS allowed;
