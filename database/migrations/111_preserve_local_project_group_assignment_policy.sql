/* Preserve migration 086's local-project freshness policy after the group-source
   overlap change. Applied migration 110 remains immutable. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='110') THROW 52000,'Migration 110 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='111') THROW 52000,'Migration 111 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.AllocateGuard')),
 @old nvarchar(200)=N'p.LastSyncedAtUtc BETWEEN @cutoff AND @now';
IF @definition IS NULL OR (LEN(@definition)-LEN(REPLACE(@definition,@old,N'')))<>LEN(@old)
 OR CHARINDEX('GroupAssignmentId IS NULL',@definition)=0 THROW 52000,'Unexpected group-aware allocation contract.',1;
SET @definition=REPLACE(@definition,@old,N'gp._ProjectCurrent(p.ProjectId,@cutoff,@now)=1');
SET @definition=REPLACE(@definition,N'CREATE PROCEDURE',N'ALTER PROCEDURE');
EXEC sys.sp_executesql @definition;
INSERT gp.SchemaMigrations(Version,Description) VALUES('111',N'Preserve persistent local-project policy in group-aware individual guard allocation');COMMIT;
